import { NextResponse } from "next/server";
import { dbConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Tells the thank-you page which optional features are live. */
export function GET() {
  return NextResponse.json({ photos: dbConfigured() }, { headers: { "Cache-Control": "no-store" } });
}
