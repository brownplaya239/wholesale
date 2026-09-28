/**
 * The unified lead record. One row per seller inquiry; the thank-you page's
 * answers, photos and enrichment all update the same row (same lead ID).
 *
 * Duplicate handling:
 * - same lead ID resubmitted (double-tap, network retry) -> no new row
 * - same phone + street address within 24h under a new ID -> merged into the
 *   original as an event, no new row, no second notification
 */
import { iso, type Db } from "@/lib/db";
import type { Dossier } from "@/lib/enrich/types";
import type { Workflow } from "@/lib/enrich/insights";
import type { LeadSource } from "./source";

export type LeadEvent = { type: string; at: string; [k: string]: unknown };

export type LeadRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  name: string;
  phone: string;
  email: string | null;
  addressOriginal: string;
  addressCurrent: string;
  addressUnit: string | null;
  placeId: string | null;
  timeline: string | null;
  priority: string | null;
  condition: string | null;
  occupancy: string | null;
  beds: string | null;
  baths: string | null;
  notes: string | null;
  source: LeadSource | Record<string, never>;
  consent: Record<string, unknown>;
  events: LeadEvent[];
  workflow: Workflow | null;
  notified: Record<string, string>;
  enrichmentStatus: string;
  enrichmentAttempts: number;
  enrichmentError: string | null;
  enrichedAt: string | null;
  dossier: Dossier | null;
  photoCount?: number;
  /** List view only: the comp-based range without loading the whole dossier. */
  valuation?: { low: number; mid: number; high: number; confidence: string } | null;
};

const SUFFIXES: [RegExp, string][] = [
  [/\bstreet\b/g, "st"], [/\bavenue\b/g, "ave"], [/\broad\b/g, "rd"], [/\bdrive\b/g, "dr"],
  [/\blane\b/g, "ln"], [/\bcourt\b/g, "ct"], [/\bplace\b/g, "pl"], [/\bboulevard\b/g, "blvd"],
  [/\bterrace\b/g, "ter"], [/\bcircle\b/g, "cir"], [/\bparkway\b/g, "pkwy"], [/\bhighway\b/g, "hwy"],
];

