import Link from "next/link";
import FaqBlock from "@/components/Faq";
import Hero from "@/components/Hero";
import {
  AboutSum,
  HonestBroker,
  IntroVideo,
  OfferMath,
  ProcessSteps,
  Section,
  SectionTitle,
} from "@/components/Sections";
import { site } from "@/config/site";
import { counties } from "@/data/counties";
import { mainFaqs } from "@/data/faqs";
import { situations } from "@/data/situations";

export default function HomePage() {
  return (
    <>
      <Hero headline="Sell Your House Fast in New Jersey" idPrefix="home" />

      <Section tinted>
        <SectionTitle>How it works</SectionTitle>
        <ProcessSteps />
      </Section>

      <Section>
        <SectionTitle>A real person, not a call center</SectionTitle>
        <div className="mx-auto max-w-2xl">
          <AboutSum />
        </div>
        <div className="mt-8">
          <IntroVideo />
        </div>
      </Section>

      <HonestBroker />

      <OfferMath />

      <Section tinted>
        <SectionTitle>Whatever the situation, we've seen it</SectionTitle>
        <div className="mx-auto grid max-w-2xl grid-cols-2 gap-2.5 sm:grid-cols-3">
          {situations.map((s) => (
            <Link
              key={s.slug}
              href={`/${s.slug}`}
              className="rounded-xl border border-line bg-cream px-4 py-3.5 text-center text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              {s.name}
            </Link>
          ))}
        </div>
      </Section>

      <Section>
        <SectionTitle>Where we buy</SectionTitle>
        <p className="mx-auto mb-6 max-w-2xl text-center text-ink-soft">
          We buy houses across {site.counties} counties.
        </p>
        <div className="mx-auto grid max-w-2xl grid-cols-2 gap-2.5 sm:grid-cols-4">
          {counties.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}`}
              className="rounded-xl border border-line bg-white px-3 py-3 text-center text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              {c.short}
            </Link>
          ))}
        </div>
      </Section>

      <Section tinted>
        <SectionTitle>Questions sellers actually ask</SectionTitle>
        <FaqBlock faqs={mainFaqs} />
      </Section>
    </>
  );
}
