/**
 * One entry = one indexable situation page at /{slug}.
 * These double as high-Quality-Score PPC targets and as proof we've seen the
 * seller's problem before (spec §5). Each explainer is NJ-specific on purpose:
 * national-template genericness is the #1 scam tell.
 */

export type Situation = {
  slug: string;
  name: string; // short label for nav/links
  headline: string; // page H1
  /** PPC landing headline template — "{geo}" is replaced with "Town, NJ". */
  lpHeadline: string;
  metaDescription: string;
  // Short empathetic opener — calm, factual, no hype.
  lead: string;
  // "Here's how this works in NJ" — the substance of the page.
  njExplainer: { heading: string; body: string }[];
  faq: { q: string; a: string }[];
};

export const situations: Situation[] = [
  {
    slug: "probate",
    name: "Probate",
    headline: "Selling a House in Probate in New Jersey",
    lpHeadline: "Sell a Probate House Fast in {geo}",
    metaDescription:
      "How probate house sales work in NJ — executor authority, surrogate court, and how to sell an estate property for cash without repairs.",
    lead:
      "Settling an estate is paperwork-heavy and slow, and the house is usually the biggest, most stressful piece. Here's how it actually works in New Jersey, and how we can take the house part off your plate.",
    njExplainer: [
      {
        heading: "Probate in NJ is simpler than most states",
        body:
          "New Jersey probate runs through the county Surrogate's Court and can usually be opened 10 days after death. Once the executor or administrator receives their Letters (Testamentary or of Administration), they generally have authority to sell estate real estate — often without a separate court approval, unless the will says otherwise.",
      },
      {
        heading: "You don't need to clear out or fix up the house",
        body:
          "We buy estate houses exactly as they sit — furniture, decades of belongings, deferred maintenance and all. Take the photos and keepsakes you want; leave the rest to us.",
      },
      {
        heading: "Watch the NJ estate paperwork",
        body:
          "Inheritance tax waivers (Form L-9 for Class A beneficiaries) and lien releases can hold up a closing if nobody flags them early. Our attorney has closed estate sales before and will walk yours through the sequence.",
      },
      {
        heading: "Cash offer or list it — the estate's choice",
        body:
          "Sometimes the right answer for the heirs is a fast, certain cash sale. Sometimes it's listing the house to maximize the estate. We'll show you both numbers honestly — Sum is a licensed NJ agent and can do either.",
      },
    ],
    faq: [
      {
        q: "Can the executor sell before probate is complete?",
        a: "In most NJ cases, yes — once the Surrogate issues Letters, the executor can contract to sell estate real estate. Closing waits for any required tax waivers. We time our closings around that.",
      },
      {
        q: "What if the heirs disagree?",
        a: "It happens in a lot of estates. We can hold our offer open while the family works it out, and we're happy to walk every heir through the numbers on the same call.",
      },
    ],
  },
  {
    slug: "inherited-house",
    name: "Inherited house",
    headline: "Sell an Inherited House in New Jersey",
    lpHeadline: "Sell Your Inherited House in {geo}",
    metaDescription:
      "Inherited a house in NJ? Your options — keep, list, or sell for cash — plus taxes, the stepped-up basis, and selling a house full of belongings.",
    lead:
      "An inherited house usually comes with belongings to sort, taxes to figure out, maybe siblings to agree with — and carrying costs every month while you decide. There's no rush, but here's the honest map.",
    njExplainer: [
      {
        heading: "The stepped-up basis usually works in your favor",
        body:
          "Inherited property generally gets a stepped-up basis to its value at the date of death, so selling soon after inheriting often means little or no capital gains tax. Confirm with your accountant — but for most heirs, waiting doesn't save taxes; it just adds carrying costs.",
      },
      {
        heading: "NJ inheritance tax depends on who inherits",
        body:
          "Spouses, children and grandchildren (Class A) pay no NJ inheritance tax. Siblings, nieces, nephews and non-relatives can owe it, and the state's lien has to be cleared before or at closing. This trips up more NJ estate sales than anything else — we plan for it up front.",
      },
      {
        heading: "The house can be sold full",
        body:
          "You do not need to empty it. We buy houses with every closet and basement full, and we coordinate the cleanout after closing.",
      },
      {
        heading: "Two honest numbers",
        body:
          "We'll give you a cash offer AND what we think it would net after listing, repairs, and time on market. If listing wins for you, Sum can list it — that's the licensed-agent advantage.",
      },
    ],
    faq: [
      {
        q: "The deed is still in my parent's name. Can I sell?",
        a: "Yes — the sale is done through the estate. The executor/administrator signs, and title passes at closing. You don't need to re-deed it to yourself first in most cases.",
      },
      {
        q: "Three of us inherited it. Do we all have to agree?",
        a: "All owners (or the executor, if it's still in the estate) sign the contract. We're used to coordinating signatures across multiple heirs in different states.",
      },
    ],
  },
  {
    slug: "foreclosure",
    name: "Foreclosure",
    headline: "Stop a New Jersey Foreclosure by Selling Your House",
    lpHeadline: "Stop Foreclosure in {geo} — Sell Fast, Keep Your Equity",
    metaDescription:
      "Behind on your NJ mortgage? How the foreclosure timeline works, why NJ's process gives you time to sell, and how a fast sale protects your equity.",
    lead:
      "Falling behind doesn't mean losing everything. New Jersey's foreclosure process is one of the slowest in the country — which means if you act, you almost always have time to sell, pay the loan off, and keep your equity instead of losing it at auction.",
    njExplainer: [
      {
        heading: "NJ foreclosures are judicial — you have time",
        body:
          "Every NJ foreclosure goes through court, and the process commonly takes a year or more from the first missed payments to a sheriff's sale. A Notice of Intention to Foreclose, a filed complaint, even a judgment — none of these mean it's over. Until the sheriff's sale is final, you can generally sell.",
      },
      {
        heading: "Selling protects the equity a sheriff's sale burns",
        body:
          "At auction, your house can go for far less than it's worth, and fees stack up the whole way. A private sale — cash to us, or listed — pays off the bank and puts the remaining equity in your pocket, not the process's.",
      },
      {
        heading: "We move at foreclosure speed",
        body:
          "Proof of funds with the offer, attorney-reviewed contract, and closings in as little as two to three weeks. If a sheriff's sale date is close, NJ also allows adjournments — your attorney can often buy the extra weeks a sale needs.",
      },
      {
        heading: "If selling isn't the right answer, we'll say so",
        body:
          "Reinstatement, loan modification, or listing the house may serve you better — it depends on your numbers. We'll lay out the options like a licensed professional, not a rescue-scam artist. Be careful out there: never sign a deed over to anyone promising to 'save' your house.",
      },
    ],
    faq: [
      {
        q: "I got a sheriff's sale date. Is it too late?",
        a: "Usually not. NJ lets homeowners request adjournments of a sheriff's sale, and lenders often postpone when a real closing is scheduled. Call us — timing is everything at this stage.",
      },
      {
        q: "Will you talk to my lender?",
        a: "With your written authorization, yes — we and your attorney can coordinate the payoff figures directly so nothing stalls.",
      },
    ],
  },
  {
    slug: "tired-landlord",
    name: "Tired landlord",
    headline: "Sell Your NJ Rental Property — Tenants and All",
    lpHeadline: "Sell Your {geo} Rental Property — Tenants and All",
    metaDescription:
      "Done being a landlord in NJ? Sell your rental with tenants in place — occupied, behind on rent, or mid-eviction. Cash offer, no showings.",
    lead:
      "Chasing rent, court dates, 2am calls, one more capex bill — at some point the spreadsheet stops justifying it. You don't have to empty the building to exit. We buy NJ rentals occupied.",
    njExplainer: [
      {
        heading: "Tenants in place are fine — really",
        body:
          "Paying, non-paying, month-to-month, mid-eviction, inherited tenants you've never met: we buy with tenants in place and take over the landlord relationship at closing. No need to non-renew anyone just to sell.",
      },
      {
        heading: "NJ tenant law transfers with the deed, and we know it",
        body:
          "The Anti-Eviction Act, security-deposit transfer rules, rent control in some cities — these follow the property, and buyers who don't know them get hurt. We do this deliberately; your sale doesn't depend on pretending the rules aren't there.",
      },
      {
        heading: "No showings, no tenant drama",
        body:
          "Listing an occupied rental means parading buyers through a tenant's home — awkward at best, sabotaged at worst. We typically need one walkthrough, scheduled with proper notice, and that's it.",
      },
      {
        heading: "1031 or cash out — your call",
        body:
          "If you're exchanging into something more passive, we can time the closing for your 1031 window. If you're just done, we'll make it clean.",
      },
    ],
    faq: [
      {
        q: "My tenant is behind on rent and won't leave. Do I have to evict before selling?",
        a: "No. We buy properties mid-nonpayment and even mid-eviction, and we price openly around it — you'll see the math.",
      },
      {
        q: "What about the security deposits?",
        a: "NJ law requires deposits (plus interest) to transfer to the buyer at closing, who then owes the tenant the accounting. It's a standard line item on our settlement statement.",
      },
    ],
  },
  {
    slug: "divorce",
    name: "Divorce",
    headline: "Selling a House During a Divorce in New Jersey",
    lpHeadline: "Sell the House in Your {geo} Divorce — Fast and Neutral",
    metaDescription:
      "Selling the marital home in an NJ divorce — neutral, fast, and fair to both sides. Cash offer or honest listing advice, either way with real numbers.",
    lead:
      "The house is usually the biggest asset on the table and the last thing either of you wants to keep negotiating over. A clean, documented sale — at a number both attorneys can verify — is often what finally lets everyone move forward.",
    njExplainer: [
      {
        heading: "Equitable distribution needs a real number",
        body:
          "NJ divides marital property by equitable distribution, and the house's value is where settlements stall. A written cash offer from a verifiable buyer — with proof of funds — gives both attorneys a hard number to work with, whether or not you take it.",
      },
      {
        heading: "We work with both sides, neutrally",
        body:
          "We're happy to present the same numbers to both spouses and both attorneys, on the same call or separately. No side deals, no pressure — the offer is the offer.",
      },
      {
        heading: "Speed lowers the temperature",
        body:
          "Months of showings, staging, and price drops keep two people tied together financially. A two-to-three-week cash closing converts the house to divisible dollars and ends the joint mortgage liability.",
      },
      {
        heading: "Or list it — with the math in writing",
        body:
          "If the settlement timeline allows and listing nets meaningfully more, we'll say so and show the comparison. Sum is a licensed NJ agent; both paths are on the table.",
      },
    ],
    faq: [
      {
        q: "Do both spouses have to sign?",
        a: "If both are on the deed, yes — and in NJ even a non-titled spouse generally must join in the deed for the marital home. Your attorneys will confirm; our contract accounts for it.",
      },
      {
        q: "Can you wait until our settlement is finalized?",
        a: "Yes. We can sign now with a closing date keyed to the settlement, or simply hold the offer while the agreement is drafted.",
      },
    ],
  },
  {
    slug: "house-needs-repairs",
    name: "House needs repairs",
    headline: "Sell a House That Needs Work in New Jersey — Truly As-Is",
    lpHeadline: "Sell Your {geo} House As-Is — Any Condition",
    metaDescription:
      "Major repairs, fire or water damage, hoarding, failed inspections, open permits — sell your NJ house as-is for cash. No cleanout, no contractors.",
    lead:
      "Roof, foundation, mold, a kitchen from 1974, rooms you'd rather nobody photographed — houses like this get quietly turned away by agents and torn apart by retail buyers' inspection reports. It's the exact house we buy.",
    njExplainer: [
      {
        heading: "As-is means as-is",
        body:
          "No repairs, no cleanout, no staging, no inspection-repair credits. We price the work into our offer and show you that math — you'll see the repair budget line, not a black box.",
      },
      {
        heading: "NJ's paperwork gotchas, handled",
        body:
          "Open permits, municipal certificate-of-occupancy or smoke-cert requirements, oil tanks (buried tanks are an NJ classic), and code violations all have known fixes. We've dealt with each and price them calmly instead of running away.",
      },
      {
        heading: "Hoarding and full houses are not a problem",
        body:
          "Take what matters to you; leave everything else. The cleanout happens after closing, on our dime. Nobody will make you tour people through it.",
      },
      {
        heading: "Sometimes a light cleanup + listing wins — we'll tell you",
        body:
          "If the house is closer to retail-ready than you think, listing may net you meaningfully more even after concessions. We'll show both numbers. That's the promise on every house.",
      },
    ],
    faq: [
      {
        q: "Do I need to get the open permits closed before selling?",
        a: "Not for a sale to us — we take title subject to them and handle the resolution. (Retail buyers' lenders usually won't allow that, which is why these houses stall on the MLS.)",
      },
      {
        q: "The house isn't safe to enter. Can you still buy it?",
        a: "Yes. We can often make an offer from an exterior visit plus whatever records exist, with a short verification window after contract.",
      },
    ],
  },
];

export function getSituation(slug: string): Situation | undefined {
  return situations.find((s) => s.slug === slug);
}
