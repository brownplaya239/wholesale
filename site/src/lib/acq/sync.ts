/**
 * GHL record operations built on the schema: resolve field/pipeline ids by
 * name, push a released owner (contact + property records + association +
 * opportunity), apply phone/lane patches, and push a web lead.
 */
import { cfValue, Ghl, GhlError, type CustomFieldValue, type GhlContact, type GhlField } from "./ghl";
import {
  CONTACT_FIELDS,
  CONTACT_PROPERTY_ASSOCIATION,
  fieldKey,
  OPPORTUNITY_FIELDS,
  PIPELINES,
  PROPERTY_OBJECT,
  TAGS,
  type FieldDef,
  type PipelineKey,
} from "./schema";

export type Resolved = {
  contact: Map<string, string>;
  opportunity: Map<string, string>;
  idToName: Map<string, string>;
  pipelines: Partial<Record<PipelineKey, { id: string; stages: Map<string, string>; stageNames: Map<string, string> }>>;
  associationId: string | null;
  missing: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchFields(fields: GhlField[], defs: readonly FieldDef[], model: string): { map: Map<string, string>; missing: string[] } {
  const map = new Map<string, string>();
  const missing: string[] = [];
  for (const d of defs) {
    const f = fields.find((x) => x.fieldKey === `${model}.${fieldKey(d.name)}` || norm(x.name) === norm(d.name));
    if (f) map.set(d.name, f.id);
    else missing.push(`${model}: ${d.name}`);
  }
  return { map, missing };
}

let cached: { at: number; r: Resolved } | null = null;

/** Field ids, pipeline/stage ids and the contact↔property association id. Cached 10 min. */
export async function resolve(ghl: Ghl, opts: { fresh?: boolean } = {}): Promise<Resolved> {
  if (!opts.fresh && cached && Date.now() - cached.at < 600_000) return cached.r;
  const [cFields, oFields, pipes, assoc] = await Promise.all([
    ghl.listFields("contact"),
    ghl.listFields("opportunity"),
    ghl.listPipelines(),
    ghl.listAssociations().catch(() => ({ associations: [] })),
  ]);
  const c = matchFields(cFields, CONTACT_FIELDS, "contact");
  const o = matchFields(oFields, OPPORTUNITY_FIELDS, "opportunity");
  const idToName = new Map<string, string>();
  for (const [n, id] of [...c.map, ...o.map]) idToName.set(id, n);
  const pipelines: Resolved["pipelines"] = {};
  const missing = [...c.missing, ...o.missing];
  for (const key of Object.keys(PIPELINES) as PipelineKey[]) {
    const p = pipes.find((x) => norm(x.name) === norm(PIPELINES[key].name));
    if (!p) {
      missing.push(`pipeline: ${PIPELINES[key].name}`);
      continue;
    }
    const stages = new Map(p.stages.map((s) => [s.name, s.id] as const));
    for (const s of PIPELINES[key].stages) if (!stages.has(s)) missing.push(`stage: ${PIPELINES[key].name} / ${s}`);
    pipelines[key] = { id: p.id, stages, stageNames: new Map(p.stages.map((s) => [s.id, s.name] as const)) };
  }
  const a = (assoc.associations ?? []).find(
    (x) =>
      x.key === CONTACT_PROPERTY_ASSOCIATION.key ||
      ([x.firstObjectKey, x.secondObjectKey].includes(PROPERTY_OBJECT.key) && [x.firstObjectKey, x.secondObjectKey].includes("contact"))
  );
  if (!a) missing.push(`association: contact <-> ${PROPERTY_OBJECT.key}`);
  const r: Resolved = { contact: c.map, opportunity: o.map, idToName, pipelines, associationId: a?.id ?? null, missing };
  cached = { at: Date.now(), r };
  return r;
}

export function resetResolveCache(): void {
  cached = null;
}

/** {Field Name: value} -> GHL customFields payload. undefined = leave alone; null = clear. */
export function cf(map: Map<string, string>, values: Record<string, unknown>): CustomFieldValue[] {
  const out: CustomFieldValue[] = [];
  for (const [name, v] of Object.entries(values)) {
    if (v === undefined) continue;
    const id = map.get(name);
    if (!id) continue;
    out.push({ id, field_value: v === null ? "" : v });
  }
  return out;
}

/** GHL customFields array -> {Field Name: value}. */
export function readFields(r: Resolved, cfs: Record<string, unknown>[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const x of cfs ?? []) {
    const name = r.idToName.get(String(x.id));
    if (name) out[name] = cfValue(x);
  }
  return out;
}

export const e164 = (digits: string) => (digits.startsWith("+") ? digits : `+1${digits.replace(/\D/g, "").slice(-10)}`);
export const today = (d = new Date()) => d.toISOString().slice(0, 10);

const isConflict = (e: unknown) => e instanceof GhlError && (e.status === 400 || e.status === 409 || e.status === 422) && /exist|duplicate|already/i.test(e.body);

// ---------------------------------------------------------------- waves --
export type WavePhone = { number: string; type: string; scrub_date: string | null };
export type WaveContact = {
  first_name: string;
  last_name: string;
  full_name: string;
  owner_type: string;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  phones: WavePhone[];
  emails: string[];
  dial_lane: string;
  lane_reason: string;
  call_zones: string;
  call_window_et: string;
  dnc_scrub_date: string | null;
  lead_source: string;
  primary_cohort: string | null;
  source_list: string;
  primary_county: string;
  asset_class: string | null;
  primary_property: string;
  property_count: number;
  lead_score: number;
  signals: string;
  pull_date: string | null;
  skip_trace_provider: string;
};
export type WaveProperty = Record<string, string | number | boolean | null> & { property_id: string; address: string; asset_class: string };
export type WaveRecord = {
  op: "upsert" | "patch" | "suppress";
  owner_id: string;
  wave: string;
  primary_property_id: string | null;
  contact: WaveContact;
  properties: WaveProperty[];
};

export type IdMap = {
  owners: Record<string, { contactId: string; opportunities: Partial<Record<PipelineKey, string>> }>;
  properties: Record<string, string>;
};

function phoneFields(phones: WavePhone[]) {
  return {
    "Phone 2": phones[1] ? e164(phones[1].number) : null,
    "Phone 3": phones[2] ? e164(phones[2].number) : null,
    "Phone Types": phones.map((p) => p.type).join(", "),
  };
}

function contactSnapshot(rec: WaveRecord): Record<string, unknown> {
  const c = rec.contact;
  return {
    "Acq Owner ID": rec.owner_id,
    "Owner Type": c.owner_type,
    "Primary Property": c.primary_property,
    "Primary County": c.primary_county,
    "Primary Cohort": c.primary_cohort ?? "",
    "Asset Class": c.asset_class ?? undefined,
    "Property Count": c.property_count,
    "Lead Score": c.lead_score,
    Signals: c.signals,
    "Source List": c.source_list,
    "Lead Source": c.lead_source,
    Wave: rec.wave,
    "Pull Date": c.pull_date ?? undefined,
    "Skip Trace Provider": c.skip_trace_provider || undefined,
  };
}

function dialState(rec: WaveRecord): Record<string, unknown> {
  const c = rec.contact;
  return {
    ...phoneFields(c.phones),
    "Dial Lane": c.dial_lane,
    "Lane Reason": c.lane_reason,
    "Call Window ET": c.call_window_et,
    "Call Zones": c.call_zones,
    "DNC Scrub Date": c.dnc_scrub_date ?? undefined,
    "DNC Status": "Clear",
    "SMS Consent": "No consent",
  };
}

const ynu = (v: unknown) => (v === true ? "Yes" : v === false ? "No" : "Unknown");

export function propertyProperties(p: WaveProperty): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [PROPERTY_OBJECT.primary.key]: [p.address, p.city].filter(Boolean).join(", "),
  };
  const src: Record<string, unknown> = {
    "Acq Property ID": p.property_id,
    City: p.city,
    ZIP: p.zip,
    County: p.county,
    Municipality: p.municipality,
    APN: p.apn,
    Block: p.block,
    Lot: p.lot,
    "Asset Class": p.asset_class,
    "Property Type": p.property_type,
    Units: p.units,
    Beds: p.beds,
    Baths: p.baths,
    Sqft: p.sqft,
    Acres: p.acres,
    "Year Built": p.year_built,
    "Estimated Value": p.est_value,
    "Mortgage Estimate": p.mortgage_estimate,
    "Equity Pct": p.equity_pct,
    "Ownership Years": p.ownership_years,
    "Last Sale Date": p.last_sale_date,
    "Last Sale Price": p.last_sale_price,
    Vacant: ynu(p.vacant),
    Absentee: ynu(p.absentee),
    "Tax Delinquent": ynu(p.tax_delinquent),
    Preforeclosure: ynu(p.preforeclosure),
    Inherited: ynu(p.inherited),
    "Free And Clear": ynu(p.free_clear),
    "Code Violation": ynu(p.code_violation),
    "Wetlands Pct": p.wetlands_pct,
    "Flood Zone": p.flood_zone,
    "Flood Pct": p.flood_pct,
    "Road Frontage Ft": p.road_frontage_ft,
    Landlocked: ynu(p.landlocked),
    "Slope Pct": p.slope_pct,
    "MLS Status": p.mls_status,
    "Source Lists": p.cohorts,
    "Source Provider": p.providers,
    "Pull Date": p.pull_date,
    "Skip Trace Provider": p.skip_trace_provider,
    "Lead Score": p.lead_score,
    "Score Reasons": p.score_reasons,
    Signals: p.signals,
    "Property Status": "Active",
  };
  for (const [name, v] of Object.entries(src)) {
    if (v === null || v === undefined || v === "") continue;
    out[fieldKey(name)] = v;
  }
  return out;
}