/** "714 Dennisville Road, Cape May…" and "714 Dennisville Rd." dedupe together. */
export function normalizeStreet(address: string): string {
  let s = address.split(",")[0].toLowerCase().replace(/[.#]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, abbr] of SUFFIXES) s = s.replace(re, abbr);
  return s;
}

export function dedupeKey(phoneDigits: string, address: string, unit?: string | null): string {
  return `${phoneDigits}|${normalizeStreet(address)}${unit ? `|${unit.toLowerCase()}` : ""}`;
}

type Row = Record<string, unknown>;

function toRecord(r: Row): LeadRecord {
  return {
    id: String(r.id),
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
    status: String(r.status),
    name: String(r.name),
    phone: String(r.phone),
    email: (r.email as string) ?? null,
    addressOriginal: String(r.address_original),
    addressCurrent: String(r.address_current),
    addressUnit: (r.address_unit as string) ?? null,
    placeId: (r.place_id as string) ?? null,
    timeline: (r.timeline as string) ?? null,
    priority: (r.priority as string) ?? null,
    condition: (r.condition as string) ?? null,
    occupancy: (r.occupancy as string) ?? null,
    beds: (r.beds as string) ?? null,
    baths: (r.baths as string) ?? null,
    notes: (r.notes as string) ?? null,
    source: (r.source as LeadSource) ?? {},
    consent: (r.consent as Record<string, unknown>) ?? {},
    events: (r.events as LeadEvent[]) ?? [],
    workflow: (r.workflow as Workflow) ?? null,
    notified: (r.notified as Record<string, string>) ?? {},
    enrichmentStatus: String(r.enrichment_status),
    enrichmentAttempts: Number(r.enrichment_attempts ?? 0),
    enrichmentError: (r.enrichment_error as string) ?? null,
    enrichedAt: iso(r.enriched_at),
    dossier: (r.dossier as Dossier) ?? null,
    photoCount: r.photo_count == null ? undefined : Number(r.photo_count),
    valuation: (r.valuation as LeadRecord["valuation"]) ?? null,
  };
}

export async function getLead(db: Db, id: string): Promise<LeadRecord | null> {
  const rows = await db.q<Row>(
    `SELECT l.*, (SELECT count(*)::int FROM lead_photos p WHERE p.lead_id = l.id) AS photo_count
       FROM leads l WHERE l.id = $1`,
    [id]
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listLeads(db: Db, limit = 100): Promise<LeadRecord[]> {
  const rows = await db.q<Row>(
    `SELECT l.id, l.created_at, l.updated_at, l.status, l.name, l.phone, l.email, l.address_original,
            l.address_current, l.address_unit, l.place_id, l.timeline, l.priority, l.condition,
            l.occupancy, l.beds, l.baths, l.notes, l.source, l.consent, '[]'::jsonb AS events, l.workflow, l.notified,
            l.enrichment_status, l.enrichment_attempts, l.enrichment_error, l.enriched_at,
            NULL::jsonb AS dossier, l.dossier->'comps'->'data'->'valuation' AS valuation,
            (SELECT count(*)::int FROM lead_photos p WHERE p.lead_id = l.id) AS photo_count
       FROM leads l ORDER BY l.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows.map(toRecord);
}

export type NewLead = {
  id: string;
  name: string;
  phone: string;
  address: string;
  placeId: string | null;
  source: LeadSource;
  consent: Record<string, unknown>;
  workflow: Workflow;
};

export type SaveOutcome =
  | { outcome: "created"; lead: LeadRecord }
  | { outcome: "duplicate_submit"; lead: LeadRecord }
  | { outcome: "merged"; lead: LeadRecord };

export async function saveFullLead(db: Db, n: NewLead): Promise<SaveOutcome> {
  const existing = await getLead(db, n.id);
  if (existing) return { outcome: "duplicate_submit", lead: existing };

  const key = dedupeKey(n.phone, n.address);
  const dup = await db.q<{ id: string }>(
    `SELECT id FROM leads WHERE dedupe_key = $1 AND created_at > now() - interval '24 hours'
     ORDER BY created_at DESC LIMIT 1`,
    [key]
  );
  if (dup[0]) {
    const event: LeadEvent = {
      type: "duplicate_submission",
      at: new Date().toISOString(),
      submissionId: n.id,
      pageUrl: n.consent.pageUrl ?? null,
    };
    await db.q(
      `UPDATE leads SET events = events || $2::jsonb, updated_at = now() WHERE id = $1`,
      [dup[0].id, JSON.stringify([event])]
    );
    return { outcome: "merged", lead: (await getLead(db, dup[0].id))! };
  }

  const created = await db.q<{ id: string }>(
    `INSERT INTO leads (id, name, phone, address_original, address_current, place_id, source,
       consent, events, dedupe_key, workflow)
     VALUES ($1, $2, $3, $4, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10::jsonb)
     ON CONFLICT (id) DO NOTHING RETURNING id`,
    [
      n.id,
      n.name,
      n.phone,
      n.address,
      n.placeId,
      JSON.stringify(n.source),
      JSON.stringify(n.consent),
      JSON.stringify([{ type: "submitted", at: new Date().toISOString() }]),
      key,
      JSON.stringify(n.workflow),
    ]
  );
  const lead = (await getLead(db, n.id))!;
  // Lost an insert race with a concurrent identical submit.
  return { outcome: created.length ? "created" : "duplicate_submit", lead };
}

export type DetailsPatch = Partial<{
  timeline: string;
  priority: string;
  email: string;
  condition: string;
  occupancy: string;
  beds: string;
  baths: string;
  notes: string;
  unit: string;
  address: string;
}>;

const COLUMN: Record<keyof DetailsPatch, string> = {
  timeline: "timeline",
  priority: "priority",
  email: "email",
  condition: "condition",
  occupancy: "occupancy",
  beds: "beds",
  baths: "baths",
  notes: "notes",
  unit: "address_unit",
  address: "address_current",
};

const CURRENT: Record<keyof DetailsPatch, keyof LeadRecord> = {
  timeline: "timeline",
  priority: "priority",
  email: "email",
  condition: "condition",
  occupancy: "occupancy",
  beds: "beds",
  baths: "baths",
  notes: "notes",
  unit: "addressUnit",
  address: "addressCurrent",
};

/** Applies only fields that actually changed; returns what changed. */
export async function updateDetails(
  db: Db,
  id: string,
  patch: DetailsPatch
): Promise<{ lead: LeadRecord; changed: (keyof DetailsPatch)[]; addressChanged: boolean } | null> {
  const lead = await getLead(db, id);
  if (!lead) return null;
  const changed = (Object.keys(patch) as (keyof DetailsPatch)[]).filter((k) => {
    const next = patch[k] ?? "";
    const cur = (lead[CURRENT[k]] as string | null) ?? "";
    return next !== cur;
  });
  if (!changed.length) return { lead, changed, addressChanged: false };
  const sets = changed.map((k, i) => `${COLUMN[k]} = $${i + 2}`);
  const values = changed.map((k) => patch[k] || null);
  const event: LeadEvent = {
    type: "details_updated",
    at: new Date().toISOString(),
    fields: changed,
    ...(changed.includes("address") ? { previousAddress: lead.addressCurrent } : {}),
    ...(changed.includes("unit") ? { previousUnit: lead.addressUnit } : {}),
  };
  await db.q(
    `UPDATE leads SET ${sets.join(", ")}, updated_at = now(),
       events = events || $${changed.length + 2}::jsonb WHERE id = $1`,
    [id, ...values, JSON.stringify([event])]
  );
  return {
    lead: (await getLead(db, id))!,
    changed,
    addressChanged: changed.includes("address") || changed.includes("unit"),
  };
}

/**
 * Atomically claims a notification slot; true only for the first caller.
 * Prevents duplicate alert emails across retries and concurrent requests.
 */
export async function claimNotification(db: Db, id: string, key: string): Promise<boolean> {
  const rows = await db.q(
    `UPDATE leads SET notified = notified || jsonb_build_object($2::text, now()::text)
     WHERE id = $1 AND NOT (notified ? $2) RETURNING id`,
    [id, key]
  );
  return rows.length > 0;
}

export async function releaseNotification(db: Db, id: string, key: string): Promise<void> {
  await db.q(`UPDATE leads SET notified = notified - $2::text WHERE id = $1`, [id, key]);
}

export async function setEnrichment(
  db: Db,
  id: string,
  u: { status: string; dossier?: Dossier; error?: string | null; workflow?: Workflow; startAttempt?: boolean }
): Promise<void> {
  await db.q(
    `UPDATE leads SET enrichment_status = $2,
       enrichment_attempts = enrichment_attempts + $3,
       dossier = COALESCE($4::jsonb, dossier),
       enrichment_error = $5,
       enriched_at = CASE WHEN $4::jsonb IS NULL THEN enriched_at ELSE now() END,
       workflow = COALESCE($6::jsonb, workflow),
       updated_at = now()
     WHERE id = $1`,
    [
      id,
      u.status,
      u.startAttempt ? 1 : 0,
      u.dossier ? JSON.stringify(u.dossier) : null,
      u.error ?? null,
      u.workflow ? JSON.stringify(u.workflow) : null,
    ]
  );
}

export async function setStatus(db: Db, id: string, status: string): Promise<void> {
  await db.q(
    `UPDATE leads SET status = $2, updated_at = now(), events = events || $3::jsonb WHERE id = $1`,
    [id, status, JSON.stringify([{ type: "status", at: new Date().toISOString(), status }])]
  );
}

export const MAX_PHOTOS = 8;

export async function addPhoto(
  db: Db,
  leadId: string,
  photo: { id: string; contentType: string; size: number; b64: string }
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const count = await db.q<{ n: number }>(`SELECT count(*)::int AS n FROM lead_photos WHERE lead_id = $1`, [leadId]);
  if ((count[0]?.n ?? 0) >= MAX_PHOTOS) return { ok: false, error: "photo_limit" };
  await db.q(
    `INSERT INTO lead_photos (id, lead_id, content_type, size, data_b64) VALUES ($1, $2, $3, $4, $5)`,
    [photo.id, leadId, photo.contentType, photo.size, photo.b64]
  );
  await db.q(
    `UPDATE leads SET updated_at = now(), events = events || $2::jsonb WHERE id = $1`,
    [leadId, JSON.stringify([{ type: "photo_added", at: new Date().toISOString(), photoId: photo.id }])]
  );
  return { ok: true, count: (count[0]?.n ?? 0) + 1 };
}

export async function listPhotoIds(db: Db, leadId: string): Promise<{ id: string; createdAt: string; size: number }[]> {
  const rows = await db.q<Row>(
    `SELECT id, created_at, size FROM lead_photos WHERE lead_id = $1 ORDER BY created_at`,
    [leadId]
  );
  return rows.map((r) => ({ id: String(r.id), createdAt: iso(r.created_at) ?? "", size: Number(r.size) }));
}

export async function getPhoto(db: Db, id: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  const rows = await db.q<{ content_type: string; data_b64: string }>(
    `SELECT content_type, data_b64 FROM lead_photos WHERE id = $1`,
    [id]
  );
  return rows[0] ? { contentType: rows[0].content_type, bytes: Buffer.from(rows[0].data_b64, "base64") } : null;
}

export async function setWorkflow(db: Db, id: string, workflow: Workflow): Promise<void> {
  await db.q(`UPDATE leads SET workflow = $2::jsonb WHERE id = $1`, [id, JSON.stringify(workflow)]);
}
