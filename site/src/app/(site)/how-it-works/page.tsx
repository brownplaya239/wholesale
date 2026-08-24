import type { Metadata } from "next";
import FaqBlock from "@/components/Faq";
import LeadForm from "@/components/LeadForm";
import {
  HonestBroker,
  OfferMath,
  ProcessSteps,
  Section,
  SectionTitle,
} from "@/components/Sections";
import { mainFaqs } from "@/data/faqs";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "How selling your NJ house to us works: one conversation, both numbers (cash offer AND estimated listing net), typically within 24 hours. Close on your timeline.",
};

export default function HowItWorksPage() {
  return (
    <>
      <Section>
        <h1 className="text-balance text-center text-4xl font-extrabold tracking-tight">
          How It Works
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-ink-soft">
          Three steps, no pressure, and you see every number before deciding
          anything.
        </p>
        <div className="mt-8">
          <ProcessSteps />
        </div>
      </Section>

      <HonestBroker />
      <OfferMath />

      <Section tinted>
        <SectionTitle>Common questions</SectionTitle>
        <FaqBlock faqs={mainFaqs} />
      </Section>

      <Section>
        <SectionTitle>Get your two numbers</SectionTitle>
        <div className="mx-auto max-w-xl scroll-mt-4" data-lead-form-anchor>
          <LeadForm idPrefix="hiw" />
        </div>
      </Section>
    </>
  );
}
