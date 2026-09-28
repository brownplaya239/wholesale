import type { Metadata } from "next";
import Image from "next/image";
import { Section } from "@/components/Sections";
import { site } from "@/config/site";
import LeadFollowUp from "./LeadFollowUp";
import ThankYouHero from "./ThankYouHero";
import ThankYouTracking from "./ThankYouTracking";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Got it — here's what happens next",
};

/**
 * Conversion page (spec §4): confirm receipt, set expectations, prime the
 * callback. A converted lead gets prepared for the call, never routed back
 * into the site. Everything below the contact card is optional.
 */
export default function ThankYouPage() {
  return (
    <>
      <ThankYouTracking />
      <Section>
        <div className="mx-auto max-w-xl">
          <ThankYouHero />

          <div className="mt-8 rounded-2xl border border-line bg-white p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <Image
                src={site.principal.photo}
                alt={site.principal.fullName}
                width={72}
                height={72}
                className="h-[72px] w-[72px] shrink-0 rounded-full object-cover"
              />
              <div>
                <p className="font-bold">{site.principal.firstName} will personally call or text you — typically the same day.</p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  From {site.phone.display} · 8 AM–9 PM, seven days a week. Save the number so you know it&apos;s {site.principal.firstName}.
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <a
                href={`tel:${site.phone.e164}`}
                className="rounded-lg bg-accent px-4 py-3.5 text-center font-bold text-white transition-colors hover:bg-accent-hover"
              >
                Call now
              </a>
              <a
                href={`sms:${site.phone.e164}`}
                className="rounded-lg border-2 border-accent px-4 py-3 text-center font-bold text-accent transition-colors hover:bg-accent hover:text-white"
              >
                Text {site.principal.firstName}
              </a>
            </div>
          </div>

          <div className="mt-8">
            <p className="text-center text-lg font-bold">You&apos;ll get both numbers — typically within 24 hours</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-line bg-cream p-5">
                <p className="text-sm font-bold uppercase tracking-wide text-accent">Cash offer</p>
                <p className="mt-2 text-sm text-ink-soft">
                  A written offer with proof of funds to buy the property as-is — no repairs, no showings, no
                  commission on the cash sale, and a closing date you choose.
                </p>
              </div>
              <div className="rounded-2xl border border-line bg-cream p-5">
                <p className="text-sm font-bold uppercase tracking-wide text-trust">Listing estimate</p>
                <p className="mt-2 text-sm text-ink-soft">
                  An MLS-based estimate of what you&apos;d likely net by listing — recent comparable sales, costs
                  shown line by line, and roughly how long it would take to sell.
                </p>
              </div>
            </div>
            <p className="mt-4 text-center text-sm text-ink-soft">
              No pressure and no obligation. Choose either option, or neither — the timeline is yours.
            </p>
          </div>

          <LeadFollowUp />
        </div>
      </Section>
    </>
  );
}
