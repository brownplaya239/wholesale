/**
 * Acquisition machine tests (offline): disposition engine, compliance audit,
 * WAVV signatures, AI-review planner, GHL client + sync against a mock
 * HighLevel, metrics — and one end-to-end webhook run through PGlite.
 *   npm run test:unit
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { dispositionKey, MAX_ATTEMPTS, missingQualification, planDisposition, type ContactState, type OppState } from "../src/lib/acq/dispositions.ts";
import { auditCall, callWindowFlags, isFederalHoliday, trainedCallers } from "../src/lib/acq/compliance.ts";
import { verifyWavvSignature } from "../src/lib/acq/wavv.ts";
import { formatIntel, planIntel, type CallIntel } from "../src/lib/acq/callIntel.ts";
import { Ghl } from "../src/lib/acq/ghl.ts";
import { cf, matchFields, matchStages, pushOwner, resetResolveCache, resolve, toFieldValue, type IdMap, type WaveRecord } from "../src/lib/acq/sync.ts";
import {
  CONTACT_FIELDS,
  DISPOSITIONS,
  fieldKey,
  OPPORTUNITY_FIELDS,
  PIPELINES,
  QUALIFICATION_FIELDS,
  type PipelineKey,
} from "../src/lib/acq/schema.ts";
import { breakdown, funnel, weeklySample } from "../src/lib/acq/metrics.ts";
import type { CallRow } from "../src/lib/acq/store.ts";
import { firstTouch } from "../src/lib/enrich/insights.ts";

const TUE = new Date("2026-10-06T15:00:00Z"); // 11am EDT
const contact = (o: Partial<ContactState> = {}): ContactState => ({
  lane: "power",
  attempts: 0,
  conversations: 0,
  phones: ["8562221111", "8563334444"],
  invalidPhones: [],
  propertyCount: 1,
  primaryPropertyId: "prop1",
  ...o,
});
const opp = (stage: string, fields: Record<string, unknown> = {}, pipeline: PipelineKey = "residential"): OppState => ({ id: "opp1", pipeline, stage, status: "open", fields });
const fullQual = Object.fromEntries(QUALIFICATION_FIELDS.map((f) => [f, f === "Next Follow Up" ? "2026-10-09" : "x"]));
const call = (o: Partial<{ human: boolean | null; seconds: number; dialed: string | null }> = {}) => ({ at: TUE, human: true, seconds: 120, dialed: "8562221111", userId: "caller123456789", ...o });

// ------------------------------------------------------------- schema --
test("schema invariants: stage roles exist, qualification fields exist, keys unique, 12 dispositions", () => {
  for (const p of Object.values(PIPELINES)) for (const s of Object.values(p.roles)) assert.ok(p.stages.includes(s), s);
  const opNames = new Set(OPPORTUNITY_FIELDS.map((f) => f.name));
  for (const q of QUALIFICATION_FIELDS) assert.ok(opNames.has(q), q);
  for (const list of [CONTACT_FIELDS, OPPORTUNITY_FIELDS]) {
    const keys = list.map((f) => fieldKey(f.name));
    assert.equal(new Set(keys).size, keys.length);
  }
  assert.equal(Object.keys(DISPOSITIONS).length, 12);
  assert.equal(fieldKey("Call Window ET"), "call_window_et");
});

// -------------------------------------------------------- dispositions --
test("disposition labels, synonyms and outcome fallback map to the 12", () => {
  assert.equal(dispositionKey("Hot Lead"), "HOT");
  assert.equal(dispositionKey("appointment booked"), "BOOKED");
  assert.equal(dispositionKey("Do Not Call"), "DNC");
  assert.equal(dispositionKey("Bad Number"), "WRONG_NUMBER");
  assert.equal(dispositionKey("Voice Message"), "VOICEMAIL");
  assert.equal(dispositionKey(null, "VOICEMAIL"), "VOICEMAIL");
  assert.equal(dispositionKey("", "NO_ANSWER"), "NO_ANSWER");
});

test("no answer: counts the attempt, schedules the next, advances New -> Attempting", () => {
  const p = planDisposition("NO_ANSWER", call({ human: null, seconds: 0 }), contact(), opp("New / Ready to Call"));
  assert.equal(p.contactFields["Call Attempts"], 1);
  assert.equal(p.contactFields["Next Call Due"], "2026-10-07");
  assert.equal(p.opp?.stageRole, "attempting");
  assert.equal(p.conversation, false);
  assert.equal(p.primaryPhone, undefined);
});

test("no answer: every second miss rotates to the next number; Sunday rolls to Monday", () => {
  const p = planDisposition("NO_ANSWER", call({ human: null, seconds: 0 }), contact({ attempts: 1 }), opp("Attempting Contact"));
  assert.equal(p.primaryPhone, "8563334444");
  assert.equal(p.contactFields["Phone 2"], "+18562221111");
  const sat = new Date("2026-10-10T15:00:00Z");
  const q = planDisposition("VOICEMAIL", { ...call(), at: sat }, contact(), opp("Attempting Contact"));
  assert.equal(q.contactFields["Next Call Due"], "2026-10-12");
});

test(`no answer #${MAX_ATTEMPTS}: recycle 90 days, card abandoned`, () => {
  const p = planDisposition("NO_ANSWER", call({ human: null, seconds: 0 }), contact({ attempts: MAX_ATTEMPTS - 1 }), opp("Attempting Contact"));
  assert.equal(p.contactFields["Dial Lane"], "recycle");
  assert.equal(p.contactFields["Next Call Due"], null);
  assert.equal(p.opp?.status, "abandoned");
  assert.equal(p.opp?.fields["Close Reason"], "Unreachable (recycled)");
});

test("wrong number: number invalidated, next number queued now; last number -> needs re-skip", () => {
  const p = planDisposition("WRONG_NUMBER", call(), contact(), opp("Attempting Contact"));
  assert.equal(p.primaryPhone, "8563334444");
  assert.match(String(p.contactFields["Invalid Phones"]), /8562221111 \(wrong number/);
  assert.equal(p.contactFields["Next Call Due"], "2026-10-06");
  const q = planDisposition("WRONG_NUMBER", call(), contact({ phones: ["8562221111"] }), opp("Attempting Contact"));
  assert.equal(q.contactFields["Dial Lane"], "reskip");
  assert.ok(q.tagsAdd.includes("needs-reskip"));
});

test("DNC overrides everything: person + every number suppressed, DND all channels, card lost", () => {
  const p = planDisposition("DNC", call(), contact(), opp("Qualified Warm", fullQual));
  assert.equal(p.contactFields["Dial Lane"], "suppressed");
  assert.equal(p.dndAll, true);
  assert.deepEqual(p.suppress.filter((s) => s.kind === "phone").map((s) => s.value).sort(), ["8562221111", "8563334444"]);
  assert.ok(p.suppress.some((s) => s.kind === "contact"));
  assert.equal(p.opp?.status, "lost");
  assert.equal(p.opp?.fields["Close Reason"], "DNC / opt-out");
});

test("hot with missing qualification fields: stays Contacted, caller task, Sum still alerted", () => {
  const p = planDisposition("HOT", call(), contact(), opp("Attempting Contact", { Motivation: "divorce" }));
  assert.equal(p.opp?.stageRole, "contacted");
  assert.ok(p.tagsAdd.includes("qa:missing-fields"));
  assert.ok(p.tasks.some((t) => t.assignTo === "caller" && /qualification/.test(t.title)));
  assert.equal(p.notify?.level, "hot");
  assert.match(p.notify!.text, /fields incomplete/);
  assert.equal(p.hotReport, true);
  assert.equal(missingQualification({ Motivation: "x" }).length, QUALIFICATION_FIELDS.length - 1);
});

test("hot with every field: Qualified Hot, assigned to Sum, caller attributed", () => {
  const p = planDisposition("HOT", call(), contact(), opp("Contacted", fullQual));
  assert.equal(p.opp?.stageRole, "hot");
  assert.equal(p.opp?.assignToOwner, true);
  assert.equal(p.opp?.fields["Caller Attribution"], "caller123456789");
  assert.ok(p.tagsRemove.includes("qa:missing-fields"));
});

test("land pipeline: warm -> 'Qualified', booked -> 'Consultation'", () => {
  const w = planDisposition("WARM", call(), contact(), opp("Contacted", fullQual, "land"));
  assert.equal(PIPELINES.land.roles[w.opp!.stageRole!], "Qualified");
  const b = planDisposition("BOOKED", call(), contact(), opp("Contacted", {}, "land"));
  assert.equal(PIPELINES.land.roles[b.opp!.stageRole!], "Consultation");
});

test("automation never moves backwards and never closes a deal past consultation", () => {
  const back = planDisposition("CALLBACK", call(), contact(), opp("Qualified Hot", fullQual));
  assert.equal(back.opp?.stageRole, undefined);
  const late = planDisposition("NOT_INTERESTED", call(), contact(), opp("Under Contract", fullQual));
  assert.equal(late.opp?.status, undefined);
  assert.ok(late.tasks.some((t) => t.assignTo === "owner" && /Review/.test(t.title)));
});

test("not interested with a caller-set future follow-up = nurture, not lost", () => {
  const p = planDisposition("NOT_INTERESTED", call(), contact(), opp("Contacted", { "Next Follow Up": "2027-03-01" }));
  assert.equal(p.opp?.status, undefined);
  assert.equal(p.opp?.stageRole, "followUp");
  assert.equal(p.contactFields["Next Call Due"], "2027-03-01");
});

test("already listed: property suppressed (NJ REC), card lost, single-property owner suppressed", () => {
  const p = planDisposition("LISTED", call(), contact(), opp("Contacted"));
  assert.deepEqual(p.suppress, [{ kind: "property", value: "prop1", reason: "listed with another broker (NJ REC)" }]);
  assert.equal(p.opp?.fields["Close Reason"], "Listed with another broker");
  assert.equal(p.contactFields["Dial Lane"], "suppressed");
  const multi = planDisposition("LISTED", call(), contact({ propertyCount: 3 }), opp("Contacted"));
  assert.equal(multi.contactFields["Dial Lane"], undefined);
});

// ---------------------------------------------------------- compliance --
test("call window: federal 8-9 violation vs policy 9-8, in the owner's zone", () => {
  const ny = ["America/New_York"];
  assert.deepEqual(callWindowFlags(new Date("2026-10-06T12:30:00Z"), ny).map((f) => f.code), ["outside_policy_hours"]);
  assert.deepEqual(callWindowFlags(new Date("2026-10-06T11:30:00Z"), ny).map((f) => f.severity), ["violation"]);
  assert.deepEqual(callWindowFlags(TUE, ny), []);
  // 10am ET is 7am in California
  assert.equal(callWindowFlags(new Date("2026-10-06T14:00:00Z"), ["America/Los_Angeles"])[0].severity, "violation");
  assert.ok(callWindowFlags(new Date("2026-10-04T15:00:00Z"), ny).some((f) => f.code === "sunday_call"));
  assert.ok(isFederalHoliday("2026-11-26") && isFederalHoliday("2026-05-25") && !isFederalHoliday("2026-11-19"));
});

test("audit: suppressed contact, missing/expired scrub, inbound consent exemption, dropped connect", () => {
  const base = { at: TUE, direction: "outbound", dialed: "8562221111", human: true, seconds: 90, lane: "power", tags: [], zones: ["America/New_York"], scrubDate: "2026-10-01", phones: ["8562221111"], inboundConsent: false };
  assert.deepEqual(auditCall(base), []);
  assert.ok(auditCall({ ...base, lane: "suppressed" }).some((f) => f.code === "dialed_suppressed_contact"));
  assert.ok(auditCall({ ...base, scrubDate: null }).some((f) => f.code === "no_scrub_on_file"));
  assert.ok(auditCall({ ...base, scrubDate: "2026-08-20" }).some((f) => f.code === "scrub_expired"));
  assert.deepEqual(auditCall({ ...base, scrubDate: null, lane: "inbound", inboundConsent: true }), []);
  assert.ok(auditCall({ ...base, seconds: 0 }).some((f) => f.code === "possible_abandoned"));
  assert.ok(auditCall({ ...base, dialed: "6095550000" }).some((f) => f.code === "number_not_on_record"));
  assert.deepEqual(auditCall({ ...base, direction: "inbound", lane: "suppressed" }), []);
});

test("audit: a caller without a signed training acknowledgement is a violation", () => {
  const base = { at: TUE, direction: "outbound", dialed: "8562221111", human: true, seconds: 90, lane: "power", tags: [], zones: ["America/New_York"], scrubDate: "2026-10-01", phones: ["8562221111"], inboundConsent: false };
  assert.deepEqual(auditCall({ ...base, callerTrained: null }), [], "check off when no list is configured");
  assert.deepEqual(auditCall({ ...base, callerTrained: true }), []);
  assert.ok(auditCall({ ...base, callerTrained: false }).some((f) => f.code === "caller_not_trained" && f.severity === "violation"));
  assert.equal(trainedCallers(""), null);
  assert.deepEqual([...trainedCallers(" u1, u2 ,")!], ["u1", "u2"]);
});

// ----------------------------------------------------------------- WAVV --
test("WAVV signature: valid, tampered, stale, and whsec_ key forms", () => {
  const body = JSON.stringify({ event: "call.ended", data: { id: "c1" } });
  const t = 1_790_000_000;
  const sig = (key: string, b = body, ts = t) => `t=${ts},v1=${createHmac("sha256", key).update(`${ts}.${b}`).digest("hex")}`;
  assert.ok(verifyWavvSignature(body, sig("whsec_abc"), "whsec_abc", t));
  assert.ok(verifyWavvSignature(body, sig("abc"), "whsec_abc", t));
  assert.ok(!verifyWavvSignature(body + " ", sig("whsec_abc"), "whsec_abc", t));
  assert.ok(!verifyWavvSignature(body, sig("whsec_abc", body, t - 1000), "whsec_abc", t));
  assert.ok(!verifyWavvSignature(body, null, "whsec_abc", t));
});

// ------------------------------------------------------------ AI review --
const intel = (o: Partial<CallIntel> = {}, comp: Partial<CallIntel["compliance"]> = {}): CallIntel => ({
  spoke_with: "owner",
  owner_confirmed: true,
  owner_deceased: false,
  seller_motivation: "relocating for work",
  property_condition: "needs roof",
  timeline: "60 days",
  asking_price: "around 300",
  price_flexibility: null,
  occupancy: "vacant",
  decision_makers: "owner and wife",
  mortgage_liens: null,
  listing_status: "not_listed",
  objections: [],
  callback_requested: null,
  next_action: "Sumeet to call Thursday",
  lead_temperature: "hot",
  temperature_reason: "intent, motivation, 60-day timeline, open to offer",
  key_quote: "I just want it gone",
  compliance: { opt_out_requested: false, opt_out_quote: null, recording_disclosed: "yes", license_disclosed: "yes", caller_quoted_price_or_terms: false, caller_quote: null, concerns: [], ...comp },
  qa: { opening: 4, tone: 4, discovery: 4, listening: 4, qualification: 4, objection_handling: 3, control: 4, closing: 4, notes_accuracy: "accurate", coaching_note: "ask about liens" },
  summary: "Owner relocating, vacant house needs a roof, wants out in 60 days.",
  ...o,
});

test("AI review: missed opt-out forces DNC; hidden hot alerts; inflated hot gets QA review", () => {
  const optOut = planIntel(intel({ lead_temperature: "not_qualified" }, { opt_out_requested: true, opt_out_quote: "take me off your list" }), "NOT_INTERESTED", "c1");
  assert.equal(optOut.forceDnc, true);
  assert.match(optOut.alerts[0], /OPT-OUT MISSED/);
  const hidden = planIntel(intel(), "CALLBACK", "c2");
  assert.ok(hidden.tagsAdd.includes("alert:hidden-hot"));
  assert.equal(hidden.oppFields["AI Temperature"], "hot");
  const inflated = planIntel(intel({ lead_temperature: "not_qualified" }), "HOT", "c3");
  assert.ok(inflated.qaFlags.some((f) => f.startsWith("inflated")));
  const clean = planIntel(intel(), "HOT", "c4");
  assert.deepEqual([clean.forceDnc, clean.alerts.length, clean.qaFlags.length], [false, 0, 0]);
});

test("AI review: disclosure misses, quoted price, listed property, estate", () => {
  const p = planIntel(intel({ listing_status: "listed_with_agent", owner_deceased: true }, { recording_disclosed: "no", license_disclosed: "no", caller_quoted_price_or_terms: true, caller_quote: "we'd pay 250" }), "WARM", "c5");
  assert.equal(p.suppressListedProperty, true);
  assert.ok(p.qaFlags.includes("no recording disclosure") && p.qaFlags.includes("no license/brokerage disclosure"));
  assert.ok(p.qaFlags.some((f) => /quoted price/.test(f)));
  assert.ok(p.tagsAdd.includes("research:estate"));
  assert.equal(formatIntel(intel()).split("\n").length, 12);
});

test("outbound leads are never told to text", () => {
  assert.match(firstTouch(TUE, false), /never text/);
  assert.match(firstTouch(TUE), /text right away/);
});

// ----------------------------------------------------------- mock GHL --
type Json = Record<string, unknown>;
const pf = (name: string, key: string, dataType = "TEXT", options?: { key: string; label: string }[]) => ({ name, fieldKey: `custom_objects.property.${key}`, dataType, ...(options ? { options } : {}) });
const YES = [{ key: "yes", label: "Yes" }];
/** Sum's live build: primary + 27 "Property Details" fields (GHL-made keys) + Acq Property ID. */
const LIVE_PROPERTY_FIELDS = [
  pf("Property Address", "property_address"),
  pf("County", "county"), pf("Municipality", "municipality"), pf("ZIP", "zip"), pf("Block", "block"), pf("Lot", "lot"),
  pf("APN/Parcel ID", "apnparcel_id"),
  pf("Residential/Vacant Land", "residentialvacant_land", "SINGLE_OPTIONS", [{ key: "residential", label: "Residential" }, { key: "vacant_land", label: "Vacant Land" }]),
  pf("Property Type", "property_type"),
  pf("Occupancy", "occupancy", "SINGLE_OPTIONS", [{ key: "owner_occupied", label: "Owner Occupied" }, { key: "tenant", label: "Tenant" }, { key: "vacant", label: "Vacant" }]),
  pf("Estimated Value", "estimated_value", "MONETORY"), pf("Mortgage Estimate", "mortgage_estimate", "MONETORY"),
  pf("Equity %", "equity_", "NUMERICAL"), pf("Acres", "acres", "NUMERICAL"), pf("Ownership Years", "ownership_years", "NUMERICAL"),
  pf("Wetlands %", "wetlands_", "NUMERICAL"), pf("Road Frontage", "road_frontage", "NUMERICAL"),
  pf("Vacancy", "vacancy", "CHECKBOX", YES), pf("Absentee", "absentee", "CHECKBOX", YES), pf("Tax Delinquency", "tax_delinquency", "CHECKBOX", YES),
  pf("Foreclosure", "foreclosure", "CHECKBOX", YES), pf("Inherited", "inherited", "CHECKBOX", YES), pf("Free & Clear", "free__clear", "CHECKBOX", YES),
  pf("Flood", "flood", "CHECKBOX", YES),
  pf("Source Provider", "source_provider"), pf("Original List", "original_list"), pf("Pull Date", "pull_date", "DATE"), pf("Skip-Trace Provider", "skiptrace_provider"),
  pf("Acq Property ID", "acq_property_id"),
];
function mockGhl() {
  const calls: { method: string; path: string; body: Json | null }[] = [];
  const contacts = new Map<string, Json>();
  const records = new Map<string, Json>();
  const opps = new Map<string, Json>();
  const field = (model: string) => (f: { name: string }) => ({ id: `${model[0]}_${fieldKey(f.name)}`, name: f.name, fieldKey: `${model}.${fieldKey(f.name)}`, model });
  const pipelines = (Object.keys(PIPELINES) as PipelineKey[]).map((k) => ({
    id: `pipe_${k}`,
    name: PIPELINES[k].name,
    stages: PIPELINES[k].stages.map((s, i) => ({ id: `${k}_${i}`, name: s.replace(/ \/ /g, "/") })),
  }));
  let n = 0;
  const mergeCf = (target: Json, cfs: { id: string; field_value: unknown }[] | undefined, valueKey: string) => {
    const cur = new Map(((target.customFields as Json[]) ?? []).map((x) => [String(x.id), x]));
    for (const c of cfs ?? []) cur.set(c.id, { id: c.id, [valueKey]: c.field_value });
    target.customFields = [...cur.values()];
  };
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Json) : null;
    const path = url.pathname;
    calls.push({ method, path, body });
    const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
    if (url.hostname === "api.wavv.com") return ok({ transcript: "Caller: hi... Owner: not interested.", summary: null });
    if (url.hostname !== "services.leadconnectorhq.com") return new Response("nope", { status: 404 });
    let m: RegExpMatchArray | null;
    if (path.endsWith("/customFields")) {
      const model = url.searchParams.get("model")!;
      return ok({ customFields: (model === "contact" ? CONTACT_FIELDS : OPPORTUNITY_FIELDS).map(field(model)) });
    }
    if (path === "/opportunities/pipelines") return ok({ pipelines });
    if (path === "/associations/") return ok({ associations: [{ id: "assoc1", key: "owner_property", firstObjectKey: "custom_objects.property", secondObjectKey: "contact" }] });
    if (path === "/contacts/upsert") {
      const existing = [...contacts.values()].find((c) => c.phone === body!.phone);
      if (existing) return ok({ contact: existing, new: false });
      const c: Json = { id: `ct${++n}`, ...body, tags: [], customFields: [] };
      contacts.set(String(c.id), c);
      return ok({ contact: c, new: true });
    }
    if ((m = path.match(/^\/contacts\/([^/]+)\/tags$/))) {
      const c = contacts.get(m[1])!;
      const tags = new Set(c.tags as string[]);
      for (const t of body!.tags as string[]) method === "DELETE" ? tags.delete(t) : tags.add(t);
      c.tags = [...tags];
      return ok({ tags: c.tags });
    }
    if ((m = path.match(/^\/contacts\/([^/]+)\/(notes|tasks)$/))) return ok({ id: `x${++n}` });
    if ((m = path.match(/^\/contacts\/([^/]+)$/))) {
      const c = contacts.get(m[1])!;
      if (method === "PUT") {
        const { customFields, ...rest } = body!;
        Object.assign(c, rest);
        mergeCf(c, customFields as never, "value");
      }
      return ok({ contact: c });
    }
    if (path === "/objects/") return ok({ objects: [{ key: "custom_objects.property", labels: { singular: "Property", plural: "Properties" } }] });
    if (path === "/custom-fields/object-key/custom_objects.property") return ok({ fields: LIVE_PROPERTY_FIELDS, folders: [{ id: "fold1", name: "Property Details" }] });
    if (path.endsWith("/records/search")) return ok({ records: [] });
    if (path.endsWith("/records") && method === "POST") {
      const id = `rec${++n}`;
      records.set(id, (body!.properties ?? {}) as Json);
      return ok({ record: { id } });
    }
    if (path.match(/\/records\/[^/]+$/)) {
      const id = path.split("/").pop()!;
      if (method === "PUT") records.set(id, (body!.properties ?? {}) as Json);
      return ok({ record: { id, properties: records.get(id) ?? {} } });
    }
    if (path === "/associations/relations") return ok({});
    if (path === "/opportunities/" && method === "POST") {
      const o: Json = { id: `op${++n}`, ...body, customFields: [] };
      mergeCf(o, body!.customFields as never, "fieldValue");
      opps.set(String(o.id), o);
      return ok({ opportunity: o });
    }
    if ((m = path.match(/^\/opportunities\/([^/]+)$/))) {
      const o = opps.get(m[1])!;
      if (method === "PUT") {
        const { customFields, ...rest } = body!;
        Object.assign(o, rest);
        mergeCf(o, customFields as never, "fieldValue");
      }
      return ok({ opportunity: o });
    }
    return new Response(`unmocked ${method} ${path}`, { status: 404 });
  }) as typeof fetch;
  return { calls, contacts, opps, records, fetchImpl };
}

