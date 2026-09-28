import { after, NextRequest, NextResponse } from "next/server";
import { getDb, type Db } from "@/lib/db";
import { assignWorkflow, type Workflow } from "@/lib/enrich/insights";
import {
  addressProblem,
  formatUSPhone,
  isFullName,
  normalizeUSPhone,
  type LeadSubmission,
} from "@/lib/lead";
import { BATHROOMS, BEDROOMS, CONDITIONS, OCCUPANCY, oneOf, PRIORITIES, TIMELINES } from "@/lib/leadOptions";
import { currentDossier, enrichLead, leadFacts } from "@/lib/leads/enrich";
import { fanOut, leadSubject, reportUrl } from "@/lib/leads/notify";
import { answersUpdate } from "@/lib/leads/reportEmail";
import { describeSource, parseSource } from "@/lib/leads/source";
import {
  claimNotification,
  releaseNotification,
  saveFullLead,
  setWorkflow,
  updateDetails,
  type DetailsPatch,
  type LeadRecord,
} from "@/lib/leads/store";

export const runtime = "nodejs";
// Enrichment runs after the response (after()) inside this budget.
export const maxDuration = 120;

/**
 * Lead intake (spec §4).
 *
 * The lead email goes out immediately; the lead record is saved (when the
 * database is configured) and property enrichment runs afterwards, updating
 * the same record. Nothing about enrichment can delay or fail a lead.
 *
 * Failure-proof delivery: fan out to every configured channel; a lead is
 * "delivered" if ANY channel succeeded. Only if EVERY channel fails does the
 * client get an error, so the UI shows the "call Sumeet directly" fallback.
 *
 * Consent artifact: timestamp, IP, page URL, checkbox state, and the exact
 * consent wording ride with every payload — provable per-lead.
 */

const MAX_LEN = 300;

