/**
 * Builds a property dossier for an address. Each provider runs independently;
 * one failing only marks its own section — the rest of the dossier still
 * builds. Nothing here writes to the lead record (see leads/enrich.ts).
 */
import type { Db } from "@/lib/db";
import { streetViewMeta } from "@/lib/leads/images";
import { haversineMi, reconcileOwnSale, selectComps, type CompCandidate, type Subject } from "./comps";
import { floodZone } from "./flood";
import { cleanAddress, extractUnit, geocode } from "./geocode";
import { nowIso } from "./http";
import { buildInsights, type LeadFacts } from "./insights";
import { photoCheck } from "./vision";
import {
  addressParts,
  matchesSubject,
  mlsClosedSales,
  mlsConfigured,
  mlsKind,
  mlsNearby,
  mlsSubject,
  streetKey,
  type MlsListing,
  type MlsSubject,
} from "./mls";
import { fetchPinAttrs, lookupParcel, municipalitiesNear, municipalityAt, type MuniShape, type PinAttrs } from "./parcel";
import {
  compCandidates,
  deedHistory,
  marketStats,
  salesLoaded,
  sameBuildingSales,
  sr1aSource,
  type Candidate,
} from "./sales";
import type {
  Characteristics,
  CompsResult,
  Conflict,
  DeedRecord,
  Dossier,
  Fact,
  GeocodeData,
  MarketStats,
  ParcelData,
  PropertyKind,
  Section,
  SourceRef,
} from "./types";

const noDb = <T,>(what: string): Section<T> => ({
  status: "not_configured",
  data: null,
  source: null,
  note: `${what} needs the lead database (DATABASE_URL) and loaded deed data.`,
});

function fact<T>(value: T | null | undefined, source: SourceRef | null, fallback: Fact<T>["status"] = "missing"): Fact<T> {
  return value == null ? { value: null, status: fallback, source: null } : { value, status: "ok", source };
}

/**
 * Picks each characteristic from the best source (official records first,
 * MLS next) and records every disagreement between sources.
 */
export function mergeCharacteristics(
  parcel: Section<ParcelData>,
  history: Section<DeedRecord[]>,
  mls: Section<MlsSubject>
): { characteristics: Characteristics; conflicts: Conflict[] } {
  const p = parcel.data;
  const deeds = history.data ?? [];
  const m = mls.data;
  const mlsStatus = mls.status === "not_configured" ? "not_configured" : "missing";
  const deedSqft = deeds.find((d) => d.livingSpace)?.livingSpace ?? null;
  const deedYear = deeds.find((d) => d.yearBuilt)?.yearBuilt ?? null;

  const livingSpace = deedSqft ? fact(deedSqft, history.source) : fact(m?.sqft, mls.source, mlsStatus);
  const yearBuilt = p?.yearBuilt
    ? fact(p.yearBuilt, parcel.source)
    : deedYear
      ? fact(deedYear, history.source)
      : fact(m?.yearBuilt, mls.source, mlsStatus);
  const lotAcres = p?.acres ? fact(p.acres, parcel.source) : fact(m?.lotAcres, mls.source, mlsStatus);

  const conflicts: Conflict[] = [];
  const years = [
    p?.yearBuilt ? { value: p.yearBuilt, source: "tax list" } : null,
    deedYear ? { value: deedYear, source: "deed record" } : null,
    m?.yearBuilt ? { value: m.yearBuilt, source: "MLS" } : null,
  ].filter(Boolean) as { value: number; source: string }[];
  if (years.length > 1 && Math.max(...years.map((y) => y.value)) - Math.min(...years.map((y) => y.value)) > 2) {
    // Sources that agree share one entry: "1988 (tax list, deed record) vs 1960 (MLS)".
    const grouped = new Map<number, string[]>();
    for (const y of years) grouped.set(y.value, [...(grouped.get(y.value) ?? []), y.source]);
    conflicts.push({ field: "year built", values: [...grouped].map(([value, src]) => ({ value: String(value), source: src.join(", ") })) });
  }
  if (deedSqft && m?.sqft && Math.abs(deedSqft - m.sqft) / deedSqft > 0.1) {
    conflicts.push({
      field: "living area",
      values: [
        { value: `${deedSqft.toLocaleString()} sq ft`, source: "deed record" },
        { value: `${m.sqft.toLocaleString()} sq ft`, source: "MLS" },
      ],
    });
  }
  if (p?.acres && m?.lotAcres && Math.abs(p.acres - m.lotAcres) / p.acres > 0.25) {
    conflicts.push({
      field: "lot size",
      values: [
        { value: `${p.acres.toFixed(2)} ac`, source: "parcel map" },
        { value: `${m.lotAcres.toFixed(2)} ac`, source: "MLS" },
      ],
    });
  }
  return {
    conflicts,
    characteristics: {
      livingSpace,
      yearBuilt,
      bedrooms: fact(m?.beds, mls.source, mlsStatus),
      bathrooms: fact(m?.baths, mls.source, mlsStatus),
      lotAcres,
      dwellings: fact(p?.dwellings, parcel.source),
    },
  };
}

