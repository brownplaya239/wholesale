/**
 * Internal acquisition worksheet. Every input is an ASSUMPTION (editable in
 * the report) except where `basis` names a sourced fact. Output is for
 * Sumeet's review only — nothing here is ever sent to a homeowner.
 */
import type { Dossier } from "./types";

export type WorksheetInputs = {
  asIsValue: number | null;
  arv: number | null;
  livingSpace: number | null;
  repairPerSqft: number;
  repairFlat: number;
  holdMonths: number;
  monthlyTaxes: number;
  monthlyInsurance: number;
  monthlyUtilities: number;
  purchaseClosingPct: number;
  saleCommissionPct: number;
  saleClosingPct: number;
  targetProfitPct: number;
  assignmentFee: number;
  listCommissionPct: number;
  listSellerClosingPct: number;
  listCarryMonths: number;
};

export type WorksheetBasis = Partial<Record<keyof WorksheetInputs, string>>;

/** Repair budget assumptions by seller-reported condition. */
export const CONDITION_REPAIRS: Record<string, { perSqft: number; flat: number }> = {
  "Move-in ready": { perSqft: 5, flat: 10_000 },
  "Needs minor updates": { perSqft: 20, flat: 35_000 },
  "Needs major repairs": { perSqft: 45, flat: 75_000 },
  "Needs a full renovation": { perSqft: 75, flat: 120_000 },
};
const UNKNOWN_CONDITION = { perSqft: 30, flat: 50_000 };

export function defaultWorksheet(d: Dossier, condition: string | null): { inputs: WorksheetInputs; basis: WorksheetBasis } {
  const v = d.comps.data?.valuation ?? null;
  const sqft = d.characteristics.livingSpace.value;
  const taxes = d.parcel.data?.lastYearTaxes ?? null;
  const rep = (condition && CONDITION_REPAIRS[condition]) || UNKNOWN_CONDITION;
  const basis: WorksheetBasis = {
    asIsValue: v ? `Comp-based estimate (${v.confidence} confidence)` : "No comp-based estimate — enter manually",
    arv: v ? "Assumption: upper quartile of comps ≈ renovated condition — verify with renovated comps" : "Enter manually",
    livingSpace: d.characteristics.livingSpace.source ? `Source: ${d.characteristics.livingSpace.source.name}` : "Unknown — enter from walkthrough",
    repairPerSqft: condition ? `Assumption for "${condition}" (seller-reported)` : "Assumption — condition not reported",
    monthlyTaxes: taxes ? `Last year's taxes ÷ 12 (MOD-IV tax list)` : "Assumption — taxes not on record",
  };
  return {
    basis,
    inputs: {
      asIsValue: v?.mid ?? null,
      arv: v?.high ?? null,
      livingSpace: sqft,
      repairPerSqft: rep.perSqft,
      repairFlat: rep.flat,
      holdMonths: 6,
      monthlyTaxes: taxes ? Math.round(taxes / 12) : 800,
      monthlyInsurance: 150,
      monthlyUtilities: 250,
      purchaseClosingPct: 1.5,
      saleCommissionPct: 5,
      saleClosingPct: 1.5,
      targetProfitPct: 15,
      assignmentFee: 15_000,
      listCommissionPct: 5,
      listSellerClosingPct: 1.5,
      listCarryMonths: 3,
    },
  };
}

export type WorksheetResult = {
  repairs: number;
  carrying: number;
  purchaseClosing: number;
  disposition: number;
  targetProfit: number;
  maxPurchase: number | null;
  rule70: number | null;
  wholesaleOffer: number | null;
  listingNet: number | null;
  monthlyCarry: number;
};

const r100 = (v: number) => Math.round(v / 100) * 100;

export function computeWorksheet(i: WorksheetInputs): WorksheetResult {
  const repairs = i.livingSpace ? i.livingSpace * i.repairPerSqft : i.repairFlat;
  const monthlyCarry = i.monthlyTaxes + i.monthlyInsurance + i.monthlyUtilities;
  const carrying = monthlyCarry * i.holdMonths;
  const purchaseClosing = ((i.asIsValue ?? 0) * i.purchaseClosingPct) / 100;
  const disposition = ((i.arv ?? 0) * (i.saleCommissionPct + i.saleClosingPct)) / 100;
  const targetProfit = ((i.arv ?? 0) * i.targetProfitPct) / 100;
  const maxPurchase = i.arv ? i.arv - repairs - carrying - purchaseClosing - disposition - targetProfit : null;
  const listingNet = i.asIsValue
    ? i.asIsValue * (1 - (i.listCommissionPct + i.listSellerClosingPct) / 100) - monthlyCarry * i.listCarryMonths
    : null;
  return {
    repairs: r100(repairs),
    carrying: r100(carrying),
    purchaseClosing: r100(purchaseClosing),
    disposition: r100(disposition),
    targetProfit: r100(targetProfit),
    maxPurchase: maxPurchase == null ? null : r100(maxPurchase),
    rule70: i.arv ? r100(i.arv * 0.7 - repairs) : null,
    wholesaleOffer: maxPurchase == null ? null : r100(maxPurchase - i.assignmentFee),
    listingNet: listingNet == null ? null : r100(listingNet),
    monthlyCarry,
  };
}
