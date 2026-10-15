/**
 * Slack reports over the call log — pure, so the tests can pin the content.
 *
 *   eodReport      the full end-of-day report (cron ~8-9 pm ET, Mon–Sat)
 *   morningDigest  today's agenda: callbacks due/overdue, leads waiting on
 *                  Sumeet, open pipeline problems (cron ~8:30 am ET)
 *
 * "Every call" check: each report counts calls whose processing, recording,
 * transcript or AI review did not finish, plus calls with no CRM contact, so
 * a failed automation is visible instead of silent.
 */
import { breakdown, callerQa, funnel, qaAverage, qaFlags } from "./metrics";
import type { CallRow } from "./store";

export type DigestCtx = {
  contactUrl: (contactId: string) => string;
  callUrl: (callId: string) => string;
  callerName: (userId: string | null) => string;
};

export type Health = { recovered?: number };

const TZ = "America/New_York";
const MAX_ITEMS = 15;
const QUALIFIED = new Set(["WARM", "HOT", "BOOKED"]);
const EMOJI: Record<string, string> = { HOT: "🔥", BOOKED: "📅", WARM: "🌤" };

/** YYYY-MM-DD in Eastern time. */
export const etDate = (d: Date | string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));

const prettyDay = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

const etTime = (v: string | null) =>
  v ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(v)) : "?";

/** The calling day before `day` (Saturday before a Monday — no Sunday dialing). */
export function prevCallingDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const mins = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} h` : `${Math.round(s / 60)} min`);
const outbound = (calls: CallRow[]) => calls.filter((c) => c.direction !== "inbound");
const onDay = (calls: CallRow[], day: string) => calls.filter((c) => c.startedAt && etDate(c.startedAt) === day);

type Intel = {
  summary?: string;
  callback_requested?: string | null;
  lead_temperature?: string;
  qa?: { coaching_note?: string } | null;
  plan?: { alerts?: string[] };
};
const intelOf = (c: CallRow) => (c.intel ?? null) as Intel | null;

function who(c: CallRow, x: DigestCtx): string {
  const name = c.dims.name || c.phone || c.id.slice(0, 8);
  const prop = c.dims.property ? ` — ${c.dims.property}` : "";
  const link = c.contactId ? ` <${x.contactUrl(c.contactId)}|GHL>` : "";
  return `*${name}*${prop}${link}`;
}

function cap(lines: string[]): string[] {
  return lines.length > MAX_ITEMS ? [...lines.slice(0, MAX_ITEMS), `   …and ${lines.length - MAX_ITEMS} more (see /admin/calls)`] : lines;
}

function section(title: string, lines: string[]): string[] {
  return lines.length ? ["", `*${title}*`, ...cap(lines)] : [];
}

/** First callback task date the disposition engine planned for this call. */
function callbackDue(c: CallRow): string | null {
  const tasks = (c.plan?.tasks ?? []) as { title?: string; due?: string }[];
  const t = tasks.find((x) => /callback/i.test(x.title ?? "")) ?? (c.dispositionKey === "CALLBACK" ? tasks[0] : undefined);
  return t?.due ? etDate(t.due) : null;
}

/** Calls whose automation did not finish — the "every single call" check. */
export function pipelineGaps(calls: CallRow[]): string[] {
  const out = outbound(calls);
  const count = (pred: (c: CallRow) => boolean) => out.filter(pred).length;
  const lines: string[] = [];
  const stuck = count((c) => c.endedStatus === "pending" || c.endedStatus === "waiting");
  const failed = count((c) => c.endedStatus === "failed");
  const unmatched = count((c) => !c.contactId);
  const noRecording = count((c) => Boolean(c.conversation) && !c.recorded);
  const noTranscript = count((c) => c.recorded && (c.seconds ?? 0) >= 15 && c.transcriptStatus !== "ready");
  const noReview = count((c) => c.transcriptStatus === "ready" && (c.seconds ?? 0) >= 15 && c.intelStatus !== "done" && c.intelStatus !== "skipped");
  if (failed) lines.push(`• ❌ ${failed} call(s) failed disposition processing — GHL was not updated`);
  if (stuck) lines.push(`• ⏳ ${stuck} call(s) still waiting on WAVV's call-ended event`);
  if (unmatched) lines.push(`• ❓ ${unmatched} call(s) with no GHL contact (manual dial / unmatched) — not tracked in the CRM`);
  if (noRecording) lines.push(`• 🎙 ${noRecording} conversation(s) with no recording — no AI review possible`);
  if (noTranscript) lines.push(`• 📝 ${noTranscript} recorded call(s) without a transcript yet`);
  if (noReview) lines.push(`• 🤖 ${noReview} transcript(s) not yet AI-reviewed`);
  return lines;
}

