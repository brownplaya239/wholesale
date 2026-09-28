/** Photo-check vocabulary, shared by the vision call, scoring and the email. */
export const PHOTO_INDICATORS = [
  "roof_tarp",
  "roof_damage",
  "boarded_or_broken_windows",
  "structural_damage",
  "exterior_disrepair",
  "overgrown_yard",
  "debris_or_junk",
  "neglected_pool",
  "vacancy_cues",
  "renovation_in_progress",
] as const;

export type PhotoIndicator = (typeof PHOTO_INDICATORS)[number];

export const INDICATOR_LABEL: Record<PhotoIndicator, string> = {
  roof_tarp: "tarp on the roof",
  roof_damage: "roof damage",
  boarded_or_broken_windows: "boarded or broken windows",
  structural_damage: "structural damage",
  exterior_disrepair: "exterior disrepair",
  overgrown_yard: "overgrown yard",
  debris_or_junk: "debris or junk",
  neglected_pool: "neglected pool",
  vacancy_cues: "looks vacant",
  renovation_in_progress: "renovation in progress",
};

export type PhotoFinding = {
  indicator: PhotoIndicator;
  seen_in: "street_view" | "satellite";
  confidence: "high" | "medium" | "low";
  detail: string;
};

export type PhotoCheck = {
  street_view: {
    view: "clear" | "partly_obstructed" | "house_not_visible" | "not_provided";
    house_number: "matches" | "different" | "not_visible" | "not_provided";
  };
  satellite: { view: "clear" | "unclear" | "not_provided" };
  findings: PhotoFinding[];
  overall: "none" | "minor" | "moderate" | "severe" | "unclear";
  summary: string;
  streetViewDate: string | null;
  model: string;
};
