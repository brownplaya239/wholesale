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
  // www is the primary host (apex 308-redirects to it) — keep canonical URLs on www.
  url: "https://www.housesoldnj.com",
  name: "House Sold NJ",

  // ── The named, licensed principal ──────────────────────────────────────────
  principal: {
    firstName: "Sumeet",
    fullName: "Sumeet Sancheti",
    // NJ REC advertising disclosure — license status in writing on every page.
    licenseLine: "NJ Licensed Real Estate Salesperson",
    licenseNumber: "2082408",
    brokerage: "Coldwell Banker Realty",
    photo: "/sum.jpg",
    base: "Based in Monmouth County",
  },

  // ── Contact ────────────────────────────────────────────────────────────────
  phone: {
    // Sumeet's cell. TODO: swap for a CallRail-tracked local number before
    // scaling ad spend (keeps attribution; never toll-free).
    display: "(908) 596-0242",
    e164: "+19085960242",
    hours: "8am–9pm, 7 days",
  },
  email: "sum@housesoldnj.com", // TODO: confirm this inbox exists on the domain

  // ── Legal entity (footer facts — anonymous footers kill trust) ─────────────
  legal: {
    entityName: "", // TODO: e.g. "House Sold NJ LLC" — falls back to site name
    officeAddress:
      "Coldwell Banker Realty — Monmouth-Ocean Regional Office, 335 Route 9 South, Manalapan, NJ 07726 · Office (732) 462-4242",
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
