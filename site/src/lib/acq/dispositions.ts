/**
 * Disposition engine — pure. Given one finished call, the contact's dial
 * state and the open opportunity, decide every state change. The processor
 * applies the plan to GHL; tests drive this directly.
 *
 * Rules worth knowing:
 *  - DNC overrides everything, for the PERSON (all their numbers), forever.
 *  - Automation never moves a card backwards and never closes a deal that is
 *    past "Consultation Booked" — past that point Sum gets a task instead.
 *  - Qualified Warm/Hot require the qualification fields; GHL only enforces
 *    that in its UI, so an API move re-checks. Missing fields -> the card
 *    goes to Contacted + qa:missing-fields + a 10-minute task for the caller.
 *    A hot seller still alerts Sum immediately — paperwork never delays money.
 *  - Cadence: ≤1 attempt per contact per day (inside every state's 3-per-24h
 *    cap), gaps 1,1,2,3,7,7,9 days -> 8 attempts over ~30 days, then the
 *    contact recycles for 90 days. Sundays roll to Monday.
 */
import { DISPOSITIONS, PIPELINES, QUALIFICATION_FIELDS, TAGS, stageIndex, type DispositionKey, type PipelineKey, type StageRole } from "./schema";

export const CADENCE_GAPS_DAYS = [1, 1, 2, 3, 7, 7, 9] as const;
export const MAX_ATTEMPTS = 8;
export const RECYCLE_DAYS = { unreachable: 90, notInterested: 180, listed: 90 } as const;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const SYNONYMS: Record<string, DispositionKey> = {
  noanswer: "NO_ANSWER",
  busy: "NO_ANSWER",
  none: "NO_ANSWER",
  wavvnone: "NO_ANSWER",
  voicemail: "VOICEMAIL",
  voicemessage: "VOICEMAIL",
  leftvoicemail: "VOICEMAIL",
  wrongnumber: "WRONG_NUMBER",
  badnumber: "WRONG_NUMBER",
  disconnected: "WRONG_NUMBER",
  dnc: "DNC",
  donotcall: "DNC",
  notinterested: "NOT_INTERESTED",
  callbackrequested: "CALLBACK",
  callback: "CALLBACK",
  warmlead: "WARM",
  warm: "WARM",
  hotlead: "HOT",
  hot: "HOT",
  appointmentbooked: "BOOKED",
  appointment: "BOOKED",
  booked: "BOOKED",
  alreadylisted: "LISTED",
  listed: "LISTED",
  propertysold: "SOLD",
  sold: "SOLD",
  wrongowner: "WRONG_OWNER",
};

/** WAVV's free-text disposition (or, if none was chosen, its outcome) -> one of the 12. */
export function dispositionKey(label: string | null | undefined, outcome?: string | null): DispositionKey {
  const n = norm(label ?? "");
  for (const [k, v] of Object.entries(DISPOSITIONS)) if (norm(v.label) === n) return k as DispositionKey;
  if (SYNONYMS[n]) return SYNONYMS[n];
  const o = norm(outcome ?? "");
  if (o.startsWith("voicemail") || o === "novoicemail") return "VOICEMAIL";
  return "NO_ANSWER";
}

export type ContactState = {
  lane: string;
  attempts: number;
  conversations: number;
  /** callable numbers, primary first (10 digits) */
  phones: string[];
  invalidPhones: string[];
  propertyCount: number;
  primaryPropertyId?: string | null;
};

export type OppState = {
  id: string;
  pipeline: PipelineKey;
  stage: string;
  status: string;
  fields: Record<string, unknown>;
} | null;

export type CallFacts = { at: Date; human: boolean | null; seconds: number; dialed: string | null; userId?: string | null };

export type PlannedTask = { title: string; body: string; due: Date; assignTo: "caller" | "owner" };

