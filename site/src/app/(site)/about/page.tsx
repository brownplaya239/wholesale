import type { Metadata } from "next";
import LeadForm from "@/components/LeadForm";
import { AboutSum, IntroVideo, Section, SectionTitle } from "@/components/Sections";
import { entityName, site } from "@/config/site";

export const metadata: Metadata = {
  title: `About ${site.principal.firstName}`,
  description: `Who you're dealing with: ${site.principal.fullName}, ${site.principal.licenseLine} and local New Jersey buyer. A named, licensed, findable person — not an anonymous "we buy houses" outfit.`,
};

export default function AboutPage() {
  return (
    <>
      <Section>
        <h1 className="text-balance text-center text-4xl font-extrabold tracking-tight">
          Who you're dealing with
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-ink-soft">
          You've probably been warned about anonymous "we buy houses" outfits.
          Good — you should be. Here's exactly who's on the other end of this
          website.
        </p>
        <div className="mx-auto mt-10 max-w-2xl">
          <AboutSum />
        </div>
        <div className="mt-8">
          <IntroVideo />
        </div>
      </Section>

      <Section tinted>
        <SectionTitle>What I promise</SectionTitle>
        <ul className="mx-auto max-w-xl space-y-4 text-ink-soft">
          <li className="rounded-xl border border-line bg-cream p-4">
            <strong className="text-ink">You'll see both options clearly.</strong>{" "}
            I'll give you a written cash offer and an honest estimate of what
            you could net by listing. If listing is the better financial
            option, I'll tell you.
          </li>
          <li className="rounded-xl border border-line bg-cream p-4">
            <strong className="text-ink">
              Everything is transparent and in writing.
            </strong>{" "}
            Cash offers include proof of funds and use attorney-reviewed New
            Jersey contracts. My NJ real estate license is disclosed from the
            start.
          </li>
          <li className="rounded-xl border border-line bg-cream p-4">
            <strong className="text-ink">
              No pressure or artificial deadlines.
            </strong>{" "}
            Take your time, review everything with your attorney, and walk
            away if it doesn't make sense.
          </li>
          <li className="rounded-xl border border-line bg-cream p-4">
            <strong className="text-ink">You deal directly with me.</strong>{" "}
            {entityName()} is local, and the person you speak with is the same
            person who evaluates your property and works with you through the
            process.
          </li>
        </ul>
      </Section>

      <Section>
        <SectionTitle>Have a property to talk about?</SectionTitle>
        <div className="mx-auto max-w-xl scroll-mt-4" data-lead-form-anchor>
          <LeadForm idPrefix="about" />
        </div>
      </Section>
    </>
  );
}
