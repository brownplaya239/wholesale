/**
 * NJ SR1A deed-sales files (NJ Division of Taxation, statewide, every recorded
 * deed). Fixed-width layout per SR1Afilelayout.pdf — the same offsets
 * scripts/nj_common.py uses (records are 663 chars without line endings).
 *
 * These are the official source for closed comparable sales and transfer
 * history. Loaded into the `sales` table by ingestSr1aFile(); the cron keeps
 * the current-year YTD file fresh.
 */
import { unzipSync } from "fflate";
import type { Db } from "@/lib/db";

export const SR1A_BASE = "https://www.nj.gov/treasury/taxation/lpt/statdata";
export const SR1A_SOURCE_URL = "https://www.nj.gov/treasury/taxation/lpt/statdata.shtml";

/** YTD file for the year in progress; full-year files for earlier years. */
export function sr1aFileName(year: number, currentYear = new Date().getFullYear()): string {
  return year >= currentYear ? `YTDSR1A${year}` : `Sales${year}`;
}

export type SaleRow = {
  recKey: string;
  muncode: string;
  block: string;
  lot: string;
  qual: string;
  pin: string;
  deedDate: string | null;
  recordedDate: string | null;
  price: number | null;
  usable: boolean;
  nuCode: string | null;
  propClass: string | null;
  yearBuilt: number | null;
  livingSpace: number | null;
  location: string | null;
  grantor: string | null;
  grantee: string | null;
};

const f = (line: string, start: number, len: number) => line.slice(start, start + len).trim();

/** "00161" + "" -> "161"; "00029" + "02" -> "29.02" (matches parcel PAMS_PIN). */
export function normalizeBlockLot(prefix: string, suffix: string): string {
  const p = prefix.trim().replace(/^0+(?=.)/, "");
  const s = suffix.trim();
  return s ? `${p}.${s}` : p;
}

/** PAMS_PIN as used by the NJ parcel layer: MUN_BLOCK_LOT[_QUAL]. */
export function pamsPin(muncode: string, block: string, lot: string, qual: string): string {
  return `${muncode}_${block}_${lot}${qual ? `_${qual}` : ""}`;
}

