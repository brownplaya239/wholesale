import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runDigest } from "@/lib/acq/digestRun";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * /api/cron/digest/eod   — vercel cron, ~9:15 pm EDT / 8:15 pm EST, Mon–Sat
 * /api/cron/digest/morning — on demand (the scheduled agenda rides the daily cron)
 * Manual run: ?date=YYYY-MM-DD, ?dry=1 returns the text without posting.
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel sends it) or ?secret=.
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
  const res = await runDigest(db, kind, { day: q.get("date") ?? undefined, dry: q.get("dry") === "1" });
  return NextResponse.json({ ok: true, ...res });
}
