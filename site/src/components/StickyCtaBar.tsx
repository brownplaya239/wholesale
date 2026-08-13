"use client";

import { useEffect, useState } from "react";
import PhoneLink from "@/components/PhoneLink";

/**
 * Mobile sticky bottom bar (spec §1/§3): call button + "Get My Offer" that
 * scrolls back to the form. Hidden on >=sm screens. On pages without a form
 * (e.g. /thank-you) the offer button drops and Call/Text goes full-width.
 */
export default function StickyCtaBar() {
  const [hasForm, setHasForm] = useState(true);
  useEffect(() => {
    setHasForm(!!document.querySelector("[data-lead-form-anchor]"));
  }, []);
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white/95 p-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden"
      role="region"
      aria-label="Quick actions"
    >
      <div className="mx-auto flex max-w-xl gap-2.5">
        <PhoneLink
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-base font-bold ${
            hasForm
              ? "border-2 border-accent text-accent"
              : "bg-accent text-white"
          }`}
        >
          <svg aria-hidden className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.15a1.5 1.5 0 0 1 1.47 1.19l.54 2.54a1.5 1.5 0 0 1-.83 1.66l-1.1.55a11.05 11.05 0 0 0 5.33 5.33l.55-1.1a1.5 1.5 0 0 1 1.66-.83l2.54.54A1.5 1.5 0 0 1 18 13.35v1.15a1.5 1.5 0 0 1-1.5 1.5H15C7.82 16 2 10.18 2 3v.5Z" />
          </svg>
          Call / Text
        </PhoneLink>
        {hasForm && (
          <button
            type="button"
            onClick={() => {
              document
                .querySelector("[data-lead-form-anchor]")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="flex-1 rounded-lg bg-accent px-4 py-3 text-base font-bold text-white"
          >
            Get My Offer
          </button>
        )}
      </div>
    </div>
  );
}