export function eodReport(all: CallRow[], day: string, x: DigestCtx, health: Health = {}): string {
  const calls = outbound(onDay(all, day));
  const head = `📊 *End-of-day report — ${prettyDay(day)}*`;
  if (!calls.length) return `${head}\nNo outbound calls today.`;

  const f = funnel(calls);
  const by = (k: string) => calls.filter((c) => c.dispositionKey === k).length;
  const contacts = new Set(calls.map((c) => c.contactId ?? c.phone)).size;
  const talk = calls.filter((c) => c.conversation).reduce((s, c) => s + (c.seconds ?? 0), 0);
  const first = calls.map((c) => c.startedAt!).sort()[0];
  const last = calls.map((c) => c.startedAt!).sort().at(-1)!;

  const skipped = calls.filter((c) => /^agent\s*cancel/i.test(c.disposition ?? "")).length;
  const blocked = calls.filter((c) => /call\s*blocked/i.test(c.disposition ?? "")).length;
  const redials = calls.filter((c) => c.flags.some((fl) => fl.code === "same_day_redial" || fl.code === "over_3_calls_24h")).length;
  const lines = [
    head,
    `*${f.dials}* dials · ${contacts} owners · ${f.humanAnswered} picked up · *${f.conversations}* conversations (${pct(f.contactRate)}) · ${mins(talk)} talk time · ${etTime(first)}–${etTime(last)} ET`,
    `🔥 Hot ${by("HOT")} · 📅 Booked ${by("BOOKED")} · 🌤 Warm ${by("WARM")} · 📞 Callbacks ${by("CALLBACK")} · Not interested ${by("NOT_INTERESTED")} · Wrong # ${by("WRONG_NUMBER") + by("WRONG_OWNER")} · Listed ${by("LISTED")} · DNC ${by("DNC")}`,
    ...(skipped || blocked || redials
      ? [`Skipped by caller ${skipped} · Blocked by carrier ${blocked}${redials ? ` · ⚠️ ${redials} same-day redial(s) — double dial / shared list` : ""}`]
      : []),
  ];

  lines.push(
    ...section(
      "By caller",
      breakdown(calls, "caller").map(({ key, f: g }) => {
        const mine = calls.filter((c) => (c.userId || "(none)") === key);
        const qa = callerQa(mine)[0];
        const t = mine.filter((c) => c.conversation).reduce((s, c) => s + (c.seconds ?? 0), 0);
        return `• *${x.callerName(key === "(none)" ? null : key)}*: ${g.dials} dials · ${g.conversations} convos · ${g.qualified} qualified · ${g.dnc} DNC · ${mins(t)} talk${qa?.avg != null ? ` · AI QA ${qa.avg.toFixed(1)}/5` : ""}${qa?.flags ? ` · ⚠️ ${qa.flags} flagged` : ""}`;
      }),
    ),
  );

  const leads = calls.filter((c) => QUALIFIED.has(c.dispositionKey ?? ""));
  lines.push(
    ...section(
      "Leads for Sumeet",
      leads.map((c) => {
        const s = intelOf(c)?.summary || c.note || "no summary yet";
        return `• ${EMOJI[c.dispositionKey!]} ${who(c, x)} · ${x.callerName(c.userId)} · ${s} <${x.callUrl(c.id)}|call>`;
      }),
    ),
  );

  const ai = calls.flatMap((c) => (intelOf(c)?.plan?.alerts ?? []).map((a) => `• ${who(c, x)}: ${a} <${x.callUrl(c.id)}|call>`));
  lines.push(...section("🤖 AI review caught", ai));

  const callbacks = calls
    .map((c) => {
      const due = callbackDue(c);
      const heard = intelOf(c)?.callback_requested;
      if (c.dispositionKey === "CALLBACK") return `• ${who(c, x)} · due ${due ? prettyDay(due) : "?"}${heard ? ` (“${heard}”)` : ""} · ${x.callerName(c.userId)}`;
      if (heard && !["DNC", "BOOKED"].includes(c.dispositionKey ?? "")) return `• ${who(c, x)} · AI heard “${heard}” but it was marked ${c.dispositionKey ?? "?"} — task created for Sumeet`;
      return null;
    })
    .filter((s): s is string => Boolean(s));
  lines.push(...section("Callbacks set", callbacks));

  const flagged = calls.flatMap((c) => c.flags.filter((fl) => fl.severity === "violation").map((fl) => `• ⚠️ ${fl.code} — ${who(c, x)} · ${x.callerName(c.userId)}: ${fl.detail}`));
  const policy = new Map<string, number>();
  for (const c of calls) for (const fl of c.flags) if (fl.severity !== "violation") policy.set(fl.code, (policy.get(fl.code) ?? 0) + 1);
  const comp = [...flagged, ...(policy.size ? [`• Warnings: ${[...policy].map(([k, n]) => `${k} ×${n}`).join(", ")}`] : [])];
  lines.push(...(comp.length ? section("Compliance", comp) : ["", "*Compliance* — clean ✅"]));

  const coaching: string[] = [];
  const callers = [...new Set(calls.map((c) => c.userId || "(none)"))];
  for (const k of callers) {
    const reviewed = calls.filter((c) => (c.userId || "(none)") === k && c.intel && intelOf(c)?.qa);
    if (!reviewed.length) continue;
    const worst = reviewed.sort((a, b) => (qaAverage(a) ?? 5) - (qaAverage(b) ?? 5))[0];
    const flags = qaFlags(worst).filter((q) => !/^(OPT-OUT|LISTED|HIDDEN)/.test(q));
    if ((qaAverage(worst) ?? 0) >= 4 && !flags.length) {
      coaching.push(`• *${x.callerName(k === "(none)" ? null : k)}* — every reviewed call scored 4+/5 ✅`);
      continue;
    }
    coaching.push(
      `• *${x.callerName(k === "(none)" ? null : k)}* — listen: ${who(worst, x)} (QA ${qaAverage(worst)?.toFixed(1) ?? "?"}) <${x.callUrl(worst.id)}|call>${flags.length ? `\n   flags: ${flags.join("; ")}` : ""}\n   tip: ${intelOf(worst)?.qa?.coaching_note ?? "—"}`,
    );
  }
  lines.push(...section("Coaching (lowest-scored reviewed call per caller)", coaching));

  const cohorts = breakdown(calls, "cohort").slice(0, 5).map(({ key, f: g }) => `${key || "?"} ${g.conversations}/${g.dials}`);
  const counties = breakdown(calls, "county").slice(0, 6).map(({ key, f: g }) => `${key || "?"} ${g.conversations}/${g.dials}`);
  lines.push("", `*Conversations / dials* — county: ${counties.join(" · ")}`, `list: ${cohorts.join(" · ")}`);

  const gaps = pipelineGaps(calls);
  if (health.recovered) gaps.unshift(`• 🔁 ${health.recovered} call(s) recovered from WAVV that the webhook missed`);
  lines.push(...(gaps.length ? section("Pipeline check", gaps) : ["", "*Pipeline check* — every call processed ✅"]));
  return lines.join("\n");
}

