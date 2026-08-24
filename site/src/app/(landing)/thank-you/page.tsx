import type { Metadata } from "next";
import PhoneLink from "@/components/PhoneLink";
import { Section } from "@/components/Sections";
import { site } from "@/config/site";
import ThankYouTracking from "./ThankYouTracking";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Got it — here's what happens next",
};

/**
 * Conversion page (spec §4): confirm receipt, set expectations, prime the
 * callback. One secondary CTA only — a converted lead gets prepared for the
 * call, never routed back into the site.
 */
export default function ThankYouPage() {
  return (
    <>
      <ThankYouTracking />
      <Section>
        <div className="mx-auto max-w-xl text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-trust/10">
            <svg aria-hidden className="h-8 w-8 text-trust" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-balance text-4xl font-extrabold tracking-tight">
            Got it — here's what happens next.
          </h1>
          <p className="mt-3 text-sm font-medium text-trust">
            Your property information has been received successfully.
          </p>
          <div className="mt-8 space-y-4 text-left">
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="font-bold">
                1 · {site.principal.firstName} will call or text you ASAP —
                same day
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Between 8am–9pm, 7 days a week, you'll get a call from my
                personal cell:{" "}
                <PhoneLink className="font-semibold text-ink underline" />.
                Save the number so you know it's me.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="font-bold">
                2 · Helpful to have nearby — but not required
              </p>
              <ul className="mt-1 list-inside list-disc text-sm text-ink-soft">
                <li>Rough mortgage balance, if any</li>
                <li>Your ideal selling timeline</li>
                <li>Anything important about the property or its condition</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="font-bold">
                3 · Get both numbers — typically within 24 hours
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                A written cash offer with proof of funds for us to purchase
                the property — and an MLS data-driven listing proposal:
                comparable sales, an accurately priced estimate of what you'd
                likely net by listing, and roughly how long it would take to
                sell on the market.
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                No pressure. No obligation. You choose the option and timeline
                that makes the most sense for you and your family — we stay
                flexible.
              </p>
            </div>
          </div>
          <a
            href={`sms:${site.phone.e164}`}
            className="btn mt-8 inline-flex items-center justify-center rounded-lg bg-accent px-6 py-4 text-base font-bold text-white transition-colors hover:bg-accent-hover"
          >
            Prefer not to wait? Text {site.principal.firstName} now →{" "}
            {site.phone.display}
          </a>
        </div>
      </Section>
    </>
  );
}
