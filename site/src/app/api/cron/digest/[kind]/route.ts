import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { callerNamer, eodReport, etDate, morningDigest, type DigestCtx } from "@/lib/acq/digest";
import { callUrl, contactUrl, drain, reconcile } from "@/lib/acq/processor";
import { recentCalls } from "@/lib/acq/store";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Slack reports (vercel.json crons, Mon–Sat):
 *   /api/cron/digest/morning  ~8:30 am ET — callbacks due/overdue, leads
 *                             waiting on Sumeet, open pipeline problems
 *   /api/cron/digest/eod      ~9 pm ET — the full end-of-day report
 * Both first pull the day's calls from WAVV (catches lost webhooks) and
 * finish pending processing, so the report reflects every call.
 * Posts to SLACK_DIGEST_WEBHOOK_URL (the daily-summary channel), else
 * SLACK_WEBHOOK_URL. Manual run: ?date=YYYY-MM-DD, ?dry=1 returns the text
 * without posting. Auth: `Authorization: Bearer $CRON_SECRET` (Vercel cron
 * sends it) or ?secret= for a manual run.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const secret = process.env.CRON_SECRET;
  const q = req.nextUrl.searchParams;
  const given = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? q.get("secret");
  if (!secret || given !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  if (kind !== "morning" && kind !== "eod") return NextResponse.json({ ok: false, error: "kind must be morning or eod" }, { status: 404 });
  const db = await getDb();
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 503 });

  const day = q.get("date") ?? etDate(new Date());
  const dry = q.get("dry") === "1";
  const sunday = new Date(`${day}T12:00:00Z`).getUTCDay() === 0;

  const rec = await reconcile(db, 30).catch((e) => ({ seen: 0, added: 0, error: String(e).slice(0, 200) }));
  const drained = await drain(db, 60).catch((e) => ({ error: String(e).slice(0, 200) }));

  const x: DigestCtx = { contactUrl, callUrl, callerName: callerNamer() };
  const calls = await recentCalls(db, kind === "eod" ? 3 : 40, 5000, { plan: true });
  const text = kind === "eod" ? eodReport(calls, day, x, { recovered: rec.added }) : morningDigest(calls, day, x);
  // No Sunday dialing: stay quiet unless something actually happened.
  const skip = sunday && /No outbound calls today|no calls\./.test(text) && !q.get("date");
  const posted = dry || skip ? null : await postSlack(text);
  return NextResponse.json({ ok: true, kind, day, skipped: skip, posted, reconcile: rec, drained, ...(dry ? { text } : {}) });
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
