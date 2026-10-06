import { type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { geocode } from "@/lib/enrich/geocode";
import { arcgisValidate, fetchJson } from "@/lib/enrich/http";
import { PARCEL_LAYER } from "@/lib/enrich/parcel";
import { inspectionAccess, privateJson } from "@/lib/inspection/access";
import { getInspection, saveLocation } from "@/lib/inspection/store";
import { propertyInput } from "@/lib/inspection/model";

export const runtime = "nodejs";
type Feature = { attributes: { PAMS_PIN: string; PROP_LOC: string; MUN_NAME: string; PCLBLOCK: string; PCLLOT: string }; geometry?: { rings: [number, number][][] }; centroid?: { x: number; y: number } };
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await inspectionAccess(req); if (denied) return denied;
  const db = await getDb(); if (!db) return privateJson({ error: "Lead database is not connected" }, 503);
  const p = await getInspection(db, (await context.params).id); if (!p) return privateJson({ error: "Property not found" }, 404);
  if (!p.objectId && !p.pin) return privateJson({ rings: null, note: "No confirmed parcel identifier; location remains a candidate." });
  const where = p.objectId ? `OBJECTID = ${p.objectId}` : `PAMS_PIN = '${p.pin!.replace(/'/g, "''")}'`;
  try {
    const result = await fetchJson<{ features?: Feature[] }>("nj_parcels", `${PARCEL_LAYER}/query`, {
      form: { where, outFields: "PAMS_PIN,PROP_LOC,MUN_NAME,PCLBLOCK,PCLLOT", returnGeometry: "true", outSR: "4326", resultRecordCount: "2", f: "json" },
      validate: arcgisValidate, cacheKey: `d4d_parcel:${where}`, cacheTtlSec: 7 * 86400, retries: 1,
    });
    const f = result.features?.length === 1 ? result.features[0] : null;
    if (!f || (p.pin && f.attributes.PAMS_PIN !== p.pin)) return privateJson({ rings: null, note: "Parcel identity could not be corroborated. Verify block/lot." });
    return privateJson({ rings: f.geometry?.rings ?? null, attributes: f.attributes, source: `${PARCEL_LAYER}/query?where=${encodeURIComponent(where)}&outFields=*&f=pjson`, retrievedAt: new Date().toISOString() });
  } catch { return privateJson({ error: "NJ parcel service is unavailable; retry later" }, 502); }
}
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await inspectionAccess(req, true); if (denied) return denied;
  const db = await getDb(); if (!db) return privateJson({ error: "Lead database is not connected" }, 503);
  const p = await getInspection(db, (await context.params).id); if (!p) return privateJson({ error: "Property not found" }, 404);
  const resolved = await geocode(`${p.address}, ${p.city}, NJ`, null);
  const g = resolved.data;
  if (!g || !["exact", "interpolated"].includes(g.match) || !propertyInput.safeParse({ ...p, lat: g.lat, lng: g.lng }).success) return privateJson({ error: "No reliable NJ address location. Confirm municipality and block/lot before plotting." }, 422);
  const property = await saveLocation(db, p.id, p.revision, { lat: g.lat, lng: g.lng, locationStatus: "candidate" });
  if (!property) return privateJson({ error: "Property changed while resolving; reload and retry" }, 409);
  return privateJson({ property, note: "Geocoded candidate only; confirm the address and parcel before scoring.", source: resolved.source });
}
