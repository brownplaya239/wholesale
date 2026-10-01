/**
 * The GoHighLevel build, as code. Single source of truth for every custom
 * field, the Property custom object, both pipelines, the WAVV dispositions
 * and the tags the middleware writes. `npm run ghl:provision` creates what
 * the API allows and verifies the rest; docs/ACQUISITION_SYSTEM.md lists the
 * UI-only steps (custom object schema, smart lists, workflows).
 *
 * Data model:
 *   CONTACT  = the person (dial state lives here — WAVV dials contacts and
 *              GHL smart lists filter contacts, and they CANNOT filter on
 *              fields of an associated custom object, so the primary
 *              property's facts are denormalized onto the contact).
 *   PROPERTY = custom object, one record per parcel, associated to its owner.
 *   OPPORTUNITY = the deal: one per owner per pipeline at release, anchored
 *              to the owner's best property; split per property only when a
 *              second deal is real (enable "Allow Multiple Opportunities per
 *              Contact": Sub-Account Settings → Objects → Opportunities).
 */

export type FieldType =
  | "TEXT"
  | "LARGE_TEXT"
  | "NUMERICAL"
  | "PHONE"
  | "MONETORY"
  | "CHECKBOX"
  | "SINGLE_OPTIONS"
  | "MULTIPLE_OPTIONS"
  | "DATE";

export type FieldDef = { name: string; type: FieldType; options?: readonly string[] };

/** GHL derives a field's key from its name: "Dial Lane" -> dial_lane. */
export function fieldKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const YN = ["Yes", "No", "Unknown"] as const;

export const DIAL_LANES = ["power", "manual", "inbound", "mail_only", "reskip", "research", "recycle", "suppressed"] as const;
export type DialLane = (typeof DIAL_LANES)[number];
/** Lanes a caller may dial. Everything else is out of every dial smart list. */
export const DIALABLE_LANES: readonly DialLane[] = ["power", "manual", "inbound"];

export const CONTACT_FIELDS: readonly FieldDef[] = [
  { name: "Acq Owner ID", type: "TEXT" },
  { name: "Owner Type", type: "SINGLE_OPTIONS", options: ["Individual", "Entity", "Trust", "Estate"] },
  { name: "Phone 2", type: "PHONE" },
  { name: "Phone 3", type: "PHONE" },
  { name: "Phone Types", type: "TEXT" },
  { name: "Invalid Phones", type: "LARGE_TEXT" },
  { name: "Dial Lane", type: "SINGLE_OPTIONS", options: DIAL_LANES },
  { name: "Lane Reason", type: "TEXT" },
  { name: "Call Window ET", type: "TEXT" },
  { name: "Call Zones", type: "TEXT" },
  { name: "DNC Scrub Date", type: "DATE" },
  { name: "DNC Status", type: "SINGLE_OPTIONS", options: ["Clear", "Internal DNC", "Federal/State DNC", "Litigator"] },
  { name: "SMS Consent", type: "SINGLE_OPTIONS", options: ["No consent", "Web form consent"] },
  { name: "Consent Record", type: "TEXT" },
  { name: "Call Attempts", type: "NUMERICAL" },
  { name: "Conversations", type: "NUMERICAL" },
  { name: "Last Call Date", type: "DATE" },
  { name: "Last Disposition", type: "TEXT" },
  { name: "Next Call Due", type: "DATE" },
  { name: "Last Successful Contact", type: "DATE" },
  { name: "Recycle Until", type: "DATE" },
  {
    name: "Lead Source",
    type: "SINGLE_OPTIONS",
    options: ["BatchLeads", "Land Portal", "M-Power 2019", "HouseSoldNJ Web", "Skip-trace return", "Referral", "Other"],
  },
  { name: "Source List", type: "TEXT" },
  { name: "Primary Cohort", type: "TEXT" },
  { name: "Wave", type: "TEXT" },
  { name: "Pull Date", type: "DATE" },
  { name: "Skip Trace Provider", type: "TEXT" },
  { name: "Primary Property", type: "TEXT" },
  { name: "Primary County", type: "TEXT" },
  { name: "Asset Class", type: "SINGLE_OPTIONS", options: ["residential", "land", "both"] },
  { name: "Property Count", type: "NUMERICAL" },
  { name: "Lead Score", type: "NUMERICAL" },
  { name: "Signals", type: "TEXT" },
  { name: "Preferred Contact Method", type: "SINGLE_OPTIONS", options: ["Call", "Text", "Email", "Mail"] },
  { name: "Residential Opportunity ID", type: "TEXT" },
  { name: "Land Opportunity ID", type: "TEXT" },
];

