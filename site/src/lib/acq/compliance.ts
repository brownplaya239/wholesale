/**
 * Per-call compliance audit — pure, deterministic, no AI. Every finished call
 * is checked against the rules the business can be sued over:
 *
 *  violation (a legal line):
 *   - outside 8am-9pm in ANY time zone the owner may be in (47 CFR 64.1200(c)(1))
 *   - a cold contact dialed with no DNC scrub on file, or one > 31 days old
 *   - a contact the system had suppressed (DNC / mail-only / recycled) was dialed
 *   - the caller has no signed training acknowledgement (ACQ_TRAINED_CALLERS)
 *  policy (our tighter rule, Mon-Sat 9am-8pm local, no Sunday/federal holiday)
 *  warning: number not on the contact record; human answered but 0 s talk
 *   (a dropped/abandoned connect — the 3%-per-30-days cap is computed from these)
 *
 * WAVV's own "Timezone Protection" keys off the AREA CODE only; this audit
 * keys off the mailing state the prep step wrote to the contact (Call Zones)
 * — the two together cover ported cell numbers.
 */
export type Flag = { severity: "violation" | "policy" | "warning"; code: string; detail: string };

export const SCRUB_VALID_DAYS = 31;
const SUPPRESSED_LANES = new Set(["suppressed", "mail_only", "reskip", "research", "recycle"]);

export function localParts(at: Date, tz: string): { hour: number; minute: number; weekday: number; ymd: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value])
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { hour: Number(p.hour) % 24, minute: Number(p.minute), weekday, ymd: `${p.year}-${p.month}-${p.day}` };
}

/** Fixed-date + floating federal holidays (MLK, Presidents, Memorial, Labor, Columbus, Thanksgiving). */
export function isFederalHoliday(ymdStr: string): boolean {
  const [y, m, d] = ymdStr.split("-").map(Number);
  if (["1-1", "6-19", "7-4", "11-11", "12-25"].includes(`${m}-${d}`)) return true;
  const date = new Date(Date.UTC(y, m - 1, d));
  const wd = date.getUTCDay();
  const nth = Math.floor((d - 1) / 7) + 1;
  const lastWeek = new Date(Date.UTC(y, m - 1, d + 7)).getUTCMonth() !== m - 1;
  const floating: [number, number, number][] = [
    [1, 1, 3],
    [2, 1, 3],
    [9, 1, 1],
    [10, 1, 2],
    [11, 4, 4],
  ];
  return floating.some(([mm, w, n]) => mm === m && w === wd && n === nth) || (m === 5 && wd === 1 && lastWeek);
}

const fmt = (h: number, mi: number) => `${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;

export function callWindowFlags(at: Date, zones: string[]): Flag[] {
  const flags: Flag[] = [];
  const list = zones.length ? zones : ["America/New_York"];
  for (const z of list) {
    let lp;
    try {
      lp = localParts(at, z);
    } catch {
      continue;
    }
    const mins = lp.hour * 60 + lp.minute;
    if (mins < 8 * 60 || mins >= 21 * 60) {
      flags.push({ severity: "violation", code: "outside_federal_hours", detail: `${fmt(lp.hour, lp.minute)} local in ${z} (federal window 8am-9pm)` });
    } else if (mins < 9 * 60 || mins >= 20 * 60) {
      flags.push({ severity: "policy", code: "outside_policy_hours", detail: `${fmt(lp.hour, lp.minute)} local in ${z} (policy 9am-8pm)` });
    }
    if (lp.weekday === 0) flags.push({ severity: "policy", code: "sunday_call", detail: `Sunday in ${z}` });
    if (isFederalHoliday(lp.ymd)) flags.push({ severity: "policy", code: "holiday_call", detail: `federal holiday ${lp.ymd}` });
  }
  // one flag per code is enough
  return flags.filter((f, i) => flags.findIndex((g) => g.code === f.code) === i);
}

export type AuditInput = {
  at: Date;
  direction: string | null | undefined;
  dialed: string | null;
  human: boolean | null;
  seconds: number;
  lane: string | null;
  tags: string[];
  zones: string[];
  scrubDate: string | null;
  phones: string[];
  inboundConsent: boolean;
  /** false = caller is not on the signed training log (ACQ_TRAINED_CALLERS); null = check off. */
  callerTrained?: boolean | null;
};

/** WAVV user ids of callers with a signed training acknowledgement (compliance/CALLER_TRAINING.md). */
export function trainedCallers(env = process.env.ACQ_TRAINED_CALLERS): Set<string> | null {
  const ids = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

export function auditCall(a: AuditInput): Flag[] {
  if (a.direction === "inbound") return []; // they called us
  const flags = callWindowFlags(a.at, a.zones);
  if (a.callerTrained === false) {
    flags.push({ severity: "violation", code: "caller_not_trained", detail: "caller is not on the signed training log (ACQ_TRAINED_CALLERS)" });
  }
  const lane = a.lane ?? "";
  if (SUPPRESSED_LANES.has(lane) || a.tags.includes("dnc")) {
    flags.push({ severity: "violation", code: "dialed_suppressed_contact", detail: `contact lane "${lane || "?"}"${a.tags.includes("dnc") ? " + dnc tag" : ""}` });
  }
  if (!a.inboundConsent) {
    if (!a.scrubDate) {
      flags.push({ severity: "violation", code: "no_scrub_on_file", detail: "cold contact with no DNC/litigator scrub date" });
    } else {
      const age = Math.floor((a.at.getTime() - new Date(a.scrubDate).getTime()) / 86_400_000);
      if (age > SCRUB_VALID_DAYS) flags.push({ severity: "violation", code: "scrub_expired", detail: `DNC scrub ${age} days old at dial time (max ${SCRUB_VALID_DAYS})` });
    }
  }
  if (a.dialed && a.phones.length && !a.phones.includes(a.dialed)) {
    flags.push({ severity: "warning", code: "number_not_on_record", detail: `dialed ${a.dialed}, not a callable number on the contact` });
  }
  if (a.human === true && a.seconds === 0) {
    flags.push({ severity: "warning", code: "possible_abandoned", detail: "human answered, 0 s talk time (dropped connect?)" });
  }
  return flags;
}