const waveRecord = (): WaveRecord => ({
  op: "upsert",
  owner_id: "own1",
  wave: "W01",
  primary_property_id: "prop1",
  contact: {
    first_name: "John", last_name: "Smith", full_name: "John Smith", owner_type: "Individual",
    mailing_address: "1 Elsewhere Rd", mailing_city: "Phila", mailing_state: "PA", mailing_zip: "19103",
    phones: [{ number: "8562221111", type: "mobile", scrub_date: "2026-10-01" }, { number: "8563334444", type: "mobile", scrub_date: "2026-10-01" }],
    emails: [], dial_lane: "power", lane_reason: "", call_zones: "America/New_York", call_window_et: "9a-8p ET",
    dnc_scrub_date: "2026-10-01", lead_source: "BatchLeads", primary_cohort: "vacant_equity", source_list: "Vacant + equity",
    primary_county: "CAMDEN", asset_class: "residential", primary_property: "10 Oak St, Camden 08102", property_count: 1,
    lead_score: 61, signals: "Vacant · Tax delinquent", pull_date: "2026-09-25", skip_trace_provider: "batchskiptracing",
  },
  properties: [{
    property_id: "prop1", address: "10 Oak St", city: "Camden", zip: "08102", county: "CAMDEN", apn: "1234",
    asset_class: "residential", vacant: true, absentee: true, tax_delinquent: true, preforeclosure: false,
    est_value: 300000, equity_pct: 65, flood_zone: "X", cohorts: "tax_delinquent;vacant_equity", providers: "batchleads",
    pull_date: "2026-09-25", beds: 3, lead_score: 61,
  }],
});

