/**
 * Shared lead-payload types between the form (client) and /api/lead (server).
 */

export type LeadStage = "step1" | "full" | "details";

export type LeadSubmission = {
  stage: LeadStage;
  /** Random client-generated id for the submission. */
  leadId: string;
  address: string;
  /** Google Places place_id when autocomplete resolved the address. */
  placeId?: string;
  name?: string;
  phone?: string;
  email?: string;
  timeline?: string;
  /** Optional routing signal: what the seller says matters most. */
  priority?: string;
  consentChecked?: boolean;
  /** Exact consent copy the user saw — stored per-lead (provable artifact). */
  consentText?: string;
  /** Full URL of the page the form was on, incl. campaign params. */
  pageUrl: string;
  /** Honeypot — invisible to people; anything in it means a bot. */
  website?: string;
};

/*
 * Field validators shared by the form (blocks submit) and /api/lead (rejects
 * anything that bypasses the form). A lead that fails these can't be called,
 * valued, or mailed — and must never count as a Google Ads conversion.
 */

/**
 * True when the address leads with a house number ("12 Main St", "12A …",
 * "12-14 …"). Google autocomplete also offers bare streets ("80th St, North
 * Bergen") — those can't be valued or mailed.
 */
export function hasHouseNumber(address: string): boolean {
  return /^\s*\d+[A-Za-z]?(?:[-/]\d+[A-Za-z]?)?\s+\S/.test(address);
}

export type AddressProblem = "missing" | "houseNumber" | "notNJ" | "incomplete";

/** null = a complete New Jersey street address. */
export function addressProblem(raw: string): AddressProblem | null {
  const address = raw.trim();
  if (address.length < 4) return "missing";
  if (!hasHouseNumber(address)) return "houseNumber";
  // Google's format ends ", PA 18042, USA"; typed input may end ", PA".
  const state = address.match(/,\s*([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,\s*USA)?\s*$/i);
  if (state && state[1].toUpperCase() !== "NJ") return "notNJ";
  const rest = address.replace(/^\s*\S+\s+/, ""); // drop the house number
  const zip = rest.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zip && !/^0[78]/.test(zip[1])) return "notNJ";
  if (zip) return null; // NJ ZIP present
  if (/,\s*[^,]+,\s*(?:NJ|New Jersey)\b/i.test(address)) return null; // street, town, NJ
  if (/\b(?:NJ|New Jersey)\b/i.test(rest) && rest.split(/[\s,]+/).filter(Boolean).length >= 4) {
    return null; // "Main St Freehold NJ"
  }
  return "incomplete";
}

/** First and last name, letters only (accents, apostrophes, hyphens OK). */
export function isFullName(raw: string): boolean {
  return /^\p{L}[\p{L}'’.-]*(?:\s+\p{L}[\p{L}'’.-]*)+$/u.test(raw.trim().replace(/\s+/g, " "));
}

/**
 * The 10-digit US number, or null when it can't be a real dialable number:
 * wrong length, invalid area code/exchange (0/1 lead, N11), 555-01xx
 * fictional range, or one digit repeated.
 */
export function normalizeUSPhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(d)) return null;
  const area = d.slice(0, 3);
  const exch = d.slice(3, 6);
  if (area.slice(1) === "11" || exch.slice(1) === "11") return null;
  if (exch === "555" && d.slice(6, 8) === "01") return null;
  if (/^(\d)\1{9}$/.test(d)) return null;
  return d;
}

export function formatUSPhone(d: string): string {
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * The just-submitted lead, handed from the form to /thank-you so the optional
 * follow-up questions can reference it. sessionStorage only: dies with the tab.
 */
export type RememberedLead = { leadId: string; name: string; address: string };

const LEAD_KEY = "hsnj_last_lead";

export function rememberLead(lead: RememberedLead): void {
  try {
    sessionStorage.setItem(LEAD_KEY, JSON.stringify(lead));
  } catch {
    // Private mode / blocked storage: the thank-you extras just won't show.
  }
}

export function recallLead(): RememberedLead | null {
  try {
    const raw = sessionStorage.getItem(LEAD_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RememberedLead>;
    return v.leadId && v.name && v.address ? (v as RememberedLead) : null;
  } catch {
    return null;
  }
}
