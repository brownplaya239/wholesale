import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { LEAD_STATUSES } from "@/lib/leads/pipeline";
import { setStatus } from "@/lib/leads/store";

export const runtime = "nodejs";

/** Pipeline stage (contacted → appointment → offer → contract → closed). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const status = String(form?.get("status") ?? "");
  const db = await getDb();
  if (db && (LEAD_STATUSES as readonly string[]).includes(status)) await setStatus(db, id, status);
  return NextResponse.redirect(new URL(`/admin/leads/${encodeURIComponent(id)}`, req.url), 303);
}
