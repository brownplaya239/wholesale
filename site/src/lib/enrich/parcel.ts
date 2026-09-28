/**
 * Parcel + tax-assessment record from the NJ Office of GIS "Parcels and
 * MOD-IV Composite" layer (official; MOD-IV = the state tax list). Point-in-
 * parcel lookup at the geocoded location, with condo-unit resolution.
 *
 * Note: this layer's sale fields come from the annual tax list and lag by a
 * year or more — recent transfers come from SR1A (see sales.ts).
 */
import { sr1aDate } from "@/lib/sr1a";
import { arcgisValidate, fetchJson, nowIso } from "./http";
import type { ParcelData, PropertyKind, Section, SourceRef, UnitInfo } from "./types";

export const PARCEL_LAYER =
  "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0";

const FIELDS = [
  "PAMS_PIN", "PCL_MUN", "PCLBLOCK", "PCLLOT", "PCLQCODE", "PROP_CLASS", "COUNTY", "MUN_NAME",
  "PROP_LOC", "OWNER_NAME", "ST_ADDRESS", "CITY_STATE", "ZIP5", "LAND_VAL", "IMPRVT_VAL",
  "NET_VALUE", "LAST_YR_TX", "BLDG_DESC", "LAND_DESC", "CALC_ACRE", "DEED_BOOK", "DEED_PAGE",
  "DEED_DATE", "YR_CONSTR", "SALE_PRICE", "DWELL",
].join(",");

type Attrs = Record<string, string | number | null>;
type Feature = { attributes: Attrs; geometry?: { rings?: [number, number][][] } };

export const PROP_CLASS_LABELS: Record<string, string> = {
  "1": "Vacant land",
  "2": "Residential (1–4 family)",
  "3A": "Farm (regular)",
  "3B": "Farm (qualified)",
  "4A": "Commercial",
  "4B": "Industrial",
  "4C": "Apartment (5+ units)",
  "5A": "Railroad (Class I)",
  "5B": "Railroad (Class II)",
  "6A": "Personal property (telephone)",
  "6B": "Personal property (petroleum)",
  "15A": "Exempt — public school",
  "15B": "Exempt — other school",
  "15C": "Exempt — public property",
  "15D": "Exempt — church/charitable",
  "15E": "Exempt — cemetery/graveyard",
  "15F": "Exempt — other",
};

export function kindOf(propClass: string, qualifier: string, dwellings: number | null): PropertyKind {
  if (propClass === "1") return "land";
  if (propClass === "4C") return "multifamily";
  if (propClass === "2") {
    if (/^C/i.test(qualifier)) return "condo";
    if ((dwellings ?? 1) >= 2) return "multifamily";
    return "single_family";
  }
  return "other";
}

const s = (v: unknown) => (v == null ? "" : String(v).trim());
const n = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

let layerMeta: { asOf: string | null; at: number } | null = null;

/** Publisher's last data edit for the layer (cached for a day). */
export async function parcelLayerAsOf(): Promise<string | null> {
  if (layerMeta && Date.now() - layerMeta.at < 86_400_000) return layerMeta.asOf;
  try {
    const json = await fetchJson<{ editingInfo?: { dataLastEditDate?: number } }>(
      "nj_parcels",
      `${PARCEL_LAYER}?f=json`,
      { validate: arcgisValidate, cacheKey: "nj_parcels:layer_meta", cacheTtlSec: 86_400 }
    );
    const t = json.editingInfo?.dataLastEditDate;
    layerMeta = { asOf: t ? new Date(t).toISOString() : null, at: Date.now() };
  } catch {
    layerMeta = { asOf: null, at: Date.now() };
  }
  return layerMeta.asOf;
}

async function queryAtPoint(lat: number, lng: number, distanceM?: number): Promise<Feature[]> {
  const form: Record<string, string> = {
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: FIELDS,
    returnGeometry: "true",
    outSR: "4326",
    geometryPrecision: "6",
    resultRecordCount: "1000",
    f: "json",
  };
  if (distanceM) Object.assign(form, { distance: String(distanceM), units: "esriSRUnit_Meter" });
  const json = await fetchJson<{ features?: Feature[] }>("nj_parcels", `${PARCEL_LAYER}/query`, {
    form,
    validate: arcgisValidate,
    cacheKey: `nj_parcels:pt:${lat.toFixed(6)},${lng.toFixed(6)}:${distanceM ?? 0}`,
    cacheTtlSec: 7 * 86_400,
  });
  return json.features ?? [];
}

