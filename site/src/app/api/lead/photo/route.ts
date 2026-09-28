import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { addPhoto, getLead } from "@/lib/leads/store";

export const runtime = "nodejs";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 3 * 1024 * 1024;
const WINDOW_MS = 14 * 86_400_000;

/**
 * Optional seller photos from /thank-you. The browser downsizes to JPEG
 * first; stored privately in the lead database, viewable only in the
 * authenticated report.
 */
export async function POST(req: NextRequest) {
  const db = await getDb();
  if (!db) return NextResponse.json({ ok: false, error: "photos_unavailable" }, { status: 503 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_form" }, { status: 400 });
  }
  const leadId = String(form.get("leadId") ?? "").replace(/[^\w-]/g, "").slice(0, 64);
  const file = form.get("photo");
  if (!leadId || !(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
  }
  if (!TYPES.has(file.type)) return NextResponse.json({ ok: false, error: "bad_type" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });
  const lead = await getLead(db, leadId);
  if (!lead || Date.now() - Date.parse(lead.createdAt) > WINDOW_MS) {
    return NextResponse.json({ ok: false, error: "unknown_lead" }, { status: 404 });
  }
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const r = await addPhoto(db, leadId, { id: crypto.randomUUID(), contentType: file.type, size: file.size, b64 });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 409 });
  return NextResponse.json({ ok: true, count: r.count });
}