function clean(v: unknown, max = MAX_LEN): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export async function POST(req: NextRequest) {
  let body: Partial<LeadSubmission>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  // Address-only partials carry no contact info — not a lead. Acknowledge
  // quietly (old cached pages may still send them) and deliver nothing.
  if (body.stage === "step1") {
    return NextResponse.json({ ok: true, delivered: 0 });
  }
  if (body.stage === "details") return handleDetails(body);

  // Honeypot filled = bot. Look successful so it doesn't retry; deliver nothing.
  if (clean(body.website)) {
    console.warn(`LEAD HONEYPOT tripped leadId=${clean(body.leadId, 64)}`);
    return NextResponse.json({ ok: true, delivered: 0 });
  }

  // Same validators as the form: nothing incomplete reaches the inbox.
  const address = clean(body.address);
  const addrProblem = addressProblem(address);
  if (addrProblem) {
    return NextResponse.json({ ok: false, error: `address_${addrProblem}` }, { status: 400 });
  }
  const name = clean(body.name, 120).replace(/\s+/g, " ");
  if (!isFullName(name)) {
    return NextResponse.json({ ok: false, error: "name_invalid" }, { status: 400 });
  }
  const phoneDigits = normalizeUSPhone(clean(body.phone, 30));
  if (!phoneDigits) {
    return NextResponse.json({ ok: false, error: "phone_invalid" }, { status: 400 });
  }
  const phone = formatUSPhone(phoneDigits);
  const leadIdIn = clean(body.leadId, 64).replace(/[^\w-]/g, "") || crypto.randomUUID();

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const pageUrl = clean(body.pageUrl, 1000);
  const source = parseSource(pageUrl, clean(body.referrer, 500) || null);
  const consent = {
    checked: body.consentChecked === true,
    text: clean(body.consentText, 500),
    timestamp: new Date().toISOString(),
    ip,
    userAgent: clean(req.headers.get("user-agent"), 300),
    pageUrl,
  };

  // Persist first (fast), so duplicates are caught before any email goes out.
  const db = await getDb();
  let leadId = leadIdIn;
  let persisted = false;
  if (db) {
    try {
      const createdAt = new Date().toISOString();
      const workflow = assignWorkflow(null, {
        name,
        timeline: null,
        priority: null,
        condition: null,
        occupancy: null,
        createdAt,
      });
      const saved = await saveFullLead(db, {
        id: leadIdIn,
        name,
        phone,
        address,
        placeId: clean(body.placeId, 200) || null,
        source,
        consent,
        workflow,
      });
      leadId = saved.lead.id;
      persisted = true;
      // Already delivered once (double-tap, retry, or same seller again within
      // 24h): no second alert. If the first delivery failed, deliver now.
      if (saved.outcome !== "created" && saved.lead.notified.initial) {
        return NextResponse.json({ ok: true, delivered: 0, duplicate: true, leadId });
      }
    } catch (err) {
      console.error(`LEAD PERSIST FAILURE leadId=${leadIdIn} ${String(err)}`);
    }
  }

  const payload = {
    source: "housesoldnj.com",
    stage: "full",
    leadId,
    receivedAt: new Date().toISOString(),
    address,
    placeId: clean(body.placeId, 200),
    name,
    phone,
    attribution: source,
    consent,
  };

  const subject = leadSubject(name, address);
  const text = [
    subject,
    `Address: ${address}`,
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Consent to call/text: ${consent.checked ? "YES" : "no"} @ ${consent.timestamp} (IP ${ip})`,
    `Source: ${describeSource(source)}`,
    `Page: ${pageUrl}`,
    `Lead ID: ${leadId}`,
    persisted && `Report (fills in within a minute): ${reportUrl(leadId)}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (db && persisted && !(await claimNotification(db, leadId, "initial").catch(() => true))) {
    // A concurrent identical request already claimed the alert.
    return NextResponse.json({ ok: true, delivered: 0, duplicate: true, leadId });
  }

  const results = await fanOut(subject, text, payload, `leadId=${leadId} stage=full`);

  // No channels configured at all: log the full lead so it's recoverable from
  // server logs, and still succeed for the user (dev / pre-launch state).
  if (results.length === 0) {
    console.warn(`LEAD (no delivery channels configured): ${JSON.stringify(payload)}`);
  } else if (!results.some((r) => r.ok)) {
    // Every configured channel failed — let a retry deliver it, and surface it
    // so the UI shows the direct-call fallback rather than a false "we got it".
    if (db && persisted) await releaseNotification(db, leadId, "initial").catch(() => {});
    console.error(`LEAD TOTAL DELIVERY FAILURE: ${JSON.stringify(payload)}`);
    return NextResponse.json({ ok: false, error: "delivery_failed", leadId }, { status: 502 });
  }

  if (db && persisted) {
    after(async () => {
      await enrichLead(leadId, { notify: true, reason: "new" });
    });
  }

  return NextResponse.json({ ok: true, delivered: results.filter((r) => r.ok).length, leadId });
}

/**
 * Optional answers from /thank-you. Updates the original record (same lead
 * ID); emails only what changed, threaded under the lead ("Re: …"); a changed
 * address or unit re-runs enrichment.
 */
async function handleDetails(body: Partial<LeadSubmission>) {
  const leadId = clean(body.leadId, 64).replace(/[^\w-]/g, "");
  if (!leadId) return NextResponse.json({ ok: false, error: "lead_required" }, { status: 400 });

  const patch: DetailsPatch = {};
  const timeline = oneOf(TIMELINES, body.timeline);
  const priority = oneOf(PRIORITIES, body.priority);
  const condition = oneOf(CONDITIONS, body.condition);
  const occupancy = oneOf(OCCUPANCY, body.occupancy);
  if (timeline) patch.timeline = timeline;
  if (priority) patch.priority = priority;
  if (condition) patch.condition = condition;
  if (occupancy) patch.occupancy = occupancy;
  const beds = oneOf(BEDROOMS, body.beds);
  const baths = oneOf(BATHROOMS, body.baths);
  if (beds) patch.beds = beds;
  if (baths) patch.baths = baths;
  const email = clean(body.email, 200);
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) patch.email = email;
  const notes = clean(body.notes, 1000);
  if (notes) patch.notes = notes;
  if (typeof body.unit === "string") patch.unit = clean(body.unit, 12).replace(/^(unit|apt|#)\s*/i, "");
  const editedAddress = clean(body.addressEdit);
  if (editedAddress) {
    const problem = addressProblem(editedAddress);
    if (problem) return NextResponse.json({ ok: false, error: `address_${problem}` }, { status: 400 });
    patch.address = editedAddress;
  }
  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: "nothing_to_add" }, { status: 400 });
  }

  const db = await getDb();
  const name = clean(body.name, 120);
  const originalAddress = clean(body.address);
  let changed: string[] = Object.keys(patch);
  let addressChanged = false;
  let subjectName = name;
  let subjectAddress = originalAddress;
  let update: string[] = [];
  if (db) {
    try {
      const r = await updateDetails(db, leadId, patch);
      if (r) {
        changed = r.changed;
        addressChanged = r.addressChanged;
        subjectName = r.lead.name;
        subjectAddress = r.lead.addressOriginal;
        if (!changed.length) return NextResponse.json({ ok: true, changed: [] });
        // Answers like timeline/priority change the follow-up track.
        const workflow = await setEnrichmentWorkflow(db, r.lead);
        if (!addressChanged) update = answersUpdate(r.lead, currentDossier(r.lead), workflow, changed);
      }
    } catch (err) {
      console.error(`LEAD DETAILS PERSIST FAILURE leadId=${leadId} ${String(err)}`);
    }
  }

  const label: Record<string, string> = {
    timeline: "Timeline",
    priority: "Priority",
    condition: "Condition",
    occupancy: "Occupancy",
    beds: "Bedrooms (seller)",
    baths: "Bathrooms (seller)",
    email: "Email",
    notes: "Notes",
    unit: "Unit",
    address: "Corrected address",
  };
  const text = [
    `More from ${subjectName || "this seller"} (added on the thank-you page):`,
    ...changed.map((k) => `${label[k] ?? k}: ${patch[k as keyof DetailsPatch] || "(cleared)"}`),
    ...update,
    addressChanged && "Address/unit changed — the property report is being refreshed.",
    `Lead ID: ${leadId}`,
    db && `Report: ${reportUrl(leadId)}`,
  ]
    .filter(Boolean)
    .join("\n");
  const results = await fanOut(
    `Re: ${leadSubject(subjectName, subjectAddress)}`,
    text,
    { source: "housesoldnj.com", stage: "details", leadId, ...patch },
    `leadId=${leadId} stage=details`
  );

  if (db && addressChanged) {
    after(async () => {
      await enrichLead(leadId, { notify: true, reason: "address_changed" });
    });
  }
  return NextResponse.json({ ok: results.length === 0 || results.some((r) => r.ok), changed });
}

async function setEnrichmentWorkflow(db: Db, lead: LeadRecord): Promise<Workflow> {
  const workflow = assignWorkflow(currentDossier(lead), leadFacts(lead));
  await setWorkflow(db, lead.id, workflow).catch(() => {});
  return workflow;
}
