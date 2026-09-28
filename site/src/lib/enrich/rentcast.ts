/**
 * RentCast (licensed provider, optional — set RENTCAST_API_KEY). Supplies what
 * NJ public records don't: beds/baths, provider AVM, rent estimate, and
 * active sale listings. Its AVM comparables are LISTINGS, not recorded deeds —
 * the report labels them separately from the SR1A closed sales.
 */
import { fetchJson, nowIso } from "./http";
import type {
  PropertyKind,
  ProviderAvm,
  ProviderListing,
  ProviderProperty,
  ProviderRent,
  Section,
  SourceRef,
} from "./types";

const BASE = "https://api.rentcast.io/v1";
const TTL = 7 * 86_400;

const key = () => process.env.RENTCAST_API_KEY || "";

export function rentcastConfigured(): boolean {
  return Boolean(key());
}

function source(): SourceRef {
  return { id: "rentcast", name: "RentCast API (licensed)", url: "https://www.rentcast.io/api", retrievedAt: nowIso() };
}

function notConfigured<T>(what: string): Section<T> {
  return {
    status: "not_configured",
    data: null,
    source: null,
    note: `${what} requires a licensed data provider — add RENTCAST_API_KEY to enable.`,
  };
}

export const RENTCAST_TYPES: Record<PropertyKind, string | null> = {
  single_family: "Single Family",
  condo: "Condo",
  multifamily: "Multi-Family",
  land: "Land",
  other: null,
};

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown) => (v == null || v === "" ? null : String(v));

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  return fetchJson<T>("rentcast", `${BASE}${path}?${qs}`, {
    headers: { "X-Api-Key": key() },
    cacheKey: `rentcast:${path}?${qs}`,
    cacheTtlSec: TTL,
    retries: 1,
  });
}

export async function rentcastProperty(address: string): Promise<Section<ProviderProperty>> {
  if (!rentcastConfigured()) return notConfigured("Beds, baths and full sale history");
  const src = source();
  try {
    const arr = await get<Record<string, unknown>[]>("/properties", { address });
    const p = Array.isArray(arr) ? arr[0] : null;
    if (!p) return { status: "missing", data: null, source: src, note: "No RentCast property record for this address." };
    const rawHist = p.history as Record<string, { event?: string; date?: string; price?: number }> | unknown[] | undefined;
    const histEntries = Array.isArray(rawHist) ? rawHist : rawHist ? Object.values(rawHist) : [];
    return {
      status: "ok",
      source: src,
      data: {
        bedrooms: num(p.bedrooms),
        bathrooms: num(p.bathrooms),
        squareFootage: num(p.squareFootage),
        lotSize: num(p.lotSize),
        yearBuilt: num(p.yearBuilt),
        propertyType: str(p.propertyType),
        lastSaleDate: str(p.lastSaleDate)?.slice(0, 10) ?? null,
        lastSalePrice: num(p.lastSalePrice),
        ownerOccupied: typeof p.ownerOccupied === "boolean" ? p.ownerOccupied : null,
        history: histEntries
          .map((h) => h as { event?: string; date?: string; price?: number })
          .filter((h) => h.date)
          .map((h) => ({ date: String(h.date).slice(0, 10), event: h.event ?? "Event", price: num(h.price) })),
      },
    };
  } catch (err) {
    return { status: "error", data: null, source: src, error: String(err) };
  }
}

export async function rentcastAvm(address: string, kind: PropertyKind): Promise<Section<ProviderAvm>> {
  if (!rentcastConfigured()) return notConfigured("A provider value estimate");
  const src = source();
  try {
    const params: Record<string, string> = { address, compCount: "10" };
    const t = RENTCAST_TYPES[kind];
    if (t) params.propertyType = t;
    const r = await get<Record<string, unknown>>("/avm/value", params);
    const comps = Array.isArray(r.comparables) ? (r.comparables as Record<string, unknown>[]) : [];
    return {
      status: "ok",
      source: src,
      note: "Provider AVM; its comparables are sale listings, not recorded deeds.",
      data: {
        price: num(r.price),
        low: num(r.priceRangeLow),
        high: num(r.priceRangeHigh),
        listingComps: comps.slice(0, 8).map((c) => ({
          address: str(c.formattedAddress) ?? "",
          price: num(c.price),
          status: str(c.status),
          distance: num(c.distance),
          squareFootage: num(c.squareFootage),
          date: str(c.removedDate ?? c.lastSeenDate ?? c.listedDate)?.slice(0, 10) ?? null,
        })),
      },
    };
  } catch (err) {
    return { status: "error", data: null, source: src, error: String(err) };
  }
}

export async function rentcastRent(address: string, kind: PropertyKind): Promise<Section<ProviderRent>> {
  if (!rentcastConfigured()) return notConfigured("Rent estimates (multifamily income)");
  const src = source();
  try {
    const params: Record<string, string> = { address };
    const t = RENTCAST_TYPES[kind];
    if (t) params.propertyType = t;
    const r = await get<Record<string, unknown>>("/avm/rent/long-term", params);
    return { status: "ok", source: src, data: { rent: num(r.rent), low: num(r.rentRangeLow), high: num(r.rentRangeHigh) } };
  } catch (err) {
    return { status: "error", data: null, source: src, error: String(err) };
  }
}

export async function rentcastListings(lat: number, lng: number): Promise<Section<ProviderListing[]>> {
  if (!rentcastConfigured()) return notConfigured("Active/pending listings");
  const src = source();
  try {
    const arr = await get<Record<string, unknown>[]>("/listings/sale", {
      latitude: lat.toFixed(6),
      longitude: lng.toFixed(6),
      radius: "1",
      status: "Active",
      limit: "10",
    });
    const rows = (Array.isArray(arr) ? arr : []).map((l) => ({
      address: str(l.formattedAddress) ?? "",
      price: num(l.price),
      status: str(l.status),
      listedDate: str(l.listedDate)?.slice(0, 10) ?? null,
      daysOnMarket: num(l.daysOnMarket),
      bedrooms: num(l.bedrooms),
      bathrooms: num(l.bathrooms),
      squareFootage: num(l.squareFootage),
    }));
    return { status: rows.length ? "ok" : "missing", source: src, data: rows };
  } catch (err) {
    return { status: "error", data: null, source: src, error: String(err) };
  }
}