test("live build mapping: hand-typed stage names + Sum's 28 Property fields resolve; extras stay optional", async () => {
  resetResolveCache();
  const mock = mockGhl();
  const ghl = new Ghl({ token: "t", locationId: "LOC", fetchImpl: mock.fetchImpl, minIntervalMs: 0 });
  const r = await resolve(ghl, { fresh: true });
  assert.deepEqual(r.missing, []);
  assert.equal(r.propertyKey, "custom_objects.property");
  assert.equal(r.pipelines.residential!.stages.get("New / Ready to Call"), "residential_0");
  assert.equal(r.pipelines.land!.stageNames.get(`land_${PIPELINES.land.stages.length - 1}`), "Closed");
  assert.equal(r.propertyFields.get("free_clear")!.key, "free__clear");
  assert.equal(r.propertyFields.has("beds"), false);
  const m = matchStages("residential", [{ id: "a", name: "New Ready To Call" }, { id: "b", name: "Closed" }]);
  assert.equal(m.stages.get("New / Ready to Call"), "a");
  assert.equal(m.stages.get("Closed Won"), "b", "alias: Closed == Closed Won");
});

test("value conversion follows the live field type, never guesses", () => {
  const f = (dataType: string, options: { key?: string; label: string }[] = []) => ({ name: "x", key: "x", dataType, options });
  assert.deepEqual(toFieldValue(f("CHECKBOX", [{ key: "yes", label: "Yes" }]), true), ["yes"]);
  assert.equal(toFieldValue(f("CHECKBOX"), "Yes"), undefined);
  assert.equal(toFieldValue(f("SINGLE_OPTIONS", [{ label: "Vacant Land" }]), ["Vacant Land", "Land"]), "Vacant Land");
  assert.equal(toFieldValue(f("SINGLE_OPTIONS", [{ label: "Residential" }]), ["Commercial"]), undefined);
  assert.equal(toFieldValue(f("NUMERICAL"), "$1,250"), 1250);
  assert.equal(toFieldValue(f("NUMERICAL"), true), undefined);
  assert.equal(toFieldValue(f("DATE"), "2026-09-25T00:00:00"), "2026-09-25");
  assert.equal(toFieldValue(f("DATE"), "Sept"), undefined);
  assert.equal(toFieldValue(f("TEXT"), 7), "7");
  assert.equal(toFieldValue(f("TEXT"), ""), undefined);
});

