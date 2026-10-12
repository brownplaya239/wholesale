/**
 * Postgres side of the acquisition machine: the call log (append-mostly —
 * the compliance record of every dial the dialer reports), webhook dedupe,
 * and the internal suppression list (append-only; never deleted).
 */
import { iso, type Db } from "@/lib/db";
import { contactNumber, type WavvCall } from "./wavv";

export type CallRow = {
  id: string;
  direction: string | null;
  phone: string | null;
  contactId: string | null;
  userId: string | null;
  campaignId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  seconds: number | null;
  outcome: string | null;
  human: boolean | null;
  disposition: string | null;
  dispositionKey: string | null;
  note: string | null;
  dims: Record<string, string>;
  conversation: boolean | null;
  plan: Record<string, unknown> | null;
  flags: { severity: string; code: string; detail: string }[];
  endedStatus: string;
  endedAttempts: number;
  endedError: string | null;
  recorded: boolean;
  transcriptStatus: string;
  transcriptAttempts: number;
  transcript: string | null;
  wavvSummary: string | null;
  intel: Record<string, unknown> | null;
  intelStatus: string | null;
  intelError: string | null;
};

type Row = Record<string, unknown>;

function toCall(r: Row): CallRow {
  return {
    id: String(r.id),
    direction: (r.direction as string) ?? null,
    phone: (r.phone as string) ?? null,
    contactId: (r.contact_id as string) ?? null,
    userId: (r.user_id as string) ?? null,
    campaignId: (r.campaign_id as string) ?? null,
    startedAt: iso(r.started_at),
    endedAt: iso(r.ended_at),
    seconds: r.seconds == null ? null : Number(r.seconds),
    outcome: (r.outcome as string) ?? null,
    human: (r.human as boolean) ?? null,
    disposition: (r.disposition as string) ?? null,
    dispositionKey: (r.disposition_key as string) ?? null,
    note: (r.note as string) ?? null,
    dims: (r.dims as Record<string, string>) ?? {},
    conversation: (r.conversation as boolean) ?? null,
    plan: (r.plan as Record<string, unknown>) ?? null,
    flags: (r.flags as CallRow["flags"]) ?? [],
    endedStatus: String(r.ended_status),
    endedAttempts: Number(r.ended_attempts ?? 0),
    endedError: (r.ended_error as string) ?? null,
    recorded: Boolean(r.recorded),
    transcriptStatus: String(r.transcript_status),
    transcriptAttempts: Number(r.transcript_attempts ?? 0),
    transcript: (r.transcript as string) ?? null,
    wavvSummary: (r.wavv_summary as string) ?? null,
    intel: (r.intel as Record<string, unknown>) ?? null,
    intelStatus: (r.intel_status as string) ?? null,
    intelError: (r.intel_error as string) ?? null,
  };
}

/** True the first time (event, call id) is seen — WAVV delivers at-least-once. */
export async function firstDelivery(db: Db, event: string, callId: string): Promise<boolean> {
  const rows = await db.q(
    `INSERT INTO acq_webhook_events (event, call_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING call_id`,
    [event, callId]
  );
  return rows.length > 0;
}

