/**
 * The middleware loop. WAVV event -> call log -> compliance audit ->
 * disposition plan -> GHL -> alerts; then, once recorded, transcript ->
 * Claude review -> GHL. Every step is idempotent and claimable, so webhook
 * retries, piggyback retries and the daily cron can all call it safely.
 *
 * The middleware is the ONLY writer of dial state (counters, cadence, phone
 * rotation, lanes, DNC, stage moves). GHL workflows just notify.
 */
import type { Db } from "@/lib/db";
import { enrichLead } from "@/lib/leads/enrich";
import { fanOut, reportUrl } from "@/lib/leads/notify";
import { saveFullLead } from "@/lib/leads/store";
import { assignWorkflow } from "@/lib/enrich/insights";
import { extractIntel, planIntel } from "./callIntel";
import { auditCall, type Flag } from "./compliance";
import { dispositionKey, planDisposition, type ContactState, type OppState, type Plan } from "./dispositions";
import { ghlFromEnv, type Ghl, type GhlContact } from "./ghl";
import { PIPELINES, TAGS, type DispositionKey, type PipelineKey } from "./schema";
import {
  addSuppression,
  claimEnded,
  claimIntel,
  finishEnded,
  firstDelivery,
  getCall,
  markRecorded,
  pendingWork,
  setIntel,
  setTranscript,
  upsertCall,
  type CallRow,
} from "./store";
import { cf, ensureOpportunity, OPP_ID_FIELD, readFields, resolve, type Resolved } from "./sync";
import { wavvFromEnv, type WavvCall, type WavvEvent } from "./wavv";

const digits = (v: unknown) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
};

export function contactUrl(contactId: string): string {
  return `https://app.gohighlevel.com/v2/location/${process.env.GHL_LOCATION_ID}/contacts/detail/${contactId}`;
}

async function alert(subject: string, lines: (string | false | null | undefined)[], tag: string): Promise<void> {
  const text = lines.filter(Boolean).join("\n");
  await fanOut(subject, text, { stage: "acq_alert", subject, text }, tag).catch((e) => console.error(`ACQ ALERT FAILURE ${String(e)}`));
}

// ------------------------------------------------------------ webhooks --
/** Fast path, before the webhook responds (WAVV allows 10 s): dedupe + log. */
export async function ingestWavvEvent(db: Db, evt: WavvEvent): Promise<"duplicate" | "ingested" | "invalid"> {
  const c = evt.data;
  if (!c?.id || !evt.event) return "invalid";
  // Store first (idempotent), THEN mark delivered: a failure in between makes
  // WAVV retry instead of silently losing the event.
  await upsertCall(db, c, evt.event === "call.ended");
  if (evt.event === "call.recorded") await markRecorded(db, c.id);
  if (!(await firstDelivery(db, evt.event, c.id))) return "duplicate";
  return "ingested";
}

/** Slow path, after the response: CRM updates, transcript, AI review. */
export async function processWavvEvent(db: Db, evt: WavvEvent): Promise<void> {
  if (evt.event === "call.ended") await processEnded(db, evt.data.id);
  if (evt.event === "call.recorded") await processTranscript(db, evt.data.id);
  // Calls arrive every few seconds during a dial session: use them to drain
  // anything an earlier timeout left behind (no frequent cron needed).
  await drain(db, 3);
}

export async function drain(db: Db, limit: number): Promise<Record<string, number>> {
  const work = await pendingWork(db, limit);
  for (const id of work.ended) await processEnded(db, id);
  for (const id of work.transcripts) await processTranscript(db, id);
  for (const id of work.intel) await processIntel(db, id);
  return { ended: work.ended.length, transcripts: work.transcripts.length, intel: work.intel.length };
}

// -------------------------------------------------------- GHL context --
type Ctx = {
  ghl: Ghl;
  r: Resolved;
  contact: GhlContact;
  fields: Record<string, unknown>;
  pipeline: PipelineKey;
  oppId: string | null;
  opp: OppState;
};

