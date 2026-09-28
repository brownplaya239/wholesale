/**
 * The property dossier: everything enrichment learned about a lead's
 * property, with provenance on every section. Nothing in here is estimated
 * unless it lives under `comps.valuation` (computed from the listed comps) —
 * and a field with no source is `null` with a status saying why.
 */

export type FactStatus =
  | "ok" // retrieved from the named source
  | "missing" // source consulted, no record/value for this property
  | "not_configured" // needs a licensed provider or credential not set up
  | "not_available" // no source exists for this in NJ public data
  | "error"; // source failed after retries

export type SourceRef = {
  id: string;
  name: string;
  url?: string;
  /** When the source's data was last updated (publisher's date), if known. */
  asOf?: string | null;
  /** When we fetched it. */
  retrievedAt: string;
};

export type Section<T> = {
  status: FactStatus;
  data: T | null;
  source: SourceRef | null;
  note?: string;
  error?: string;
};

export type Fact<T> = { value: T | null; status: FactStatus; source: SourceRef | null; note?: string };

export type MatchStatus = "exact" | "interpolated" | "low_confidence" | "not_found";

export type GeocodeData = {
  standardized: string;
  lat: number;
  lng: number;
  score: number;
  matchType: string;
  match: MatchStatus;
  county: string | null;
  city: string | null;
  postal: string | null;
  unit: string | null;
};

export type PropertyKind = "single_family" | "condo" | "multifamily" | "land" | "other";

export type ParcelData = {
  pin: string;
  muncode: string;
  municipality: string;
  county: string;
  block: string;
  lot: string;
  qualifier: string;
  propClass: string;
  propClassLabel: string;
  kind: PropertyKind;
  location: string;
  buildingDesc: string | null;
  landDesc: string | null;
  acres: number | null;
  dwellings: number | null;
  yearBuilt: number | null;
  assessed: { land: number | null; improvement: number | null; net: number | null };
  lastYearTaxes: number | null;
  owner: { name: string | null; mailing: string | null; mailingState: string | null; absentee: boolean | null };
  lastSale: { date: string | null; price: number | null; deedBook: string | null; deedPage: string | null } | null;
  /** Parcel outline as [lng, lat] rings. For condo units: the building/complex lot. */
  rings: [number, number][][] | null;
  /** Other records sharing this footprint (condo units, etc.). */
  siblings: number;
};

export type UnitStatus = "not_applicable" | "matched" | "unmatched" | "needs_unit";

export type UnitInfo = {
  status: UnitStatus;
  requested: string | null;
  note?: string;
  candidates?: { pin: string; location: string }[];
};

export type DeedRecord = {
  date: string | null;
  recorded: string | null;
  price: number | null;
  usable: boolean;
  nuCode: string | null;
  nuLabel: string | null;
  livingSpace: number | null;
  yearBuilt: number | null;
  propClass: string | null;
  location: string | null;
  sourceFile: string;
};

export type FloodData = {
  zone: string | null;
  subtype: string | null;
  sfha: boolean | null;
  baseFloodElevation: number | null;
  firmPanel: string | null;
};

export type MarketStats = {
  municipality: string;
  windowDays: number;
  sales: number;
  medianPrice: number | null;
  p25Price: number | null;
  p75Price: number | null;
  medianPpsf: number | null;
  from: string;
  to: string;
  segment: string;
};

export type Comp = {
  pin: string;
  address: string;
  municipality: string | null;
  saleDate: string;
  price: number;
  livingSpace: number | null;
  ppsf: number | null;
  yearBuilt: number | null;
  distanceMi: number | null;
  dwellings: number | null;
  acres: number | null;
  pricePerUnit: number | null;
  pricePerAcre: number | null;
  sameBuilding: boolean;
  differences: string[];
  score: number;
  lat: number | null;
  lng: number | null;
};

export type Valuation = {
  low: number;
  mid: number;
  high: number;
  method: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

export type CompsResult = {
  kind: PropertyKind;
  comps: Comp[];
  steps: { label: string; qualifying: number }[];
  windowDays: number;
  radiusMi: number | null;
  valuation: Valuation | null;
  note?: string;
};

export type ProviderProperty = {
  bedrooms: number | null;
  bathrooms: number | null;
  squareFootage: number | null;
  lotSize: number | null;
  yearBuilt: number | null;
  propertyType: string | null;
  lastSaleDate: string | null;
  lastSalePrice: number | null;
  ownerOccupied: boolean | null;
  history: { date: string; event: string; price: number | null }[];
};

export type ProviderAvm = {
  price: number | null;
  low: number | null;
  high: number | null;
  listingComps: { address: string; price: number | null; status: string | null; distance: number | null; squareFootage: number | null; date: string | null }[];
};

export type ProviderRent = { rent: number | null; low: number | null; high: number | null };

export type ProviderListing = {
  address: string;
  price: number | null;
  status: string | null;
  listedDate: string | null;
  daysOnMarket: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFootage: number | null;
};

export type Characteristics = {
  livingSpace: Fact<number>;
  yearBuilt: Fact<number>;
  bedrooms: Fact<number>;
  bathrooms: Fact<number>;
  lotAcres: Fact<number>;
  dwellings: Fact<number>;
};

export type Conflict = { field: string; values: { value: string; source: string }[] };

export type Insights = {
  tags: string[];
  risks: string[];
  missing: string[];
  recommended: string[];
};

export type Dossier = {
  version: 1;
  generatedAt: string;
  input: { address: string; unit: string | null };
  geocode: Section<GeocodeData>;
  parcel: Section<ParcelData>;
  unit: UnitInfo;
  characteristics: Characteristics;
  conflicts: Conflict[];
  history: Section<DeedRecord[]>;
  flood: Section<FloodData>;
  zoning: Section<null>;
  distress: Section<{ indicators: string[] }>;
  market: Section<MarketStats>;
  comps: Section<CompsResult>;
  provider: {
    property: Section<ProviderProperty>;
    avm: Section<ProviderAvm>;
    rent: Section<ProviderRent>;
    listings: Section<ProviderListing[]>;
  };
  insights: Insights;
  sources: SourceRef[];
};
