/**
 * Postgres access. Production: Neon (DATABASE_URL, set by the Vercel/Neon
 * integration). Local testing only: PGlite, an in-process Postgres, when
 * PGLITE_DIR is set outside Vercel.
 *
 * Everything that calls getDb() must handle `null`: with no database the site
 * still collects and emails leads exactly as before — persistence,
 * enrichment, and reports simply stay dormant.
 */

export type Db = {
  q<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const SCHEMA_VERSION = "5";

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS inspection_properties (
    id text PRIMARY KEY, data jsonb NOT NULL, review jsonb,
    revision int NOT NULL DEFAULT 1, reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS inspection_review_events (
    id bigserial PRIMARY KEY, property_id text NOT NULL REFERENCES inspection_properties(id),
    review jsonb NOT NULL, revision int NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS leads (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'new',
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    address_original text NOT NULL,
    address_current text NOT NULL,
    address_unit text,
    place_id text,
    timeline text,
    priority text,
    condition text,
    occupancy text,
    notes text,
    source jsonb NOT NULL DEFAULT '{}'::jsonb,
    consent jsonb NOT NULL DEFAULT '{}'::jsonb,
    events jsonb NOT NULL DEFAULT '[]'::jsonb,
    dedupe_key text,
    workflow jsonb,
    notified jsonb NOT NULL DEFAULT '{}'::jsonb,
    enrichment_status text NOT NULL DEFAULT 'pending',
    enrichment_attempts int NOT NULL DEFAULT 0,
    enrichment_error text,
    enriched_at timestamptz,
    dossier jsonb
  )`,
  // v4: seller-reported beds/baths (thank-you page)
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS beds text`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS baths text`,
  `CREATE INDEX IF NOT EXISTS leads_dedupe_idx ON leads (dedupe_key, created_at)`,
  `CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS lead_photos (
    id text PRIMARY KEY,
    lead_id text NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    content_type text NOT NULL,
    size int NOT NULL,
    data_b64 text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS lead_photos_lead_idx ON lead_photos (lead_id)`,
  `CREATE TABLE IF NOT EXISTS sales (
    rec_key text PRIMARY KEY,
    muncode text NOT NULL,
    block text NOT NULL,
    lot text NOT NULL,
    qual text NOT NULL DEFAULT '',
    pin text NOT NULL,
    deed_date date,
    recorded_date date,
    price bigint,
    usable boolean NOT NULL,
    nu_code text,
    prop_class text,
    year_built smallint,
    living_space int,
    location text,
    grantor text,
    grantee text,
    source_file text NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS sales_mun_date_idx ON sales (muncode, deed_date)`,
  `CREATE INDEX IF NOT EXISTS sales_pin_idx ON sales (pin)`,
  `CREATE TABLE IF NOT EXISTS ingest_runs (
    id bigserial PRIMARY KEY,
    source_file text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL,
    rows_parsed int,
    rows_inserted int,
    file_last_modified text,
    max_deed_date date,
    max_recorded_date date,
    error text
  )`,
  `CREATE TABLE IF NOT EXISTS provider_cache (
    key text PRIMARY KEY,
    provider text NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    payload jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS api_usage (
    day date NOT NULL,
    provider text NOT NULL,
    calls int NOT NULL DEFAULT 0,
    errors int NOT NULL DEFAULT 0,
    cache_hits int NOT NULL DEFAULT 0,
    PRIMARY KEY (day, provider)
  )`,
];

let dbPromise: Promise<Db | null> | undefined;
let lastFailure = 0;
let closer: (() => Promise<void>) | null = null;

export function dbConfigured(): boolean {
  return Boolean(
    process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      (process.env.PGLITE_DIR && !process.env.VERCEL)
  );
}

export function getDb(): Promise<Db | null> {
  // After a failed connect, back off for 30s instead of retrying every call.
  if (!dbPromise && Date.now() - lastFailure < 30_000) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = open().catch((err) => {
      console.error(`DB unavailable: ${String(err)}`);
      dbPromise = undefined;
      lastFailure = Date.now();
      return null;
    });
  }
  return dbPromise;
}

async function open(): Promise<Db | null> {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  let db: Db;
  if (url) {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    db = { q: (text, params = []) => sql.query(text, params as unknown[]) as never };
  } else if (process.env.PGLITE_DIR && !process.env.VERCEL) {
    // Variable specifier keeps the (dev-only) PGlite wasm out of prod bundles.
    const pkg = "@electric-sql/pglite";
    const { PGlite } = await import(/* webpackIgnore: true */ pkg);
    const pg = new PGlite(process.env.PGLITE_DIR);
    closer = () => pg.close();
    db = { q: async (text, params = []) => (await pg.query(text, params)).rows as never };
  } else {
    return null;
  }
  await migrate(db);
  return db;
}

/** Flushes and closes a local PGlite database (tests/scripts before exit). */
export async function closeDb(): Promise<void> {
  if (closer) await closer();
  closer = null;
  dbPromise = undefined;
}

async function migrate(db: Db): Promise<void> {
  const current = await db
    .q<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'schema_version'`)
    .catch(() => []);
  if (current[0]?.value === SCHEMA_VERSION) return;
  for (const stmt of SCHEMA) await db.q(stmt);
  await db.q(
    `INSERT INTO app_meta (key, value) VALUES ('schema_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [SCHEMA_VERSION]
  );
}

/** Timestamps come back as Date (Neon) or string (PGlite); normalize to ISO. */
export function iso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/** A date column as YYYY-MM-DD regardless of driver. */
export function ymd(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Per-provider daily call/error/cache-hit counters (API usage monitoring). */
export async function recordUsage(
  provider: string,
  kind: "call" | "error" | "cache_hit"
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const col = kind === "call" ? "calls" : kind === "error" ? "errors" : "cache_hits";
  await db
    .q(
      `INSERT INTO api_usage (day, provider, ${col}) VALUES (CURRENT_DATE, $1, 1)
       ON CONFLICT (day, provider) DO UPDATE SET ${col} = api_usage.${col} + 1`,
      [provider]
    )
    .catch(() => {});
}