export function morningDigest(recent: CallRow[], today: string, x: DigestCtx): string {
  const out = outbound(recent);
  const yday = prevCallingDay(today);
  const prev = onDay(out, yday);
  const f = funnel(prev);
  const lines = [`☀️ *Today's agenda — ${prettyDay(today)}*`];
  lines.push(
    prev.length
      ? `${prettyDay(yday)}: ${f.dials} dials · ${f.conversations} conversations · ${f.qualified} qualified · ${f.booked} booked · ${f.dnc} DNC`
      : `${prettyDay(yday)}: no calls.`,
  );

  // Callbacks: the latest call per contact decides — a later call means it was handled.
  const latest = new Map<string, CallRow>();
  for (const c of out) {
    const k = c.contactId ?? c.phone ?? c.id;
    const cur = latest.get(k);
    if (!cur || (c.startedAt ?? "") > (cur.startedAt ?? "")) latest.set(k, c);
  }
  const due: string[] = [];
  const overdue: string[] = [];
  for (const c of latest.values()) {
    if (c.dispositionKey !== "CALLBACK") continue;
    const d = callbackDue(c);
    if (!d) continue;
    const heard = intelOf(c)?.callback_requested;
    const line = `• ${who(c, x)}${heard ? ` (“${heard}”)` : ""} · set by ${x.callerName(c.userId)}`;
    if (d === today) due.push(line);
    else if (d < today) overdue.push(`${line} · was due ${prettyDay(d)}`);
  }
  lines.push(...section(`📞 Callbacks due today (${due.length})`, due));
  lines.push(...section(`⏰ Overdue callbacks (${overdue.length})`, overdue));

  const waiting = prev.filter((c) => QUALIFIED.has(c.dispositionKey ?? "")).map((c) => `• ${EMOJI[c.dispositionKey!]} ${who(c, x)} · ${intelOf(c)?.summary || c.note || ""}`);
  lines.push(...section("Leads from yesterday — call them first", waiting));

  const late = prev.flatMap((c) => (intelOf(c)?.plan?.alerts ?? []).map((a) => `• ${who(c, x)}: ${a}`));
  lines.push(...section("🤖 AI review alerts from yesterday", late));

  const gaps = pipelineGaps(out.filter((c) => c.startedAt && etDate(c.startedAt) >= prevCallingDay(yday)));
  lines.push(...section("Still open from the pipeline check", gaps));
  if (!due.length && !overdue.length && !waiting.length) lines.push("", "Nothing scheduled — straight into the queues.");
  return lines.join("\n");
}

/** ACQ_CALLER_NAMES="wavvUserId=Alex,otherId=Kate" -> display names in reports. */
export function callerNamer(env = process.env.ACQ_CALLER_NAMES): (id: string | null) => string {
  const map = new Map(
    (env ?? "")
      .split(",")
      .map((p) => p.split("=").map((s) => s.trim()))
      .filter((p) => p.length === 2 && p[0] && p[1]) as [string, string][],
  );
  return (id) => (id ? map.get(id) ?? `caller ${id.slice(0, 8)}` : "unknown caller");
}
