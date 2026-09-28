/** Read-only queries for the admin dashboard. */
import { iso, ymd, type Db } from "@/lib/db";

export async function usageLast7(db: Db) {
  return db.q<{ provider: string; calls: number; errors: number; cache_hits: number }>(
    `SELECT provider, sum(calls)::int AS calls, sum(errors)::int AS errors, sum(cache_hits)::int AS cache_hits
       FROM api_usage WHERE day > CURRENT_DATE - 7 GROUP BY provider ORDER BY provider`
  );
}

export async function recentIngests(db: Db) {
  const rows = await db.q<Record<string, unknown>>(
    `SELECT source_file, status, started_at, rows_parsed, rows_inserted, max_recorded_date, error
       FROM ingest_runs ORDER BY started_at DESC LIMIT 6`
  );
  return rows.map((r) => ({
    file: String(r.source_file),
    status: String(r.status),
    at: iso(r.started_at),
    parsed: r.rows_parsed == null ? null : Number(r.rows_parsed),
    inserted: r.rows_inserted == null ? null : Number(r.rows_inserted),
    recordedThrough: ymd(r.max_recorded_date),
    error: (r.error as string) ?? null,
  }));
}

/** Leads by campaign and how far each got — judge ads on deals, not form fills. */
export async function campaignFunnel(db: Db) {
  return db.q<{
    campaign: string;
    leads: number;
    contacted: number;
    appointments: number;
    contracts: number;
    closed: number;
  }>(
    `SELECT COALESCE(source->'googleAds'->>'campaignId', CASE WHEN source->>'channel' IS NULL THEN 'unknown' ELSE source->>'channel' END) AS campaign,
       count(*)::int AS leads,
       count(*) FILTER (WHERE status NOT IN ('new'))::int AS contacted,
       count(*) FILTER (WHERE status IN ('appointment','offer_sent','under_contract','listed','closed'))::int AS appointments,
       count(*) FILTER (WHERE status IN ('under_contract','listed','closed'))::int AS contracts,
       count(*) FILTER (WHERE status = 'closed')::int AS closed
     FROM leads GROUP BY 1 ORDER BY leads DESC`
  );
}
