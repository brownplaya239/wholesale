/**
 * Lead notifications: fan out to every configured channel in parallel — CRM
 * webhook, Resend email, Slack. Delivered if ANY channel succeeds; failures
 * are logged loudly.
 */
import { site } from "@/config/site";
import type { Dossier } from "@/lib/enrich/types";
import type { LeadRecord } from "./store";

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

async function sendEmail(subject: string, text: string): Promise<Delivery | null> {
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
export async function fanOut(subject: string, text: string, payload: object, tag: string): Promise<Delivery[]> {
  const results = (await Promise.all([sendWebhook(payload), sendEmail(subject, text), sendSlack(text)])).filter(
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

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

/** The enriched follow-up — threads under the original lead email ("Re:"). */
export function enrichedEmail(lead: LeadRecord, d: Dossier, reason: string): { subject: string; text: string } {
  const g = d.geocode.data;
  const p = d.parcel.data;
  const v = d.comps.data?.valuation;
  const lines: (string | number | false | null | undefined)[] = [
    reason === "address_changed" ? "Updated property report (seller edited the address/unit)." : "Property report ready.",
    "",
    `Address: ${g ? `${g.standardized} (${g.match} match)` : `NOT VERIFIED — ${lead.addressCurrent}`}`,
    lead.addressUnit && `Unit: ${lead.addressUnit} (${d.unit.status})`,
    p && `Parcel: ${p.municipality}, ${p.county} County — Block ${p.block} Lot ${p.lot}${p.qualifier ? ` Qual ${p.qualifier}` : ""}`,
    p && `Type: ${p.propClassLabel}${p.dwellings && p.dwellings > 1 ? ` · ${p.dwellings} dwellings` : ""}${p.yearBuilt ? ` · built ${p.yearBuilt}` : ""}${p.acres ? ` · ${p.acres.toFixed(2)} ac` : ""}`,
    d.characteristics.livingSpace.value && `Living area: ${d.characteristics.livingSpace.value.toLocaleString()} sq ft (${d.characteristics.livingSpace.source?.name ?? ""})`,
    p?.lastYearTaxes && `Taxes (last year): ${money(p.lastYearTaxes)} · Assessed ${money(p.assessed.net)}`,
    p?.owner.mailing && `Owner mailing: ${p.owner.mailing}${p.owner.absentee ? " (absentee)" : ""}`,
    d.history.data?.[0] && `Last deed: ${d.history.data[0].date} ${money(d.history.data[0].price)}${d.history.data[0].nuLabel ? ` — ${d.history.data[0].nuLabel}` : ""}`,
    d.flood.data && `Flood: zone ${d.flood.data.zone}${d.flood.data.sfha ? " (Special Flood Hazard Area)" : ""}`,
    v
      ? `Comps: ${d.comps.data!.comps.length} sales → preliminary ${money(v.low)}–${money(v.high)} (${v.confidence} confidence)`
      : `Comps: ${d.comps.note ?? "none found"}`,
    "",
    d.insights.risks.length ? "Watch:" : null,
    ...d.insights.risks.slice(0, 5).map((r) => `• ${r}`),
    "",
    `Workflow: ${lead.workflow?.label ?? "—"} — ${lead.workflow?.firstTouch ?? ""}`,
    "",
    `Full report: ${reportUrl(lead.id)}`,
    "Internal only — estimates need your review; nothing is sent to the seller automatically.",
  ];
  return {
    subject: `Re: ${leadSubject(lead.name, lead.addressOriginal)}`,
    text: lines.filter((l): l is string => typeof l === "string").join("\n"),
  };
}
