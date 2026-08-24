import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FaqBlock from "@/components/Faq";
import Hero from "@/components/Hero";
import {
  AboutSum,
  HonestBroker,
  OfferMath,
  ProcessSteps,
  Section,
  SectionTitle,
} from "@/components/Sections";
import { counties, getCounty } from "@/data/counties";
import { mainFaqs } from "@/data/faqs";
import { getSituation, situations } from "@/data/situations";

/**
 * One dynamic route serves all county pages (/monmouth-county) and situation
 * pages (/probate) — 14+ indexable pages generated from the two data files
 * (spec §2). Static routes like /about win over this segment automatically.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return [
    ...counties.map((c) => ({ slug: c.slug })),
    ...situations.map((s) => ({ slug: s.slug })),
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const county = getCounty(slug);
  if (county) {
    return {
      title: `Sell Your House Fast in ${county.name}, NJ`,
      description: `Written cash offer, typically within 24 hours, on your ${county.name} house — ${county.towns.slice(0, 4).join(", ")} and beyond. No fees, no repairs. Licensed local agent.`,
    };
  }
  const situation = getSituation(slug);
  if (situation) {
    return { title: situation.headline, description: situation.metaDescription };
  }
  return {};
}

export default async function SlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const county = getCounty(slug);
  if (county) return <CountyPage county={county} />;
  const situation = getSituation(slug);
  if (situation) return <SituationPage situation={situation} />;
  notFound();
}

function CountyPage({ county }: { county: NonNullable<ReturnType<typeof getCounty>> }) {
  return (
    <>
      <Hero
        headline={`Sell Your House Fast in ${county.name}, NJ`}
        idPrefix={county.slug}
      />

      <Section tinted>
        <SectionTitle>We know {county.short} County</SectionTitle>
        <p className="mx-auto max-w-2xl text-center leading-relaxed text-ink-soft">
          {county.intro}
        </p>
        <p className="mx-auto mt-6 max-w-2xl text-center text-sm text-ink-soft">
          <span className="font-semibold text-ink">Towns we buy in:</span>{" "}
          {county.towns.join(" · ")}
        </p>
        {county.proofPoint && (
          <p className="mx-auto mt-6 max-w-xl rounded-xl border border-line bg-cream p-4 text-center text-sm font-medium">
            {county.proofPoint}
          </p>
        )}
        {county.testimonial && (
          <blockquote className="mx-auto mt-6 max-w-xl text-center">
            <p className="text-lg italic">“{county.testimonial.quote}”</p>
            <footer className="mt-2 text-sm font-semibold text-ink-soft">
              — {county.testimonial.attribution}
            </footer>
          </blockquote>
        )}
      </Section>

      <Section>
        <SectionTitle>How it works</SectionTitle>
        <ProcessSteps />
      </Section>

      <HonestBroker />
      <OfferMath />

      <Section>
        <div className="mx-auto max-w-2xl">
          <AboutSum />
        </div>
      </Section>

      <Section tinted>
        <SectionTitle>Common questions</SectionTitle>
        <FaqBlock faqs={mainFaqs} />
      </Section>
    </>
  );
}

function SituationPage({
  situation,
}: {
  situation: NonNullable<ReturnType<typeof getSituation>>;
}) {
  return (
    <>
      <Hero headline={situation.headline} subhead={situation.lead} idPrefix={situation.slug} />

      <Section tinted>
        <SectionTitle>How this works in New Jersey</SectionTitle>
        <div className="mx-auto max-w-2xl space-y-7">
          {situation.njExplainer.map((block) => (
            <div key={block.heading}>
              <h3 className="mb-1.5 text-lg font-bold">{block.heading}</h3>
              <p className="leading-relaxed text-ink-soft">{block.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <div className="mx-auto max-w-2xl">
          <AboutSum />
        </div>
      </Section>

      <HonestBroker />

      <Section tinted>
        <SectionTitle>Common questions</SectionTitle>
        <FaqBlock faqs={[...situation.faq, ...mainFaqs]} />
      </Section>
    </>
  );
}
