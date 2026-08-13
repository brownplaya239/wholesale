/**
 * Single source of truth for every business fact on the site.
 *
 * ██ EVERY VALUE MARKED "TODO" IS A PLACEHOLDER. ██
 * The reputability system only works if everything shown is REAL and
 * verifiable (spec §5) — replace these before launch or the related UI
 * element hides itself / shows neutral copy where it can.
 */

export const site = {
  domain: "housesoldnj.com",
  url: "https://housesoldnj.com",
  name: "House Sold NJ",

  // ── The named, licensed principal ──────────────────────────────────────────
  principal: {
    firstName: "Sum",
    fullName: "Sumeet Sancheti", // TODO: confirm exact name as licensed
    // NJ REC advertising disclosure — license status in writing on every page.
    licenseLine: "NJ Licensed Real Estate Salesperson",
    licenseNumber: "", // TODO: e.g. "2612345678" — shown in footer when set
    brokerage: "", // TODO: brokerage name — REQUIRED by NJ REC before launch
    // TODO: add a real photo as site/public/sum.jpg and change this to "/sum.jpg"
    photo: "/sum-placeholder.svg",
    base: "Based in Monmouth County",
  },

  // ── Contact ────────────────────────────────────────────────────────────────
  phone: {
    // TODO: replace with the CallRail-tracked local NJ number (never toll-free).
    display: "(732) 555-0199",
    e164: "+17325550199",
    hours: "8am–9pm, 7 days",
  },
  email: "sum@housesoldnj.com", // TODO: confirm

  // ── Legal entity (footer facts — anonymous footers kill trust) ─────────────
  legal: {
    entityName: "", // TODO: e.g. "House Sold NJ LLC" — falls back to site name
    officeAddress: "", // TODO: street address, city, NJ zip
  },

  // ── Proof numbers — only shown when set; never fake these ──────────────────
  proof: {
    housesBought: 0, // TODO: real count; 0 hides the stat
    googleReviewCount: 0, // TODO: real count; 0 hides the review badge
    googleReviewUrl: "", // TODO: Google Business Profile review link
    googleRating: 5.0,
  },

  // ── Intro video (spec §5) — YouTube unlisted ID; empty hides the embed ─────
  introVideoId: "", // TODO: e.g. "dQw4w9WgXcQ"

  counties: "Monmouth, Ocean, Middlesex, Somerset, Union, Hudson, Essex and Mercer",
} as const;

/** Entity name for footer/legal copy, falling back to the site name. */
export function entityName(): string {
  return site.legal.entityName || site.name;
}

/**
 * The exact consent text shown next to the checkbox. The API route stores this
 * string with every lead so the artifact is provable per-lead — if you edit
 * the wording, old leads keep the wording they actually agreed to.
 */
export const CONSENT_TEXT =
  `I agree that ${site.name} may call or text me at the number provided ` +
  `about my inquiry. Msg/data rates may apply. Reply STOP to opt out.`;
