import type { Metadata } from "next";
import LeadForm from "@/components/LeadForm";
import { AboutSum, IntroVideo, Section, SectionTitle } from "@/components/Sections";
import { entityName, site } from "@/config/site";

export const metadata: Metadata = {
  title: `About ${site.principal.firstName}`,
  description: `Who you're dealing with: ${site.principal.fullName}, ${site.principal.licenseLine}, based in Monmouth County, NJ. A named, licensed, findable person — not an anonymous "we buy houses" outfit.`,
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
            <strong className="text-ink">I'll show you both numbers.</strong>{" "}
            A written cash offer and an honest estimate of what listing would
            net you. If listing wins, I'll say so — I'm licensed to do either.
          </li>
          <li className="rounded-xl border border-line bg-cream p-4">
            <strong className="text-ink">Everything in writing.</strong> Offers
            come with proof of funds, on attorney-reviewed NJ contracts. My
            license status is disclosed at first contact and in every contract.
          </li>
          <li className="rounded-xl border border-line bg-cream p-4">
            <strong className="text-ink">No pressure, ever.</strong> No
            countdown clocks, no "this offer expires tonight." Take a week.
            Show your attorney. Say no.
          </li>
          <li className="rounded-xl border border-line bg-cream p-4">
            <strong className="text-ink">You deal with me.</strong> {" "}
            {entityName()} is local ({site.principal.base.toLowerCase()}), and
            the person on the phone is the person who shows up at the house.
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
