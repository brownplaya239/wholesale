import { NextRequest, NextResponse } from "next/server";
import { enrichLead } from "@/lib/leads/enrich";

export const runtime = "nodejs";
export const maxDuration = 120;

/** "Re-run enrichment" from the report. No email — you're already looking at it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await enrichLead(id, { notify: false, reason: "manual" });
  const back = new URL(`/admin/leads/${encodeURIComponent(id)}`, req.url);
  back.searchParams.set("enriched", result);
  return NextResponse.redirect(back, 303);
}