async function loadContext(ghl: Ghl, contactId: string): Promise<Ctx> {
  const r = await resolve(ghl);
  const contact = (await ghl.getContact(contactId)).contact;
  const fields = readFields(r, contact.customFields);
  const pipeline: PipelineKey = fields["Asset Class"] === "land" ? "land" : "residential";
  const oppId = (fields[OPP_ID_FIELD[pipeline]] as string) || null;
  let opp: OppState = null;
  if (oppId) {
    const o = (await ghl.getOpportunity(oppId).catch(() => null))?.opportunity;
    if (o) {
      opp = {
        id: o.id,
        pipeline,
        stage: r.pipelines[pipeline]?.stageNames.get(o.pipelineStageId) ?? "",
        status: o.status,
        fields: readFields(r, o.customFields),
      };
    }
  }
  return { ghl, r, contact, fields, pipeline, oppId, opp };
}

function contactState(ctx: Ctx): ContactState {
  const f = ctx.fields;
  const phones = [digits(ctx.contact.phone), digits(f["Phone 2"]), digits(f["Phone 3"])].filter(Boolean);
  return {
    lane: String(f["Dial Lane"] ?? ""),
    attempts: Number(f["Call Attempts"] ?? 0) || 0,
    conversations: Number(f["Conversations"] ?? 0) || 0,
    phones: [...new Set(phones)],
    invalidPhones: String(f["Invalid Phones"] ?? "").split("\n").filter(Boolean),
    propertyCount: Number(f["Property Count"] ?? 1) || 1,
    primaryPropertyId: (ctx.opp?.fields["Primary Property ID"] as string) ?? null,
  };
}

function dims(ctx: Ctx, call: CallRow): Record<string, string> {
  const f = ctx.fields;
  return {
    county: String(f["Primary County"] ?? ""),
    cohort: String(f["Primary Cohort"] ?? ""),
    asset: String(f["Asset Class"] ?? ""),
    source: String(f["Lead Source"] ?? ""),
    wave: String(f["Wave"] ?? ""),
    lane: String(f["Dial Lane"] ?? ""),
    caller: call.userId ?? "",
  };
}

const ownerUser = () => process.env.GHL_OWNER_USER_ID || undefined;
const looksLikeUserId = (v: string | null) => Boolean(v && /^[A-Za-z0-9]{12,}$/.test(v));

const DND_ALL = {
  dnd: true,
  dndSettings: Object.fromEntries(
    ["Call", "SMS", "Email", "WhatsApp", "GMB", "FB"].map((ch) => [ch, { status: "active", message: "Asked not to be contacted" }])
  ),
};

/** Writes a disposition plan to GHL + the suppression list. */
async function applyPlan(db: Db, ctx: Ctx, plan: Plan, call: CallRow): Promise<string | null> {
  const { ghl, r } = ctx;
  const contactId = ctx.contact.id;
  await ghl.updateContact(contactId, {
    ...(plan.primaryPhone ? { phone: `+1${plan.primaryPhone}` } : {}),
    ...(plan.dndAll ? DND_ALL : {}),
    customFields: cf(r.contact, plan.contactFields),
  });
  await ghl.addTags(contactId, plan.tagsAdd);
  if (plan.tagsRemove.length) await ghl.removeTags(contactId, plan.tagsRemove).catch(() => {});
  for (const s of plan.suppress) {
    await addSuppression(db, { ...s, value: s.kind === "contact" ? contactId : s.value, source: `disposition:${plan.key}`, callId: call.id, contactId });
  }
  let oppId = ctx.oppId;
  const pipe = r.pipelines[ctx.pipeline];
  // A live seller with no card yet (manual dial / legacy contact): open one.
  if (!oppId && pipe && (["CALLBACK", "WARM", "HOT", "BOOKED"] as DispositionKey[]).includes(plan.key)) {
    const role = plan.key === "CALLBACK" ? "followUp" : plan.key === "WARM" ? "warm" : plan.key === "HOT" ? "hot" : "booked";
    const name = [ctx.contact.firstName, ctx.contact.lastName].filter(Boolean).join(" ") || "Seller";
    const res = await ensureOpportunity(ghl, r, ctx.pipeline, contactId, undefined, {
      name: `${name} — ${String(ctx.fields["Primary Property"] ?? "")}`,
      propertyId: null,
      address: String(ctx.fields["Primary Property"] ?? ""),
      stage: PIPELINES[ctx.pipeline].roles[role],
      assignedTo: ownerUser(),
    });
    oppId = res.id;
    await ghl.updateContact(contactId, { customFields: cf(r.contact, { [OPP_ID_FIELD[ctx.pipeline]]: oppId }) });
  }
  if (oppId && plan.opp) {
    const body: Record<string, unknown> = {};
    if (plan.opp.stageRole && pipe) body.pipelineStageId = pipe.stages.get(PIPELINES[ctx.pipeline].roles[plan.opp.stageRole]);
    if (plan.opp.status) body.status = plan.opp.status;
    if (plan.opp.assignToOwner && ownerUser()) body.assignedTo = ownerUser();
    const fields = cf(r.opportunity, plan.opp.fields);
    if (fields.length) body.customFields = fields;
    if (Object.keys(body).length) await ghl.updateOpportunity(oppId, body);
  }
  for (const t of plan.tasks) {
    const assignedTo = t.assignTo === "owner" ? ownerUser() : looksLikeUserId(call.userId) ? call.userId! : undefined;
    await ghl.addTask(contactId, { title: t.title, body: t.body, dueDate: t.due.toISOString(), ...(assignedTo ? { assignedTo } : {}) });
  }
  for (const n of plan.notes) await ghl.addNote(contactId, n);
  return oppId;
}

