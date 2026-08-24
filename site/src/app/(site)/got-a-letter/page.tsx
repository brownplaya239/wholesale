import type { Metadata } from "next";
import Link from "next/link";
import LeadForm from "@/components/LeadForm";
import PhoneLink from "@/components/PhoneLink";
import { AboutSum, HonestBroker, Section, SectionTitle } from "@/components/Sections";
import { entityName, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Did You Get a Letter From Us?",
  description: `If you received a letter, call, or text from ${site.name}: who we are, why we contacted you, how to verify us, and how to opt out. You're under no obligation.`,
};

/**
 * The landing surface for outbound marketing (mail, calls). People Google the
 * sender before responding — this page answers exactly what they're checking.
 */
export default function GotALetterPage() {
  return (
    <>
      <Section>
        <h1 className="text-balance text-center text-4xl font-extrabold tracking-tight">
          Did you get a letter, call, or text from us?
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-ink-soft">
          You're probably here to check whether we're legitimate before
          responding. Smart. Here's everything you'd want to know.
        </p>

        <div className="mx-auto mt-10 max-w-2xl">
          <AboutSum />
        </div>

        <div className="mx-auto mt-10 max-w-xl space-y-4">
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="font-bold">Why you may have heard from us</p>
            <p className="mt-1 text-sm text-ink-soft">
              We buy houses across {site.counties} counties, and we reach out
              to owners whose properties we'd genuinely be interested in
              purchasing. Property ownership records are public in New Jersey
              — that's how we found you. Receiving a letter doesn't mean
              anything is wrong with your property or your situation.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="font-bold">You're under no obligation — at all</p>
            <p className="mt-1 text-sm text-ink-soft">
              Our letter is an invitation to a conversation, not a claim on
              your time. If you'd like to hear a number, we'll put a written
              cash offer with proof of funds in front of you — and an honest
              estimate of what listing would net you instead. If not, recycle
              the letter and we wish you well.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="font-bold">Who's actually asking</p>
            <p className="mt-1 text-sm text-ink-soft">
              {entityName()} buys houses directly as principal. Sumeet
              Sancheti is also a NJ Licensed Real Estate Salesperson (License
              #{site.principal.licenseNumber}) with{" "}
              {site.principal.brokerage}; brokerage services, when requested,
              are provided separately. Verify both on our{" "}
              <Link href="/reviews" className="font-semibold text-ink underline">
                Verify Us
              </Link>{" "}
              page — it links to the state's own license database.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="font-bold">Want us to stop contacting you?</p>
            <p className="mt-1 text-sm text-ink-soft">
              Just say so. Reply STOP to any text, or tell us once by phone at{" "}
              <PhoneLink className="font-semibold text-ink underline" /> or
              email at{" "}
              <a href={`mailto:${site.email}`} className="font-semibold text-ink underline">
                {site.email}
              </a>
              , and we'll remove you from our outreach.
            </p>
          </div>
        </div>
      </Section>

      <HonestBroker />

      <Section>
        <SectionTitle>Curious what your two numbers look like?</SectionTitle>
        <div className="mx-auto max-w-xl scroll-mt-4" data-lead-form-anchor>
          <LeadForm idPrefix="letter" />
        </div>
      </Section>
    </>
  );
}
