import type { Metadata } from "next";
import { Section } from "@/components/Sections";
import { entityName, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${site.name} collects, uses, and protects your information.`,
};

/**
 * Plain-English privacy policy covering exactly what the site does: form
 * data, consent logging (timestamp/IP), analytics, call tracking.
 * TODO: have the NJ attorney review this text before scaling ad spend.
 */
export default function PrivacyPage() {
  return (
    <Section>
      <div className="prose-custom mx-auto max-w-2xl space-y-5 text-sm leading-relaxed text-ink-soft">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">
          Privacy Policy
        </h1>
        <p>Effective date: August 13, 2026 · {entityName()}</p>

        <h2 className="text-lg font-bold text-ink">What we collect</h2>
        <p>
          When you submit our form, we collect the property address and, if you
          continue, your name, phone number, email address, and selling
          timeline. We also log the date, time, page address, and your device's
          IP address alongside your submission — including the state of the
          consent checkbox — so we have an accurate record of what you agreed
          to.
        </p>
        <p>
          Like most websites, we use analytics tools (Google Analytics,
          Microsoft Clarity) that collect usage data via cookies, and
          call-tracking numbers that log calls and may record them after
          notice. Recorded calls begin with a recording disclosure.
        </p>

        <h2 className="text-lg font-bold text-ink">How we use it</h2>
        <p>
          We use your information for one purpose: responding to your inquiry
          about your property — contacting you, researching the property, and
          preparing your offer or listing comparison. If you check the consent
          box, we may call or text you at the number you provided about your
          inquiry. Reply STOP to any text to opt out; tell us once by phone or
          email and calls stop too.
        </p>

        <h2 className="text-lg font-bold text-ink">What we never do</h2>
        <p>
          We never sell your information. We never share it with other
          investors, lead brokers, or marketers. Your information is seen by{" "}
          {entityName()} and the service providers who operate this site's
          forms, email, and phone systems on our behalf.
        </p>

        <h2 className="text-lg font-bold text-ink">Your choices</h2>
        <p>
          Email {site.email} to ask what we hold about you, correct it, or
          have it deleted. Deleting your data ends any active conversation
          about your property, and we may retain records we're legally
          required to keep (like consent logs).
        </p>

        <h2 className="text-lg font-bold text-ink">Contact</h2>
        <p>
          {entityName()}
          {site.legal.officeAddress && <> · {site.legal.officeAddress}</>} ·{" "}
          {site.phone.display} · {site.email}
        </p>
      </div>
    </Section>
  );
}
