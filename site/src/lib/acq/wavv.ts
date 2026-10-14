/**
 * WAVV Public API v3 (docs.wavv.com, verified 2026-10-01).
 *
 * Webhook events: call.started, call.incoming, call.ended, call.recorded —
 * there is NO transcript-ready event. call.ended carries outcome, human
 * (answering-machine detection), disposition (free text = our labels),
 * note, seconds, userId and contactId (the GHL contact id; null for manual
 * dials). call.recorded adds recordingUrl (72 h). Transcript + WAVV summary
 * come from GET /calls/{id}/transcript, which returns transcript: null until
 * ready — so it is fetched after call.recorded and retried later.
 *
 * Signature: X-WAVV-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.rawBody">
 * keyed with the webhook's whsec_ secret. Delivery is at-least-once, out of
 * order, 10 s to respond, 5 attempts — dedupe on (event, data.id).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type WavvCall = {
  id: string;
  teamId?: string;
  userId?: string | null;
  groupId?: string | null;
  campaignId?: string | null;
  direction?: "inbound" | "outbound" | string;
  phone?: string | null;
  callerId?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  startedAt?: string | null;
  answeredAt?: string | null;
  endedAt?: string | null;
  seconds?: number | null;
  outcome?: string | null;
  disposition?: string | null;
  human?: boolean | null;
  note?: string | null;
  summary?: string | null;
  recorded?: boolean | null;
  recordingUrl?: string | null;
};

export type WavvEvent = { event: string; sentAt?: string; data: WavvCall };

/**
 * Which secret / message / encoding combination produced the match — logged
 * once so the live scheme is confirmed, never the secret itself.
 */
export type WavvSigScheme = { key: "raw" | "no_prefix" | "base64"; msg: "t.body" | "body" | "tbody"; enc: "hex" | "base64" };

/**
 * Verify X-WAVV-Signature (`t=<unix>,v1=<sig>`). The documented scheme is hex
 * HMAC-SHA256 of `t + "." + rawBody` keyed with the whsec_ secret. The first
 * live deliveries did not match it, so the common variants are accepted too —
 * every one is still an HMAC keyed by the secret — and the matching variant
 * is reported. Returns null when nothing matches.
 */
export function matchWavvSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): WavvSigScheme | null {
  if (!header || !secret) return null;
  const parts = header.split(",").map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i).trim(), p.slice(i + 1).trim()] as [string, string];
  });
  const tRaw = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!tRaw || !sigs.length || !/^\d+$/.test(tRaw)) return null;
  const tNum = Number(tRaw);
  const tSec = tRaw.length >= 13 ? Math.floor(tNum / 1000) : tNum; // tolerate milliseconds
  if (Math.abs(nowSec - tSec) > toleranceSec) return null;
  const bare = secret.replace(/^whsec_/, "");
  const keys: [WavvSigScheme["key"], Buffer][] = [["raw", Buffer.from(secret)], ["no_prefix", Buffer.from(bare)]];
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(bare)) keys.push(["base64", Buffer.from(bare.replace(/-/g, "+").replace(/_/g, "/"), "base64")]);
  const msgs: [WavvSigScheme["msg"], string][] = [["t.body", `${tRaw}.${rawBody}`], ["body", rawBody], ["tbody", `${tRaw}${rawBody}`]];
  for (const [kName, key] of keys) {
    if (!key.length) continue;
    for (const [mName, msg] of msgs) {
      const mac = createHmac("sha256", key).update(msg).digest();
      for (const enc of ["hex", "base64"] as const) {
        const expected = Buffer.from(mac.toString(enc));
        for (const s of sigs) {
          const got = Buffer.from(s);
          if (got.length === expected.length && timingSafeEqual(got, expected)) return { key: kName, msg: mName, enc };
        }
      }
    }
  }
  return null;
}

export function verifyWavvSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  return matchWavvSignature(rawBody, header, secret, nowSec, toleranceSec) !== null;
}

/** The contact's 10-digit number: `phone` on outbound, `callerId` on inbound. */
export function contactNumber(c: WavvCall): string | null {
  const raw = c.direction === "inbound" ? c.callerId : c.phone;
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

export class Wavv {
  constructor(
    private key: string,
    private f: typeof fetch = fetch,
    private base = "https://api.wavv.com/v3"
  ) {}

  private async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await this.f(url.toString(), {
      headers: { Authorization: `Bearer ${this.key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`WAVV ${res.status} ${path}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  /** {transcript: null} means not ready yet (200), a 404 means unknown call. */
  transcript(id: string) {
    return this.get<{ transcript: string | null; summary: string | null }>(`/calls/${encodeURIComponent(id)}/transcript`);
  }

  /** Newest first; `direction` is required by the API. */
  listCalls(q: { direction: "inbound" | "outbound"; startedAfter?: string; startedBefore?: string; cursor?: string; limit?: number }) {
    return this.get<{ data?: WavvCall[]; calls?: WavvCall[]; nextCursor?: string | null }>("/calls", q);
  }
}

export function wavvFromEnv(): Wavv | null {
  return process.env.WAVV_API_KEY ? new Wavv(process.env.WAVV_API_KEY) : null;
}
