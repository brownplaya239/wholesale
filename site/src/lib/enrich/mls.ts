/**
 * MLS data via the RESO Web API — the industry-standard OData interface that
 * both of Sumeet's MLSs expose (MOMLS: Flexmls/Spark; CJMLS: Matrix/
 * Rapattoni). Private/back-office use only: results appear solely in the
 * authenticated internal report, never on the public site.
 *
 * Per feed (ID = MOMLS | CJMLS), set in Vercel:
 *   MLS_<ID>_URL            RESO OData base. Optional for MOMLS: Spark's
 *                           endpoints are tried until one accepts the token.
 *   MLS_<ID>_TOKEN          bearer token (Spark), or instead:
 *   MLS_<ID>_CLIENT_ID / MLS_<ID>_CLIENT_SECRET / MLS_<ID>_TOKEN_URL
 *   [MLS_<ID>_SCOPE]        OAuth2 client-credentials (Trestle, Rapattoni…)
 */
import { fetchJson, nowIso, ProviderError } from "./http";
import type { PropertyKind, Section, SourceRef } from "./types";

export type MlsListing = {
  feed: string;
  listingId: string | null;
  status: string | null;
  address: string;
  unit: string | null;
  postalCode: string | null;
  propertyType: string | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  lotAcres: number | null;
  /** Units in the building (multifamily). */
  units: number | null;
  listPrice: number | null;
  originalListPrice: number | null;
  closePrice: number | null;
  closeDate: string | null;
  listDate: string | null;
  daysOnMarket: number | null;
  office: string | null;
  agent: string | null;
  lat: number | null;
  lng: number | null;
  distanceMi: number | null;
  modified: string | null;
};

export type MlsSubject = {
  /** Every MLS record matched to this property, newest first. */
  records: MlsListing[];
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  yearBuilt: number | null;
  lotAcres: number | null;
  /** Set when the property is currently listed (active/pending/hold). */
  activeListing: MlsListing | null;
};

type Feed = {
  id: string;
  name: string;
  /** Candidate RESO bases; the first that accepts the credentials is used. */
  baseUrls: string[];
  resource: string;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  tokenUrl?: string;
  scope?: string;
};

const FEED_NAMES: Record<string, string> = {
  MOMLS: "Monmouth Ocean Regional MLS (MOMLS)",
  CJMLS: "Central Jersey MLS (CJMLS)",
};

/** Spark (Flexmls) hosts: which one a key works on depends on its role. */
const DEFAULT_BASES: Record<string, string[]> = {
  MOMLS: [
    "https://replication.sparkapi.com/Version/3/Reso/OData",
    "https://sparkapi.com/Reso/OData",
    "https://sparkapi.com/Version/3/Reso/OData",
    "https://replication.sparkapi.com/Reso/OData",
  ],
};

/** Statuses that mean the property is under a listing agreement right now. */
export const CURRENT_STATUSES = ["Active", "Active Under Contract", "Pending", "Coming Soon", "Hold"];

export function mlsFeeds(env: NodeJS.ProcessEnv = process.env): Feed[] {
  return Object.keys(FEED_NAMES).flatMap((id) => {
    const explicit = env[`MLS_${id}_URL`]?.trim().replace(/\/+$/, "");
    const baseUrls = explicit ? [explicit] : DEFAULT_BASES[id] ?? [];
    const token = env[`MLS_${id}_TOKEN`];
    const clientId = env[`MLS_${id}_CLIENT_ID`];
    const clientSecret = env[`MLS_${id}_CLIENT_SECRET`];
    const tokenUrl = env[`MLS_${id}_TOKEN_URL`];
    if (!baseUrls.length || !(token || (clientId && clientSecret && tokenUrl))) return [];
    return [
      {
        id,
        name: FEED_NAMES[id],
        baseUrls,
        resource: env[`MLS_${id}_RESOURCE`] || "Property",
        token,
        clientId,
        clientSecret,
        tokenUrl,
        scope: env[`MLS_${id}_SCOPE`],
      },
    ];
  });
}

export function mlsConfigured(): boolean {
  return mlsFeeds().length > 0;
}

const tokens = new Map<string, { token: string; expires: number }>();

