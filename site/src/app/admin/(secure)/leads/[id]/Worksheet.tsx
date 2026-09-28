"use client";

import { useState } from "react";
import { computeWorksheet, type WorksheetBasis, type WorksheetInputs } from "@/lib/enrich/worksheet";

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

type FieldDef = { key: keyof WorksheetInputs; label: string; unit?: "$" | "%" | "mo" | "sf" };

const FIELDS: FieldDef[] = [
  { key: "asIsValue", label: "Estimated as-is value", unit: "$" },
  { key: "arv", label: "Potential renovated value (ARV)", unit: "$" },
  { key: "livingSpace", label: "Living area", unit: "sf" },
  { key: "repairPerSqft", label: "Repairs per sq ft", unit: "$" },
  { key: "repairFlat", label: "Repairs (if sq ft unknown)", unit: "$" },
  { key: "holdMonths", label: "Hold period", unit: "mo" },
  { key: "monthlyTaxes", label: "Taxes / month", unit: "$" },
  { key: "monthlyInsurance", label: "Insurance / month", unit: "$" },
  { key: "monthlyUtilities", label: "Utilities / month", unit: "$" },
  { key: "purchaseClosingPct", label: "Purchase closing costs", unit: "%" },
  { key: "saleCommissionPct", label: "Resale commission", unit: "%" },
  { key: "saleClosingPct", label: "Resale closing costs", unit: "%" },
  { key: "targetProfitPct", label: "Target profit (of ARV)", unit: "%" },
  { key: "assignmentFee", label: "Assignment fee (if wholesaled)", unit: "$" },
  { key: "listCommissionPct", label: "Listing commission", unit: "%" },
  { key: "listSellerClosingPct", label: "Seller closing costs (listing)", unit: "%" },
  { key: "listCarryMonths", label: "Months to sell (listing)", unit: "mo" },
];

export default function Worksheet({ initial, basis }: { initial: WorksheetInputs; basis: WorksheetBasis }) {
  const [inputs, setInputs] = useState<WorksheetInputs>(initial);
  const r = computeWorksheet(inputs);
  const set = (k: keyof WorksheetInputs, raw: string) =>
    setInputs((cur) => ({ ...cur, [k]: raw === "" ? null : Number(raw) }) as WorksheetInputs);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-900">Assumptions — edit freely</p>
        <div className="mt-2 grid gap-x-3 gap-y-2 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="text-xs text-ink-soft">
              {f.label}
              <div className="mt-0.5 flex items-center rounded-md border border-line bg-white">
                {f.unit === "$" && <span className="pl-2 text-ink-soft">$</span>}
                <input
                  type="number"
                  inputMode="decimal"
                  value={inputs[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="w-full rounded-md px-2 py-1.5 text-sm text-ink focus:outline-none"
                />
                {f.unit && f.unit !== "$" && <span className="pr-2 text-ink-soft">{f.unit}</span>}
              </div>
              {basis[f.key] && <span className="mt-0.5 block text-[11px] leading-tight text-amber-900/80">{basis[f.key]}</span>}
            </label>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-amber-300 bg-white p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-900">Estimated economics</p>
        <dl className="mt-2 space-y-1.5 text-sm">
          {[
            ["Repairs", r.repairs],
            ["Carrying (hold period)", r.carrying],
            ["Purchase closing costs", r.purchaseClosing],
            ["Disposition (resale costs)", r.disposition],
            ["Target profit", r.targetProfit],
          ].map(([label, v]) => (
            <div key={label as string} className="flex justify-between gap-3">
              <dt className="text-ink-soft">{label}</dt>
              <dd className="tabular-nums">{money(v as number)}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex justify-between gap-3">
            <p className="font-bold">Preliminary maximum purchase price</p>
            <p className="text-lg font-extrabold tabular-nums">{money(r.maxPurchase)}</p>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <p className="text-ink-soft">Check: 70% of ARV − repairs</p>
            <p className="tabular-nums">{money(r.rule70)}</p>
          </div>
          <div className="flex justify-between gap-3 text-sm">
            <p className="text-ink-soft">If assigned: max offer to seller (after fee)</p>
            <p className="tabular-nums">{money(r.wholesaleOffer)}</p>
          </div>
          <div className="flex justify-between gap-3 border-t border-line pt-2">
            <p className="font-bold">Estimated net to seller if listed as-is</p>
            <p className="text-lg font-extrabold tabular-nums">{money(r.listingNet)}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-soft">
          Estimates for your review only. Nothing on this page is ever sent to the homeowner automatically.
        </p>
      </div>
    </div>
  );
}