const houseNumber = (loc: string) => loc.match(/^\s*(\d+[A-Z]?)/i)?.[1]?.toUpperCase() ?? null;
const stripZeros = (u: string) => u.replace(/^0+(?=.)/, "").toUpperCase();

/** Unit token at the end of a tax-list location: "1 MECHANIC ST #302" -> "302". */
export function locationUnit(loc: string): string | null {
  const m = loc.match(/(?:#|\bUNIT\b|\bAPT\b|\bSTE\b|\bSUITE\b)\s*#?\s*([A-Z0-9-]+)\s*$/i);
  return m ? stripZeros(m[1]) : null;
}

export function pickUnit(
  features: Feature[],
  unit: string | null,
  inputAddress = ""
): { feature: Feature | null; info: UnitInfo } {
  const condos = features.filter((f) => /^C/i.test(s(f.attributes.PCLQCODE)));
  if (condos.length === 0) return { feature: null, info: { status: "not_applicable", requested: unit } };
  const candidates = condos
    .map((f) => ({ pin: s(f.attributes.PAMS_PIN), location: s(f.attributes.PROP_LOC) }))
    .sort((a, b) => a.location.localeCompare(b.location, undefined, { numeric: true }))
    .slice(0, 60);
  if (!unit) {
    return {
      feature: null,
      info: { status: "needs_unit", requested: null, candidates, note: `Condo complex with ${condos.length} units on the tax list — unit number needed.` },
    };
  }
  const u = stripZeros(unit);
  // Complexes often have several buildings, each with a "7A" — match the
  // building's house number first when the tax list carries one.
  const hn = houseNumber(inputAddress);
  const sameHouse = condos.filter((f) => hn && houseNumber(s(f.attributes.PROP_LOC)) === hn);
  const pool = sameHouse.length ? sameHouse : condos;
  const byLoc = pool.filter((f) => locationUnit(s(f.attributes.PROP_LOC)) === u);
  const byQual = pool.filter((f) => stripZeros(s(f.attributes.PCLQCODE).replace(/^C/i, "")).endsWith(u));
  const hit = byLoc.length === 1 ? byLoc[0] : byLoc.length === 0 && byQual.length === 1 ? byQual[0] : null;
  if (hit) return { feature: hit, info: { status: "matched", requested: unit } };
  return {
    feature: null,
    info: {
      status: "unmatched",
      requested: unit,
      candidates,
      note: `Unit ${unit} didn't match a single tax record among ${condos.length} units.`,
    },
  };
}

function toParcel(f: Feature, siblings: number): ParcelData {
  const a = f.attributes;
  const propClass = s(a.PROP_CLASS);
  const qualifier = s(a.PCLQCODE);
  const dwellings = n(a.DWELL);
  const cityState = s(a.CITY_STATE).replace(/\bN\.\s?J\.?/i, "NJ").replace(/\s{2,}/g, " ");
  const mailingState = cityState.match(/\b([A-Z]{2})\.?\s*$/i)?.[1]?.toUpperCase() ?? null;
  const street = s(a.ST_ADDRESS);
  const mailing = street || cityState ? `${street}${street && cityState ? ", " : ""}${cityState}${s(a.ZIP5) ? ` ${s(a.ZIP5)}` : ""}` : null;
  const loc = s(a.PROP_LOC);
  const absentee =
    mailing == null
      ? null
      : (mailingState != null && mailingState !== "NJ") ||
        (street !== "" && houseNumber(street) !== houseNumber(loc));
  const saleDate = sr1aDate(s(a.DEED_DATE));
  return {
    pin: s(a.PAMS_PIN),
    muncode: s(a.PCL_MUN),
    municipality: s(a.MUN_NAME),
    county: s(a.COUNTY),
    block: s(a.PCLBLOCK),
    lot: s(a.PCLLOT),
    qualifier,
    propClass,
    propClassLabel: PROP_CLASS_LABELS[propClass] ?? `Class ${propClass}`,
    kind: kindOf(propClass, qualifier, dwellings),
    location: loc,
    buildingDesc: s(a.BLDG_DESC) || null,
    landDesc: s(a.LAND_DESC) || null,
    acres: n(a.CALC_ACRE),
    dwellings,
    yearBuilt: n(a.YR_CONSTR) && Number(a.YR_CONSTR) > 1700 ? Number(a.YR_CONSTR) : null,
    assessed: { land: n(a.LAND_VAL), improvement: n(a.IMPRVT_VAL), net: n(a.NET_VALUE) },
    lastYearTaxes: n(a.LAST_YR_TX),
    owner: { name: s(a.OWNER_NAME) || null, mailing, mailingState, absentee },
    lastSale:
      saleDate || n(a.SALE_PRICE)
        ? { date: saleDate, price: n(a.SALE_PRICE), deedBook: s(a.DEED_BOOK) || null, deedPage: s(a.DEED_PAGE) || null }
        : null,
    rings: f.geometry?.rings ?? null,
    siblings,
  };
}

/** Every condo-unit record on a lot (units can have their own small polygons). */
async function condoUnitsInLot(muncode: string, block: string, lot: string): Promise<Feature[]> {
  const q = (v: string) => v.replace(/'/g, "''");
  const json = await fetchJson<{ features?: Feature[] }>("nj_parcels", `${PARCEL_LAYER}/query`, {
    form: {
      where: `PCL_MUN = '${q(muncode)}' AND PCLBLOCK = '${q(block)}' AND PCLLOT = '${q(lot)}' AND PCLQCODE LIKE 'C%'`,
      outFields: FIELDS,
      returnGeometry: "false",
      resultRecordCount: "2000",
      f: "json",
    },
    validate: arcgisValidate,
    cacheKey: `nj_parcels:condo_lot:${muncode}_${block}_${lot}`,
    cacheTtlSec: 7 * 86_400,
  });
  return json.features ?? [];
}

/** Until the unit is known, never show another unit's taxes/owner/sale as the seller's. */
function complexOnly(p: ParcelData, inputAddress: string): ParcelData {
  return {
    ...p,
    pin: `${p.muncode}_${p.block}_${p.lot}`,
    qualifier: "",
    kind: "condo",
    location: inputAddress.toUpperCase(),
    assessed: { land: null, improvement: null, net: null },
    lastYearTaxes: null,
    owner: { name: null, mailing: null, mailingState: null, absentee: null },
    lastSale: null,
    dwellings: null,
  };
}

export async function lookupParcel(
  lat: number,
  lng: number,
  inputAddress: string,
  unit: string | null
): Promise<{ parcel: Section<ParcelData>; unit: UnitInfo }> {
  const source: SourceRef = {
    id: "nj_parcels_modiv",
    name: "NJ Office of GIS — Parcels and MOD-IV Composite (tax list)",
    url: PARCEL_LAYER,
    asOf: await parcelLayerAsOf(),
    retrievedAt: nowIso(),
  };
  try {
    let features = await queryAtPoint(lat, lng);
    let note: string | undefined;
    if (features.length === 0) {
      // Address points sometimes sit on a driveway or just off the lot line.
      features = await queryAtPoint(lat, lng, 25);
      if (features.length) note = "Address point fell just outside the parcel; used parcels within 25 m.";
    }
    if (features.length === 0) {
      return {
        parcel: { status: "missing", data: null, source, note: "No parcel found at the geocoded location." },
        unit: { status: "not_applicable", requested: unit },
      };
    }
    // Condo complex: resolve the unit against every unit on the lot, not just
    // the polygon under the address point.
    const condoAtPoint = features.find((f) => /^C/i.test(s(f.attributes.PCLQCODE)));
    let pool = features;
    if (condoAtPoint) {
      const a = condoAtPoint.attributes;
      const lotUnits = await condoUnitsInLot(s(a.PCL_MUN), s(a.PCLBLOCK), s(a.PCLLOT)).catch(() => []);
      if (lotUnits.length) pool = [...features.filter((f) => !/^C/i.test(s(f.attributes.PCLQCODE))), ...lotUnits];
    }
    const { feature: unitHit, info } = pickUnit(pool, unit, inputAddress);
    if (unitHit) {
      const geom = features.find((f) => s(f.attributes.PAMS_PIN) === s(unitHit.attributes.PAMS_PIN))?.geometry ?? features[0].geometry;
      const unitCount = pool.filter((f) => /^C/i.test(s(f.attributes.PCLQCODE))).length;
      return {
        parcel: { status: "ok", data: toParcel({ ...unitHit, geometry: geom }, unitCount - 1), source, note },
        unit: info,
      };
    }
    // Prefer a record whose house number matches the input address.
    const hn = houseNumber(inputAddress);
    const nonCondo = features.filter((f) => !/^C/i.test(s(f.attributes.PCLQCODE)));
    const candidates = nonCondo.length ? nonCondo : features;
    const chosen = candidates.find((f) => hn && houseNumber(s(f.attributes.PROP_LOC)) === hn) ?? candidates[0];
    if (candidates.length > 1 && !(hn && houseNumber(s(chosen.attributes.PROP_LOC)) === hn)) {
      note = [note, `${candidates.length} parcels matched; house number didn't disambiguate.`].filter(Boolean).join(" ");
    }
    let data = toParcel(chosen, features.length - 1);
    if (info.status === "needs_unit" || info.status === "unmatched") {
      data = complexOnly(data, inputAddress);
      note = [note, "Condo complex — unit-level taxes, owner and sale are hidden until the unit is confirmed."]
        .filter(Boolean)
        .join(" ");
    }
    return { parcel: { status: "ok", data, source, note }, unit: info };
  } catch (err) {
    return {
      parcel: { status: "error", data: null, source, error: String(err) },
      unit: { status: "not_applicable", requested: unit },
    };
  }
}

export type PinAttrs = {
  pin: string;
  lat: number | null;
  lng: number | null;
  dwellings: number | null;
  acres: number | null;
  municipality: string | null;
  location: string | null;
};

/** Centroid + key attributes for many parcels (comps), 150 PINs per request. */
export async function fetchPinAttrs(pins: string[]): Promise<Map<string, PinAttrs>> {
  const out = new Map<string, PinAttrs>();
  const unique = [...new Set(pins)].filter((p) => /^[\w.\-]+$/.test(p));
  for (let i = 0; i < unique.length; i += 150) {
    const chunk = unique.slice(i, i + 150);
    const json = await fetchJson<{ features?: (Feature & { centroid?: { x: number; y: number } })[] }>(
      "nj_parcels",
      `${PARCEL_LAYER}/query`,
      {
        form: {
          where: `PAMS_PIN IN (${chunk.map((p) => `'${p}'`).join(",")})`,
          outFields: "PAMS_PIN,DWELL,CALC_ACRE,MUN_NAME,PROP_LOC",
          returnGeometry: "false",
          returnCentroid: "true",
          outSR: "4326",
          f: "json",
        },
        validate: arcgisValidate,
        cacheKey: `nj_parcels:pins:${chunk.join(",")}`,
        cacheTtlSec: 30 * 86_400,
      }
    );
    for (const f of json.features ?? []) {
      const a = f.attributes;
      out.set(s(a.PAMS_PIN), {
        pin: s(a.PAMS_PIN),
        lat: f.centroid?.y ?? null,
        lng: f.centroid?.x ?? null,
        dwellings: n(a.DWELL),
        acres: n(a.CALC_ACRE),
        municipality: s(a.MUN_NAME) || null,
        location: s(a.PROP_LOC) || null,
      });
    }
  }
  return out;
}

const MUNICIPALITIES =
  "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/NJ_Municipalities_3857/FeatureServer/0";

/** Municipality codes within `miles` of a point (for comp expansion). */
export async function muncodesNear(lat: number, lng: number, miles: number): Promise<string[]> {
  const json = await fetchJson<{ features?: { attributes: { MUN_CODE: string } }[] }>(
    "nj_municipalities",
    `${MUNICIPALITIES}/query`,
    {
      form: {
        geometry: JSON.stringify({ x: lng, y: lat }),
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        distance: String(miles),
        units: "esriSRUnit_StatuteMile",
        outFields: "MUN_CODE",
        returnGeometry: "false",
        f: "json",
      },
      validate: arcgisValidate,
      cacheKey: `nj_municipalities:${lat.toFixed(3)},${lng.toFixed(3)}:${miles}`,
      cacheTtlSec: 90 * 86_400,
    }
  );
  return (json.features ?? []).map((f) => s(f.attributes.MUN_CODE)).filter(Boolean);
}
