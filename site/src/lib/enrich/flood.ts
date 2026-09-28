/** FEMA National Flood Hazard Layer — effective flood zone at the property. */
import { arcgisValidate, fetchJson, nowIso } from "./http";
import type { FloodData, Section, SourceRef } from "./types";

const NFHL_ZONES = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28";

export async function floodZone(lat: number, lng: number): Promise<Section<FloodData>> {
  const source: SourceRef = {
    id: "fema_nfhl",
    name: "FEMA National Flood Hazard Layer (effective flood zones)",
    url: "https://msc.fema.gov/portal/home",
    retrievedAt: nowIso(),
  };
  try {
    const params = new URLSearchParams({
      geometry: JSON.stringify({ x: lng, y: lat }),
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,DFIRM_ID",
      returnGeometry: "false",
      f: "json",
    });
    const json = await fetchJson<{ features?: { attributes: Record<string, string | number | null> }[] }>(
      "fema_nfhl",
      `${NFHL_ZONES}/query?${params}`,
      { validate: arcgisValidate, timeoutMs: 15_000, cacheKey: `fema_nfhl:${lat.toFixed(5)},${lng.toFixed(5)}`, cacheTtlSec: 30 * 86_400 }
    );
    const feats = json.features ?? [];
    if (!feats.length) {
      return { status: "missing", data: null, source, note: "No mapped FEMA flood zone at this point (area may be unstudied)." };
    }
    // Several polygons can touch a point; the special-flood-hazard one governs.
    const a = (feats.find((f) => f.attributes.SFHA_TF === "T") ?? feats[0]).attributes;
    const bfe = a.STATIC_BFE == null ? null : Number(a.STATIC_BFE);
    return {
      status: "ok",
      source,
      data: {
        zone: a.FLD_ZONE ? String(a.FLD_ZONE) : null,
        subtype: a.ZONE_SUBTY ? String(a.ZONE_SUBTY) : null,
        sfha: a.SFHA_TF === "T" ? true : a.SFHA_TF === "F" ? false : null,
        // FEMA uses -9999 for "no static BFE".
        baseFloodElevation: bfe != null && bfe > -9000 ? bfe : null,
        firmPanel: a.DFIRM_ID ? String(a.DFIRM_ID) : null,
      },
    };
  } catch (err) {
    return { status: "error", data: null, source, error: String(err) };
  }
}
