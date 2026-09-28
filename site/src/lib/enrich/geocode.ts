/**
 * Address validation + coordinates. Primary: NJ Office of GIS geocoder
 * (official, address-point based, understands units). Fallback: U.S. Census
 * geocoder (range-interpolated) when the NJ service is down.
 */
import { arcgisValidate, fetchJson, nowIso } from "./http";
import type { GeocodeData, MatchStatus, Section, SourceRef } from "./types";

export const NJ_GEOCODER =
  "https://geo.nj.gov/arcgis/rest/services/Tasks/NJ_Geocode/GeocodeServer/findAddressCandidates";
const CENSUS_GEOCODER = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

/** Pulls "#302", "Unit 302", "Apt 3B", "Suite 2" out of a one-line address. */
export function extractUnit(address: string): { base: string; unit: string | null } {
  const re = /(?:,\s*|\s+)(?:#\s*|(?:unit|apt|apartment|ste|suite|condo)\.?\s*#?\s*)([A-Za-z0-9][A-Za-z0-9-]{0,7})\b/i;
  const m = address.match(re);
  if (!m || m.index === undefined) return { base: address.trim(), unit: null };
  const base = (address.slice(0, m.index) + address.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ");
  return { base: base.replace(/\s+,/g, ",").trim(), unit: m[1].toUpperCase() };
}

export function cleanAddress(address: string): string {
  return address.replace(/,?\s*USA\s*$/i, "").trim();
}

function classify(score: number, type: string): MatchStatus {
  if (score >= 90 && /PointAddress|Subaddress/i.test(type)) return "exact";
  if (score >= 85 && /StreetAddress|StreetInt|PointAddress|Subaddress/i.test(type)) return "interpolated";
  if (score >= 70) return "low_confidence";
  return "not_found";
}

type NjCandidate = {
  address: string;
  score: number;
  location: { x: number; y: number };
  attributes: Record<string, string | number | null>;
};

export async function geocode(address: string, unit: string | null): Promise<Section<GeocodeData>> {
  const line = cleanAddress(address) + (unit ? ` Unit ${unit}` : "");
  const retrievedAt = nowIso();
  const njSource: SourceRef = {
    id: "nj_geocoder",
    name: "NJ Office of GIS — NJ_Geocode service",
    url: "https://geo.nj.gov/arcgis/rest/services/Tasks/NJ_Geocode/GeocodeServer",
    retrievedAt,
  };
  try {
    const params = new URLSearchParams({
      SingleLine: line,
      outFields: "Addr_type,Match_addr,City,Subregion,Postal,UnitName,UnitType,Score",
      outSR: "4326",
      maxLocations: "5",
      f: "json",
    });
    const json = await fetchJson<{ candidates?: NjCandidate[] }>("nj_geocoder", `${NJ_GEOCODER}?${params}`, {
      validate: arcgisValidate,
      cacheKey: `nj_geocoder:${line.toLowerCase()}`,
      cacheTtlSec: 30 * 86_400,
    });
    const best = (json.candidates ?? []).sort((a, b) => b.score - a.score)[0];
    if (!best || best.score < 70) {
      return {
        status: "missing",
        data: null,
        source: njSource,
        note: `No confident match for "${line}" in the NJ address database.`,
      };
    }
    const a = best.attributes;
    const type = String(a.Addr_type ?? "");
    return {
      status: "ok",
      source: njSource,
      data: {
        standardized: String(a.Match_addr ?? best.address),
        lat: best.location.y,
        lng: best.location.x,
        score: best.score,
        matchType: type,
        match: classify(best.score, type),
        county: a.Subregion ? String(a.Subregion) : null,
        city: a.City ? String(a.City) : null,
        postal: a.Postal ? String(a.Postal) : null,
        unit: a.UnitName ? String(a.UnitName) : unit,
      },
    };
  } catch (err) {
    return censusFallback(line, String(err));
  }
}

async function censusFallback(line: string, njError: string): Promise<Section<GeocodeData>> {
  const source: SourceRef = {
    id: "census_geocoder",
    name: "U.S. Census Bureau Geocoder (fallback)",
    url: "https://geocoding.geo.census.gov/geocoder/",
    retrievedAt: nowIso(),
  };
  try {
    const params = new URLSearchParams({ address: line, benchmark: "Public_AR_Current", format: "json" });
    const json = await fetchJson<{
      result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number }; addressComponents?: Record<string, string> }[] };
    }>("census_geocoder", `${CENSUS_GEOCODER}?${params}`, {
      cacheKey: `census_geocoder:${line.toLowerCase()}`,
      cacheTtlSec: 30 * 86_400,
    });
    const m = json.result?.addressMatches?.[0];
    if (!m) {
      return { status: "missing", data: null, source, note: `NJ geocoder failed (${njError}); Census found no match.` };
    }
    return {
      status: "ok",
      source,
      note: `NJ geocoder unavailable (${njError}); used Census fallback.`,
      data: {
        standardized: m.matchedAddress,
        lat: m.coordinates.y,
        lng: m.coordinates.x,
        score: 80,
        matchType: "Census range interpolation",
        match: "interpolated",
        county: null,
        city: m.addressComponents?.city ?? null,
        postal: m.addressComponents?.zip ?? null,
        unit: null,
      },
    };
  } catch (err) {
    return { status: "error", data: null, source, error: `NJ: ${njError}; Census: ${String(err)}` };
  }
}
