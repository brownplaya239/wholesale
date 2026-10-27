/** Queries over the ingested SR1A deed records (official NJ closed sales). */
import { ymd, type Db } from "@/lib/db";
import { nuLabel, SR1A_SOURCE_URL, salesFreshness } from "@/lib/sr1a";
import { nowIso } from "./http";
import type { DeedRecord, MarketStats, PropertyKind, Section, SourceRef } from "./types";

export async function sr1aSource(db: Db): Promise<SourceRef> {
  const fr = await salesFreshness(db).catch(() => null);
  return {
    id: "nj_sr1a",
    name: `NJ Division of Taxation — SR1A deed sales${fr ? ` (${fr.files.join(", ")})` : ""}`,
    url: SR1A_SOURCE_URL,
    asOf: fr?.maxRecorded ? `deeds recorded through ${fr.maxRecorded}` : null,
    retrievedAt: nowIso(),
  };
}

type SaleRow = {
  pin: string;
  muncode: string;
  block: string;
  lot: string;
  qual: string;
  deed_date: unknown;
  recorded_date: unknown;
  price: number | string | null;
  usable: boolean;
  nu_code: string | null;
  prop_class: string | null;
  year_built: number | null;
  living_space: number | null;
  location: string | null;
  source_file: string;
};

const num = (v: unknown) => (v == null ? null : Number(v));

