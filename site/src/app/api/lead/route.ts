import { NextRequest, NextResponse } from "next/server";
import type { LeadSubmission } from "@/lib/lead";

export const runtime = "nodejs";

/**
 * Lead intake (spec §4).
 *
 * Failure-proof delivery: fan out to every configured channel in parallel —
 * CRM webhook, Resend email, Slack. A lead is "delivered" if ANY channel
 * succeeded; per-channel failures are logged loudly (Vercel log drains /
 * alerts pick these up). Only if EVERY channel fails does the client get an
 * error, so the UI can show the "call Sum directly" fallback instead of a
 * false success. A silent webhook failure at $200/lead is a fire.
 *
 * Consent artifact: timestamp, IP, page URL, checkbox state, and the exact
 * consent wording ride with every payload — provable per-lead.
 */

const MAX_LEN = 300;

function clean(v: unknown, max = MAX_LEN): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

type Delivery = { channel: string; ok: boolean; detail?: string };

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

async function sendEmail(
  subject: string,
  text: string,
  scheduledAt?: string
): Promise<(Delivery & { emailId?: string }) | null> {
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
        ...(scheduledAt ? { scheduled_at: scheduledAt } : {}),
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // Surface the provider's error body — "HTTP 400" alone is undebuggable.
      const detail = `HTTP ${res.status} ${(await res.text()).slice(0, 300)}`;
      // A failed *scheduled* send falls back to an immediate one so a lead
      // can never be lost to the scheduling feature.
      if (scheduledAt) return sendEmail(subject, text);
      return { channel: "email", ok: false, detail };
    }
    const bodyJson = (await res.json().catch(() => ({}))) as { id?: string };
    return { channel: "email", ok: true, detail: `HTTP ${res.status}`, emailId: bodyJson.id };
  } catch (err) {
    return { channel: "email", ok: false, detail: String(err) };
  }
}

/** Best-effort cancel of a scheduled Resend email (partial-lead dedupe). */
async function cancelScheduledEmail(emailId: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !/^[A-Za-z0-9-]{8,64}$/.test(emailId)) return;
  try {
    await fetch(`https://api.resend.com/emails/${emailId}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Cancel failing just means the seller's partial email also arrives —
    // harmless duplicate, never worth failing the request over.
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

export async function POST(req: NextRequest) {
  let body: Partial<LeadSubmission>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const stage = body.stage === "step1" ? "step1" : "full";
  const address = clean(body.address);
  if (address.length < 4) {
    return NextResponse.json({ ok: false, error: "address_required" }, { status: 400 });
  }

  const phone = clean(body.phone, 30);
  if (stage === "full") {
    if (clean(body.name, 120).length < 2) {
      return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });
    }
    if (phone.replace(/\D/g, "").length < 10) {
      return NextResponse.json({ ok: false, error: "phone_required" }, { status: 400 });
    }
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  const payload = {
    source: "housesoldnj.com",
    stage, // "step1" = address-only partial (still a lead — pipeline feed)
    leadId: clean(body.leadId, 64) || "unknown",
    receivedAt: new Date().toISOString(),
    address,
    placeId: clean(body.placeId, 200),
    name: clean(body.name, 120),
    phone,
    email: clean(body.email, 200),
    timeline: clean(body.timeline, 40),
    priority: clean(body.priority, 60),
    consent: {
      checked: body.consentChecked === true,
      text: clean(body.consentText, 500),
      timestamp: new Date().toISOString(),
      ip,
      userAgent: clean(req.headers.get("user-agent"), 300),
      pageUrl: clean(body.pageUrl, 1000),
    },
  };

  const subject =
    stage === "full"
      ? `🔥 LEAD: ${payload.name} — ${address}`
      : `Partial lead (address only): ${address}`;
  const text = [
    subject,
    `Stage: ${stage}`,
    `Address: ${address}`,
    payload.name && `Name: ${payload.name}`,
    payload.phone && `Phone: ${payload.phone}`,
    payload.email && `Email: ${payload.email}`,
    payload.timeline && `Timeline: ${payload.timeline}`,
    payload.priority && `Priority: ${payload.priority}`,
    `Consent to call/text: ${payload.consent.checked ? "YES" : "no"} @ ${payload.consent.timestamp} (IP ${ip})`,
    `Page: ${payload.consent.pageUrl}`,
    `Lead ID: ${payload.leadId}`,
  ]
    .filter(Boolean)
    .join("\n");

  // Partial-lead emails are scheduled 10 minutes out; completing step 2
  // cancels them, so a finished lead produces ONE email. Abandoners still
  // get captured — their partial simply arrives after the grace window.
  // Webhook + Slack stay immediate for both stages (pipeline feed).
  const emailScheduledAt =
    stage === "step1"
      ? new Date(Date.now() + 10 * 60 * 1000).toISOString()
      : undefined;
  if (stage === "full" && typeof body.cancelEmailId === "string") {
    await cancelScheduledEmail(body.cancelEmailId);
  }

  const results = (
    await Promise.all([
      sendWebhook(payload),
      sendEmail(subject, text, emailScheduledAt),
      sendSlack(text),
    ])
  ).filter((r): r is Delivery & { emailId?: string } => r !== null);

  const failures = results.filter((r) => !r.ok);
  for (const f of failures) {
    console.error(
      `LEAD DELIVERY FAILURE channel=${f.channel} detail=${f.detail} leadId=${payload.leadId} stage=${stage}`
    );
  }

  // No channels configured at all: log the full lead so it's recoverable from
  // server logs, and still succeed for the user (dev / pre-launch state).
  if (results.length === 0) {
    console.warn(`LEAD (no delivery channels configured): ${JSON.stringify(payload)}`);
    return NextResponse.json({ ok: true, delivered: 0 });
  }

  const delivered = results.length - failures.length;
  if (delivered === 0) {
    // Every configured channel failed — surface it so the UI can show the
    // direct-call fallback rather than a false "we got it".
    console.error(`LEAD TOTAL DELIVERY FAILURE: ${JSON.stringify(payload)}`);
    return NextResponse.json({ ok: false, error: "delivery_failed" }, { status: 502 });
  }

  const scheduledEmailId = results.find((r) => r.channel === "email")?.emailId;
  return NextResponse.json({
    ok: true,
    delivered,
    ...(stage === "step1" && scheduledEmailId ? { scheduledEmailId } : {}),
  });
}
