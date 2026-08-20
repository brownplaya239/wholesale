/**
 * Main FAQ block (spec §5) — rendered with FAQPage schema markup.
 * Answers are honest on purpose; the last one is the dual-track pitch.
 */

export type Faq = { q: string; a: string };

export const mainFaqs: Faq[] = [
  {
    q: "Do you charge any fees or commissions?",
    a: "No. A cash sale to us has no commissions, no fees, and we pay typical seller closing costs. If instead we list your house (when that nets you more), normal listing commission applies — and we'll show you that math before you choose.",
  },
  {
    q: "How fast can you close?",
    a: "As fast as two to three weeks with our attorney-drafted NJ contract, or on whatever date works for you — some sellers want 60 days to arrange the move. You pick the date.",
  },
  {
    q: "Do I need to clean out the house?",
    a: "No. Take what you want to keep and leave the rest — furniture, boxes, the full garage. We handle the cleanout after closing.",
  },
  {
    q: "What if I owe more than the house is worth?",
    a: "Tell us early — it changes the playbook, not the willingness to help. Depending on the numbers, options include negotiating the payoff, a short sale, or listing strategies. We'll tell you honestly if a cash sale doesn't work.",
  },
  {
    q: "What if the house has tenants?",
    a: "We buy occupied properties — paying tenants, non-paying tenants, even mid-eviction. NJ tenant obligations transfer to us at closing.",
  },
  {
    q: "Is your offer negotiable?",
    a: "Yes. It's a starting point built from real numbers — market value, repair budget, our margin — and we'll show you each piece. If you think a number is off, tell us why and we'll look again.",
  },
  {
    q: "Are you agents or investors?",
    a: "Both, and we're upfront about it. Sumeet is a licensed NJ real estate salesperson who buys houses directly. That's why we can honestly show you two numbers on every house: our cash offer, and what listing would likely net you. You pick.",
  },
];