export const LOST_REASONS = [
  "Not interested now",
  "Price expectations too high",
  "Listed with another broker",
  "Sold to someone else",
  "Wrong owner / no authority",
  "Unreachable (recycled)",
  "DNC / opt-out",
  "No callable phone",
  "Property not a fit",
  "Duplicate",
] as const;

export const CONDITION_OPTIONS = [
  "Move-in ready",
  "Needs minor updates",
  "Needs major repairs",
  "Needs a full renovation",
  "Unknown",
] as const;

export const OPPORTUNITY_FIELDS: readonly FieldDef[] = [
  { name: "Lead Temperature", type: "SINGLE_OPTIONS", options: ["Hot", "Warm", "Nurture", "Not Qualified"] },
  { name: "Owner Confirmed", type: "SINGLE_OPTIONS", options: ["Yes", "No"] },
  { name: "Motivation", type: "LARGE_TEXT" },
  { name: "Property Condition", type: "SINGLE_OPTIONS", options: CONDITION_OPTIONS },
  {
    name: "Seller Timeline",
    type: "SINGLE_OPTIONS",
    options: ["ASAP (under 30 days)", "1-3 months", "3-6 months", "6+ months", "Just exploring"],
  },
  { name: "Asking Price", type: "MONETORY" },
  { name: "Price Flexibility", type: "SINGLE_OPTIONS", options: ["Firm", "Some flexibility", "Very flexible", "Unknown"] },
  { name: "Occupancy", type: "SINGLE_OPTIONS", options: ["Owner-occupied", "Tenant-occupied", "Vacant", "Unknown"] },
  { name: "Mortgage and Liens", type: "LARGE_TEXT" },
  { name: "Decision Makers", type: "TEXT" },
  {
    name: "Realtor Involved",
    type: "SINGLE_OPTIONS",
    options: ["No", "Yes - listed", "Yes - talking to an agent", "Recently expired"],
  },
  { name: "Best Callback", type: "TEXT" },
  { name: "Caller Notes", type: "LARGE_TEXT" },
  { name: "Next Action", type: "TEXT" },
  { name: "Next Follow Up", type: "DATE" },
  { name: "Appointment Date", type: "DATE" },
  { name: "ARV", type: "MONETORY" },
  { name: "Rehab Estimate", type: "MONETORY" },
  { name: "MAO", type: "MONETORY" },
  { name: "Offer Amount", type: "MONETORY" },
  { name: "Contract Price", type: "MONETORY" },
  {
    name: "Deal Path",
    type: "SINGLE_OPTIONS",
    options: ["Undecided", "Buy (principal)", "Assign to investor", "List with Coldwell Banker"],
  },
  // CLAUDE.md: the seller learns buy / assign / list IN WRITING before signing.
  { name: "Path Disclosed In Writing", type: "DATE" },
  { name: "Assignment Target", type: "TEXT" },
  {
    name: "Contract Status",
    type: "SINGLE_OPTIONS",
    options: ["None", "Verbal yes", "PSA sent", "PSA signed", "Listing agreement signed", "Assigned", "Closed", "Cancelled"],
  },
  { name: "Lost Reason", type: "SINGLE_OPTIONS", options: LOST_REASONS },
  { name: "Primary Property ID", type: "TEXT" },
  { name: "Property Address", type: "TEXT" },
  { name: "Caller Attribution", type: "TEXT" },
  {
    name: "AI Temperature",
    type: "SINGLE_OPTIONS",
    options: ["hot", "warm", "nurture", "not_qualified", "no_conversation"],
  },
  { name: "AI Flags", type: "TEXT" },
  { name: "AI Summary", type: "LARGE_TEXT" },
  { name: "AI Last Call ID", type: "TEXT" },
  { name: "Report URL", type: "TEXT" },
];

/**
 * Qualified Warm / Hot require these (the stage rule in GHL's "Show & Require
 * Opportunity Fields Conditionally" enforces them in the UI only — API and
 * workflow updates bypass it, so the middleware re-checks before it moves a
 * card).
 */
