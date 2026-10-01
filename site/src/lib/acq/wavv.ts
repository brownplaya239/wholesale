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

export function verifyWavvSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !sigs.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  // The docs key the HMAC with "the webhook's signing secret" (whsec_…);
  // accept either the full string or the part after the prefix.
  const keys = [secret, secret.replace(/^whsec_/, "")];
  for (const key of new Set(keys)) {
    const expected = createHmac("sha256", key).update(`${t}.${rawBody}`).digest("hex");
    for (const s of sigs) {
      if (s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return true;
    }
  }
  return false;
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
