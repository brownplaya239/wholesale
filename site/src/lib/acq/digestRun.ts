/**
 * Runs one Slack report end to end: pull the day's calls from WAVV (catches
 * lost webhooks), finish pending processing, build the text, post it to the
 * daily-summary channel (SLACK_DIGEST_WEBHOOK_URL, else SLACK_WEBHOOK_URL).
 * Called by /api/cron/daily (morning agenda) and /api/cron/digest/eod.
 */
import type { Db } from "@/lib/db";
import { callerNamer, eodReport, etDate, morningDigest, type DigestCtx } from "./digest";
import { callUrl, contactUrl, drain, reconcile } from "./processor";
import { recentCalls } from "./store";

export type DigestKind = "morning" | "eod";

export async function runDigest(
  db: Db,
  kind: DigestKind,
  opts: { day?: string; dry?: boolean; skipSync?: boolean } = {},
): Promise<Record<string, unknown>> {
  const day = opts.day ?? etDate(new Date());
  const sunday = new Date(`${day}T12:00:00Z`).getUTCDay() === 0;
  // No Sunday dialing: no Sunday agenda, and no Sunday EOD unless a day was asked for.
  if (sunday && !opts.day) return { kind, day, skipped: "sunday" };

  let recovered = 0;
  const sync: Record<string, unknown> = {};
  if (!opts.skipSync) {
    const rec = await reconcile(db, 30).catch((e) => ({ seen: 0, added: 0, error: String(e).slice(0, 200) }));
    recovered = rec.added;
    sync.reconcile = rec;
    sync.drained = await drain(db, 60).catch((e) => ({ error: String(e).slice(0, 200) }));
  }
  const x: DigestCtx = { contactUrl, callUrl, callerName: callerNamer() };
  const calls = await recentCalls(db, kind === "eod" ? 3 : 40, 5000, { plan: true });
  const text = kind === "eod" ? eodReport(calls, day, x, { recovered }) : morningDigest(calls, day, x);
  const posted = opts.dry ? null : await postSlack(text);
  return { kind, day, posted, ...sync, ...(opts.dry ? { text } : {}) };
}

async function postSlack(text: string): Promise<{ ok: boolean; detail: string }> {
  const url = process.env.SLACK_DIGEST_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL;
  if (!url) return { ok: false, detail: "no SLACK_DIGEST_WEBHOOK_URL / SLACK_WEBHOOK_URL" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, unfurl_links: false, unfurl_media: false }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`ACQ DIGEST SLACK FAILURE HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (err) {
    console.error(`ACQ DIGEST SLACK FAILURE ${String(err)}`);
    return { ok: false, detail: String(err).slice(0, 200) };
  }
}