export type Plan = {
  key: DispositionKey;
  label: string;
  conversation: boolean;
  contactFields: Record<string, unknown>;
  primaryPhone?: string;
  tagsAdd: string[];
  tagsRemove: string[];
  dndAll: boolean;
  suppress: { kind: "phone" | "contact" | "property"; value: string; reason: string }[];
  opp: { stageRole?: StageRole; status?: "lost" | "abandoned"; fields: Record<string, unknown>; assignToOwner: boolean } | null;
  tasks: PlannedTask[];
  notify: { level: "hot" | "booked" | "warm"; text: string } | null;
  hotReport: boolean;
  notes: string[];
};

const DAY = 86_400_000;
export const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from.getTime() + days * DAY);
  if (d.getUTCDay() === 0) return new Date(d.getTime() + DAY); // no Sunday dialing
  return d;
}

export function nextCallDue(attemptsAfter: number, now: Date): Date | null {
  if (attemptsAfter >= MAX_ATTEMPTS) return null;
  const gap = CADENCE_GAPS_DAYS[Math.min(Math.max(attemptsAfter - 1, 0), CADENCE_GAPS_DAYS.length - 1)];
  return addBusinessDays(now, gap);
}

export function missingQualification(fields: Record<string, unknown>): string[] {
  return QUALIFICATION_FIELDS.filter((f) => {
    const v = fields[f];
    return v === undefined || v === null || String(v).trim() === "" || (Array.isArray(v) && !v.length);
  });
}

/** True when automation may change this card's stage or status. */
export function automatable(opp: NonNullable<OppState>): boolean {
  if (opp.status !== "open") return false;
  const booked = stageIndex(opp.pipeline, PIPELINES[opp.pipeline].roles.booked);
  const at = stageIndex(opp.pipeline, opp.stage);
  return at === -1 || at <= booked;
}

/** Forward-only stage target: undefined when the card is already at/after it. */
export function forward(opp: NonNullable<OppState>, role: StageRole): StageRole | undefined {
  const target = stageIndex(opp.pipeline, PIPELINES[opp.pipeline].roles[role]);
  const at = stageIndex(opp.pipeline, opp.stage);
  return target > at ? role : undefined;
}

