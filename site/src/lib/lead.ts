/**
 * Shared lead-payload types between the form (client) and /api/lead (server).
 */

export type LeadStage = "step1" | "full";

export type LeadSubmission = {
  stage: LeadStage;
  /** Random client-generated id linking a step1 partial to its full submit. */
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
  /**
   * Resend id of the scheduled partial-lead email (returned by the step1
   * call). Sent with the full submission so the server can cancel it —
   * completed leads then produce ONE email instead of partial + full.
   */
  cancelEmailId?: string;
};
