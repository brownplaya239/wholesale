/**
 * Call intelligence: Claude reads the WAVV transcript and returns the SAME
 * structure every time — the acquisition facts, a lead temperature by the
 * written definitions, the compliance signals, and a QA score.
 *
 * The AI is an AUDITOR, never the source of truth: it writes only the
 * "AI …" opportunity fields, never the caller's qualification fields. Where
 * it disagrees with the caller, the disagreement is the product:
 *   - owner asked to stop calling, caller didn't mark DNC  -> auto-DNC + alert
 *   - owner said it's listed, caller didn't mark it        -> property suppressed + alert
 *   - AI hears a hot/warm seller the caller marked lower   -> "hidden hot" alert to Sum
 *   - caller marked Hot/Booked, AI hears no real intent    -> QA review (inflation)
 *   - no recording/license disclosure, caller quoted price -> QA flags per caller
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { TAGS, type DispositionKey } from "./schema";

export const INTEL_MODEL = "claude-opus-5-5";

const Score = z.number().describe("1-5");

export const CallIntelSchema = z.object({
  spoke_with: z.enum([
    "owner",
    "co_owner_or_decision_maker",
    "relative_or_heir",
    "tenant",
    "wrong_person",
    "machine_or_voicemail",
    "nobody",
    "unclear",
  ]),
  owner_confirmed: z.boolean(),
  owner_deceased: z.boolean(),
  seller_motivation: z.string().nullable(),
  property_condition: z.string().nullable(),
  timeline: z.string().nullable(),
  asking_price: z.string().nullable(),
  price_flexibility: z.string().nullable(),
  occupancy: z.enum(["owner_occupied", "tenant_occupied", "vacant", "family", "unknown"]),
  decision_makers: z.string().nullable(),
  mortgage_liens: z.string().nullable(),
  listing_status: z.enum(["not_listed", "listed_with_agent", "recently_expired", "talking_to_agent", "unknown"]),
  objections: z.array(z.string()),
  callback_requested: z.string().nullable(),
  next_action: z.string().nullable(),
  lead_temperature: z.enum(["hot", "warm", "nurture", "not_qualified", "no_conversation"]),
  temperature_reason: z.string(),
  key_quote: z.string().nullable(),
  compliance: z.object({
    opt_out_requested: z.boolean(),
    opt_out_quote: z.string().nullable(),
    recording_disclosed: z.enum(["yes", "no", "unclear"]),
    license_disclosed: z.enum(["yes", "no", "unclear"]),
    caller_quoted_price_or_terms: z.boolean(),
    caller_quote: z.string().nullable(),
    concerns: z.array(z.string()),
  }),
  qa: z
    .object({
      opening: Score,
      tone: Score,
      discovery: Score,
      listening: Score,
      qualification: Score,
      objection_handling: Score,
      control: Score,
      closing: Score,
      notes_accuracy: z.enum(["accurate", "partly", "inaccurate", "no_note"]),
      coaching_note: z.string(),
    })
    .nullable(),
  summary: z.string(),
});
export type CallIntel = z.infer<typeof CallIntelSchema>;

const SYSTEM = `You audit outbound acquisition calls for a New Jersey real estate business. The principal is Sumeet Sancheti, a licensed NJ real estate salesperson with Coldwell Banker Realty, who buys houses and land directly, assigns some contracts to investors, and lists others. Callers phone property owners from a list, qualify them, and book a consultation with Sumeet. You get one call's transcript (speaker labels may be wrong or missing — infer who is talking from context), the disposition the caller chose, the caller's note, and what the list says about the owner and property.

Report only what was actually said. Use null (or "unknown"/"unclear") for anything not discussed; never fill gaps with guesses from the list data. Keep each text field under 25 words, in plain words, quoting numbers exactly as spoken.

Lead temperature — use these definitions exactly:
- hot: the confirmed owner or a decision-maker shows actual selling intent AND an identifiable motivation AND an actionable timeline AND gave meaningful property information AND is willing to discuss an offer.
- warm: the owner is confirmed and willing to discuss selling, but urgency, price alignment or timing is unresolved.
- nurture: a real owner conversation with no current intent, but not a hard no ("maybe next year", "call me in the spring").
- not_qualified: "might sell someday", only asked what you'd pay without engaging further, talked but gave no actual selling indication, or a clear no.
- no_conversation: no live conversation with the owner or a decision-maker (machine, wrong person, hang-up, tenant only).

Compliance — be strict, these protect the business:
- opt_out_requested: true if the person asked in ANY wording to stop calling, be removed, not be called again, or "put me on your do-not-call list" — even politely, even mid-call. "Not interested" by itself is NOT an opt-out. Quote their words in opt_out_quote.
- recording_disclosed: did the caller say the call may be recorded, near the start?
- license_disclosed: did the caller identify Sumeet as a licensed real estate agent/salesperson (or name Coldwell Banker) early in the call?
- caller_quoted_price_or_terms: true if the CALLER stated a purchase price, an offer, a price range, a commission, or listing terms. (Asking the owner what they hope to get is fine and expected.) Quote it.
- concerns: anything else a compliance reviewer should see — pressure tactics, misrepresentation, claims of a guaranteed cash purchase, discussing a property listed with another broker after learning it was listed, a minor or a confused person on the line. Empty list if none.

listing_status: listed_with_agent if the owner said the property is currently listed or under contract with an agent; recently_expired if a listing ended; talking_to_agent if they are interviewing agents.

QA (null when there was no live owner conversation): score 1-5 each — opening (identity, purpose, disclosures), tone, discovery (motivation before price), listening, qualification (condition, timeline, price, occupancy, decision makers captured), objection_handling, control (kept the call on track), closing (clear next step or booked consultation). notes_accuracy compares the caller's note with what was said. coaching_note: one concrete, specific improvement.

summary: two plain sentences a busy owner can read in five seconds.`;

export type IntelInput = {
  transcript: string;
  wavvSummary: string | null;
  disposition: string;
  callerNote: string | null;
  seconds: number;
  ownerName: string | null;
  property: string | null;
  signals: string | null;
};

export async function extractIntel(input: IntelInput): Promise<{ ok: true; intel: CallIntel; model: string } | { ok: false; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  const user = [
    `Caller's disposition: ${input.disposition}`,
    `Talk time: ${input.seconds}s`,
    `Caller's note: ${input.callerNote?.trim() || "(none)"}`,
    `List data — owner: ${input.ownerName ?? "?"}; property: ${input.property ?? "?"}; signals: ${input.signals ?? "?"}`,
    input.wavvSummary ? `Dialer's own summary (may be generic): ${input.wavvSummary}` : null,
    "",
    "Transcript:",
    input.transcript,
  ]
    .filter((x) => x !== null)
    .join("\n");
  try {
    const client = new Anthropic({ maxRetries: 2, timeout: 120_000 });
    const res = await client.beta.messages.parse({
      model: INTEL_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: betaZodOutputFormat(CallIntelSchema) },
      // If the primary model declines, the API retries on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal") return { ok: false, error: `declined (${res.stop_details?.category ?? "no category"})` };
    if (!res.parsed_output) return { ok: false, error: `no structured result (stop: ${res.stop_reason})` };
    return { ok: true, intel: res.parsed_output, model: res.model };
  } catch (err) {
    const detail = err instanceof Anthropic.APIError ? `API ${err.status ?? ""} ${err.message}` : String(err);
    return { ok: false, error: detail.slice(0, 300) };
  }
}

const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : "—");

/** The fixed 12-line structure Sum reads on the opportunity. */
export function formatIntel(i: CallIntel): string {
  return [
    `Seller motivation: ${v(i.seller_motivation)}`,
    `Property condition: ${v(i.property_condition)}`,
    `Timeline: ${v(i.timeline)}`,
    `Asking price / expectations: ${v(i.asking_price)}${i.price_flexibility ? ` (${i.price_flexibility})` : ""}`,
    `Occupancy: ${i.occupancy.replace(/_/g, " ")}`,
    `Decision makers: ${v(i.decision_makers)}`,
    `Mortgage/liens mentioned: ${v(i.mortgage_liens)}`,
    `Agent/listing status: ${i.listing_status.replace(/_/g, " ")}`,
    `Objections: ${i.objections.length ? i.objections.join("; ") : "—"}`,
    `Next action: ${v(i.next_action)}${i.callback_requested ? ` (callback: ${i.callback_requested})` : ""}`,
    `Lead temperature: ${i.lead_temperature.replace(/_/g, " ")} — ${i.temperature_reason}`,
    `Important quote: ${i.key_quote ? `"${i.key_quote}"` : "—"}`,
  ].join("\n");
}