test("GHL client: auth + Version headers, 429 retried, field ids resolved by key or name", async () => {
  let n = 0;
  const seen: Headers[] = [];
  const f = (async (_u: string, init?: RequestInit) => {
    seen.push(new Headers(init?.headers));
    return ++n === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }) : new Response('{"pipelines":[]}', { status: 200 });
  }) as typeof fetch;
  const ghl = new Ghl({ token: "pit-x", locationId: "LOC", fetchImpl: f, minIntervalMs: 0 });
  assert.deepEqual(await ghl.listPipelines(), []);
  assert.equal(n, 2);
  assert.equal(seen[0].get("authorization"), "Bearer pit-x");
  assert.equal(seen[0].get("version"), "2021-07-28");
  const { map, missing } = matchFields([{ id: "a", name: "whatever", fieldKey: "contact.dial_lane" }, { id: "b", name: "LEAD SCORE" }], CONTACT_FIELDS, "contact");
  assert.equal(map.get("Dial Lane"), "a");
  assert.equal(map.get("Lead Score"), "b");
  assert.ok(missing.length === CONTACT_FIELDS.length - 2);
  assert.deepEqual(cf(map, { "Dial Lane": "power", "Lead Score": undefined, Nope: 1 }), [{ id: "a", field_value: "power" }]);
});

