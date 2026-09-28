import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { renderImage, verifyImage, type ImageKind } from "@/lib/leads/images";
import { getLead } from "@/lib/leads/store";

export const runtime = "nodejs";

/**
 * Property pictures for report emails (Street View, satellite with the lot
 * outlined, road map). Public URL, but only with a valid signature — email
 * clients can't log in. Rendered on request; clients and Gmail's image proxy
 * cache them (the URL changes whenever the report is rebuilt).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  const sp = req.nextUrl.searchParams;
  if (!verifyImage(id, kind, sp.get("v"), sp.get("s"))) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const lead = db ? await getLead(db, id) : null;
  const g = lead?.dossier?.geocode.data;
  if (!lead || !g) return new Response("Not found", { status: 404 });
  const img = await renderImage(kind as ImageKind, g.lat, g.lng, lead.dossier?.parcel.data?.rings ?? null);
  if (!img) return new Response("Image unavailable", { status: 404 });
  return new Response(img.body as BodyInit, {
    headers: {
      "Content-Type": img.type,
      "Cache-Control": "public, max-age=2592000, immutable",
      "X-Image-Source": img.source,
    },
  });
}