export type IntelPlan = {
  oppFields: Record<string, unknown>;
  tagsAdd: string[];
  forceDnc: boolean;
  suppressListedProperty: boolean;
  alerts: string[];
  qaFlags: string[];
  note: string;
};

const LIVE_OWNER = new Set(["owner", "co_owner_or_decision_maker", "relative_or_heir"]);

/** Pure: what the extraction changes, given what the caller recorded. */
export function planIntel(i: CallIntel, key: DispositionKey, callId: string): IntelPlan {
  const alerts: string[] = [];
  const qaFlags: string[] = [];
  const tagsAdd: string[] = [];
  const forceDnc = i.compliance.opt_out_requested && key !== "DNC";
  if (forceDnc) alerts.push(`OPT-OUT MISSED: owner said "${i.compliance.opt_out_quote ?? "stop calling"}" but the call was marked "${key}". Contact auto-suppressed.`);
  const suppressListedProperty = i.listing_status === "listed_with_agent" && key !== "LISTED";
  if (suppressListedProperty) alerts.push(`LISTED: owner said the property is listed with an agent; call was marked "${key}". Property suppressed — no further solicitation (NJ REC).`);
  const hidden = (i.lead_temperature === "hot" || i.lead_temperature === "warm") && !["WARM", "HOT", "BOOKED"].includes(key);
  if (hidden) {
    tagsAdd.push(TAGS.hiddenHot);
    alerts.push(`HIDDEN ${i.lead_temperature.toUpperCase()}: AI hears a ${i.lead_temperature} seller; caller marked "${key}". ${i.temperature_reason}`);
  }
  if ((key === "HOT" || key === "BOOKED") && (i.lead_temperature === "not_qualified" || i.lead_temperature === "no_conversation")) {
    tagsAdd.push(TAGS.qaReview);
    qaFlags.push(`inflated: marked ${key}, AI says ${i.lead_temperature}`);
  }
  const live = LIVE_OWNER.has(i.spoke_with);
  if (live && i.compliance.recording_disclosed === "no") qaFlags.push("no recording disclosure");
  if (live && i.compliance.license_disclosed === "no") qaFlags.push("no license/brokerage disclosure");
  if (i.compliance.caller_quoted_price_or_terms) qaFlags.push(`caller quoted price/terms: "${i.compliance.caller_quote ?? ""}"`);
  for (const c of i.compliance.concerns) qaFlags.push(`concern: ${c}`);
  if (i.qa?.notes_accuracy === "inaccurate") qaFlags.push("caller note contradicts the call");
  if (i.owner_deceased) tagsAdd.push(TAGS.estate);
  if (qaFlags.length) tagsAdd.push(TAGS.qaReview);
  const flags = [
    forceDnc && "opt-out-missed",
    suppressListedProperty && "listed",
    hidden && "hidden-hot",
    ...qaFlags.map((q) => q.split(":")[0]),
  ].filter(Boolean) as string[];
  return {
    oppFields: {
      "AI Temperature": i.lead_temperature,
      "AI Summary": formatIntel(i),
      "Last Call Summary": i.summary,
      "AI Flags": [...new Set(flags)].join(", "),
      "AI Last Call ID": callId,
    },
    tagsAdd: [...new Set(tagsAdd)],
    forceDnc,
    suppressListedProperty,
    alerts,
    qaFlags,
    note: `AI call review (${callId})\n${i.summary}\n\n${formatIntel(i)}${qaFlags.length ? `\n\nQA: ${qaFlags.join("; ")}` : ""}`,
  };
}