async function upsertProperty(ghl: Ghl, r: Resolved, p: WaveProperty, contactId: string, ids: IdMap): Promise<string> {
  const props = propertyProperties(p);
  let id = ids.properties[p.property_id];
  if (!id) {
    const found = await ghl.searchRecords(PROPERTY_OBJECT.key, `acq_property_id:${p.property_id}`).catch(() => ({ records: [] }));
    id = found.records?.[0]?.id ?? "";
  }
  if (id) await ghl.updateRecord(PROPERTY_OBJECT.key, id, props);
  else id = (await ghl.createRecord(PROPERTY_OBJECT.key, props)).record.id;
  ids.properties[p.property_id] = id;
  if (r.associationId) {
    await ghl.relate(r.associationId, id, contactId).catch((e) => {
      if (!isConflict(e)) throw e;
    });
  }
  return id;
}

function pipelinesFor(props: { asset_class: string }[]): PipelineKey[] {
  const set = new Set<PipelineKey>(props.map((p) => (p.asset_class === "land" ? "land" : "residential")));
  return [...set];
}

export const OPP_ID_FIELD: Record<PipelineKey, string> = {
  residential: "Residential Opportunity ID",
  land: "Land Opportunity ID",
};

export async function ensureOpportunity(
  ghl: Ghl,
  r: Resolved,
  key: PipelineKey,
  contactId: string,
  existing: string | undefined,
  o: { name: string; propertyId: string | null; address: string; stage?: string; assignedTo?: string }
): Promise<{ id: string; created: boolean }> {
  if (existing) return { id: existing, created: false };
  const pipe = r.pipelines[key];
  if (!pipe) throw new Error(`pipeline "${PIPELINES[key].name}" missing — run npm run ghl:provision`);
  const stageId = pipe.stages.get(o.stage ?? PIPELINES[key].roles.new);
  const res = await ghl.createOpportunity({
    pipelineId: pipe.id,
    pipelineStageId: stageId,
    name: o.name,
    status: "open",
    contactId,
    ...(o.assignedTo ? { assignedTo: o.assignedTo } : {}),
    customFields: cf(r.opportunity, {
      "Primary Property ID": o.propertyId ?? "",
      "Property Address": o.address,
      "Deal Path": "Undecided",
      "Contract Status": "None",
    }),
  });
  return { id: res.opportunity.id, created: true };
}