/** Inserts or fills in a call; later events never blank earlier values. */
export async function upsertCall(db: Db, c: WavvCall, ended: boolean): Promise<void> {
  await db.q(
    `INSERT INTO acq_calls (id, direction, phone, contact_id, user_id, campaign_id, started_at, ended_at,
       seconds, outcome, human, disposition, note, recorded, ended_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       direction = COALESCE(EXCLUDED.direction, acq_calls.direction),
       phone = COALESCE(EXCLUDED.phone, acq_calls.phone),
       contact_id = COALESCE(EXCLUDED.contact_id, acq_calls.contact_id),
       user_id = COALESCE(EXCLUDED.user_id, acq_calls.user_id),
       campaign_id = COALESCE(EXCLUDED.campaign_id, acq_calls.campaign_id),
       started_at = COALESCE(EXCLUDED.started_at, acq_calls.started_at),
       ended_at = COALESCE(EXCLUDED.ended_at, acq_calls.ended_at),
       seconds = COALESCE(EXCLUDED.seconds, acq_calls.seconds),
       outcome = COALESCE(EXCLUDED.outcome, acq_calls.outcome),
       human = COALESCE(EXCLUDED.human, acq_calls.human),
       disposition = COALESCE(EXCLUDED.disposition, acq_calls.disposition),
       note = COALESCE(EXCLUDED.note, acq_calls.note),
       recorded = acq_calls.recorded OR EXCLUDED.recorded,
       ended_status = CASE WHEN acq_calls.ended_status = 'waiting' AND EXCLUDED.ended_status = 'pending'
                           THEN 'pending' ELSE acq_calls.ended_status END,
       updated_at = now()`,
    [
      c.id,
      c.direction ?? null,
      contactNumber(c),
      c.contactId ?? null,
      c.userId ?? null,
      c.campaignId ?? null,
      c.startedAt ?? null,
      c.endedAt ?? null,
      c.seconds ?? null,
      c.outcome ?? null,
      c.human ?? null,
      c.disposition ?? null,
      c.note ?? null,
      Boolean(c.recorded || c.recordingUrl),
      ended ? "pending" : "waiting",
    ]
  );
}

export async function getCall(db: Db, id: string): Promise<CallRow | null> {
  const rows = await db.q<Row>(`SELECT * FROM acq_calls WHERE id = $1`, [id]);
  return rows[0] ? toCall(rows[0]) : null;
}

/** Atomically claims the disposition step (true for exactly one worker). */
export async function claimEnded(db: Db, id: string): Promise<boolean> {
  const rows = await db.q(
    `UPDATE acq_calls SET ended_status = 'running', ended_attempts = ended_attempts + 1, updated_at = now()
     WHERE id = $1 AND (ended_status IN ('pending', 'failed')
       OR (ended_status = 'running' AND updated_at < now() - interval '5 minutes'))
     RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

export async function finishEnded(
  db: Db,
  id: string,
  u: { status: "done" | "failed" | "skipped"; error?: string | null; dispositionKey?: string; conversation?: boolean; plan?: unknown; flags?: unknown; dims?: unknown }
): Promise<void> {
  await db.q(
    `UPDATE acq_calls SET ended_status = $2, ended_error = $3,
       disposition_key = COALESCE($4, disposition_key), conversation = COALESCE($5, conversation),
       plan = COALESCE($6::jsonb, plan), flags = COALESCE($7::jsonb, flags), dims = COALESCE($8::jsonb, dims),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      u.status,
      u.error ?? null,
      u.dispositionKey ?? null,
      u.conversation ?? null,
      u.plan ? JSON.stringify(u.plan) : null,
      u.flags ? JSON.stringify(u.flags) : null,
      u.dims ? JSON.stringify(u.dims) : null,
    ]
  );
}

export async function markRecorded(db: Db, id: string): Promise<void> {
  await db.q(
    `UPDATE acq_calls SET recorded = true,
       transcript_status = CASE WHEN transcript_status IN ('waiting', 'none') THEN 'pending' ELSE transcript_status END,
       updated_at = now()
     WHERE id = $1`,
    [id]
  );
}

export async function setTranscript(
  db: Db,
  id: string,
  u: { status: "pending" | "ready" | "none" | "failed"; transcript?: string | null; summary?: string | null }
): Promise<void> {
  await db.q(
    `UPDATE acq_calls SET transcript_status = $2, transcript_attempts = transcript_attempts + 1,
       transcript = COALESCE($3, transcript), wavv_summary = COALESCE($4, wavv_summary), updated_at = now()
     WHERE id = $1`,
    [id, u.status, u.transcript ?? null, u.summary ?? null]
  );
}

