import type { Metadata } from "next";
import PhoneLink from "@/components/PhoneLink";
import { IntroVideo, Section } from "@/components/Sections";
import { site } from "@/config/site";
import ThankYouTracking from "./ThankYouTracking";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Got it — here's what happens next",
};

/** Conversion page (spec §4): set expectations, prime the callback. */
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
            Got it. Here's exactly what happens next.
          </h1>
          <div className="mt-8 space-y-4 text-left">
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="font-bold">
                1 · {site.principal.firstName} will call you within 15 minutes
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                Between {site.phone.hours} — the call comes from{" "}
                <PhoneLink className="font-semibold text-ink underline" />.
                Save the number so you know it's us.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="font-bold">2 · Handy to have nearby (not required)</p>
              <ul className="mt-1 list-inside list-disc text-sm text-ink-soft">
                <li>Rough idea of your mortgage balance, if any</li>
                <li>Your ideal timeline and moving plans</li>
                <li>Anything about the house you'd want us to know</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-line bg-white p-5">
              <p className="font-bold">3 · You get both numbers within 24 hours</p>
              <p className="mt-1 text-sm text-ink-soft">
                A written cash offer with proof of funds — and an honest
                estimate of what listing would net you. No obligation either
                way.
              </p>
            </div>
          </div>
          <p className="mt-8 text-sm text-ink-soft">
            Can't wait? Call or text {site.principal.firstName} right now:{" "}
            <PhoneLink className="font-bold text-ink underline decoration-accent decoration-2 underline-offset-2" />
          </p>
        </div>
        <div className="mt-10">
          <IntroVideo />
        </div>
      </Section>
    </>
  );
}