// ----------------------------------------------------------- call.ended --
export async function processEnded(db: Db, id: string): Promise<string> {
  if (!(await claimEnded(db, id))) return "not_claimed";
  const call = (await getCall(db, id))!;
  const ghl = ghlFromEnv();
  if (!ghl) {
    await finishEnded(db, id, { status: "skipped", error: "GHL not configured" });
    return "skipped";
  }
  if (!call.contactId) {
    await finishEnded(db, id, { status: "skipped", error: "manual dial — no CRM contact id" });
    return "skipped";
  }
  try {
    const ctx = await loadContext(ghl, call.contactId);
    const key = dispositionKey(call.disposition, call.outcome);
    const at = new Date(call.endedAt ?? call.startedAt ?? Date.now());
    const cs = contactState(ctx);
    const dialed = digits(call.phone) || null;
    const flags: Flag[] = auditCall({
      at: new Date(call.startedAt ?? at),
      direction: call.direction,
      dialed,
      human: call.human,
      seconds: call.seconds ?? 0,
      lane: cs.lane,
      tags: ctx.contact.tags ?? [],
      zones: String(ctx.fields["Call Zones"] ?? "").split(",").filter(Boolean),
      scrubDate: (ctx.fields["DNC Scrub Date"] as string) || null,
      phones: cs.phones,
      inboundConsent: ctx.fields["SMS Consent"] === "Web form consent",
    });
    const plan = planDisposition(key, { at, human: call.human, seconds: call.seconds ?? 0, dialed, userId: call.userId }, cs, ctx.opp);
    const oppId = await applyPlan(db, ctx, plan, call);
    const d = dims(ctx, call);
    await finishEnded(db, id, { status: "done", dispositionKey: key, conversation: plan.conversation, plan, flags, dims: d });

    const name = [ctx.contact.firstName, ctx.contact.lastName].filter(Boolean).join(" ") || "Contact";
    const violations = flags.filter((f) => f.severity === "violation");
    if (violations.length) {
      await ghl.addTags(ctx.contact.id, [TAGS.violation]);
      await alert(`⚠️ COMPLIANCE: ${name} — ${violations.map((v) => v.code).join(", ")}`, [
        ...violations.map((v) => `• ${v.code}: ${v.detail}`),
        `Caller: ${call.userId ?? "?"} · call ${id}`,
        contactUrl(ctx.contact.id),
      ], `call=${id} compliance`);
    }
    if (plan.notify) {
      const emoji = plan.notify.level === "booked" ? "📅" : plan.notify.level === "hot" ? "🔥" : "🌤";
      await alert(`${emoji} ${plan.notify.text.toUpperCase()}: ${name} — ${ctx.fields["Primary Property"] ?? ""}`, [
        `Signals: ${ctx.fields["Signals"] ?? "—"}`,
        ctx.opp && `Motivation: ${ctx.opp.fields["Motivation"] ?? "—"}`,
        ctx.opp && `Condition: ${ctx.opp.fields["Property Condition"] ?? "—"} · Timeline: ${ctx.opp.fields["Seller Timeline"] ?? "—"} · Asking: ${ctx.opp.fields["Asking Price"] ?? "—"}`,
        call.note && `Caller note: ${call.note}`,
        `Caller: ${call.userId ?? "?"} · ${call.seconds ?? 0}s`,
        contactUrl(ctx.contact.id),
      ], `call=${id} notify`);
    }
    if (plan.hotReport) await hotLeadReport(db, ctx, oppId, id).catch((e) => console.error(`HOT REPORT FAILURE call=${id} ${String(e)}`));
    return "done";
  } catch (err) {
    console.error(`ACQ ENDED FAILURE call=${id} ${String(err)}`);
    await finishEnded(db, id, { status: "failed", error: String(err).slice(0, 500) });
    return "failed";
  }
}