/** SR1A dates are YYMMDD. */
export function sr1aDate(raw: string, now = new Date()): string | null {
  if (!/^\d{6}$/.test(raw)) return null;
  const yy = Number(raw.slice(0, 2));
  const mm = Number(raw.slice(2, 4));
  const dd = Number(raw.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const cutoff = (now.getFullYear() % 100) + 1;
  const year = yy <= cutoff ? 2000 + yy : 1900 + yy;
  const d = new Date(Date.UTC(year, mm - 1, dd));
  if (d.getUTCMonth() !== mm - 1) return null; // e.g. Feb 31
  return d.toISOString().slice(0, 10);
}

function num(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseSr1aLine(line: string, now = new Date()): SaleRow | null {
  if (line.length < 660) return null;
  const county = f(line, 0, 2);
  const district = f(line, 2, 2);
  if (!/^\d{2}$/.test(county) || !/^\d{2}$/.test(district)) return null;
  const muncode = county + district;
  const block = normalizeBlockLot(line.slice(350, 355), line.slice(355, 359));
  const lot = normalizeBlockLot(line.slice(359, 364), line.slice(364, 368));
  if (!block || !lot) return null;
  const qual = f(line, 619, 5);
  const uType = f(line, 33, 1);
  const nu = f(line, 34, 3);
  const verified = num(f(line, 46, 9));
  const reported = num(f(line, 37, 9));
  const price = verified && verified > 0 ? verified : reported;
  const deedDate = sr1aDate(f(line, 338, 6), now);
  const yb = num(f(line, 652, 4));
  const ls = num(f(line, 656, 7));
  const serial = f(line, 98, 7);
  return {
    recKey: [muncode, serial, block, lot, qual, f(line, 338, 6), price ?? ""].join("|"),
    muncode,
    block,
    lot,
    qual,
    pin: pamsPin(muncode, block, lot, qual),
    deedDate,
    recordedDate: sr1aDate(f(line, 344, 6), now),
    price: price ?? null,
    // U = usable (arm's-length) per the Division's classification.
    usable: uType === "U" || (uType === "" && (nu === "" || Number(nu) === 0)),
    nuCode: nu || null,
    propClass: f(line, 626, 3) || null,
    yearBuilt: yb && yb >= 1700 && yb <= now.getFullYear() + 1 ? yb : null,
    livingSpace: ls && ls > 0 ? ls : null,
    location: f(line, 297, 25) || null,
    grantor: f(line, 109, 35) || null,
    grantee: f(line, 203, 35) || null,
  };
}

export function parseSr1aText(text: string, now = new Date()): SaleRow[] {
  const rows: SaleRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const r = parseSr1aLine(line, now);
    if (r) rows.push(r);
  }
  return rows;
}

/**
 * Non-usable deed categories, N.J.A.C. 18:12-1.1(a) (summarized from the
 * regulation text; the code on the deed is the source of truth).
 */
export const NU_LABELS: Record<number, string> = {
  1: "Sale between immediate family members",
  2: "\"Love and affection\" stated as consideration",
  3: "Between a corporation and its stockholder/affiliate",
  4: "Transfer of convenience (e.g., title correction)",
  5: "Outside the ratio-study sampling period",
  6: "Portion of a larger assessed tract (split-off)",
  7: "Substantially improved after assessment",
  8: "Sale of an undivided interest",
  9: "Subject to a tax sale certificate or tax/government lien",
  10: "By guardian, trustee, executor or administrator (estate)",
  11: "Judicial sale, including partition",
  12: "Sheriff's sale",
  13: "Bankruptcy, receivership, liquidation or short sale",
  14: "Doubtful title, including quit-claim deed",
  15: "Involving a government entity",
  16: "Property assessed in more than one taxing district",
  17: "Involving a charitable, religious or benevolent organization",
  18: "Deed in lieu of foreclosure to a financial institution",
  19: "Affected by demolition, fire, contamination or damage after assessment",
  20: "Railroad, pipeline or utility acquisition (easement/right-of-way)",
  21: "Low/moderate-income (Fair Housing Act) housing",
  22: "Exchange for other real estate, securities or property",
  23: "Commercial/industrial sale including equipment",
  24: "Influenced by zoning, approvals, variances or rent control",
  25: "Consideration of $100 or less",
  26: "Not between willing, knowledgeable parties without compulsion",
  27: "Sale before a revaluation within the sampling period",
  28: "Subject to a leaseback",
  29: "After an appeal with a court-ordered or Freeze Act assessment",
  30: "Multiple parcels not forming one economic unit",
  31: "First sale after a financial-institution foreclosure",
  32: "Assessment description differs substantially from property sold",
  33: "Qualified farmland or exempt/abated property",
  34: "Property class doesn't reflect actual use",
  35: "Less than full ownership rights, or subject to exceptions",
  36: "Assessment not reflective / disproportionate ratio",
};

export function nuLabel(code: string | null | undefined): string | null {
  if (!code || !/^\d+$/.test(code.trim())) return null;
  return NU_LABELS[Number(code)] ?? `Non-usable code ${Number(code)}`;
}

/** Codes that signal distress or estate transfers in a property's history. */
export const DISTRESS_NU = new Set([9, 11, 12, 13, 18, 31]);
export const ESTATE_NU = new Set([10]);
export const FAMILY_NU = new Set([1, 2]);

export type IngestResult = {
  file: string;
  status: "ingested" | "unchanged" | "not_found" | "error";
  rowsParsed?: number;
  rowsInserted?: number;
  lastModified?: string | null;
  maxDeedDate?: string | null;
  maxRecordedDate?: string | null;
  error?: string;
};

const BATCH = 1000;

/** Idempotent: re-running inserts only records not already present. */
export async function insertSales(db: Db, rows: SaleRow[], sourceFile: string): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const b = rows.slice(i, i + BATCH);
    const res = await db.q<{ n: number }>(
      `WITH ins AS (
         INSERT INTO sales (rec_key, muncode, block, lot, qual, pin, deed_date, recorded_date,
           price, usable, nu_code, prop_class, year_built, living_space, location, grantor,
           grantee, source_file)
         SELECT *, $18::text FROM unnest($1::text[], $2::text[], $3::text[], $4::text[],
           $5::text[], $6::text[], $7::date[], $8::date[], $9::bigint[], $10::boolean[],
           $11::text[], $12::text[], $13::smallint[], $14::int[], $15::text[], $16::text[],
           $17::text[])
         ON CONFLICT (rec_key) DO NOTHING
         RETURNING 1
       ) SELECT count(*)::int AS n FROM ins`,
      [
        b.map((r) => r.recKey),
        b.map((r) => r.muncode),
        b.map((r) => r.block),
        b.map((r) => r.lot),
        b.map((r) => r.qual),
        b.map((r) => r.pin),
        b.map((r) => r.deedDate),
        b.map((r) => r.recordedDate),
        b.map((r) => r.price),
        b.map((r) => r.usable),
        b.map((r) => r.nuCode),
        b.map((r) => r.propClass),
        b.map((r) => r.yearBuilt),
        b.map((r) => r.livingSpace),
        b.map((r) => r.location),
        b.map((r) => r.grantor),
        b.map((r) => r.grantee),
        sourceFile,
      ]
    );
    inserted += Number(res[0]?.n ?? 0);
  }
  return inserted;
}