function dateField(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(typeof v === "number" ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function planDisposition(key: DispositionKey, call: CallFacts, c: ContactState, opp: OppState, now = call.at): Plan {
  const label = DISPOSITIONS[key].label;
  const attempts = c.attempts + 1;
  const LIVE: DispositionKey[] = ["NOT_INTERESTED", "CALLBACK", "WARM", "HOT", "BOOKED", "LISTED", "SOLD", "DNC"];
  const conversation = LIVE.includes(key) || (call.human === true && call.seconds >= 60 && !["NO_ANSWER", "VOICEMAIL", "WRONG_NUMBER", "WRONG_OWNER"].includes(key));
  const plan: Plan = {
    key,
    label,
    conversation,
    contactFields: {
      "Call Attempts": attempts,
      "Last Call Date": ymd(now),
      "Last Disposition": label,
      ...(conversation ? { Conversations: c.conversations + 1, "Last Successful Contact": ymd(now) } : {}),
    },
    tagsAdd: [],
    tagsRemove: [],
    dndAll: false,
    suppress: [],
    opp: opp ? { fields: {}, assignToOwner: false } : null,
    tasks: [],
    notify: null,
    hotReport: false,
    notes: [],
  };
  const canAuto = opp ? automatable(opp) : false;
  const stage = (role: StageRole) => {
    if (opp && plan.opp && canAuto) {
      const f = forward(opp, role);
      if (f) plan.opp.stageRole = f;
    }
  };
  const close = (status: "lost" | "abandoned", reason: string) => {
    if (!opp || !plan.opp) return;
    if (canAuto) {
      plan.opp.status = status;
      plan.opp.fields["Lost Reason"] = reason;
    } else {
      plan.tasks.push({
        title: `Review: "${label}" on a deal past consultation`,
        body: `Automation left the deal open (stage "${opp.stage}"). Decide by hand.`,
        due: new Date(now.getTime() + 60 * 60_000),
        assignTo: "owner",
      });
    }
  };
  const setLane = (lane: string, reason: string) => {
    plan.contactFields["Dial Lane"] = lane;
    plan.contactFields["Lane Reason"] = reason;
  };
  const due = (d: Date | null) => {
    plan.contactFields["Next Call Due"] = d ? ymd(d) : null;
  };
  const rotateOut = (number: string | null, why: string): string[] => {
    const remaining = c.phones.filter((p) => p !== number);
    if (number && c.phones.includes(number)) {
      plan.contactFields["Invalid Phones"] = [...c.invalidPhones, `${number} (${why} ${ymd(now)})`].join("\n");
    }
    applyPhones(remaining);
    return remaining;
  };
  const applyPhones = (list: string[]) => {
    if (list[0] && list[0] !== c.phones[0]) plan.primaryPhone = list[0];
    plan.contactFields["Phone 2"] = list[1] ? `+1${list[1]}` : null;
    plan.contactFields["Phone 3"] = list[2] ? `+1${list[2]}` : null;
  };
  const followUp = opp ? dateField(opp.fields["Next Follow Up"]) : null;

  switch (key) {
    case "NO_ANSWER":
    case "VOICEMAIL": {
      if (attempts >= MAX_ATTEMPTS) {
        setLane("recycle", `${MAX_ATTEMPTS} attempts, no contact`);
        plan.contactFields["Recycle Until"] = ymd(new Date(now.getTime() + RECYCLE_DAYS.unreachable * DAY));
        due(null);
        plan.tagsAdd.push(TAGS.recycle);
        close("abandoned", "Unreachable (recycled)");
      } else {
        due(nextCallDue(attempts, now));
        stage("attempting");
        // alternate numbers every second miss
        if (attempts % 2 === 0 && c.phones.length > 1) applyPhones([...c.phones.slice(1), c.phones[0]]);
      }
      break;
    }
    case "WRONG_NUMBER":
    case "WRONG_OWNER": {
      const left = rotateOut(call.dialed, key === "WRONG_NUMBER" ? "wrong number" : "wrong owner");
      if (key === "WRONG_OWNER") {
        plan.tagsAdd.push(TAGS.wrongOwner);
        plan.tasks.push({
          title: "Research ownership",
          body: `Number reached someone other than the owner. If they said the owner passed away, this is an estate lead — find the executor.`,
          due: new Date(now.getTime() + DAY),
          assignTo: "owner",
        });
      }
      if (left.length) {
        due(now);
        stage("attempting");
      } else {
        setLane(key === "WRONG_OWNER" ? "research" : "reskip", key === "WRONG_OWNER" ? "wrong owner, no other number" : "no valid number left");
        due(null);
        if (key === "WRONG_NUMBER") plan.tagsAdd.push(TAGS.reskip);
      }
      break;
    }
    case "DNC": {
      setLane("suppressed", "asked not to be called");
      plan.contactFields["DNC Status"] = "Internal DNC";
      due(null);
      plan.dndAll = true;
      plan.tagsAdd.push(TAGS.dnc);
      plan.suppress.push({ kind: "contact", value: "", reason: "internal DNC request" });
      for (const p of new Set([...c.phones, ...(call.dialed ? [call.dialed] : [])])) {
        plan.suppress.push({ kind: "phone", value: p, reason: "internal DNC request" });
      }
      close("lost", "DNC / opt-out");
      break;
    }
    case "NOT_INTERESTED": {
      if (opp && !canAuto) {
        close("lost", "Not interested now"); // a deal past consultation: Sum decides
        due(null);
      } else if (followUp && followUp.getTime() > now.getTime()) {
        stage("followUp");
        due(followUp);
        plan.notes.push("Not interested now; caller set a follow-up date — kept as nurture.");
      } else {
        setLane("recycle", "not interested");
        plan.contactFields["Recycle Until"] = ymd(new Date(now.getTime() + RECYCLE_DAYS.notInterested * DAY));
        due(null);
        plan.tagsAdd.push(TAGS.recycle);
        close("lost", "Not interested now");
      }
      break;
    }
    case "CALLBACK": {
      const when = followUp && followUp.getTime() > now.getTime() ? followUp : addBusinessDays(now, 1);
      stage("followUp");
      due(when);
      const best = opp?.fields["Best Callback"] ? ` — ${opp.fields["Best Callback"]}` : "";
      plan.tasks.push({ title: `Callback${best}`, body: "Seller asked for a callback.", due: when, assignTo: "caller" });
      break;
    }
    case "WARM":
    case "HOT":
    case "BOOKED": {
      const missing = opp ? missingQualification(opp.fields) : [...QUALIFICATION_FIELDS];
      const role: StageRole = key === "WARM" ? "warm" : key === "HOT" ? "hot" : "booked";
      if (key === "BOOKED" || !missing.length) stage(role);
      else stage("contacted");
      if (missing.length) {
        plan.tagsAdd.push(TAGS.missingFields);
        plan.tasks.push({
          title: "Complete qualification fields (5-minute rule)",
          body: `Missing: ${missing.join(", ")}. The card moves to ${PIPELINES[opp?.pipeline ?? "residential"].roles[role]} once they're filled.`,
          due: new Date(now.getTime() + 10 * 60_000),
          assignTo: "caller",
        });
      } else {
        plan.tagsRemove.push(TAGS.missingFields);
      }
      if (plan.opp) {
        plan.opp.fields["Lead Temperature"] = key === "WARM" ? "Warm" : "Hot";
        if (call.userId) plan.opp.fields["Caller Attribution"] = call.userId;
        plan.opp.assignToOwner = true;
      }
      plan.tagsAdd.push(key === "WARM" ? TAGS.warm : key === "HOT" ? TAGS.hot : TAGS.booked);
      due(followUp && followUp.getTime() > now.getTime() ? followUp : addBusinessDays(now, key === "WARM" ? 2 : 1));
      const incomplete = missing.length ? ` (fields incomplete: ${missing.length})` : "";
      plan.notify = { level: key === "WARM" ? "warm" : key === "HOT" ? "hot" : "booked", text: `${label}${incomplete}` };
      plan.hotReport = key !== "WARM";
      plan.tasks.push({
        title: key === "BOOKED" ? "Prep the seller consultation" : key === "HOT" ? "Call the hot seller today" : "Follow up with warm seller",
        body: "Property report + recording are linked on the opportunity.",
        due: new Date(now.getTime() + (key === "WARM" ? DAY : key === "HOT" ? 60 * 60_000 : 30 * 60_000)),
        assignTo: "owner",
      });
      break;
    }
    case "LISTED": {
      if (plan.opp) plan.opp.fields["Realtor Involved"] = "Yes - listed";
      if (c.primaryPropertyId) plan.suppress.push({ kind: "property", value: c.primaryPropertyId, reason: "listed with another broker (NJ REC)" });
      plan.tagsAdd.push(TAGS.listedRecheck);
      close("lost", "Listed with another broker");
      due(null);
      if (c.propertyCount <= 1) {
        setLane("suppressed", "listed with another broker — recheck for expiry");
        plan.contactFields["Recycle Until"] = ymd(new Date(now.getTime() + RECYCLE_DAYS.listed * DAY));
      } else {
        plan.notes.push("Owner has other properties; only the listed one is off-limits.");
      }
      break;
    }
    case "SOLD": {
      close("lost", "Sold to someone else");
      due(null);
      if (c.propertyCount <= 1) setLane("suppressed", "property sold");
      break;
    }
  }
  return plan;
}
