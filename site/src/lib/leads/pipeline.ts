/** Lead pipeline stages — tracked past the form so ads can be judged on deals. */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "appointment",
  "offer_sent",
  "under_contract",
  "listed",
  "closed",
  "dead",
] as const;

export const STATUS_LABEL: Record<(typeof LEAD_STATUSES)[number], string> = {
  new: "New",
  contacted: "Contacted",
  appointment: "Appointment set",
  offer_sent: "Offer sent",
  under_contract: "Under contract",
  listed: "Listing signed",
  closed: "Closed",
  dead: "Dead / not a fit",
};