/**
 * Download one Treasury file (e.g. "YTDSR1A2026" or "Sales2025") and load it.
 * Skips the download work when the file's Last-Modified matches the last
 * successful run, unless `force`.
 */
export async function ingestSr1aFile(
  db: Db,
  file: string,
  opts: { force?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<IngestResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${SR1A_BASE}/${file}.zip`;
  const run = await db.q<{ id: number }>(
    `INSERT INTO ingest_runs (source_file, status) VALUES ($1, 'running') RETURNING id`,
    [file]
  );
  const runId = run[0].id;
  const finish = async (r: IngestResult) => {
    await db.q(
      `UPDATE ingest_runs SET finished_at = now(), status = $2, rows_parsed = $3,
         rows_inserted = $4, file_last_modified = $5, max_deed_date = $6,
         max_recorded_date = $7, error = $8 WHERE id = $1`,
      [
        runId,
        r.status,
        r.rowsParsed ?? null,
        r.rowsInserted ?? null,
        r.lastModified ?? null,
        r.maxDeedDate ?? null,
        r.maxRecordedDate ?? null,
        r.error ?? null,
      ]
    );
    return r;
  };
  try {
    const head = await fetchImpl(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
    if (head.status === 404) return finish({ file, status: "not_found" });
    const lastModified = head.headers.get("last-modified");
    if (!opts.force && lastModified) {
      const prev = await db.q(
        `SELECT 1 FROM ingest_runs WHERE source_file = $1 AND status = 'ingested'
           AND file_last_modified = $2 LIMIT 1`,
        [file, lastModified]
      );
      if (prev.length) return finish({ file, status: "unchanged", lastModified });
    }
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(120_000) });
    if (res.status === 404) return finish({ file, status: "not_found" });
    if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${file}`);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const entry = Object.keys(zip).find((n) => /\.(txt|dat)$/i.test(n)) ?? Object.keys(zip)[0];
    if (!entry) throw new Error(`${file}.zip is empty`);
    const text = new TextDecoder("latin1").decode(zip[entry]);
    const rows = parseSr1aText(text);
    if (rows.length === 0) throw new Error(`${file}: no parseable records (layout drift?)`);
    const inserted = await insertSales(db, rows, file);
    const maxOf = (vals: (string | null)[]) =>
      vals.reduce<string | null>((m, v) => (v && (!m || v > m) ? v : m), null);
    const today = new Date().toISOString().slice(0, 10);
    return finish({
      file,
      status: "ingested",
      rowsParsed: rows.length,
      rowsInserted: inserted,
      lastModified: lastModified ?? res.headers.get("last-modified"),
      // Future-dated typos exist in the source; ignore them for freshness.
      maxDeedDate: maxOf(rows.map((r) => (r.deedDate && r.deedDate <= today ? r.deedDate : null))),
      maxRecordedDate: maxOf(
        rows.map((r) => (r.recordedDate && r.recordedDate <= today ? r.recordedDate : null))
      ),
    });
  } catch (err) {
    return finish({ file, status: "error", error: String(err).slice(0, 500) });
  }
}

/** Freshness of the loaded deed data, for report provenance. */
export async function salesFreshness(
  db: Db
): Promise<{ files: string[]; lastModified: string | null; maxRecorded: string | null; maxDeed: string | null } | null> {
  const rows = await db.q<{
    source_file: string;
    file_last_modified: string | null;
    max_recorded_date: unknown;
    max_deed_date: unknown;
  }>(
    `SELECT DISTINCT ON (source_file) source_file, file_last_modified, max_recorded_date, max_deed_date
       FROM ingest_runs WHERE status = 'ingested' ORDER BY source_file, finished_at DESC`
  );
  if (!rows.length) return null;
  const toYmd = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  const recs = rows.map((r) => toYmd(r.max_recorded_date)).filter(Boolean) as string[];
  const deeds = rows.map((r) => toYmd(r.max_deed_date)).filter(Boolean) as string[];
  const mods = rows.map((r) => r.file_last_modified).filter(Boolean) as string[];
  return {
    files: rows.map((r) => r.source_file),
    lastModified: mods.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
    maxRecorded: recs.sort().at(-1) ?? null,
    maxDeed: deeds.sort().at(-1) ?? null,
  };
}