test("wave push: contact (no tags in upsert), property + association, opportunity at New, ids saved, idempotent", async () => {
  resetResolveCache();
  const mock = mockGhl();
  const ghl = new Ghl({ token: "t", locationId: "LOC", fetchImpl: mock.fetchImpl, minIntervalMs: 0 });
  const r = await resolve(ghl, { fresh: true });
  assert.deepEqual(r.missing, []);
  const ids: IdMap = { owners: {}, properties: {} };
  const res = await pushOwner(ghl, r, waveRecord(), ids, { coldSmsDnd: true });
  assert.equal(res.newContact, true);
  assert.equal(res.opportunitiesCreated, 1);
  const upsert = mock.calls.find((c) => c.path === "/contacts/upsert")!;
  assert.equal(upsert.body!.tags, undefined, "upsert replaces tags — never send them");
  assert.equal(upsert.body!.phone, "+18562221111");
  const ct = mock.contacts.get(res.contactId)!;
  assert.ok((ct.tags as string[]).includes("no-sms") && (ct.tags as string[]).includes("lane:power"));
  assert.equal((ct.dndSettings as Json).SMS && ((ct.dndSettings as Json).SMS as Json).status, "active");
  const cfv = Object.fromEntries((ct.customFields as Json[]).map((x) => [x.id, x.value]));
  assert.equal(cfv["c_dial_lane"], "power");
  assert.equal(cfv["c_phone_2"], "+18563334444");
  assert.equal(cfv["c_residential_opportunity_id"], ids.owners.own1.opportunities.residential);
  const o = mock.opps.get(ids.owners.own1.opportunities.residential!)!;
  assert.equal(o.pipelineStageId, "residential_0");
  assert.ok(mock.calls.some((c) => c.path === "/associations/relations" && c.body!.secondRecordId === res.contactId));
  assert.ok(ids.properties.prop1);
  const props = mock.records.get(ids.properties.prop1)!;
  assert.equal(props.property_address, "10 Oak St, Camden");
  assert.equal(props.equity_, 65, "'Equity %' resolved to its live key");
  assert.deepEqual(props.vacancy, ["yes"], "checkbox flag written as the option");
  assert.equal(props.foreclosure, undefined, "false flag not written");
  assert.equal(props.residentialvacant_land, "residential");
  assert.equal(props.occupancy, "vacant");
  assert.deepEqual(props.estimated_value, { currency: "default", value: 300000 });
  assert.equal(props.flood, undefined, "zone X is not a flood flag");
  assert.equal(props.original_list, "Tax delinquent; Vacant + equity");
  assert.equal(props.acq_property_id, "prop1");
  assert.ok(!("beds" in props) && !("lead_score" in props), "fields that don't exist in GHL are skipped, never invented");
  const before = mock.opps.size;
  await pushOwner(ghl, r, waveRecord(), ids, { coldSmsDnd: true });
  assert.equal(mock.opps.size, before, "re-push creates no second opportunity");
});

