/**
 * GHL record operations built on the schema: resolve field/pipeline ids by
 * name, push a released owner (contact + property records + association +
 * opportunity), apply phone/lane patches, and push a web lead.
 */
import { cfValue, Ghl, GhlError, type CustomFieldValue, type GhlContact, type GhlField, type GhlObjectField } from "./ghl";
import {
  COHORT_LABELS,
  CONTACT_FIELDS,
  CONTACT_PROPERTY_ASSOCIATION,
  fieldKey,
  OPPORTUNITY_FIELDS,
  PIPELINES,
  PROPERTY_OBJECT,
  STAGE_ALIASES,
  TAGS,
  type FieldDef,
  type PipelineKey,
  type PropField,
} from "./schema";

/** A live Property-object field: the bare key records use, its type and options. */
export type ObjField = { name: string; key: string; dataType: string; options: { key?: string; label: string }[] };

export type Resolved = {
  contact: Map<string, string>;
  opportunity: Map<string, string>;
  idToName: Map<string, string>;
  pipelines: Partial<Record<PipelineKey, { id: string; stages: Map<string, string>; stageNames: Map<string, string> }>>;
  associationId: string | null;
  /** live key of the Property custom object (null = not found) */
  propertyKey: string | null;
  /** PropField id -> live field */
  propertyFields: Map<string, ObjField>;
  missing: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Canonical stage name -> the live stage, ignoring spacing/punctuation, plus aliases. */
export function matchStages(key: PipelineKey, live: { id: string; name: string }[]) {
  const stages = new Map<string, string>();
  const stageNames = new Map<string, string>();
  const missing: string[] = [];
  for (const s of PIPELINES[key].stages) {
    const wants = [s, ...(STAGE_ALIASES[s] ?? [])].map(norm);
    const hit = live.find((t) => norm(t.name) === wants[0]) ?? live.find((t) => wants.includes(norm(t.name)));
    if (hit && !stageNames.has(hit.id)) {
      stages.set(s, hit.id);
      stageNames.set(hit.id, s);
    } else missing.push(s);
  }
  return { stages, stageNames, missing };
}

const bare = (k: string) => k.split(".").pop() ?? k;

function objOptions(f: GhlObjectField): ObjField["options"] {
  return (f.options ?? []).map((o) => (typeof o === "string" ? { label: o } : { key: o.key, label: o.label ?? o.key ?? "" }));
}

/** PropField id -> live field, matched by label then aliases (never by our own key guess). */
export function matchPropertyFields(live: GhlObjectField[], defs: readonly PropField[] = [{ ...PROPERTY_OBJECT.primary, type: "TEXT", tier: "core" }, ...PROPERTY_OBJECT.fields]) {
  const map = new Map<string, ObjField>();
  const missing: PropField[] = [];
  for (const d of defs) {
    const names = [d.name, ...(d.aliases ?? [])].map(norm);
    const f =
      live.find((x) => norm(x.name) === names[0]) ??
      live.find((x) => names.includes(norm(x.name))) ??
      live.find((x) => bare(x.fieldKey) === fieldKey(d.name));
    if (f) map.set(d.id, { name: f.name, key: bare(f.fieldKey), dataType: (f.dataType ?? "TEXT").toUpperCase(), options: objOptions(f) });
    else missing.push(d);
  }
  return { map, missing };
}

/** The Property object's live key: env override, else the object labelled "Property", else the default. */
export async function findPropertyObject(ghl: Ghl): Promise<{ key: string | null; fields: GhlObjectField[]; folders: { id: string; name: string }[] }> {
  const candidates = [process.env.GHL_PROPERTY_OBJECT_KEY].filter(Boolean) as string[];
  if (!candidates.length) {
    const objs = await ghl.listObjects().catch(() => []);
    const hit = objs.find((o) => norm(o.labels?.singular ?? "") === norm(PROPERTY_OBJECT.singular) || norm(o.labels?.plural ?? "") === norm(PROPERTY_OBJECT.plural));
    if (hit) candidates.push(hit.key);
    candidates.push(PROPERTY_OBJECT.key, "custom_objects.properties");
  }
  for (const key of [...new Set(candidates)]) {
    const r = await ghl.listObjectFields(key).catch(() => null);
    if (r && (r.fields?.length || r.folders?.length)) return { key, fields: r.fields ?? [], folders: r.folders ?? [] };
  }
  return { key: null, fields: [], folders: [] };
}

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
  const [cFields, oFields, pipes, assoc, prop] = await Promise.all([
    ghl.listFields("contact"),
    ghl.listFields("opportunity"),
    ghl.listPipelines(),
    ghl.listAssociations().catch(() => ({ associations: [] })),
    findPropertyObject(ghl),
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
    const m = matchStages(key, p.stages);
    for (const s of m.missing) missing.push(`stage: ${PIPELINES[key].name} / ${s}`);
    pipelines[key] = { id: p.id, stages: m.stages, stageNames: m.stageNames };
  }
  const pk = prop.key;
  const pf = matchPropertyFields(prop.fields);
  if (!pk) missing.push(`custom object: ${PROPERTY_OBJECT.singular}`);
  else for (const d of pf.missing) if (d.tier !== "extra") missing.push(`property field (${d.tier}): ${d.name}`);
  const a = (assoc.associations ?? []).find(
    (x) =>
      x.key === CONTACT_PROPERTY_ASSOCIATION.key ||
      (pk !== null && [x.firstObjectKey, x.secondObjectKey].includes(pk) && [x.firstObjectKey, x.secondObjectKey].includes("contact"))
  );
  if (!a) missing.push(`association: contact <-> ${pk ?? PROPERTY_OBJECT.key}`);
  const r: Resolved = {
    contact: c.map,
    opportunity: o.map,
    idToName,
    pipelines,
    associationId: a?.id ?? null,
    propertyKey: pk,
    propertyFields: pk ? pf.map : new Map(),
    missing,
  };
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

/** What the pipeline knows about a property, keyed by PropField id. */
export function propertyValues(p: WaveProperty): Record<string, unknown> {
  const cohorts = String(p.cohorts ?? "").split(";").filter(Boolean);
  const floodZone = String(p.flood_zone ?? "").trim().toUpperCase();
  const flood =
    floodZone || p.flood_pct != null
      ? /^(A|V)/.test(floodZone) || Number(p.flood_pct ?? 0) > 0
      : null;
  const occupancy = p.vacant === true
    ? ["Vacant"]
    : p.owner_occupied === true
      ? ["Owner-occupied", "Owner Occupied", "Owner"]
      : p.absentee === true
        ? ["Tenant-occupied", "Tenant Occupied", "Tenant", "Non-owner", "Rented", "Absentee"]
        : ["Unknown"];
  return {
    address: [p.address, p.city].filter(Boolean).join(", "),
    acq_property_id: p.property_id,
    county: p.county,
    // the vendor's postal city stands in when no municipality is supplied
    municipality: p.municipality || p.city,
    zip: p.zip,
    block: p.block,
    lot: p.lot,
    apn: p.apn,
    asset_class: p.asset_class === "land" ? ["Vacant Land", "Land", "Vacant"] : ["Residential", "Home"],
    property_type: p.property_type,
    occupancy,
    est_value: p.est_value,
    mortgage_estimate: p.mortgage_estimate,
    equity_pct: p.equity_pct,
    acres: p.acres,
    ownership_years: p.ownership_years,
    wetlands_pct: p.wetlands_pct,
    road_frontage_ft: p.road_frontage_ft,
    vacant: p.vacant,
    absentee: p.absentee,
    tax_delinquent: p.tax_delinquent,
    preforeclosure: p.preforeclosure,
    inherited: p.inherited,
    free_clear: p.free_clear,
    flood,
    source_provider: p.providers,
    original_list: cohorts.map((c) => COHORT_LABELS[c] ?? c).join("; ") || undefined,
    pull_date: p.pull_date,
    skip_trace_provider: p.skip_trace_provider,
    lead_score: p.lead_score,
    signals: p.signals,
    last_sale_date: p.last_sale_date,
    last_sale_price: p.last_sale_price,
    beds: p.beds,
    baths: p.baths,
    sqft: p.sqft,
    year_built: p.year_built,
    units: p.units,
    mls_status: p.mls_status,
    landlocked: p.landlocked,
    slope_pct: p.slope_pct,
    flood_zone: p.flood_zone,
  };
}

/** Converts a value to the live field's type. undefined = skip (never guess). */
export function toFieldValue(f: ObjField, v: unknown): unknown {
  if (v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) return undefined;
  const pick = (cands: string[]) => {
    for (const c of cands) {
      const o = f.options.find((x) => norm(x.label) === norm(c) || (x.key && norm(x.key) === norm(c)));
      if (o) return o.key ?? o.label;
    }
    return undefined;
  };
  const num = () => {
    const n = typeof v === "number" ? v : Number(String(v).replace(/[$,%\s]/g, ""));
    return typeof v === "boolean" || !Number.isFinite(n) ? undefined : n;
  };
  switch (f.dataType) {
    case "CHECKBOX": {
      if (typeof v !== "boolean") return undefined;
      if (!v) return undefined;
      const o = f.options[0];
      return [o ? (o.key ?? o.label) : "Yes"];
    }
    case "SINGLE_OPTIONS":
    case "RADIO": {
      const cands = Array.isArray(v) ? v.map(String) : typeof v === "boolean" ? [v ? "Yes" : "No"] : [String(v)];
      return pick(cands);
    }
    case "MULTIPLE_OPTIONS": {
      const cands = Array.isArray(v) ? v.map(String) : [String(v)];
      const hit = pick(cands);
      return hit === undefined ? undefined : [hit];
    }
    case "NUMERICAL":
      return num();
    case "MONETORY": {
      const n = num();
      return n === undefined ? undefined : { currency: "default", value: n };
    }
    case "DATE":
      return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : undefined;
    default:
      if (typeof v === "boolean") return v ? "Yes" : "No";
      return Array.isArray(v) ? String(v[0]) : String(v);
  }
}

/** Record `properties` for the live Property object: only fields that exist, in their types. */
export function propertyProperties(p: WaveProperty, r: Pick<Resolved, "propertyFields">): Record<string, unknown> {
  const vals = propertyValues(p);
  const out: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(vals)) {
    const f = r.propertyFields.get(id);
    if (!f) continue;
    const conv = toFieldValue(f, v);
    if (conv !== undefined) out[f.key] = conv;
  }
  return out;
}

const TEXTY = new Set(["TEXT", "LARGE_TEXT"]);

async function upsertProperty(ghl: Ghl, r: Resolved, p: WaveProperty, contactId: string, ids: IdMap, warnings: string[] = []): Promise<string | null> {
  const key = r.propertyKey;
  if (!key) return null;
  const props = propertyProperties(p, r);
  let id = ids.properties[p.property_id];
  const idField = r.propertyFields.get("acq_property_id");
  if (!id && idField) {
    const found = await ghl.searchRecords(key, `${idField.key}:${p.property_id}`).catch(() => ({ records: [] }));
    id = found.records?.[0]?.id ?? "";
  }
  const write = async (body: Record<string, unknown>) =>
    id ? (await ghl.updateRecord(key, id, body), id) : (await ghl.createRecord(key, body)).record.id;
  try {
    id = await write(props);
  } catch (e) {
    if (!(e instanceof GhlError) || e.status >= 500) throw e;
    // A value GHL rejects (option label, money shape…) must not lose the record:
    // retry with text fields only and report what was dropped.
    const textOnly = Object.fromEntries(
      [...r.propertyFields.values()].filter((f) => TEXTY.has(f.dataType) && f.key in props).map((f) => [f.key, props[f.key]])
    );
    id = await write(textOnly);
    warnings.push(`property ${p.property_id}: GHL rejected typed fields (${e.body.slice(0, 120)}); saved text fields only`);
  }
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

export type PushResult = { contactId: string; newContact: boolean; properties: number; opportunitiesCreated: number; note?: string; warnings?: string[] };

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

  const warnings: string[] = [];
  if (!r.propertyKey) warnings.push("no Property custom object found — property records skipped");
  for (const p of rec.properties) await upsertProperty(ghl, r, p, contactId, ids, warnings);

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
    ...(warnings.length ? { warnings } : {}),
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
        customFields: cf(r.opportunity, { "Close Reason": "No callable phone" }),
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
