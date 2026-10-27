/**
 * The CALL BRIEF note: what the caller sees on the contact card in WAVV
 * while the line rings. Read top to bottom in about ten seconds — who to ask
 * for, the compliant opener, the property, the angle, what happened on
 * earlier dials, then the answers to the questions owners actually ask.
 *
 * Deliberately has NO dollar figures (value, equity, sale price) and no
 * tax/lien/foreclosure wording — callers never quote numbers or raise how
 * the list was built. Sumeet sees the numbers on the Property record.
 *
 * Two writers: the wave push (whole brief) and the call processor (only the
 * HISTORY block, rewritten after every dial so the next caller knows what
 * the last one heard).
 */
import { site } from "@/config/site";
import type { Ghl } from "./ghl";
import { DISPOSITIONS, type DispositionKey } from "./schema";
import type { WaveProperty, WaveRecord } from "./sync";

export const CALL_BRIEF_MARKER = "CALL BRIEF";
const HISTORY_MARKER = "HISTORY";

export const titleCase = (s: string) =>
  s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_m, d, x) => d + x.toLowerCase());

const SUFFIX = /\b(STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|COURT|CT|PLACE|PL|BOULEVARD|BLVD|TERRACE|TER|CIRCLE|CIR|WAY|PARKWAY|PKWY|HIGHWAY|HWY)\b/g;
/** "1301 1st Ave." and "1301 FIRST AVENUE" don't match, but "1301 1ST AVE" variants do. */
export const streetMatchKey = (s: string | null | undefined) =>
  String(s ?? "").toUpperCase().split(",")[0].replace(/[^A-Z0-9 ]/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();

const yes = (v: unknown) => v === true;
const n = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Short, spoken-style property type: "single family", "2-family", "condo", "land". */
function typeLabel(p: WaveProperty): string | null {
  if (p.asset_class === "land") return "land";
  const units = n(p.units);
  if (units && units >= 2) return `${units}-family`;
  const t = String(p.property_type ?? "").toLowerCase();
  if (!t) return null;
  if (/condo|townho|co-?op/.test(t)) return /townho/.test(t) ? "townhouse" : "condo";
  if (/multi|duplex|two|2 ?fam/.test(t)) return "multi-family";
  if (/mobile|manufactured/.test(t)) return "mobile home";
  if (/single|sfr|detached|residential/.test(t)) return "single family";
  return null;
}

function yearsOwned(p: WaveProperty, now: Date): { years: number; since: string } | null {
  const d = typeof p.last_sale_date === "string" ? Date.parse(p.last_sale_date) : Number.NaN;
  if (Number.isFinite(d)) {
    const years = Math.floor((now.getTime() - d) / (365.25 * 86_400_000));
    return years >= 1 ? { years, since: String(p.last_sale_date).slice(0, 4) } : null;
  }
  const yrs = n(p.ownership_years);
  return yrs && yrs >= 1 ? { years: Math.round(yrs), since: "" } : null;
}

/**
 * Where the owner lives relative to the property: the same house, another
 * house they own (common — "absentee" owners often live down the street),
 * or somewhere else.
 */
function occupancyLine(rec: WaveRecord, p: WaveProperty, street: string): string | null {
  const c = rec.contact;
  const home = streetMatchKey(c.mailing_address);
  if (yes(p.vacant)) return `OCCUPANCY: may be empty — ask: "Is anyone living there right now?"`;
  if (home && home === streetMatchKey(String(p.address))) return "OCCUPANCY: owner appears to live there.";
  const other = rec.properties.find((x) => x !== p && home && streetMatchKey(String(x.address)) === home);
  if (other) return `OCCUPANCY: owner lives at ${titleCase(String(other.address))} (another of theirs) — ask who's living at ${street} now.`;
  if (yes(p.absentee) || p.owner_occupied === false) {
    const where = [titleCase(c.mailing_city ?? ""), c.mailing_state ?? ""].filter(Boolean).join(", ");
    return `OCCUPANCY: owner lives elsewhere${where ? ` (${where})` : ""} — ask who's living there now.`;
  }
  if (yes(p.owner_occupied)) return "OCCUPANCY: owner appears to live there.";
  return null;
}

/**
 * One or two conversation angles from what the list says about the
 * situation. Only things an owner would expect a local buyer to notice —
 * never the tax/lien/foreclosure flags.
 */
function angles(rec: WaveRecord, p: WaveProperty, owned: { years: number } | null): string[] {
  const c = rec.contact;
  const out: string[] = [];
  const outOfState = c.mailing_state && c.mailing_state.toUpperCase() !== "NJ";
  if (p.asset_class === "land") out.push("land — ask what they'd planned for it, road access, utilities, any survey or perc test.");
  if (yes(p.inherited)) out.push("may be a family/estate property — go gently, and ask who else has a say.");
  if (yes(p.vacant)) out.push("likely empty — ask what the plan is for it and what upkeep is costing them in time.");
  else if (p.asset_class !== "land" && (yes(p.absentee) || p.owner_occupied === false)) {
    out.push(outOfState ? `owner is out of state (${c.mailing_state}) — managing from a distance is usually the pain point.` : "likely a rental — ask how renting it has been (tenants, repairs, management).");
  }
  if (rec.properties.length > 1) out.push(`owns ${rec.properties.length} properties — ask if they'd consider selling more than one.`);
  if (owned && owned.years >= 15 && out.length < 2) out.push(`owned ${owned.years}+ years — "You've had it a while; what has you thinking about it now?"`);
  return out.slice(0, 2);
}

const callbackNumber = () => process.env.ACQ_CALLBACK_NUMBER?.trim() || site.phone.display;

export function callBrief(rec: WaveRecord, now = new Date()): string {
  const c = rec.contact;
  const props = rec.properties;
  const p = props.find((x) => x.property_id === rec.primary_property_id) ?? props[0];
  const street = p ? titleCase(String(p.address)) : titleCase(c.primary_property ?? "");
  const where = p ? `${street}, ${titleCase(String(p.city ?? ""))} ${p.zip ?? ""}`.trim() + (p.county ? ` (${titleCase(String(p.county))} County)` : "") : street;
  const entity = c.owner_type !== "Individual";
  const first = titleCase(c.first_name || c.full_name);
  const greet = entity ? `Hi, may I speak with whoever handles the property for ${c.full_name}?` : `Hi, is this ${first}?`;
  const owner2 = String(c.owner2 ?? "").trim();
  const full = titleCase(c.full_name || first);
  const askFor = entity
    ? `ASK FOR: whoever handles ${c.full_name}'s properties (owner, manager, member).`
    : full !== first || owner2
      ? `ASK FOR: ${full}${owner2 ? ` · co-owner ${titleCase(owner2)} is also a decision maker` : ""}`
      : null;
  const lines = [
    `${CALL_BRIEF_MARKER} — ${where}`,
    ...(askFor ? [askFor] : []),
    `OPENER: "${greet} This is ___ calling from HouseSoldNJ — we're local real estate investors, and our calls are recorded. I'm calling about ${street} — is that still yours?"`,
    "",
  ];
  const owned = p ? yearsOwned(p, now) : null;
  if (p) {
    const facts: string[] = [];
    const type = typeLabel(p);
    if (type) facts.push(type);
    if (p.beds) facts.push(`${p.beds} bd`);
    if (p.baths) facts.push(`${p.baths} ba`);
    if (p.sqft) facts.push(`${Math.round(Number(p.sqft)).toLocaleString("en-US")} sqft`);
    if (p.acres && (p.asset_class === "land" || Number(p.acres) >= 1)) facts.push(`${Number(p.acres).toFixed(Number(p.acres) < 10 ? 2 : 0)} acres`);
    if (p.year_built) facts.push(`built ${Math.round(Number(p.year_built))}`);
    if (owned) facts.push(`owned ~${owned.years} yrs${owned.since ? ` (since ${owned.since})` : ""}`);
    if (facts.length) lines.push(`PROPERTY: ${facts.join(" · ")}`);
    const occ = occupancyLine(rec, p, street);
    if (occ) lines.push(occ);
  }
  if (props.length > 1) {
    const others = props.filter((x) => x !== p).map((x) => titleCase(`${x.address}, ${x.city ?? ""}`));
    lines.push(`ALSO OWNS: ${others.slice(0, 5).join("; ")}${others.length > 5 ? ` (+${others.length - 5} more)` : ""}`);
  }
  if (p) for (const a of angles(rec, p, owned)) lines.push(`ANGLE: ${a}`);
  lines.push(
    "",
    "COVER: confirm owner → what's got them thinking about it → condition/repairs → timeline → who lives there → other decision makers → roughly what they'd need → book Sumeet or a dated callback.",
    `IF ASKED — "How'd you get my number?" → "We work from public property records and a data provider." (want it stopped → DNC) · "What's it worth / what would you pay?" → "Sumeet will go over real numbers with you himself." · "Are you agents?" → "Yes — Sumeet Sancheti, who owns HouseSoldNJ, is a licensed agent. We also buy directly, and he'll walk you through every option."`,
    "END POLITELY IF: listed with an agent (thank them → Already Listed) · owner passed (condolences, ask who handles the estate → Wrong Owner + note) · tenant, minor or confused person (ask for the owner, don't qualify).",
    `VOICEMAIL (live, your own voice): "Hi, this is ___ calling from HouseSoldNJ, about ${street}. You can reach us at ${callbackNumber()}. Thank you."`,
    "NEVER: a price, value, offer or range · back taxes, liens or how we found them · keep going after \"stop calling\" (→ DNC).",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------- call history --
export type BriefCall = {
  startedAt: string | null;
  dispositionKey: string | null;
  disposition: string | null;
  seconds: number | null;
  note: string | null;
  /** AI review of the call, when it has run. */
  summary?: string | null;
  callback?: string | null;
};

const etStamp = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(iso))
    .replace(/:00(?= ?[AP]M)/, "")
    .replace(" AM", "a")
    .replace(" PM", "p");

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const mins = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

/** The HISTORY block for the brief: dial count, then the latest touches, newest first. */
export function historyBlock(calls: BriefCall[], total = calls.length): string {
  if (!calls.length) return "";
  const head = `${HISTORY_MARKER} (${total} dial${total === 1 ? "" : "s"} so far):`;
  const rows = calls.slice(0, 4).map((k) => {
    const label = k.dispositionKey && k.dispositionKey in DISPOSITIONS ? DISPOSITIONS[k.dispositionKey as DispositionKey].label : k.disposition || "No disposition";
    const talk = (k.seconds ?? 0) >= 30 ? ` (${mins(k.seconds!)})` : "";
    const said = k.summary?.trim() || k.note?.trim();
    const cb = k.callback?.trim() ? ` · callback asked: ${clip(k.callback.trim(), 60)}` : "";
    return `• ${k.startedAt ? etStamp(k.startedAt) : "?"} — ${label}${talk}${said ? `: ${clip(said.replace(/\s+/g, " "), 160)}` : ""}${cb}`;
  });
  return [head, ...rows].join("\n");
}

/** GHL may hand a note back as HTML; compare and edit it as plain text. */
export function noteText(body: string | undefined | null): string {
  return String(body ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits a brief into its static part and its HISTORY block. */
function splitHistory(text: string): { base: string[]; history: string } {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`${HISTORY_MARKER} (`));
  if (at < 0) return { base: lines, history: "" };
  let end = at + 1;
  while (end < lines.length && lines[end].startsWith("• ")) end++;
  const history = lines.slice(at, end).join("\n");
  const base = [...lines.slice(0, at), ...lines.slice(end)];
  // Drop the blank line the block was framed by.
  if (base[at] === "" && base[at - 1] === "") base.splice(at, 1);
  return { base, history };
}

/** The brief with `history` in place of any earlier HISTORY block (just above COVER). */
export function withHistory(brief: string, history: string): string {
  const { base } = splitHistory(noteText(brief));
  if (!history) return base.join("\n");
  const cover = base.findIndex((l) => l.startsWith("COVER:"));
  const at = cover < 0 ? base.length : cover;
  return [...base.slice(0, at), history, "", ...base.slice(at)].join("\n");
}

const isBrief = (body: string | undefined) => noteText(body).startsWith(CALL_BRIEF_MARKER);

/**
 * Adds the call brief, or rewrites it when the script/facts changed — the
 * HISTORY block the call processor maintains is carried over. Safe to re-run.
 */
export async function ensureCallBrief(ghl: Ghl, contactId: string, rec: WaveRecord): Promise<"added" | "updated" | "kept"> {
  const fresh = callBrief(rec);
  const mine = (await ghl.listNotes(contactId)).filter((x) => isBrief(x.body));
  if (!mine.length) {
    await ghl.addNote(contactId, fresh);
    return "added";
  }
  let changed = false;
  for (const note of mine) {
    const body = withHistory(fresh, splitHistory(noteText(note.body)).history);
    if (noteText(note.body) === body) continue;
    await ghl.updateNote(contactId, note.id, body);
    changed = true;
  }
  return changed ? "updated" : "kept";
}

/**
 * Rewrites the HISTORY block of the contact's brief. No brief (web leads,
 * manual dials) -> nothing to do. Never throws past the caller's catch.
 */
export async function refreshBriefHistory(ghl: Ghl, contactId: string, calls: BriefCall[], total?: number): Promise<"updated" | "kept" | "no_brief"> {
  const note = (await ghl.listNotes(contactId)).find((x) => isBrief(x.body));
  if (!note) return "no_brief";
  const body = withHistory(note.body ?? "", historyBlock(calls, total));
  if (body === noteText(note.body)) return "kept";
  await ghl.updateNote(contactId, note.id, body);
  return "updated";
}
