"use client";

import { useEffect, useState } from "react";
import { recallLead, type RememberedLead } from "@/lib/lead";

/** Personalized confirmation — falls back to generic copy on a direct visit. */
export default function ThankYouHero() {
  const [lead, setLead] = useState<RememberedLead | null>(null);
  useEffect(() => setLead(recallLead()), []);
  const first = lead?.name.split(/\s+/)[0];
  const address = lead?.extras?.addressEdit || lead?.address;
  const unit = lead?.extras?.unit;
  return (
    <div className="text-center">
      <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-trust/10">
        <svg aria-hidden className="h-8 w-8 text-trust" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      </div>
      <h1 className="text-balance text-4xl font-extrabold tracking-tight">
        {first ? `Thanks, ${first} — we've got it.` : "Got it — here's what happens next."}
      </h1>
      {address ? (
        <div className="mx-auto mt-5 max-w-lg rounded-2xl border border-trust/30 bg-trust/5 px-5 py-4 text-left">
          <p className="text-xs font-bold uppercase tracking-wide text-trust">Request received for</p>
          <p className="mt-1 text-lg font-semibold text-ink">
            {address.replace(/,?\s*USA$/i, "")}
            {unit ? `, Unit ${unit}` : ""}
          </p>
          <a href="#details" className="mt-1 inline-block text-sm text-ink-soft underline">
            Wrong address, or missing a unit number? Fix it below.
          </a>
        </div>
      ) : (
        <p className="mt-3 text-sm font-medium text-trust">Your property information has been received successfully.</p>
      )}
    </div>
  );
}