export async function deedHistory(db: Db, pins: string[], source: SourceRef): Promise<Section<DeedRecord[]>> {
  if (!pins.length) return { status: "missing", data: null, source };
  const rows = await db.q<SaleRow>(
    `SELECT * FROM sales WHERE pin = ANY($1::text[]) ORDER BY deed_date DESC NULLS LAST LIMIT 50`,
    [pins]
  );
  if (!rows.length) {
    return { status: "missing", data: [], source, note: "No recorded transfers in the loaded deed years." };
  }
  // The same deed can appear in two annual files; keep one.
  const seen = new Set<string>();
  const deeds: DeedRecord[] = [];
  for (const r of rows) {
    const key = `${ymd(r.deed_date)}|${r.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deeds.push({
      date: ymd(r.deed_date),
      recorded: ymd(r.recorded_date),
      price: num(r.price),
      usable: r.usable,
      nuCode: r.nu_code,
      nuLabel: nuLabel(r.nu_code),
      livingSpace: r.living_space,
      yearBuilt: r.year_built,
      propClass: r.prop_class,
      location: r.location,
      sourceFile: r.source_file,
    });
  }
  return { status: "ok", data: deeds, source };
}

export function segmentFilter(kind: PropertyKind, propClass: string): { sql: string; label: string } {
  switch (kind) {
    case "condo":
      return { sql: `prop_class = '2' AND qual LIKE 'C%'`, label: "condo units" };
    case "single_family":
      return { sql: `prop_class = '2' AND qual = ''`, label: "1–4 family homes" };
    case "multifamily":
      return { sql: `((prop_class = '2' AND qual = '') OR prop_class = '4C')`, label: "1–4 family and apartment buildings" };
    case "land":
      return { sql: `prop_class = '1'`, label: "vacant land" };
    default:
      return { sql: `prop_class = '${propClass.replace(/[^0-9A-Z]/gi, "")}'`, label: `class ${propClass} properties` };
  }
}

export async function marketStats(
  db: Db,
  muncode: string,
  municipality: string,
  kind: PropertyKind,
  propClass: string,
  source: SourceRef
): Promise<Section<MarketStats>> {
  const seg = segmentFilter(kind, propClass);
  for (const days of [180, 365]) {
    const rows = await db.q<{
      n: number;
      med: number | null;
      p25: number | null;
      p75: number | null;
      ppsf: number | null;
      mn: unknown;
      mx: unknown;
    }>(
      `SELECT count(*)::int AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price) AS med,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY price) AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY price) AS p75,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY price::float / NULLIF(living_space, 0))
           FILTER (WHERE living_space > 300) AS ppsf,
         min(deed_date) AS mn, max(deed_date) AS mx
       FROM sales
       WHERE muncode = $1 AND usable AND price >= 10000
         AND deed_date >= CURRENT_DATE - $2::int AND deed_date <= CURRENT_DATE AND ${seg.sql}`,
      [muncode, days]
    );
    const r = rows[0];
    if (r && (r.n >= 5 || days === 365)) {
      if (!r.n) {
        return { status: "missing", data: null, source, note: `No usable ${seg.label} sales in ${municipality} in the last year of deed data.` };
      }
      const round = (v: number | null) => (v == null ? null : Math.round(Number(v)));
      return {
        status: "ok",
        source,
        data: {
          municipality,
          windowDays: days,
          sales: r.n,
          medianPrice: round(r.med),
          p25Price: round(r.p25),
          p75Price: round(r.p75),
          medianPpsf: round(r.ppsf),
          from: ymd(r.mn) ?? "",
          to: ymd(r.mx) ?? "",
          segment: seg.label,
        },
      };
    }
  }
  return { status: "missing", data: null, source };
}

/**
 * What arm's-length sales in the municipality fetched relative to their
 * assessments (median sale price ÷ assessed value) — the Division of
 * Taxation's sales-ratio method, from the deed file. Needs the `assessed`
 * column (deed files loaded or re-loaded after it was added).
 */
export async function assessmentRatio(
  db: Db,
  muncode: string,
  municipality: string,
  kind: PropertyKind,
  propClass: string
): Promise<{ ratio: number; p25: number; p75: number; sales: number; windowDays: number; municipality: string; segment: string } | null> {
  const seg = segmentFilter(kind, propClass);
  for (const days of [365, 730]) {
    const rows = await db.q<{ n: number; med: number | null; p25: number | null; p75: number | null }>(
      `SELECT count(*)::int AS n,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY r) AS med,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY r) AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY r) AS p75
       FROM (SELECT price::float / assessed AS r FROM sales
             WHERE muncode = $1 AND usable AND price >= 25000 AND assessed >= 10000
               AND deed_date >= CURRENT_DATE - $2::int AND deed_date <= CURRENT_DATE AND ${seg.sql}) x
       WHERE r BETWEEN 0.2 AND 5`,
      [muncode, days]
    );
    const r = rows[0];
    if (r && r.n >= 10 && r.med) {
      const k = (v: number | null) => Math.round(Number(v) * 1000) / 1000;
      return { ratio: k(r.med), p25: k(r.p25), p75: k(r.p75), sales: r.n, windowDays: days, municipality, segment: seg.label };
    }
  }
  return null;
}

export type Candidate = {
  pin: string;
  muncode: string;
  block: string;
  lot: string;
  qual: string;
  saleDate: string;
  price: number;
  propClass: string | null;
  yearBuilt: number | null;
  livingSpace: number | null;
  location: string | null;
};

export async function compCandidates(
  db: Db,
  opts: {
    muncodes: string[];
    homeMuncode: string;
    sinceDays: number;
    kind: PropertyKind;
    propClass: string;
    excludePin: string;
    livingSpace: number | null;
    limit?: number;
  }
): Promise<Candidate[]> {
  const seg = segmentFilter(opts.kind, opts.propClass);
  const params: unknown[] = [opts.muncodes, opts.sinceDays, opts.excludePin, opts.homeMuncode, opts.limit ?? 300];
  let size = "";
  if (opts.livingSpace && opts.kind !== "land") {
    params.push(Math.round(opts.livingSpace * 0.5), Math.round(opts.livingSpace * 1.6));
    size = `AND (living_space IS NULL OR living_space BETWEEN $6 AND $7)`;
  }
  const rows = await db.q<SaleRow>(
    `SELECT DISTINCT ON (pin) * FROM (
       SELECT * FROM sales
       WHERE muncode = ANY($1::text[]) AND usable AND price >= 25000
         AND deed_date >= CURRENT_DATE - $2::int AND deed_date <= CURRENT_DATE
         AND pin <> $3 AND ${seg.sql} ${size}
       ORDER BY (muncode = $4) DESC, deed_date DESC
       LIMIT $5
     ) c ORDER BY pin, deed_date DESC`,
    params
  );
  return rows.map((r) => ({
    pin: r.pin,
    muncode: r.muncode,
    block: r.block,
    lot: r.lot,
    qual: r.qual,
    saleDate: ymd(r.deed_date) ?? "",
    price: Number(r.price),
    propClass: r.prop_class,
    yearBuilt: r.year_built,
    livingSpace: r.living_space,
    location: r.location,
  }));
}

/** Condo sales in the subject's building (same block/lot, any unit). */
export async function sameBuildingSales(
  db: Db,
  muncode: string,
  block: string,
  lot: string,
  excludePin: string
): Promise<Candidate[]> {
  const rows = await db.q<SaleRow>(
    `SELECT DISTINCT ON (pin) * FROM sales
     WHERE muncode = $1 AND block = $2 AND lot = $3 AND qual LIKE 'C%' AND usable
       AND price >= 25000 AND deed_date >= CURRENT_DATE - 730 AND deed_date <= CURRENT_DATE
       AND pin <> $4
     ORDER BY pin, deed_date DESC`,
    [muncode, block, lot, excludePin]
  );
  return rows.map((r) => ({
    pin: r.pin,
    muncode: r.muncode,
    block: r.block,
    lot: r.lot,
    qual: r.qual,
    saleDate: ymd(r.deed_date) ?? "",
    price: Number(r.price),
    propClass: r.prop_class,
    yearBuilt: r.year_built,
    livingSpace: r.living_space,
    location: r.location,
  }));
}

export async function salesLoaded(db: Db): Promise<boolean> {
  const r = await db.q<{ x: boolean }>(`SELECT EXISTS (SELECT 1 FROM sales) AS x`);
  return Boolean(r[0]?.x);
}

/** Buyers that are companies, not people — investors (family trusts excluded). */
export const ENTITY_SQL = String.raw`~* '\m(LLC|L L C|INC|CORP|CORPORATION|CO|COMPANY|LP|LLP|HOLDINGS?|PROPERTIES|PROPERTY|INVESTMENTS?|CAPITAL|VENTURES?|REALTY|HOMES|DEVELOPMENT|ENTERPRISES?|PARTNERS|GROUP|ACQUISITIONS?)\M'`;

export type FlipRow = {
  pin: string;
  muncode: string;
  location: string | null;
  buyDate: string;
  buyPrice: number;
  buyer: string | null;
  buyNuCode: string | null;
  sellDate: string;
  sellPrice: number;
  livingSpace: number | null;
  yearBuilt: number | null;
};

/**
 * Flip pairs from the deed file: the same parcel bought and resold within
 * 60–540 days for at least 25% more, the resale arm's-length. The resale is
 * the renovated price (ARV evidence); the purchase is what an investor paid
 * as-is. Both deeds must be in the loaded years.
 */
export async function flipPairs(db: Db, opts: { muncodes: string[]; kind: PropertyKind; propClass: string; sinceDays: number; excludePin: string }): Promise<FlipRow[]> {
  const seg = segmentFilter(opts.kind, opts.propClass);
  const rows = await db.q<Record<string, unknown>>(
    `WITH s AS (SELECT * FROM sales WHERE muncode = ANY($1::text[]) AND price >= 10000 AND ${seg.sql})
     SELECT DISTINCT ON (b.pin) b.pin, b.muncode, b.location, a.deed_date AS buy_date, a.price AS buy_price,
            a.grantee AS buyer, a.nu_code AS buy_nu, b.deed_date AS sell_date, b.price AS sell_price,
            COALESCE(b.living_space, a.living_space) AS living_space, COALESCE(b.year_built, a.year_built) AS year_built
       FROM s a JOIN s b ON a.pin = b.pin
        AND b.deed_date BETWEEN a.deed_date + 60 AND a.deed_date + 540
      WHERE b.usable AND b.price >= 50000 AND b.price >= a.price * 1.25
        AND b.deed_date >= CURRENT_DATE - $2::int AND b.deed_date <= CURRENT_DATE AND b.pin <> $3
      ORDER BY b.pin, b.deed_date DESC
      LIMIT 200`,
    [opts.muncodes, opts.sinceDays, opts.excludePin]
  );
  return rows.map((r) => ({
    pin: String(r.pin),
    muncode: String(r.muncode),
    location: (r.location as string) ?? null,
    buyDate: ymd(r.buy_date) ?? "",
    buyPrice: Number(r.buy_price),
    buyer: (r.buyer as string) ?? null,
    buyNuCode: (r.buy_nu as string) ?? null,
    sellDate: ymd(r.sell_date) ?? "",
    sellPrice: Number(r.sell_price),
    livingSpace: r.living_space == null ? null : Number(r.living_space),
    yearBuilt: r.year_built == null ? null : Number(r.year_built),
  }));
}

export type InvestorBuyRow = {
  pin: string;
  muncode: string;
  location: string | null;
  date: string;
  price: number;
  buyer: string;
  nuCode: string | null;
  usable: boolean;
  livingSpace: number | null;
  yearBuilt: number | null;
};

/**
 * Company buyers (LLC, Inc, Holdings…) paying real money: arm's-length
 * sales plus sheriff's, foreclosure, short and lien sales — what investors
 * pay for houses as-is. Family/estate and nominal transfers are excluded.
 */
export async function investorBuys(
  db: Db,
  opts: { muncodes: string[]; kind: PropertyKind; propClass: string; sinceDays: number; excludePin: string; distressCodes: number[] }
): Promise<InvestorBuyRow[]> {
  const seg = segmentFilter(opts.kind, opts.propClass);
  const rows = await db.q<Record<string, unknown>>(
    `SELECT DISTINCT ON (pin) pin, muncode, location, deed_date, price, grantee, nu_code, usable, living_space, year_built
       FROM sales
      WHERE muncode = ANY($1::text[]) AND price >= 25000 AND ${seg.sql}
        AND deed_date >= CURRENT_DATE - $2::int AND deed_date <= CURRENT_DATE AND pin <> $3
        AND grantee ${ENTITY_SQL}
        AND (usable OR (CASE WHEN nu_code ~ '^[0-9]+$' THEN nu_code::int END) = ANY($4::int[]))
      ORDER BY pin, deed_date DESC
      LIMIT 300`,
    [opts.muncodes, opts.sinceDays, opts.excludePin, opts.distressCodes]
  );
  return rows.map((r) => ({
    pin: String(r.pin),
    muncode: String(r.muncode),
    location: (r.location as string) ?? null,
    date: ymd(r.deed_date) ?? "",
    price: Number(r.price),
    buyer: String(r.grantee ?? ""),
    nuCode: (r.nu_code as string) ?? null,
    usable: Boolean(r.usable),
    livingSpace: r.living_space == null ? null : Number(r.living_space),
    yearBuilt: r.year_built == null ? null : Number(r.year_built),
  }));
}
