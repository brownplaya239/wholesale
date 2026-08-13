import type { Metadata } from "next";
import FaqBlock from "@/components/Faq";
import Hero from "@/components/Hero";
import {
  AboutSum,
  OfferMath,
  ProcessSteps,
  Section,
  SectionTitle,
} from "@/components/Sections";
import { mainFaqs } from "@/data/faqs";
import { getSituation } from "@/data/situations";
import { geoWithState, resolveGeo } from "@/lib/geo";

/**
 * PPC landing variants (spec §2/§3). One route serves every campaign:
 *
 *   /lp/{campaign-slug}?loc={City}&sit={situation-slug}
 *
 * - campaign-slug is free-form (named per ad group; shows up in pageUrl on
 *   every lead and in analytics).
 * - loc fills the headline geo token (sanitized; defaults to "New Jersey").
 * - sit switches to that situation's message-matched headline + lead.
 *
 * Rendered dynamically (params vary per click); noindexed here AND via
 * X-Robots-Tag in next.config.ts.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: "Sell Your House Fast in New Jersey",
};

export default async function LandingPage({
  searchParams,
}: {
  params: Promise<{ campaign: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const loc = typeof sp.loc === "string" ? sp.loc : undefined;
  const sitSlug = typeof sp.sit === "string" ? sp.sit : undefined;

  const geo = geoWithState(resolveGeo(loc));
  const situation = sitSlug ? getSituation(sitSlug) : undefined;

  const headline = situation
    ? situation.lpHeadline.replace("{geo}", geo)
    : `Sell Your House Fast in ${geo}`;

  return (
    <>
      <Hero
        headline={headline}
        subhead={situation?.lead}
        idPrefix="lp"
      />

      <Section tinted>
        <SectionTitle>How it works</SectionTitle>
        <ProcessSteps />
      </Section>

      <Section>
        <SectionTitle>Who you'll be talking to</SectionTitle>
        <div className="mx-auto max-w-2xl">
          <AboutSum />
        </div>
      </Section>

      <OfferMath />

      <Section tinted>
        <SectionTitle>Common questions</SectionTitle>
        <FaqBlock
          faqs={situation ? [...situation.faq, ...mainFaqs.slice(0, 5)] : mainFaqs}
          withSchema={false}
        />
        <p className="mt-8 text-center">
          <a
            href="#top-form"
            className="btn inline-flex items-center justify-center rounded-lg bg-accent px-8 py-4 text-lg font-bold text-white transition-colors hover:bg-accent-hover"
          >
            Get My Fair Cash Offer →
          </a>
        </p>
      </Section>
    </>
  );
}
