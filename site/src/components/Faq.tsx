import type { Faq } from "@/data/faqs";

/**
 * FAQ block with FAQPage JSON-LD (spec §5). `withSchema` only on indexable
 * pages — schema on noindex landing pages is pointless weight.
 */
export default function FaqBlock({
  faqs,
  withSchema = true,
}: {
  faqs: Faq[];
  withSchema?: boolean;
}) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return (
    <div className="mx-auto max-w-2xl">
      {withSchema && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      )}
      <div className="divide-y divide-line rounded-2xl border border-line bg-white">
        {faqs.map((f) => (
          <details key={f.q} className="group px-5 py-1">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold [&::-webkit-details-marker]:hidden">
              {f.q}
              <span
                aria-hidden
                className="text-xl text-ink-soft transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="pb-4 text-sm leading-relaxed text-ink-soft">{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