/**
 * A hot / booked outbound seller gets the same internal property report as a
 * web lead (comps, MLS history, flood, photo check, buy/assign/list
 * worksheet). The site lead record is marked as having NO text consent.
 */
async function hotLeadReport(db: Db, ctx: Ctx, oppId: string | null, callId: string): Promise<void> {
  const address = String(ctx.fields["Primary Property"] ?? "").trim();
  const phone = digits(ctx.contact.phone);
  if (!address || !phone) return;
  const id = `out-${ctx.contact.id}`;
  const name = [ctx.contact.firstName, ctx.contact.lastName].filter(Boolean).join(" ") || String(ctx.fields["Acq Owner ID"] ?? "Owner");
  const createdAt = new Date().toISOString();
  const saved = await saveFullLead(db, {
    id,
    name,
    phone: `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`,
    address: address.includes("NJ") ? address : `${address}, NJ`,
    placeId: null,
    source: { channel: "outbound", landingPath: null, referrer: null, utm: { campaign: String(ctx.fields["Source List"] ?? "") }, clickIds: {}, googleAds: null },
    consent: { checked: false, channel: "outbound_call", note: "Outbound cold call — no call/text consent artifact. Never text.", callId, ghlContactId: ctx.contact.id },
    workflow: assignWorkflow(null, { name, timeline: null, priority: null, condition: null, occupancy: null, createdAt, canText: false }),
  });
  if (oppId) {
    await ctx.ghl.updateOpportunity(oppId, { customFields: cf(ctx.r.opportunity, { "Report URL": reportUrl(saved.lead.id) }) }).catch(() => {});
  }
  if (saved.outcome === "created") await enrichLead(saved.lead.id, { notify: true, reason: "new" });
}

// ------------------------------------------------- transcript + intel --
export async function processTranscript(db: Db, id: string): Promise<string> {
  const call = await getCall(db, id);
  if (!call || call.transcriptStatus !== "pending") return "not_pending";
  const wavv = wavvFromEnv();
  if (!wavv) {
    await setTranscript(db, id, { status: "none" });
    return "no_wavv_key";
  }
  try {
    const t = await wavv.transcript(id);
    if (!t.transcript) {
      // not ready yet; give up after ~15 tries (piggyback + daily cron)
      await setTranscript(db, id, { status: call.transcriptAttempts >= 14 ? "none" : "pending", summary: t.summary });
      return "not_ready";
    }
    await setTranscript(db, id, { status: "ready", transcript: t.transcript, summary: t.summary });
    return processIntel(db, id);
  } catch (err) {
    await setTranscript(db, id, { status: call.transcriptAttempts >= 14 ? "failed" : "pending" });
    return `error: ${String(err).slice(0, 100)}`;
  }
}

