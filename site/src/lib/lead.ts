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
};

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
