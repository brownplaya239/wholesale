import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listSuppression, recentCalls } from "@/lib/acq/store";

export const runtime = "nodejs";

const csv = (rows: (string | number | boolean | null)[][]) =>
  rows.map((r) => r.map((v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(",")).join("\n") + "\n";

/**
 * Admin-only CSV exports for the local pipeline and the compliance file:
 *   ?kind=dnc   -> data/processed/acq/internal_dnc.csv (09 build never
 *                  re-releases these numbers)
 *   ?kind=calls -> compliance/dial_log_<date>.csv (every dial WAVV reported,
 *                  with its disposition and compliance flags; last 90 days)
 */
export async function GET(req: NextRequest) {
  const db = await getDb();
  if (!db) return NextResponse.json({ ok: false, error: "no_db" }, { status: 503 });
  const kind = req.nextUrl.searchParams.get("kind");
  const day = new Date().toISOString().slice(0, 10);
  let body: string;
  let name: string;
  if (kind === "dnc") {
    const rows = await listSuppression(db);
    body = csv([["created_at", "kind", "phone_or_id", "reason", "source", "call_id", "contact_id"], ...rows.map((r) => [r.createdAt, r.kind, r.value, r.reason, r.source, r.callId, r.contactId])]);
    name = "internal_dnc.csv";
  } else if (kind === "calls") {
    const rows = await recentCalls(db, 90, 50_000);
    body = csv([
      ["started_at", "call_id", "direction", "number", "caller", "seconds", "human", "outcome", "disposition", "conversation", "county", "cohort", "lane", "flags"],
      ...rows.map((c) => [c.startedAt, c.id, c.direction, c.phone, c.userId, c.seconds, c.human, c.outcome, c.disposition, c.conversation, c.dims.county ?? "", c.dims.cohort ?? "", c.dims.lane ?? "", c.flags.map((f) => `${f.severity}:${f.code}`).join("; ")]),
    ]);
    name = `dial_log_${day}.csv`;
  } else {
    return NextResponse.json({ ok: false, error: "kind must be dnc or calls" }, { status: 400 });
  }
  return new NextResponse(body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