const SELLER_SOURCE: SourceRef = { id: "seller", name: "Seller-reported (thank-you page)", retrievedAt: "" };

/** "5+" -> 5, "2.5" -> 2.5 */
const sellerNum = (v: string | null | undefined) => (v ? Number.parseFloat(v) : Number.NaN);

/**
 * Seller's own bed/bath answers: fill the gap when no MLS record exists, and
 * flag it when they disagree with the MLS. Answers can arrive after
 * enrichment, so the report applies this on every view.
 */
export function withSellerFacts(d: Dossier, facts: Pick<LeadFacts, "beds" | "baths">): Dossier {
  const out: Dossier = { ...d, characteristics: { ...d.characteristics }, conflicts: [...d.conflicts] };
  for (const [key, answer, label] of [
    ["bedrooms", facts.beds, "bedrooms"],
    ["bathrooms", facts.baths, "bathrooms"],
  ] as const) {
    const n = sellerNum(answer);
    if (Number.isNaN(n)) continue;
    const cur = out.characteristics[key];
    if (cur.status !== "ok") {
      out.characteristics[key] = {
        value: n,
        status: "ok",
        source: SELLER_SOURCE,
        note: answer?.endsWith("+") ? `${answer} (or more)` : undefined,
      };
    } else if (cur.value != null && cur.value !== n && !(answer?.endsWith("+") && cur.value >= n)) {
      if (!out.conflicts.some((c) => c.field === label)) {
        out.conflicts.push({
          field: label,
          values: [
            { value: String(cur.value), source: cur.source?.id === "mls" ? "MLS" : cur.source?.name ?? "records" },
            { value: answer!, source: "seller" },
          ],
        });
      }
    }
  }
  return out;
}

/** "10 ERIC DRIVE" / "10 Eric Drive, Howell, NJ" -> "10 ERIC": matches deeds to MLS closings. */
function houseKey(address: string | null): string {
  const m = (address ?? "").toUpperCase().match(/^\s*(\d+[A-Z]?)\s+([^,]+)/);
  return m ? `${m[1]} ${streetKey(m[2])}` : "";
}
const sameHouse = (a: string, b: string) => Boolean(a && b && (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)));

/**
 * The property's own arm's-length sale in the last 12 months — from the deed
 * file or an MLS closing, whichever is newer.
 */