async function bearer(feed: Feed): Promise<string> {
  if (feed.token) return feed.token;
  const cached = tokens.get(feed.id);
  if (cached && cached.expires > Date.now()) return cached.token;
  const form: Record<string, string> = {
    grant_type: "client_credentials",
    client_id: feed.clientId!,
    client_secret: feed.clientSecret!,
  };
  if (feed.scope) form.scope = feed.scope;
  const json = await fetchJson<{ access_token?: string; expires_in?: number }>(`mls_${feed.id.toLowerCase()}`, feed.tokenUrl!, {
    form,
    retries: 1,
  });
  if (!json.access_token) throw new ProviderError(`mls_${feed.id}`, "token endpoint returned no access_token");
  tokens.set(feed.id, { token: json.access_token, expires: Date.now() + Math.max(60, (json.expires_in ?? 3600) - 60) * 1000 });
  return json.access_token;
}

const resolved = new Map<string, string>();

/** The feed's working RESO base: probed once per server instance. */
async function baseFor(feed: Feed, auth: string): Promise<string> {
  if (feed.baseUrls.length === 1) return feed.baseUrls[0];
  const known = resolved.get(feed.id);
  if (known) return known;
  const tried: string[] = [];
  for (const base of feed.baseUrls) {
    try {
      const res = await fetch(`${base}/${feed.resource}?$top=1`, {
        headers: { Authorization: `Bearer ${auth}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok && Array.isArray(((await res.json()) as { value?: unknown }).value)) {
        resolved.set(feed.id, base);
        return base;
      }
      tried.push(`${base} → HTTP ${res.status}`);
    } catch (err) {
      tried.push(`${base} → ${String(err).slice(0, 80)}`);
    }
  }
  throw new ProviderError(`mls_${feed.id.toLowerCase()}`, `no endpoint accepted the token (${tried.join("; ")})`, 401);
}

const SELECT = [
  "ListingKey", "ListingId", "StandardStatus", "UnparsedAddress", "StreetNumber", "StreetName",
  "UnitNumber", "City", "PostalCode", "PropertyType", "PropertySubType", "BedroomsTotal",
  "BathroomsTotalInteger", "BathroomsFull", "BathroomsHalf", "LivingArea", "YearBuilt",
  "LotSizeAcres", "ListPrice", "ClosePrice", "CloseDate", "OnMarketDate", "ListingContractDate",
  "DaysOnMarket", "ListOfficeName", "ListAgentFullName", "Latitude", "Longitude",
  "ModificationTimestamp", "NumberOfUnitsTotal", "OriginalListPrice",
].join(",");

/**
 * One OData query. MLS servers differ in what they accept, so each call tries
 * the given filters in order and drops $select if the server rejects it —
 * the first variant that succeeds wins.
 */
async function query(feed: Feed, filters: string[], extra: Record<string, string>, ttlSec: number): Promise<Record<string, unknown>[]> {
  const auth = await bearer(feed);
  const base = await baseFor(feed, auth);
  let lastErr: unknown;
  for (const filter of filters) {
    for (const withSelect of [true, false]) {
      const params = new URLSearchParams({ $filter: filter, ...extra });
      if (withSelect) params.set("$select", SELECT);
      const url = `${base}/${feed.resource}?${params}`;
      try {
        const json = await fetchJson<{ value?: Record<string, unknown>[] }>(`mls_${feed.id.toLowerCase()}`, url, {
          headers: { Authorization: `Bearer ${auth}` },
          cacheKey: `mls:${feed.id}:${url}`,
          cacheTtlSec: ttlSec,
          retries: 1,
          timeoutMs: 15_000,
        });
        return json.value ?? [];
      } catch (err) {
        lastErr = err;
        const status = (err as ProviderError).status;
        if (status === 401 || status === 403) throw err; // bad credentials — variants won't help
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

const num = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());
const day = (v: unknown) => str(v)?.slice(0, 10) ?? null;

export function toListing(feedName: string, r: Record<string, unknown>): MlsListing {
  const full = num(r.BathroomsFull);
  const half = num(r.BathroomsHalf);
  // Feeds send 0 for "not entered"; a home with zero baths isn't real data.
  const baths = (full != null ? full + (half ?? 0) * 0.5 : num(r.BathroomsTotalInteger)) || null;
  const address =
    str(r.UnparsedAddress) ?? [str(r.StreetNumber), str(r.StreetName), str(r.City)].filter(Boolean).join(" ");
  return {
    feed: feedName,
    listingId: str(r.ListingId) ?? str(r.ListingKey),
    status: str(r.StandardStatus),
    address,
    unit: str(r.UnitNumber),
    postalCode: str(r.PostalCode),
    propertyType: [str(r.PropertyType), str(r.PropertySubType)].filter(Boolean).join(" — ") || null,
    beds: num(r.BedroomsTotal),
    baths,
    sqft: num(r.LivingArea),
    yearBuilt: num(r.YearBuilt),
    lotAcres: num(r.LotSizeAcres),
    units: num(r.NumberOfUnitsTotal),
    listPrice: num(r.ListPrice),
    originalListPrice: num(r.OriginalListPrice),
    closePrice: num(r.ClosePrice),
    closeDate: day(r.CloseDate),
    listDate: day(r.OnMarketDate) ?? day(r.ListingContractDate),
    daysOnMarket: num(r.DaysOnMarket),
    office: str(r.ListOfficeName),
    agent: str(r.ListAgentFullName),
    lat: num(r.Latitude),
    lng: num(r.Longitude),
    distanceMi: null,
    modified: str(r.ModificationTimestamp),
  };
}

const SUFFIX = /\b(STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|BOULEVARD|BLVD|TERRACE|TER|CIRCLE|CIR|WAY|PARKWAY|PKWY|HIGHWAY|HWY|N|S|E|W|NORTH|SOUTH|EAST|WEST)\b\.?/g;

/** "Dennisville Road" and "DENNISVILLE RD" both -> "DENNISVILLE". */
export function streetKey(name: string): string {
  return name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
}

const unitKey = (u: string | null) => (u ? u.toUpperCase().replace(/^(UNIT|APT|#)\s*/, "").replace(/^0+(?=.)/, "") : "");

/** "714 Dennisville Road, Cape May Court House, New Jersey, 08210" -> parts. */
export function addressParts(standardized: string): { number: string; street: string } | null {
  const m = standardized.match(/^\s*(\d+[A-Z]?)\s+([^,]+)/i);
  return m ? { number: m[1].toUpperCase(), street: m[2] } : null;
}

export function matchesSubject(l: MlsListing, number: string, street: string, unit: string | null, raw: Record<string, unknown>): boolean {
  const n = str(raw.StreetNumber) ?? l.address.match(/^\s*(\d+[A-Z]?)/i)?.[1] ?? "";
  if (n.toUpperCase() !== number) return false;
  const name = str(raw.StreetName) ?? l.address.replace(/^\s*\d+[A-Z]?\s+/, "").split(",")[0];
  const a = streetKey(name);
  const b = streetKey(street);
  if (!a || !b || !(a.startsWith(b) || b.startsWith(a))) return false;
  return unit ? unitKey(l.unit) === unitKey(unit) : true;
}

function source(feeds: Feed[]): SourceRef {
  return {
    id: "mls",
    name: `MLS (RESO Web API): ${feeds.map((f) => f.name).join(", ")}`,
    retrievedAt: nowIso(),
  };
}

function notConfigured<T>(what: string): Section<T> {
  return {
    status: "not_configured",
    data: null,
    source: null,
    note: `${what} come from your MLS — connect the MOMLS/CJMLS data feed to enable.`,
  };
}

const haversine = (a: number, b: number, c: number, d: number) => {
  const R = 3958.8;
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export async function mlsSubject(
  standardized: string,
  postalCode: string | null,
  unit: string | null
): Promise<Section<MlsSubject>> {
  const feeds = mlsFeeds();
  if (!feeds.length) return notConfigured("Bedrooms, bathrooms and listing history");
  const src = source(feeds);
  const parts = addressParts(standardized);
  if (!parts || !postalCode) return { status: "missing", data: null, source: src, note: "Address couldn't be split into number/street/ZIP for an MLS lookup." };
  const zip = postalCode.slice(0, 5).replace(/'/g, "");
  const esc = parts.number.replace(/'/g, "''");
  const records: MlsListing[] = [];
  const errors: string[] = [];
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const rows = await query(
          feed,
          [
            `StreetNumber eq '${esc}' and PostalCode eq '${zip}'`,
            // Servers that don't index StreetNumber: match on the address text.
            `PostalCode eq '${zip}' and startswith(UnparsedAddress, '${esc} ')`,
          ],
          { $orderby: "ModificationTimestamp desc", $top: "50" },
          3600 // listing status must be current — short cache
        );
        for (const r of rows) {
          const l = toListing(feed.name, r);
          if (matchesSubject(l, parts.number, parts.street, unit, r)) records.push(l);
        }
      } catch (err) {
        errors.push(`${feed.id}: ${String(err)}`);
      }
    })
  );
  if (!records.length && errors.length === feeds.length) {
    return { status: "error", data: null, source: src, error: errors.join("; ") };
  }
  records.sort((a, b) => (b.modified ?? b.listDate ?? "").localeCompare(a.modified ?? a.listDate ?? ""));
  const first = <K extends keyof MlsListing>(k: K) => records.find((r) => r[k] != null)?.[k] ?? null;
  const active = records.find((r) => r.status && CURRENT_STATUSES.includes(r.status)) ?? null;
  return {
    status: records.length ? "ok" : "missing",
    source: src,
    note: records.length ? (errors.length ? `Some feeds failed: ${errors.join("; ")}` : undefined) : "No MLS record for this property (never listed, or listed before the feed's history).",
    data: {
      records,
      beds: first("beds") as number | null,
      baths: first("baths") as number | null,
      sqft: first("sqft") as number | null,
      yearBuilt: first("yearBuilt") as number | null,
      lotAcres: first("lotAcres") as number | null,
      activeListing: active,
    },
  };
}

export async function mlsNearby(
  postalCode: string | null,
  lat: number,
  lng: number,
  subjectAddress: string,
  subjectUnit: string | null = null
): Promise<Section<MlsListing[]>> {
  const feeds = mlsFeeds();
  if (!feeds.length) return notConfigured("Active and pending listings nearby");
  const src = source(feeds);
  if (!postalCode) return { status: "missing", data: null, source: src, note: "No ZIP code to search listings by." };
  const zip = postalCode.slice(0, 5).replace(/'/g, "");
  const statusFilter = CURRENT_STATUSES.filter((s) => s !== "Hold").map((s) => `StandardStatus eq '${s}'`).join(" or ");
  const since = new Date(Date.now() - 180 * 86_400_000).toISOString();
  const subject = addressParts(subjectAddress);
  const found = new Map<string, MlsListing>();
  const errors: string[] = [];
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const rows = await query(
          feed,
          [
            `PostalCode eq '${zip}' and (${statusFilter})`,
            // Servers that reject status comparisons: recent changes, filtered here.
            `PostalCode eq '${zip}' and ModificationTimestamp gt ${since}`,
          ],
          { $orderby: "ModificationTimestamp desc", $top: "200" },
          6 * 3600
        );
        for (const r of rows) {
          const l = toListing(feed.name, r);
          if (!l.status || !CURRENT_STATUSES.includes(l.status) || l.status === "Hold") continue;
          if (/lease|rental/i.test(l.propertyType ?? "")) continue;
          // The seller's own listing belongs in the subject's MLS history, not here.
          if (subject && matchesSubject(l, subject.number, subject.street, subjectUnit, r)) continue;
          l.distanceMi = l.lat != null && l.lng != null ? Math.round(haversine(lat, lng, l.lat, l.lng) * 100) / 100 : null;
          found.set(`${l.address}|${l.unit ?? ""}`, l);
        }
      } catch (err) {
        errors.push(`${feed.id}: ${String(err)}`);
      }
    })
  );
  if (!found.size && errors.length === feeds.length) return { status: "error", data: null, source: src, error: errors.join("; ") };
  const list = [...found.values()]
    .filter((l) => l.distanceMi == null || l.distanceMi <= 1.5)
    .sort((a, b) => (a.distanceMi ?? 99) - (b.distanceMi ?? 99))
    .slice(0, 12);
  return {
    status: list.length ? "ok" : "missing",
    data: list,
    source: src,
    note: `Active, under-contract, pending and coming-soon listings in ZIP ${zip}${list.some((l) => l.distanceMi != null) ? " within 1.5 mi" : ""}.`,
  };
}

/**
 * Maps an MLS listing onto the tax-list property kinds the comp engine uses.
 * null = not a comparable sale (leases, commercial, unknown).
 */
export function mlsKind(l: Pick<MlsListing, "propertyType">): PropertyKind | null {
  const t = (l.propertyType ?? "").toLowerCase();
  if (!t || /lease|rental|commercial|business|farm/.test(t)) return null;
  if (/\bland\b|\blots?\b|acreage/.test(t)) return "land";
  if (/income|multi|duplex|triplex|quadruplex|2 family|two family|3 family|4 family/.test(t)) return "multifamily";
  if (/condo|townho|co-?op|cooperative/.test(t)) return "condo";
  if (/manufactured|mobile/.test(t)) return "other";
  if (/single family|detached/.test(t) || /^residential$/.test(t.trim())) return "single_family";
  return null;
}

/**
 * Closed MLS sales around a point — comps that are current to today (the
 * state deed file lags months) and carry beds/baths. Bounding box first;
 * servers that can't filter on coordinates fall back to the ZIP code.
 */
export async function mlsClosedSales(
  lat: number,
  lng: number,
  postalCode: string | null,
  miles: number,
  sinceDays: number
): Promise<Section<MlsListing[]>> {
  const feeds = mlsFeeds();
  if (!feeds.length) return notConfigured("MLS closed sales");
  const src = source(feeds);
  const dLat = miles / 69;
  const dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const closed = `StandardStatus eq 'Closed' and CloseDate ge ${since}`;
  const box = `Latitude ge ${(lat - dLat).toFixed(5)} and Latitude le ${(lat + dLat).toFixed(5)} and Longitude ge ${(lng - dLng).toFixed(5)} and Longitude le ${(lng + dLng).toFixed(5)}`;
  const zip = postalCode?.slice(0, 5).replace(/'/g, "");
  const found = new Map<string, MlsListing>();
  const errors: string[] = [];
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const rows = await query(
          feed,
          [`${closed} and ${box}`, ...(zip ? [`${closed} and PostalCode eq '${zip}'`] : [])],
          { $orderby: "CloseDate desc", $top: "500" },
          6 * 3600
        );
        for (const r of rows) {
          const l = toListing(feed.name, r);
          if (!l.closePrice || !l.closeDate) continue;
          if (l.lat != null && l.lng != null) l.distanceMi = Math.round(haversine(lat, lng, l.lat, l.lng) * 100) / 100;
          found.set(`${l.address}|${l.unit ?? ""}|${l.closeDate}`, l);
        }
      } catch (err) {
        errors.push(`${feed.id}: ${String(err)}`);
      }
    })
  );
  if (!found.size && errors.length === feeds.length) return { status: "error", data: null, source: src, error: errors.join("; ") };
  return {
    status: found.size ? "ok" : "missing",
    data: [...found.values()],
    source: src,
    note: errors.length ? `Some feeds failed: ${errors.join("; ")}` : undefined,
  };
}

/** Statuses probed by the connection test (what the key's role can see). */
const PROBE_STATUSES = ["Active", "Active Under Contract", "Pending", "Closed", "Expired", "Withdrawn", "Canceled"];

export type FeedTest = { feed: string; ok: boolean; detail: string; endpoint?: string; fields?: number; statuses?: Record<string, boolean | null> };

/** Admin "test connection": which endpoint works, and what the key can see. */
export async function testFeeds(): Promise<FeedTest[]> {
  const feeds = mlsFeeds();
  return Promise.all(
    feeds.map(async (feed): Promise<FeedTest> => {
      try {
        const auth = await bearer(feed);
        const base = await baseFor(feed, auth);
        const get = async (qs: string) => {
          const res = await fetch(`${base}/${feed.resource}?${qs}`, {
            headers: { Authorization: `Bearer ${auth}`, Accept: "application/json" },
            signal: AbortSignal.timeout(15_000),
          });
          const body = await res.text();
          if (!res.ok) throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
          return (JSON.parse(body) as { value?: Record<string, unknown>[] }).value ?? [];
        };
        const fields = Object.keys((await get("$top=1"))[0] ?? {});
        const statuses: Record<string, boolean | null> = {};
        await Promise.all(
          PROBE_STATUSES.map(async (st) => {
            statuses[st] = await get(new URLSearchParams({ $filter: `StandardStatus eq '${st}'`, $top: "1" }).toString())
              .then((v) => v.length > 0)
              .catch(() => null);
          })
        );
        const seen = PROBE_STATUSES.filter((st) => statuses[st]);
        const unseen = PROBE_STATUSES.filter((st) => statuses[st] === false);
        return {
          feed: feed.name,
          ok: true,
          endpoint: base,
          fields: fields.length,
          statuses,
          detail: `Connected via ${base} — ${fields.length} fields${fields.includes("BedroomsTotal") ? " incl. beds/baths" : ""}. Sees: ${seen.join(", ") || "none"}${unseen.length ? ` · not in this feed: ${unseen.join(", ")}` : ""}.`,
        };
      } catch (err) {
        return { feed: feed.name, ok: false, detail: String(err).slice(0, 400) };
      }
    })
  );
}