export type PushResult = { contactId: string; newContact: boolean; properties: number; opportunitiesCreated: number; note?: string };

/**
 * Release one owner into GHL. Idempotent: re-pushing the same wave updates in
 * place (ids map + acq_property_id search). An owner who is ALREADY a GHL
 * contact (e.g. a web lead with SMS consent) keeps their consent, lane and
 * call history — only the property records and snapshot are added.
 */
export async function pushOwner(ghl: Ghl, r: Resolved, rec: WaveRecord, ids: IdMap, opts: { coldSmsDnd: boolean }): Promise<PushResult> {
  const c = rec.contact;
  if (rec.op !== "upsert") return applyPatch(ghl, r, rec, ids);
  if (!c.phones.length) throw new Error(`owner ${rec.owner_id}: no callable phone in an upsert record`);
  const entity = c.owner_type !== "Individual";
  const known = ids.owners[rec.owner_id];
  let contactId = known?.contactId;
  let isNew = false;
  let existing: GhlContact | null = null;
  if (!contactId) {
    const up = await ghl.upsertContact({
      firstName: entity ? "" : c.first_name,
      lastName: entity ? c.full_name : c.last_name,
      ...(entity ? { companyName: c.full_name } : {}),
      phone: e164(c.phones[0].number),
    });
    contactId = up.contact.id;
    isNew = up.new === true;
    if (!isNew) existing = (await ghl.getContact(contactId)).contact;
  }
  const existingFields = existing ? readFields(r, existing.customFields) : {};
  const keepDialState = Boolean(existing) && (existingFields["Dial Lane"] === "inbound" || existingFields["SMS Consent"] === "Web form consent");
  const values = { ...contactSnapshot(rec), ...(keepDialState ? {} : dialState(rec)) };
  await ghl.updateContact(contactId, {
    address1: c.mailing_address,
    city: c.mailing_city,
    state: c.mailing_state,
    postalCode: c.mailing_zip,
    ...(c.emails[0] && !existing ? { email: c.emails[0] } : {}),
    source: c.lead_source,
    ...(opts.coldSmsDnd && !keepDialState ? { dndSettings: { SMS: { status: "active", message: "No SMS consent (cold list)" } } } : {}),
    customFields: cf(r.contact, values),
  });
  const tags = [TAGS.cold, `acq:wave-${rec.wave.toLowerCase()}`];
  if (!keepDialState) tags.push(`lane:${c.dial_lane}`, TAGS.noSms);
  await ghl.addTags(contactId, tags);

  for (const p of rec.properties) await upsertProperty(ghl, r, p, contactId, ids);

  const opps: Partial<Record<PipelineKey, string>> = { ...(known?.opportunities ?? {}) };
  let created = 0;
  const name = c.full_name || `${c.first_name} ${c.last_name}`.trim();
  for (const key of pipelinesFor(rec.properties)) {
    const primary = rec.properties.find((p) => (p.asset_class === "land" ? "land" : "residential") === key)!;
    const prior = opps[key] || (existingFields[OPP_ID_FIELD[key]] as string | undefined) || undefined;
    const res = await ensureOpportunity(ghl, r, key, contactId, prior, {
      name: `${name} — ${primary.address}, ${primary.city}`,
      propertyId: primary.property_id,
      address: `${primary.address}, ${primary.city} ${primary.zip ?? ""}`.trim(),
    });
    opps[key] = res.id;
    if (res.created) {
      created++;
      await ghl.updateContact(contactId, { customFields: cf(r.contact, { [OPP_ID_FIELD[key]]: res.id }) });
    }
  }
  ids.owners[rec.owner_id] = { contactId, opportunities: opps };
  return {
    contactId,
    newContact: isNew,
    properties: rec.properties.length,
    opportunitiesCreated: created,
    note: keepDialState ? "existing consented contact — dial state preserved" : undefined,
  };
}