export const QUALIFICATION_FIELDS = [
  "Owner Confirmed",
  "Motivation",
  "Property Condition",
  "Seller Timeline",
  "Asking Price",
  "Occupancy",
  "Decision Makers",
  "Next Action",
  "Next Follow Up",
] as const;

export const PROPERTY_OBJECT = {
  key: "custom_objects.property",
  singular: "Property",
  plural: "Properties",
  primary: { name: "Property Address", key: "property_address" },
  fields: [
    { name: "Acq Property ID", type: "TEXT" },
    { name: "City", type: "TEXT" },
    { name: "ZIP", type: "TEXT" },
    { name: "County", type: "TEXT" },
    { name: "Municipality", type: "TEXT" },
    { name: "APN", type: "TEXT" },
    { name: "Block", type: "TEXT" },
    { name: "Lot", type: "TEXT" },
    { name: "Asset Class", type: "SINGLE_OPTIONS", options: ["residential", "land"] },
    { name: "Property Type", type: "TEXT" },
    { name: "Units", type: "NUMERICAL" },
    { name: "Beds", type: "NUMERICAL" },
    { name: "Baths", type: "NUMERICAL" },
    { name: "Sqft", type: "NUMERICAL" },
    { name: "Acres", type: "NUMERICAL" },
    { name: "Year Built", type: "NUMERICAL" },
    { name: "Estimated Value", type: "NUMERICAL" },
    { name: "Mortgage Estimate", type: "NUMERICAL" },
    { name: "Equity Pct", type: "NUMERICAL" },
    { name: "Ownership Years", type: "NUMERICAL" },
    { name: "Last Sale Date", type: "DATE" },
    { name: "Last Sale Price", type: "NUMERICAL" },
    { name: "Vacant", type: "SINGLE_OPTIONS", options: YN },
    { name: "Absentee", type: "SINGLE_OPTIONS", options: YN },
    { name: "Tax Delinquent", type: "SINGLE_OPTIONS", options: YN },
    { name: "Preforeclosure", type: "SINGLE_OPTIONS", options: YN },
    { name: "Inherited", type: "SINGLE_OPTIONS", options: YN },
    { name: "Free And Clear", type: "SINGLE_OPTIONS", options: YN },
    { name: "Code Violation", type: "SINGLE_OPTIONS", options: YN },
    { name: "Wetlands Pct", type: "NUMERICAL" },
    { name: "Flood Zone", type: "TEXT" },
    { name: "Flood Pct", type: "NUMERICAL" },
    { name: "Road Frontage Ft", type: "NUMERICAL" },
    { name: "Landlocked", type: "SINGLE_OPTIONS", options: YN },
    { name: "Slope Pct", type: "NUMERICAL" },
    { name: "MLS Status", type: "TEXT" },
    { name: "Source Lists", type: "TEXT" },
    { name: "Source Provider", type: "TEXT" },
    { name: "Pull Date", type: "DATE" },
    { name: "Skip Trace Provider", type: "TEXT" },
    { name: "Lead Score", type: "NUMERICAL" },
    { name: "Score Reasons", type: "LARGE_TEXT" },
    { name: "Signals", type: "TEXT" },
    {
      name: "Property Status",
      type: "SINGLE_OPTIONS",
      options: ["Active", "Listed elsewhere - recheck", "Sold", "Under contract (ours)", "Closed (ours)"],
    },
  ] as readonly FieldDef[],
} as const;

export const CONTACT_PROPERTY_ASSOCIATION = { key: "owner_property", first: "Owner", second: "Property" } as const;

// ------------------------------------------------------------- pipelines --
export type PipelineKey = "residential" | "land";
export type StageRole = "new" | "attempting" | "contacted" | "followUp" | "warm" | "hot" | "booked";

export const PIPELINES: Record<
  PipelineKey,
  { name: string; stages: readonly string[]; roles: Record<StageRole, string> }
