import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ingestSr1aFile, sr1aFileName } from "@/lib/sr1a";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Load one SR1A deed file on demand (admin page button). */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const year = Number(form?.get("year") ?? new Date().getFullYear());
  const force = form?.get("force") === "1";
  const db = await getDb();
  const back = new URL("/admin", req.url);
  if (!db || !Number.isInteger(year) || year < 2010 || year > new Date().getFullYear() + 1) {
    back.searchParams.set("ingest", "unavailable");
    return NextResponse.redirect(back, 303);
  }
  const r = await ingestSr1aFile(db, sr1aFileName(year), { force });
  back.searchParams.set("ingest", `${r.file}: ${r.status}${r.rowsInserted != null ? ` (+${r.rowsInserted})` : ""}`);
  return NextResponse.redirect(back, 303);
}