export function recentOwnSale(
  deeds: DeedRecord[],
  mlsRecords: MlsListing[],
  now = new Date()
): { price: number; date: string; source: string } | null {
  const cutoff = now.getTime() - 365 * 86_400_000;
  const found = [
    ...deeds.filter((d) => d.usable && d.price && d.date).map((d) => ({ price: d.price!, date: d.date!, source: "deed record" })),
    ...mlsRecords
      .filter((r) => r.status === "Closed" && r.closePrice && r.closeDate)
      .map((r) => ({ price: r.closePrice!, date: r.closeDate!, source: "MLS" })),
  ].filter((x) => Date.parse(x.date) >= cutoff);
  return found.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

/**
 * Folds MLS closings into the deed-sale candidates (mutates `candidates`):
 * a closing that matches a deed (price ±1%, date ±90 days, same house) enriches
 * it with MLS beds/baths; otherwise it's added as an MLS-only candidate, and
 * for a house in both pools with different sales only the newer one is kept.
 */
export function mergeClosings(
  candidates: CompCandidate[],
  closings: MlsListing[],
  opts: { kind: PropertyKind; subjectAddress: string; unit: string | null; munis: MuniShape[] }
): { mlsOnly: number; merged: number } {
  let mlsOnly = 0;
  let merged = 0;
  const subjectParts = addressParts(opts.subjectAddress);
  const byHouse = new Map(candidates.map((c) => [houseKey(c.location), c]));
  const seen = new Set<string>();
  // Newest first, so a house that sold twice contributes its latest sale.
  const sorted = [...closings].sort((a, b) => (b.closeDate ?? "").localeCompare(a.closeDate ?? ""));
  for (const l of sorted) {
    if (mlsKind(l) !== opts.kind) continue;
    if (subjectParts && matchesSubject(l, subjectParts.number, subjectParts.street, opts.unit, {})) continue;
    const key = houseKey(l.address) + (l.unit ? ` #${l.unit}` : "");
    if (seen.has(key)) continue;
    seen.add(key);
    const price = l.closePrice!;
    const date = l.closeDate!;
    const twin = candidates.find(
      (c) =>
        c.source !== "mls" &&
        Math.abs(c.price - price) <= Math.max(1000, c.price * 0.01) &&
        Math.abs(Date.parse(c.saleDate) - Date.parse(date)) <= 90 * 86_400_000 &&
        (sameHouse(houseKey(c.location), houseKey(l.address)) ||
          (c.lat != null && c.lng != null && l.lat != null && l.lng != null && haversineMi(c.lat, c.lng, l.lat, l.lng) < 0.03))
    );
    if (twin) {
      twin.beds = l.beds;
      twin.baths = l.baths;
      if (!twin.livingSpace && l.sqft) twin.livingSpace = l.sqft;
      twin.source = "deed+mls";
      merged++;
      continue;
    }
    const older = l.unit ? undefined : byHouse.get(houseKey(l.address));
    if (older && older.source === "deed") {
      // Same house, different sale: keep only the newer one.
      if (older.saleDate >= date) continue;
      candidates.splice(candidates.indexOf(older), 1);
    }
    const town = l.lat != null && l.lng != null ? municipalityAt(l.lat, l.lng, opts.munis) : null;
    const kind = mlsKind(l);
    candidates.push({
      pin: `mls:${l.listingId ?? key}`,
      muncode: town?.code ?? "",
      block: "",
      lot: "",
      qual: kind === "condo" ? "C" : "",
      saleDate: date,
      price,
      livingSpace: l.sqft,
      yearBuilt: l.yearBuilt,
      location: `${l.address.split(",")[0].trim()}${l.unit ? ` #${l.unit}` : ""}`,
      municipality: town?.name ?? null,
      lat: l.lat,
      lng: l.lng,
      dwellings: kind === "multifamily" ? (l.units ?? 2) : 1,
      acres: l.lotAcres,
      beds: l.beds,
      baths: l.baths,
      source: "mls",
    });
    mlsOnly++;
  }

  return { mlsOnly, merged };
}

/**
 * Comparable sales from two pools: arm's-length deeds in the state file, and
 * MLS closings. A sale in both is merged (the deed gains MLS beds/baths); an
 * MLS-only sale — typically one too recent for the deed file — is added.
 */
async function runComps(
  db: Db | null,
  salesSrc: SourceRef | null,
  p: ParcelData,
  g: GeocodeData,
  chars: Characteristics,
  unit: string | null,
  sellerBeds: number | null
): Promise<Section<CompsResult>> {
  const deedsReady = Boolean(db && salesSrc && (await salesLoaded(db)));
  const mlsOn = mlsConfigured() && p.kind !== "other";
  if (!deedsReady && !mlsOn) {
    return {
      status: "missing",
      data: null,
      source: salesSrc,
      note: db ? "Deed-sales data hasn't been loaded yet (run the SR1A ingest)." : "Comparable sales need the lead database or an MLS feed.",
    };
  }
  const subject: Subject = {
    kind: p.kind,
    pin: p.pin,
    muncode: p.muncode,
    block: p.block,
    lot: p.lot,
    lat: g.lat,
    lng: g.lng,
    livingSpace: chars.livingSpace.value,
    yearBuilt: chars.yearBuilt.value,
    acres: chars.lotAcres.value,
    dwellings: chars.dwellings.value,
    beds: chars.bedrooms.value ?? sellerBeds,
  };
  const radius = p.kind === "land" ? 6 : 3;
  let munis: MuniShape[] = [];
  try {
    munis = await municipalitiesNear(g.lat, g.lng, radius);
  } catch {
    // Neighboring towns unavailable — search the home municipality only.
  }
  const muncodes = [...new Set([p.muncode, ...munis.map((m) => m.code)])];
  const notes: string[] = [];

  const [deedLists, mlsSales] = await Promise.all([
    deedsReady
      ? Promise.all([
          compCandidates(db!, {
            muncodes,
            homeMuncode: p.muncode,
            sinceDays: 730,
            kind: p.kind,
            propClass: p.propClass,
            excludePin: p.pin,
            livingSpace: subject.livingSpace,
          }),
          p.kind === "condo" ? sameBuildingSales(db!, p.muncode, p.block, p.lot, p.pin) : Promise.resolve([] as Candidate[]),
        ])
      : Promise.resolve([] as Candidate[][]),
    mlsOn ? mlsClosedSales(g.lat, g.lng, g.postal, radius, 730) : Promise.resolve(null),
  ]);

  const byPin = new Map<string, Candidate>();
  for (const c of deedLists.flat()) if (!byPin.has(c.pin)) byPin.set(c.pin, c);
  let attrs = new Map<string, PinAttrs>();
  if (byPin.size) {
    try {
      attrs = await fetchPinAttrs([...byPin.keys()]);
    } catch (err) {
      notes.push(`Comp locations unavailable (${String(err)}); distance-based steps skipped.`);
    }
  }
  const candidates: CompCandidate[] = [...byPin.values()].map((c) => {
    const a = attrs.get(c.pin);
    return {
      ...c,
      municipality: a?.municipality ?? null,
      lat: a?.lat ?? null,
      lng: a?.lng ?? null,
      dwellings: a?.dwellings ?? null,
      acres: a?.acres ?? null,
      source: "deed" as const,
    };
  });

  if (mlsSales?.status === "error") notes.push(`MLS closed sales unavailable (${mlsSales.error}).`);
  const { mlsOnly, merged } = mergeClosings(candidates, mlsSales?.data ?? [], { kind: p.kind, subjectAddress: g.standardized, unit, munis });

  const result = selectComps(subject, candidates);
  result.pool = { deed: candidates.filter((c) => c.source !== "mls").length, mls: mlsOnly, merged };
  if (notes.length) result.note = [result.note, ...notes].filter(Boolean).join(" ");
  const source: SourceRef = {
    id: "comps",
    name: [deedsReady && salesSrc ? salesSrc.name : null, mlsSales?.status === "ok" ? "MLS closed sales" : null].filter(Boolean).join(" + ") || "Comparable sales",
    url: salesSrc?.url,
    asOf: salesSrc?.asOf ?? null,
    retrievedAt: nowIso(),
  };
  return {
    status: result.comps.length ? "ok" : "missing",
    data: result,
    source,
    note: result.comps.length ? undefined : "No qualifying comparable sales in the deed data or the MLS.",
  };
}

export type DossierInput = { address: string; unit: string | null; lead: LeadFacts };

export async function buildDossier(input: DossierInput, db: Db | null): Promise<Dossier> {
  const parsed = extractUnit(cleanAddress(input.address));
  const unit = input.unit?.trim() || parsed.unit;

  const geo = await geocode(parsed.base, unit);
  const g = geo.data;
  const skipped = <T,>(): Section<T> => ({
    status: g ? "missing" : mlsConfigured() ? "missing" : "not_configured",
    data: null,
    source: null,
    note: "Skipped — address not geocoded.",
  });

  const [parcelRes, flood, mlsProperty, mlsListings, streetView] = await Promise.all([
    g
      ? lookupParcel(g.lat, g.lng, parsed.base, unit)
      : Promise.resolve({
          parcel: { status: "missing", data: null, source: null, note: "Skipped — address not geocoded." } as Section<ParcelData>,
          unit: { status: "not_applicable" as const, requested: unit },
        }),
    g ? floodZone(g.lat, g.lng) : Promise.resolve({ status: "missing", data: null, source: null, note: "Skipped — address not geocoded." } as Section<never>),
    g ? mlsSubject(g.standardized, g.postal, unit) : Promise.resolve(skipped<MlsSubject>()),
    g ? mlsNearby(g.postal, g.lat, g.lng, g.standardized, unit) : Promise.resolve(skipped<MlsListing[]>()),
    g ? streetViewMeta(g.lat, g.lng) : Promise.resolve(undefined),
  ]);
  const p = parcelRes.parcel.data;

  const salesSrc = db ? await sr1aSource(db) : null;
  const history: Section<DeedRecord[]> =
    db && salesSrc
      ? p && parcelRes.unit.status !== "needs_unit" && parcelRes.unit.status !== "unmatched"
        ? await deedHistory(db, [p.pin], salesSrc).catch((e) => ({ status: "error" as const, data: null, source: salesSrc, error: String(e) }))
        : { status: "missing", data: null, source: salesSrc, note: "Needs the exact tax record (unit) to look up transfers." }
      : noDb("Transfer history");

  const { characteristics, conflicts } = mergeCharacteristics(parcelRes.parcel, history, mlsProperty);

  const kind = p?.kind ?? "other";
  const [market, comps, photos] = await Promise.all([
    db && salesSrc && p
      ? marketStats(db, p.muncode, p.municipality, kind, p.propClass, salesSrc).catch(
          (e) => ({ status: "error", data: null, source: salesSrc, error: String(e) }) as Section<MarketStats>
        )
      : Promise.resolve(db ? ({ status: "missing", data: null, source: salesSrc, note: "No parcel record to place the property." } as Section<MarketStats>) : noDb<MarketStats>("Market statistics")),
    p && g
      ? runComps(db, salesSrc, p, g, characteristics, unit, sellerNum(input.lead.beds) || null).catch(
          (e) => ({ status: "error", data: null, source: salesSrc, error: String(e) }) as Section<CompsResult>
        )
      : Promise.resolve({ status: "missing", data: null, source: salesSrc, note: "Needs a matched parcel and location." } as Section<CompsResult>),
    g ? photoCheck({ address: g.standardized, lat: g.lat, lng: g.lng, rings: p?.rings ?? null, streetView }) : Promise.resolve(undefined),
  ]);
  // The property's own recent sale is the best single value check.
  const ownSale = recentOwnSale(history.data ?? [], mlsProperty.data?.records ?? []);
  if (comps.data?.valuation) comps.data.valuation = reconcileOwnSale(comps.data.valuation, ownSale);

  const deeds = history.data ?? [];
  const indicators = deeds
    .filter((d) => d.nuCode && d.nuLabel)
    .map((d) => `${d.date ?? "Undated"}: ${d.nuLabel}${d.price != null ? ` ($${d.price.toLocaleString()})` : ""}`);

  const dossier: Dossier = {
    version: 1,
    generatedAt: nowIso(),
    input: { address: input.address, unit },
    geocode: geo,
    parcel: parcelRes.parcel,
    unit: parcelRes.unit,
    characteristics,
    conflicts,
    history,
    flood,
    zoning: {
      status: "not_available",
      data: null,
      source: null,
      note: `New Jersey has no statewide zoning dataset — check ${p?.municipality ?? "the municipality"}'s zoning map.`,
    },
    distress: {
      status: history.status === "ok" ? "ok" : history.status,
      data: { indicators },
      source: history.source,
      note: "From non-usable deed codes only. Mortgages, liens and foreclosure filings aren't in the public data — ask the seller, and order a title search before contract.",
    },
    market,
    comps,
    mls: { subject: mlsProperty, nearby: mlsListings },
    streetView,
    photoCheck: photos,
    insights: { tags: [], risks: [], missing: [], recommended: [] },
    sources: [],
  };
  const withSeller = withSellerFacts(dossier, input.lead);
  withSeller.insights = buildInsights(withSeller, input.lead);
  const all = [geo, parcelRes.parcel, history, flood, market, comps, mlsProperty, mlsListings]
    .map((s) => s.source)
    .filter((s): s is SourceRef => Boolean(s));
  withSeller.sources = [...new Map(all.map((s) => [s.id, s])).values()];
  return withSeller;
}