> = {
  residential: {
    name: "Residential Acquisition",
    stages: [
      "New / Ready to Call",
      "Attempting Contact",
      "Contacted",
      "Follow-Up",
      "Qualified Warm",
      "Qualified Hot",
      "Consultation Booked",
      "Underwriting",
      "Offer Ready",
      "Offer Made",
      "Negotiating",
      "Under Contract",
      "Title / DD",
      "Disposition",
      "Closed Won",
    ],
    roles: {
      new: "New / Ready to Call",
      attempting: "Attempting Contact",
      contacted: "Contacted",
      followUp: "Follow-Up",
      warm: "Qualified Warm",
      hot: "Qualified Hot",
      booked: "Consultation Booked",
    },
  },
  land: {
    name: "Vacant Land Acquisition",
    stages: [
      "New / Ready to Call",
      "Attempting Contact",
      "Contacted",
      "Follow-Up",
      "Qualified",
      "Preliminary Land Screen",
      "Consultation",
      "Underwriting / Feasibility",
      "Offer",
      "Negotiating",
      "Under Contract / Option",
      "DD / Entitlement",
      "Disposition",
      "Closed Won",
    ],
    roles: {
      new: "New / Ready to Call",
      attempting: "Attempting Contact",
      contacted: "Contacted",
      followUp: "Follow-Up",
      warm: "Qualified",
      hot: "Qualified",
      booked: "Consultation",
    },
  },
};

/** Stages at or past which the middleware never moves a card backwards. */
export function stageIndex(p: PipelineKey, stage: string): number {
  return PIPELINES[p].stages.indexOf(stage);
}

// ---------------------------------------------------------- dispositions --
/**
 * The 12 WAVV dispositions. Configure them in WAVV (Agency View → WAVV Admin
 * → Dispositions) with EXACTLY these labels; WAVV's webhook sends the label
 * as free text. Tag column in WAVV: the `tag` below.
 */
export const DISPOSITIONS = {
  NO_ANSWER: { label: "No Answer", tag: "wavv-no-answer" },
  VOICEMAIL: { label: "Voicemail", tag: "wavv-voicemail" },
  WRONG_NUMBER: { label: "Wrong Number", tag: "wavv-wrong-number" },
  DNC: { label: "DNC", tag: "wavv-dnc" },
  NOT_INTERESTED: { label: "Not Interested", tag: "wavv-not-interested" },
  CALLBACK: { label: "Callback Requested", tag: "wavv-callback" },
  WARM: { label: "Warm Lead", tag: "wavv-warm" },
  HOT: { label: "Hot Lead", tag: "wavv-hot" },
  BOOKED: { label: "Appointment Booked", tag: "wavv-booked" },
  LISTED: { label: "Already Listed", tag: "wavv-listed" },
  SOLD: { label: "Property Sold", tag: "wavv-sold" },
  WRONG_OWNER: { label: "Wrong Owner", tag: "wavv-wrong-owner" },
} as const;
export type DispositionKey = keyof typeof DISPOSITIONS;

/** Tags the middleware owns. Smart lists and the thin GHL workflows key off these. */
export const TAGS = {
  cold: "acq:cold",
  inbound: "acq:inbound",
  noSms: "no-sms",
  dnc: "dnc",
  hot: "hot",
  warm: "warm",
  booked: "booked",
  missingFields: "qa:missing-fields",
  qaReview: "qa:review",
  hiddenHot: "alert:hidden-hot",
  violation: "compliance:violation",
  wrongOwner: "research:wrong-owner",
  estate: "research:estate",
  reskip: "needs-reskip",
  listedRecheck: "listed-recheck",
  recycle: "recycle",
} as const;

/**
 * The only GHL workflows in the build — deliberately thin. State changes
 * (counters, cadence, phone rotation, DNC, stage moves) happen in the
 * middleware where they are versioned and tested; workflows only do the
 * human-facing side effects GHL is good at. Built in the UI (no create API).
 */
export const WORKFLOWS = [
  {
    name: "ACQ · Hot / Booked alert",
    trigger: `Contact Tag added: "${TAGS.hot}" or "${TAGS.booked}"`,
    actions: "Internal notification to Sum (GHL app push + SMS to Sum's own cell) with Signals, Primary Property, AI Summary; assign contact to Sum",
  },
  {
    name: "ACQ · Inbound speed-to-lead",
    trigger: `Contact Tag added: "${TAGS.inbound}"`,
    actions: "SMS to the seller (consented web lead only): 'Hi {{contact.first_name}}, it's Sumeet with House Sold NJ — got your info. Calling you in a few minutes.'; internal notification; task 'Call within 5 min'",
  },
] as const;
