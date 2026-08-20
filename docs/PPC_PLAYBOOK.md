# PPC Playbook — HouseSoldNJ.com

Drafted 2026-08-20, day the site went live. Companion to `site/README.md`
(ad-URL convention) and the launch runbook. Goal: paid clicks from motivated
NJ sellers → leads at a survivable CPL, without torching money learning what
every "we buy houses" advertiser learns the hard way.

Economics to keep in your head: CPCs in this niche run $30–100. At a 15%
conversion rate that's a $200–650 lead; at the median-site 5% it's $600–2,000.
**The landing page IS the optimization** — everything below protects the
click→lead rate the site was built for.

## 0. Do-not-launch gates

No ads until: real phone number live · lead delivery tested end-to-end
(Resend email arriving on phone) · Google Ads conversion tag env var set ·
you can actually answer 8am–9pm. A missed call at $40/click is the most
expensive way to not buy a house.

## 1. Account structure (start narrow, earn breadth)

**One Search campaign.** Geo: Monmouth + Ocean counties only at launch
(home turf = strongest proof, tightest message match). Add Middlesex/Union/
Essex only after the first campaign shows a stable CPL.

- Location setting: **Presence only** (people IN the geo), never
  "presence or interest".
- Dayparting: **8am–9pm** — matches the answering hours printed on the site.
- Networks: Search only. Display OFF. Search partners OFF at launch.

**Ad groups by intent theme**, one per situation page, each pointing at its
own landing URL:

| Ad group | Example keywords (exact + phrase only) | Final URL |
| --- | --- | --- |
| core-fast | "sell my house fast", "we buy houses nj", "cash offer for my house" | `/lp/core-monmouth?loc=Monmouth+County` |
| probate | "selling a house in probate nj", "sell estate house" | `/lp/probate-monmouth?sit=probate&loc=Monmouth+County` |
| inherited | "sell inherited house nj" | `/lp/inherited-monmouth?sit=inherited-house&loc=…` |
| foreclosure | "sell house before foreclosure", "stop foreclosure nj" | `/lp/foreclosure-monmouth?sit=foreclosure&loc=…` |
| landlord | "sell rental property with tenants nj" | `/lp/landlord-monmouth?sit=tired-landlord&loc=…` |
| as-is | "sell house as is nj", "sell house that needs repairs" | `/lp/asis-monmouth?sit=house-needs-repairs&loc=…` |

City-level message match (the biggest QS lever): when a town earns volume in
the search-terms report, break it into its own ad group with the town in the
keyword AND hardcoded `?loc=Toms+River` in the URL — headline then mirrors
the search word-for-word. Don't pre-build 50 town groups; let the data tell
you which towns deserve one.

**Match types:** exact + phrase only. No broad match until tCPA is running
on 30+ conversions — broad + no data = Google spends your budget educating
itself.

## 2. Negative keywords (seed list — add BEFORE first ad runs)

`realtor`, `agent near me`, `zillow`, `redfin`, `opendoor`, `offerpad`,
`how to`, `course`, `become`, `jobs`, `salary`, `wholesaling real estate`,
`no money down`, `for rent`, `apartments`, `rent to own`, `zestimate`,
`home value calculator`, `free` — plus every research-intent term the
search-terms report surfaces. **Mine the search-terms report weekly; it is
the single highest-ROI 15 minutes in the account** for the first two months.

(Do NOT negative "for sale by owner" — FSBO sellers are a target audience.)

## 3. Ads (RSAs that respect message match)

- Headline 1 **pinned**: mirrors the LP headline — "Sell Your House Fast in
  Monmouth County" / "Sell a Probate House Fast". Word-for-word ad→page
  match is the cheapest conversion lift and a Quality Score input.
- Other headlines rotate the site's honest assets: "Fair Cash Offer in 24
  Hours" · "No Fees, No Repairs, No Cleanout" · "Licensed NJ Agent — Local"
  · "Close in 2–3 Weeks or Your Date" · "Cash Offer or List It — See Both".
- Descriptions: calm, no ALL-CAPS, no fake urgency — same register as the
  site. Sellers cross-check; mismatch reads as scam.
- Assets (extensions): callouts (No Fees · Proof of Funds · Attorney
  Contracts), sitelinks (How It Works, Reviews, About Sum), **call asset
  with the CallRail number**, location asset once the Google Business
  Profile exists. Call asset also 8am–9pm only.

## 4. Bidding & budget

- **Phase 1 (0→~20 conversions): Manual CPC or Maximize Clicks with a
  $50–60 CPC cap.** Smart bidding with zero data buys junk.
- **Phase 2: Maximize Conversions** once the account has ~15–30 conversions
  in 30 days. **Phase 3: tCPA** set ~20% above your observed CPL, tightened
  slowly.
- Budget: $50–100/day. At NJ CPCs that's 1–3 clicks/day — fine. You're
  buying data and the first deal, not volume.
- Targets: CPL $100–250. A signed contract every 20–40 leads. One wholesale
  fee or listing covers months of spend; judge the channel quarterly, not
  weekly.

## 5. Conversion tracking (already wired in the site — just connect it)

| Signal | Source | Role |
| --- | --- | --- |
| `lead_submit` | site event → GA4 → import to Ads (or `NEXT_PUBLIC_GADS_CONVERSION` tag on /thank-you) | **Primary** |
| Calls ≥60s | CallRail ↔ Google Ads integration | **Primary** |
| `lead_step1_complete` | GA4 | Secondary — observe, never optimize to it |
| `thank_you_engaged`, `call_click` | GA4 | Diagnostics |

Later upgrade: every lead's `pageUrl` (stored in the CRM payload) carries its
`gclid` — when deals start closing, upload offline conversions
(qualified → contract → closed) so bidding optimizes toward *deals*, not
form-fills. That's the end-game advantage over every competitor in the
auction.

## 6. The optimization loop (weekly, ~1 hour)

1. **Search-terms report** → add negatives, promote winning terms to exact.
2. **Clarity: watch 20 session recordings** → fix what people actually
   stumble on, not what you guess.
3. Check CPL by ad group → pause any group at 2× target CPL after ≥$300
   spend; feed its budget to the winners.
4. Lead quality notes per source (campaign is in every lead's `pageUrl`) —
   a cheap-CPL group producing unreachable leads is worse than an expensive
   one producing contracts.

**A/B discipline (from the site spec): one test at a time, ≥100 clicks per
variant before judging.** Order: headline framing → step-1 CTA copy →
trust-strip contents → long vs short page. Run variants as two `/lp/` slugs
with ads split 50/50 in the same ad group. Never two tests in one week at
launch volume.

## 7. Quality Score levers (why this setup scores well)

Expected CTR (tight keywords + pinned mirrored headline) · Ad relevance
(situation ad groups) · Landing page experience (static-rendered ~105 kB
pages, mobile-first, message-matched H1, no nav dead-ends). QS discounts
CPC directly — at $50 clicks, a 7→9 QS is real money.

## 8. Don'ts

- No Performance Max / Display at launch — this niche's PMax leads skew junk.
- No broad match + smart bidding before conversion history exists.
- No countdown timers / fake urgency to juice CTR — poisons the trust
  positioning that IS the conversion strategy.
- Don't judge anything on <100 clicks or pause anything on <$300 spend.
- Don't run ads outside answering hours. Speed-to-lead (15-min callback,
  promised on /thank-you) is the highest-leverage "optimization" in the
  whole funnel.
