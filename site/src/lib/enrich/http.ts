/**
 * Outbound calls to data providers: timeouts, retries with backoff, response
 * caching (only for public data or within provider terms), and per-provider
 * usage counters for monitoring.
 */
import { getDb, recordUsage } from "@/lib/db";

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number
  ) {
    super(`${provider}: ${message}`);
  }
}

type Opts = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Form-encoded POST body (ArcGIS queries with long IN lists). */
  form?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  cacheKey?: string;
  cacheTtlSec?: number;
  /** Throw on logically failed responses that still return HTTP 200. */
  validate?: (json: unknown) => void;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cacheGet<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db
    .q<{ payload: T }>(`SELECT payload FROM provider_cache WHERE key = $1 AND expires_at > now()`, [key])
    .catch(() => []);
  return rows[0]?.payload;
}

async function cachePut(key: string, provider: string, payload: unknown, ttlSec: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .q(
      `INSERT INTO provider_cache (key, provider, fetched_at, expires_at, payload)
       VALUES ($1, $2, now(), now() + ($3 || ' seconds')::interval, $4::jsonb)
       ON CONFLICT (key) DO UPDATE SET fetched_at = now(), expires_at = EXCLUDED.expires_at,
         payload = EXCLUDED.payload`,
      [key, provider, String(ttlSec), JSON.stringify(payload)]
    )
    .catch(() => {});
}

export async function fetchJson<T = unknown>(provider: string, url: string, opts: Opts = {}): Promise<T> {
  if (opts.cacheKey) {
    const hit = await cacheGet<T>(opts.cacheKey);
    if (hit !== undefined) {
      await recordUsage(provider, "cache_hit");
      return hit;
    }
  }
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(400 * 2 ** (attempt - 1));
    await recordUsage(provider, "call");
    try {
      const res = await fetch(url, {
        method: opts.form ? "POST" : opts.method ?? "GET",
        headers: {
          Accept: "application/json",
          ...(opts.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...opts.headers,
        },
        body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 12_000),
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ProviderError(provider, `HTTP ${res.status}`, res.status);
        continue;
      }
      if (!res.ok) {
        // 4xx other than 429 won't improve on retry.
        throw Object.assign(new ProviderError(provider, `HTTP ${res.status}`, res.status), { final: true });
      }
      const json = (await res.json()) as T;
      opts.validate?.(json);
      if (opts.cacheKey) await cachePut(opts.cacheKey, provider, json, opts.cacheTtlSec ?? 86_400);
      return json;
    } catch (err) {
      lastErr = err;
      if ((err as { final?: boolean }).final) break;
    }
  }
  await recordUsage(provider, "error");
  throw lastErr instanceof Error ? lastErr : new ProviderError(provider, String(lastErr));
}

/** ArcGIS REST returns HTTP 200 with {error: {...}} on failure. */
export function arcgisValidate(json: unknown): void {
  const e = (json as { error?: { code?: number; message?: string } })?.error;
  if (e) throw new ProviderError("arcgis", `${e.code ?? ""} ${e.message ?? "error"}`.trim(), e.code);
}

export function nowIso(): string {
  return new Date().toISOString();
}