/** Claims the AI step (true for exactly one worker). */
export async function claimIntel(db: Db, id: string): Promise<boolean> {
  const rows = await db.q(
    `UPDATE acq_calls SET intel_status = 'running', updated_at = now()
     WHERE id = $1 AND transcript_status = 'ready'
       AND (intel_status IS NULL OR intel_status = 'failed'
         OR (intel_status = 'running' AND updated_at < now() - interval '5 minutes'))
     RETURNING id`,
    [id]
  );
  return rows.length > 0;
}

export async function setIntel(db: Db, id: string, u: { status: "done" | "failed" | "skipped"; intel?: unknown; error?: string | null }): Promise<void> {
  await db.q(
    `UPDATE acq_calls SET intel_status = $2, intel = COALESCE($3::jsonb, intel), intel_error = $4,
       intel_at = CASE WHEN $2 = 'done' THEN now() ELSE intel_at END, updated_at = now()
     WHERE id = $1`,
    [id, u.status, u.intel ? JSON.stringify(u.intel) : null, u.error ?? null]
  );
}

/** Work left behind by a timeout or an outage — retried piggyback and by cron. */
export async function pendingWork(db: Db, limit: number): Promise<{ ended: string[]; transcripts: string[]; intel: string[] }> {
  const [ended, transcripts, intel] = await Promise.all([
    db.q<{ id: string }>(
      `SELECT id FROM acq_calls WHERE (ended_status IN ('pending', 'failed') OR
         (ended_status = 'running' AND updated_at < now() - interval '5 minutes'))
         AND ended_attempts < 5 AND updated_at < now() - interval '1 minute'
       ORDER BY updated_at LIMIT $1`,
      [limit]
    ),
    db.q<{ id: string }>(
      `SELECT id FROM acq_calls WHERE transcript_status = 'pending' AND transcript_attempts < 15
         AND updated_at < now() - interval '2 minutes' ORDER BY updated_at LIMIT $1`,
      [limit]
    ),
    db.q<{ id: string }>(
      `SELECT id FROM acq_calls WHERE transcript_status = 'ready' AND (intel_status IS NULL OR intel_status = 'failed')
         AND updated_at < now() - interval '2 minutes' ORDER BY updated_at LIMIT $1`,
      [limit]
    ),
  ]);
  return { ended: ended.map((r) => r.id), transcripts: transcripts.map((r) => r.id), intel: intel.map((r) => r.id) };
}

export async function addSuppression(
  db: Db,
  s: { kind: "phone" | "contact" | "property"; value: string; reason: string; source: string; callId?: string | null; contactId?: string | null }
): Promise<void> {
  await db.q(
    `INSERT INTO acq_suppression (kind, value, reason, source, call_id, contact_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [s.kind, s.value, s.reason, s.source, s.callId ?? null, s.contactId ?? null]
  );
}

export async function listSuppression(db: Db): Promise<{ createdAt: string; kind: string; value: string; reason: string; source: string; callId: string | null; contactId: string | null }[]> {
  const rows = await db.q<Row>(`SELECT * FROM acq_suppression ORDER BY created_at`);
  return rows.map((r) => ({
    createdAt: iso(r.created_at) ?? "",
    kind: String(r.kind),
    value: String(r.value),
    reason: String(r.reason),
    source: String(r.source),
    callId: (r.call_id as string) ?? null,
    contactId: (r.contact_id as string) ?? null,
  }));
}

export async function recentCalls(db: Db, days: number, limit = 500): Promise<CallRow[]> {
  const rows = await db.q<Row>(
    `SELECT id, direction, phone, contact_id, user_id, campaign_id, started_at, ended_at, seconds, outcome, human,
            disposition, disposition_key, note, dims, conversation, NULL::jsonb AS plan, flags, ended_status,
            ended_attempts, ended_error, recorded, transcript_status, transcript_attempts, NULL AS transcript,
            NULL AS wavv_summary, intel, intel_status, intel_error
       FROM acq_calls WHERE COALESCE(started_at, created_at) > now() - ($1::text || ' days')::interval
       ORDER BY COALESCE(started_at, created_at) DESC LIMIT $2`,
    [String(days), limit]
  );
  return rows.map(toCall);
}
