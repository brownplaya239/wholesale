import { NextRequest, NextResponse } from "next/server";
import { testFeeds } from "@/lib/enrich/mls";

export const runtime = "nodejs";

/** "Test MLS connection" (admin page button): one tiny query per feed. */
export async function POST(req: NextRequest) {
  const results = await testFeeds();
  const back = new URL("/admin", req.url);
  back.searchParams.set(
    "mls",
    results.length ? results.map((r) => `${r.feed}: ${r.ok ? "OK" : "FAILED"} — ${r.detail}`).join(" | ") : "No MLS feed configured."
  );
  return NextResponse.redirect(back, 303);
}