export async function processIntel(db: Db, id: string): Promise<string> {
  if (!(await claimIntel(db, id))) return "not_claimed";
  const call = (await getCall(db, id))!;
  if ((call.seconds ?? 0) < 15 || !call.transcript) {
    await setIntel(db, id, { status: "skipped", error: "under 15 s or empty transcript" });
    return "skipped";
  }
  const ghl = ghlFromEnv();
  let ctx: Ctx | null = null;
  if (ghl && call.contactId) ctx = await loadContext(ghl, call.contactId).catch(() => null);
  const key = (call.dispositionKey as DispositionKey) || dispositionKey(call.disposition, call.outcome);
  const res = await extractIntel({
    transcript: call.transcript,
    wavvSummary: call.wavvSummary,
    disposition: call.disposition ?? key,
    callerNote: call.note,
    seconds: call.seconds ?? 0,
    ownerName: ctx ? [ctx.contact.firstName, ctx.contact.lastName].filter(Boolean).join(" ") : null,
    property: ctx ? String(ctx.fields["Primary Property"] ?? "") : null,
    signals: ctx ? String(ctx.fields["Signals"] ?? "") : null,
  });
  if (!res.ok) {
    await setIntel(db, id, { status: "failed", error: res.error });
    return "failed";
  }
  const ip = planIntel(res.intel, key, id);
  await setIntel(db, id, { status: "done", intel: { ...res.intel, model: res.model, plan: { alerts: ip.alerts, qaFlags: ip.qaFlags } } });
  if (!ctx) return "done_no_crm";
  const { r } = ctx;
  if (ctx.oppId) await ghl!.updateOpportunity(ctx.oppId, { customFields: cf(r.opportunity, ip.oppFields) }).catch(() => {});
  await ghl!.addNote(ctx.contact.id, ip.note);
  await ghl!.addTags(ctx.contact.id, ip.tagsAdd);
  if (ip.forceDnc) {
    // Same effects as a DNC disposition, minus the attempt counters.
    const dnc = planDisposition("DNC", { at: new Date(), human: true, seconds: call.seconds ?? 0, dialed: digits(call.phone), userId: call.userId }, contactState(ctx), ctx.opp);
    for (const k of ["Call Attempts", "Last Call Date", "Last Disposition", "Conversations", "Last Successful Contact"]) delete dnc.contactFields[k];
    dnc.tasks = [];
    await applyPlan(db, ctx, { ...dnc, key: "DNC" }, call);
  }
  if (ip.suppressListedProperty) {
    const pid = (ctx.opp?.fields["Primary Property ID"] as string) || String(ctx.fields["Primary Property"] ?? "");
    await addSuppression(db, { kind: "property", value: pid, reason: "owner said listed with another broker (AI review)", source: "ai_review", callId: id, contactId: ctx.contact.id });
    await ghl!.addTags(ctx.contact.id, [TAGS.listedRecheck]);
  }
  if (ip.alerts.length) {
    const name = [ctx.contact.firstName, ctx.contact.lastName].filter(Boolean).join(" ") || "Contact";
    await alert(`🤖 CALL REVIEW: ${name} — ${ip.alerts.map((a) => a.split(":")[0]).join(", ")}`, [
      ...ip.alerts.map((a) => `• ${a}`),
      `Summary: ${res.intel.summary}`,
      `Caller: ${call.userId ?? "?"} · call ${id}`,
      contactUrl(ctx.contact.id),
    ], `call=${id} intel`);
  }
  return "done";
}

// ------------------------------------------------------- reconciliation --
/** Daily: pull the last ~26 h of calls from WAVV and process anything a lost webhook missed. */
export async function reconcile(db: Db, hours = 26): Promise<{ seen: number; added: number }> {
  const wavv = wavvFromEnv();
  if (!wavv) return { seen: 0, added: 0 };
  const startedAfter = new Date(Date.now() - hours * 3_600_000).toISOString();
  let seen = 0;
  let added = 0;
  for (const direction of ["outbound", "inbound"] as const) {
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await wavv.listCalls({ direction, startedAfter, cursor, limit: 200 });
      const calls: WavvCall[] = res.data ?? res.calls ?? [];
      for (const c of calls) {
        seen++;
        if (!c.endedAt) continue;
        const existing = await getCall(db, c.id);
        if (existing && existing.endedStatus !== "waiting") continue;
        await upsertCall(db, c, true);
        if (c.recorded) await markRecorded(db, c.id);
        await processEnded(db, c.id);
        added++;
      }
      cursor = res.nextCursor ?? undefined;
      if (!cursor || !calls.length) break;
    }
  }
  return { seen, added };
}