/** patch: phones/scrub/lane changed after a re-scrub. suppress: no callable phone left. */
async function applyPatch(ghl: Ghl, r: Resolved, rec: WaveRecord, ids: IdMap): Promise<PushResult> {
  const known = ids.owners[rec.owner_id];
  if (!known) throw new Error(`owner ${rec.owner_id}: not in ghl_ids.json — was the wave pushed from this machine?`);
  const c = rec.contact;
  if (rec.op === "patch") {
    await ghl.updateContact(known.contactId, {
      ...(c.phones[0] ? { phone: e164(c.phones[0].number) } : {}),
      customFields: cf(r.contact, {
        ...phoneFields(c.phones),
        "Dial Lane": c.dial_lane,
        "Lane Reason": c.lane_reason,
        "DNC Scrub Date": c.dnc_scrub_date ?? undefined,
      }),
    });
  } else {
    await ghl.updateContact(known.contactId, {
      customFields: cf(r.contact, {
        "Dial Lane": c.dial_lane === "power" || c.dial_lane === "manual" ? "mail_only" : c.dial_lane,
        "Lane Reason": c.lane_reason || "no callable phone after re-scrub",
        "Phone 2": null,
        "Phone 3": null,
      }),
    });
    await ghl.addTags(known.contactId, [`lane:${c.dial_lane}`]);
    for (const oppId of Object.values(known.opportunities)) {
      if (!oppId) continue;
      await ghl.updateOpportunity(oppId, {
        status: "abandoned",
        customFields: cf(r.opportunity, { "Lost Reason": "No callable phone" }),
      });
    }
  }
  return { contactId: known.contactId, newContact: false, properties: 0, opportunitiesCreated: 0, note: rec.op };
}

// -------------------------------------------------------------- web lead --
export type WebLead = { leadId: string; name: string; phone: string; address: string; reportUrl?: string };

/**
 * A HouseSoldNJ.com form lead: Contact (with the SMS-consent record) +
 * Property + Residential opportunity at "New / Ready to Call", tagged
 * acq:inbound so the speed-to-lead workflow and the Inbound Hot Queue pick it
 * up. A cold contact who fills the form becomes inbound (consent now exists).
 */