test("wave push: an existing consented web-lead contact keeps its lane and consent", async () => {
  resetResolveCache();
  const mock = mockGhl();
  const ghl = new Ghl({ token: "t", locationId: "LOC", fetchImpl: mock.fetchImpl, minIntervalMs: 0 });
  const r = await resolve(ghl, { fresh: true });
  mock.contacts.set("web1", { id: "web1", phone: "+18562221111", tags: ["acq:inbound"], customFields: [{ id: "c_dial_lane", value: "inbound" }, { id: "c_sms_consent", value: "Web form consent" }] });
  const ids: IdMap = { owners: {}, properties: {} };
  const res = await pushOwner(ghl, r, waveRecord(), ids, { coldSmsDnd: true });
  assert.equal(res.contactId, "web1");
  const ct = mock.contacts.get("web1")!;
  const cfv = Object.fromEntries((ct.customFields as Json[]).map((x) => [x.id, x.value]));
  assert.equal(cfv["c_dial_lane"], "inbound");
  assert.equal(cfv["c_sms_consent"], "Web form consent");
  assert.equal(ct.dndSettings, undefined);
  assert.ok(!(ct.tags as string[]).includes("no-sms"));
});

// ------------------------------------------------------------- metrics --
const row = (o: Partial<CallRow>): CallRow => ({
  id: Math.random().toString(36).slice(2), direction: "outbound", phone: "8562221111", contactId: "ct", userId: "A", campaignId: null,
  startedAt: TUE.toISOString(), endedAt: TUE.toISOString(), seconds: 0, outcome: null, human: null, disposition: null,
  dispositionKey: "NO_ANSWER", note: null, dims: { county: "CAMDEN", cohort: "vacant_equity" }, conversation: false, plan: null,
  flags: [], endedStatus: "done", endedAttempts: 1, endedError: null, recorded: false, transcriptStatus: "waiting",
  transcriptAttempts: 0, transcript: null, wavvSummary: null, intel: null, intelStatus: null, intelError: null, ...o,
});

