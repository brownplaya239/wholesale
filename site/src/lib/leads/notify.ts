/**
 * Lead notifications: fan out to every configured channel in parallel — CRM
 * webhook, Resend email, Slack. Delivered if ANY channel succeeds; failures
 * are logged loudly.
 */
import { site } from "@/config/site";

export type Delivery = { channel: string; ok: boolean; detail?: string };

export function reportUrl(id: string): string {
  return `${site.url}/admin/leads/${encodeURIComponent(id)}`;
}

async function sendWebhook(payload: object): Promise<Delivery | null> {
  const url = process.env.CRM_WEBHOOK_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return { channel: "crm_webhook", ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { channel: "crm_webhook", ok: false, detail: String(err) };
  }
}

async function sendEmail(subject: string, text: string, html?: string): Promise<Delivery | null> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.LEAD_ALERT_TO;
  if (!key || !to) return null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.LEAD_ALERT_FROM || "leads@housesoldnj.com",
        to: to.split(",").map((s) => s.trim()),
        subject,
        text,
        ...(html ? { html } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // Surface the provider's error body — "HTTP 400" alone is undebuggable.
      const detail = `HTTP ${res.status} ${(await res.text()).slice(0, 300)}`;
      return { channel: "email", ok: false, detail };
    }
    return { channel: "email", ok: true, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { channel: "email", ok: false, detail: String(err) };
  }
}

async function sendSlack(text: string): Promise<Delivery | null> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(8000),
    });
    return { channel: "slack", ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { channel: "slack", ok: false, detail: String(err) };
  }
}

/** Sends everywhere configured; `results` is empty when nothing is configured. */
export async function fanOut(subject: string, text: string, payload: object, tag: string, html?: string): Promise<Delivery[]> {
  const results = (await Promise.all([sendWebhook(payload), sendEmail(subject, text, html), sendSlack(text)])).filter(
    (r): r is Delivery => r !== null
  );
  for (const f of results.filter((r) => !r.ok)) {
    console.error(`LEAD DELIVERY FAILURE channel=${f.channel} detail=${f.detail} ${tag}`);
  }
  return results;
}

export function leadSubject(name: string, address: string): string {
  return `🔥 LEAD: ${name} — ${address}`;
}