export async function pushWebLead(ghl: Ghl, lead: WebLead, opts: { ownerUserId?: string } = {}): Promise<{ contactId: string; opportunityId: string }> {
  const r = await resolve(ghl);
  const [first, ...rest] = lead.name.trim().split(/\s+/);
  const up = await ghl.upsertContact({ firstName: first, lastName: rest.join(" "), phone: e164(lead.phone) });
  const contactId = up.contact.id;
  const existing = up.new === true ? null : (await ghl.getContact(contactId)).contact;
  const fields = existing ? readFields(r, existing.customFields) : {};
  await ghl.updateContact(contactId, {
    source: "HouseSoldNJ Web",
    dndSettings: { SMS: { status: "inactive", message: "" } },
    customFields: cf(r.contact, {
      "SMS Consent": "Web form consent",
      "Consent Record": `housesoldnj lead ${lead.leadId}`,
      "Dial Lane": "inbound",
      "Lane Reason": "web form with call/text consent",
      "Call Window ET": "9a-8p ET",
      "Call Zones": "America/New_York",
      "Lead Source": fields["Lead Source"] ? undefined : "HouseSoldNJ Web",
      "Primary Property": fields["Primary Property"] ? undefined : lead.address,
      "Asset Class": fields["Asset Class"] ? undefined : "residential",
      "Property Count": fields["Property Count"] ? undefined : 1,
    }),
  });
  await ghl.removeTags(contactId, [TAGS.noSms]).catch(() => {});
  await ghl.addTags(contactId, [TAGS.inbound]);
  const propertyId = `web-${lead.leadId}`;
  const ids: IdMap = { owners: {}, properties: {} };
  await upsertProperty(ghl, r, { property_id: propertyId, address: lead.address.split(",")[0], city: lead.address.split(",")[1]?.trim() ?? "", asset_class: "residential", providers: "HouseSoldNJ Web" }, contactId, ids).catch((e) => {
    // The Property object is created in the UI; until it exists the lead still lands.
    console.warn(`GHL property record skipped for web lead ${lead.leadId}: ${String(e)}`);
  });
  const opp = await ensureOpportunity(ghl, r, "residential", contactId, (fields[OPP_ID_FIELD.residential] as string) || undefined, {
    name: `${lead.name} — ${lead.address} (web)`,
    propertyId,
    address: lead.address,
    assignedTo: opts.ownerUserId,
  });
  if (opp.created) {
    await ghl.updateContact(contactId, { customFields: cf(r.contact, { [OPP_ID_FIELD.residential]: opp.id }) });
  } else {
    await ghl.addNote(contactId, `Submitted the HouseSoldNJ.com form (lead ${lead.leadId}) for ${lead.address}.`);
  }
  if (lead.reportUrl) {
    await ghl.updateOpportunity(opp.id, { customFields: cf(r.opportunity, { "Report URL": lead.reportUrl }) }).catch(() => {});
  }
  return { contactId, opportunityId: opp.id };
}

const TIMELINE_MAP: Record<string, string> = {
  ASAP: "ASAP (under 30 days)",
  "1–3 months": "1-3 months",
  "3+ months": "3-6 months",
  "Just curious": "Just exploring",
};
const OCCUPANCY_MAP: Record<string, string> = { "I live there": "Owner-occupied", "Tenant-occupied": "Tenant-occupied", Vacant: "Vacant" };

/** Thank-you page answers -> the web lead's opportunity fields + a note. */
export async function pushWebLeadDetails(ghl: Ghl, lead: { name: string; phone: string; leadId: string }, answers: Record<string, string>): Promise<void> {
  const r = await resolve(ghl);
  const [first, ...rest] = lead.name.trim().split(/\s+/);
  const up = await ghl.upsertContact({ firstName: first, lastName: rest.join(" "), phone: e164(lead.phone) });
  const contactId = up.contact.id;
  const contact = (await ghl.getContact(contactId)).contact;
  const oppId = readFields(r, contact.customFields)[OPP_ID_FIELD.residential] as string | undefined;
  await ghl.addNote(contactId, `Seller's answers on the thank-you page (lead ${lead.leadId}):\n${Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join("\n")}`);
  if (!oppId) return;
  await ghl.updateOpportunity(oppId, {
    customFields: cf(r.opportunity, {
      "Seller Timeline": answers.timeline ? TIMELINE_MAP[answers.timeline] : undefined,
      "Property Condition": answers.condition || undefined,
      Occupancy: answers.occupancy ? OCCUPANCY_MAP[answers.occupancy] : undefined,
    }),
  });
}