test("metrics: funnel rates, breakdown by caller/county, weekly listen-list", () => {
  const calls = [
    ...Array.from({ length: 8 }, () => row({})),
    row({ human: true, seconds: 200, conversation: true, dispositionKey: "HOT", recorded: true }),
    row({ human: true, seconds: 90, conversation: true, dispositionKey: "NOT_INTERESTED", recorded: true }),
    row({ human: true, seconds: 0, flags: [{ severity: "warning", code: "possible_abandoned", detail: "" }], userId: "B", dims: { county: "MERCER" } }),
  ];
  const f = funnel(calls);
  assert.equal(f.dials, 11);
  assert.equal(f.conversations, 2);
  assert.equal(f.qualified, 1);
  assert.equal(f.qualificationRate, 0.5);
  assert.equal(f.abandonRate, 1 / 3);
  assert.deepEqual(breakdown(calls, "caller").map((b) => b.key), ["A", "B"]);
  assert.deepEqual(breakdown(calls, "county").map((b) => b.key), ["CAMDEN", "MERCER"]);
  const s = weeklySample(calls);
  assert.equal(s.A.successful.length, 1);
  assert.equal(s.A.weak.length + s.A.ordinary.length, 1);
});

// ------------------------------------------------------------------ e2e --
test("end to end: signed WAVV call.ended -> call log -> GHL disposition applied; call.recorded -> transcript stored", async () => {
  process.env.PGLITE_DIR = mkdtempSync(join(tmpdir(), "acq-e2e-"));
  process.env.GHL_TOKEN = "t";
  process.env.GHL_LOCATION_ID = "LOC";
  process.env.WAVV_API_KEY = "k";
  delete process.env.ANTHROPIC_API_KEY;
  resetResolveCache();
  const mock = mockGhl();
  const realFetch = globalThis.fetch;
  globalThis.fetch = mock.fetchImpl;
  const { getDb, closeDb } = await import("../src/lib/db.ts");
  const { ingestWavvEvent, processWavvEvent } = await import("../src/lib/acq/processor.ts");
  const { getCall, listSuppression } = await import("../src/lib/acq/store.ts");
  try {
    const db = (await getDb())!;
    // a released contact with an open card
    const ghl = new Ghl({ token: "t", locationId: "LOC", fetchImpl: mock.fetchImpl, minIntervalMs: 0 });
    const ids: IdMap = { owners: {}, properties: {} };
    const pushed = await pushOwner(ghl, await resolve(ghl, { fresh: true }), waveRecord(), ids, { coldSmsDnd: true });
    const ended = { event: "call.ended", data: { id: "call-1", direction: "outbound", phone: "8562221111", contactId: pushed.contactId, userId: "callerA12345678", startedAt: TUE.toISOString(), endedAt: TUE.toISOString(), seconds: 95, outcome: "HUNG_UP", human: true, disposition: "DNC", note: "said stop calling" } };
    assert.equal(await ingestWavvEvent(db, ended), "ingested");
    assert.equal(await ingestWavvEvent(db, ended), "duplicate", "at-least-once delivery deduped");
    await processWavvEvent(db, ended);
    const row1 = (await getCall(db, "call-1"))!;
    assert.equal(row1.endedStatus, "done");
    assert.equal(row1.dispositionKey, "DNC");
    assert.equal(row1.dims.county, "CAMDEN");
    const ct = mock.contacts.get(pushed.contactId)!;
    assert.ok((ct.tags as string[]).includes("dnc"));
    assert.equal(ct.dnd, true);
    const cfv = Object.fromEntries((ct.customFields as Json[]).map((x) => [x.id, x.value]));
    assert.equal(cfv["c_dial_lane"], "suppressed");
    assert.equal(cfv["c_call_attempts"], 1);
    const o = mock.opps.get(ids.owners.own1.opportunities.residential!)!;
    assert.equal(o.status, "lost");
    const sup = await listSuppression(db);
    assert.ok(sup.some((s) => s.kind === "phone" && s.value === "8562221111"));
    const rec = { event: "call.recorded", data: { id: "call-1", recordingUrl: "https://x/rec.mp3", recorded: true } };
    assert.equal(await ingestWavvEvent(db, rec), "ingested");
    await processWavvEvent(db, rec);
    const row2 = (await getCall(db, "call-1"))!;
    assert.equal(row2.transcriptStatus, "ready");
    assert.match(row2.transcript ?? "", /not interested/);
    assert.equal(row2.intelStatus, "failed", "no ANTHROPIC_API_KEY in tests -> AI step fails cleanly, retried later");
  } finally {
    globalThis.fetch = realFetch;
    await closeDb();
  }
});
