import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { enrichLead } from "@/lib/leads/enrich";
import { ingestSr1aFile, sr1aFileName } from "@/lib/sr1a";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Daily (vercel.json cron): refresh the state's deed-sales files when they
 * change, then retry enrichments that failed or never finished.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const db = await getDb();
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 503 });
  const y = new Date().getFullYear();
  const ingest = [];
  // The year-to-date file for the current sampling year, the finished prior
  // year, and the next year's YTD once the state starts publishing it.
  for (const year of [y + 1, y, y - 1]) ingest.push(await ingestSr1aFile(db, sr1aFileName(year, y)));
  const stuck = await db.q<{ id: string }>(
    `SELECT id FROM leads
     WHERE enrichment_status IN ('pending', 'failed', 'running')
       AND updated_at < now() - interval '10 minutes' AND enrichment_attempts < 5
     ORDER BY created_at DESC LIMIT 10`
  );
  const retried: Record<string, string> = {};
  for (const { id } of stuck) retried[id] = await enrichLead(id, { notify: true, reason: "retry" });
  return NextResponse.json({ ok: true, ingest, retried });
}
