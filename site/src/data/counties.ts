/**
 * One entry = one indexable county page at /{slug}.
 *
 * Local specificity is the anti-scam tell (spec §5): real towns, real proof
 * points. `proofPoint` and `testimonial` are OPTIONAL — leave them undefined
 * until there's a REAL closed deal / quote to cite. Never invent one.
 */

export type Testimonial = {
  quote: string;
  // Full first name + town — "Maria R., Neptune". Never initials.
  attribution: string;
};

export type County = {
  slug: string;
  name: string; // "Monmouth County"
  short: string; // "Monmouth"
  towns: string[];
  intro: string;
  proofPoint?: string; // e.g. "Bought as-is in Keansburg, closed in 19 days."
  testimonial?: Testimonial;
};

export const counties: County[] = [
  {
    slug: "monmouth-county",
    name: "Monmouth County",
    short: "Monmouth",
    towns: [
      "Neptune", "Keansburg", "Long Branch", "Asbury Park", "Freehold",
      "Middletown", "Hazlet", "Red Bank", "Ocean Township", "Howell",
    ],
    intro:
      "This is home base — we're located in Monmouth County and most of the houses we look at are here. Shore towns, bayshore towns, and everything along Route 9: we know the streets, the flood zones, and what houses actually trade for.",
  },
  {
    slug: "ocean-county",
    name: "Ocean County",
    short: "Ocean",
    towns: [
      "Toms River", "Brick", "Lakewood", "Jackson", "Berkeley Township",
      "Manchester", "Point Pleasant", "Barnegat",
    ],
    intro:
      "From Toms River and Brick down through Barnegat, Ocean County has a lot of older housing stock, adult communities, and homes still carrying storm-era issues. We buy houses here as-is — flood history, open permits, and all.",
  },
  {
    slug: "middlesex-county",
    name: "Middlesex County",
    short: "Middlesex",
    towns: [
      "Edison", "Woodbridge", "New Brunswick", "Perth Amboy", "Old Bridge",
      "Sayreville", "Piscataway", "South River",
    ],
    intro:
      "Middlesex moves fast and demand from buyers is deep — which means even a house that needs serious work has real value. We'll tell you what that value is, whether you sell to us or list it.",
  },
  {
    slug: "somerset-county",
    name: "Somerset County",
    short: "Somerset",
    towns: [
      "Franklin Township", "Bridgewater", "North Plainfield", "Somerville",
      "Bound Brook", "Manville", "Hillsborough",
    ],
    intro:
      "From Manville's flood-prone blocks to older colonials in Somerville and Bound Brook, we work with Somerset County owners who need a straightforward exit without months of showings.",
  },
  {
    slug: "union-county",
    name: "Union County",
    short: "Union",
    towns: [
      "Elizabeth", "Plainfield", "Linden", "Union Township", "Rahway",
      "Roselle", "Hillside",
    ],
    intro:
      "Union County's two- and three-family houses, tenant situations, and estate properties are exactly the kind of purchases we handle. Tenants in place is not a problem — we buy occupied.",
  },
  {
    slug: "hudson-county",
    name: "Hudson County",
    short: "Hudson",
    towns: [
      "Jersey City", "Bayonne", "Union City", "North Bergen", "Kearny",
      "West New York",
    ],
    intro:
      "Hudson County rowhouses and multifamilies come with their own math — rent control, tenants, tight lots. We know it, we buy occupied, and we close on your timeline.",
  },
  {
    slug: "essex-county",
    name: "Essex County",
    short: "Essex",
    towns: [
      "Newark", "East Orange", "Irvington", "Bloomfield", "Orange",
      "Belleville", "Nutley",
    ],
    intro:
      "Inherited houses, houses with liens, houses that have sat vacant — Essex County has plenty of all three, and we've seen how each one gets resolved. Bring us the complicated one.",
  },
  {
    slug: "mercer-county",
    name: "Mercer County",
    short: "Mercer",
    towns: [
      "Trenton", "Hamilton", "Ewing", "Lawrence", "Hightstown",
    ],
    intro:
      "From Trenton rowhomes to Hamilton split-levels, we make fair cash offers across Mercer County — and if listing would genuinely net you more, we'll say so.",
  },
];

export function getCounty(slug: string): County | undefined {
  return counties.find((c) => c.slug === slug);
}
