# HouseSoldNJ.com — Conversion Site Spec

Drafted 2026-08-13. Implements BUSINESS_PLAN.md §3b. One job: turn paid clicks
from motivated NJ sellers into address + phone submissions and inbound calls,
while reading as the most legitimate buyer they've talked to all week. Target:
**15-25% of paid clicks → lead** (industry range for optimized motivated-seller
sites is 7-20%; the median "we buy houses" site does far worse because it looks
like every scammy bandit sign — reputability IS the conversion strategy here).

## 1. Design principles (in priority order)

1. **Message match.** The visitor clicked "sell my house fast in Toms River" —
   the page headline must say that back to them. County/city and situation
   (probate, inherited, foreclosure) are injected from the ad's URL params.
   Word-for-word ad→headline alignment is the single cheapest conversion lift.
2. **One goal per page.** PPC landing pages have NO nav menu, no footer link
   farm, no blog — the only exits are the form, the phone number, and the
   privacy policy. The main site (for organic/direct/brand searches) gets
   normal navigation; landing pages are noindexed variants.
3. **Mobile-first, fast.** 70%+ of this traffic is mobile. LCP < 2s on 4G,
   sticky bottom CTA bar on mobile (call button + "Get My Offer"), tap targets
   thumb-sized, form completable one-handed. Every 1s of load costs real money
   at $30-100/click.
4. **Calm, not hype.** No countdown timers, no ALL-CAPS, no fake urgency, no
   stock-photo "happy family" clichés. Clean layout, generous whitespace, real
   photography. Motivated sellers are usually stressed people in a bad spot —
   the design should feel like a competent professional's office, not a used
   car lot. This is also what separates the site from 90% of competitors.
5. **A real human, immediately.** Sum's actual face, name, license status, and
   brokerage on every page. Anonymous "we buy houses" outfits are what sellers
   have been warned about; a named, licensed, findable person is the trust
   shortcut nothing else substitutes for.

## 2. Site architecture

```
housesoldnj.com/                    main page (indexable, has nav)
  /monmouth-county  /ocean-county   county pages ×8 (indexable, light nav)
  /probate  /inherited-house        situation pages (indexable)
  /foreclosure  /tired-landlord
  /how-it-works  /about  /reviews   trust pages (indexable)
  /lp/{campaign-slug}               PPC landing variants (noindex, no nav,
                                    headline/geo injected from URL params)
  /thank-you                        conversion page (noindex)
  /privacy  /terms                  required, linked in every footer
```

County and situation pages are generated from one data file (name, towns
served, local proof points, testimonial) — 15+ pages from one template.

## 3. Above the fold (the page IS this section; everything below is support)

- **Headline:** "Sell Your House Fast in {County/City}, NJ" — geo token filled
  from URL param, default "New Jersey".
- **Subhead:** "Fair cash offer within 24 hours. No fees, no repairs, no
  obligation. Or, if listing would net you more — we'll tell you honestly."
- **Form, step 1 of 2:** ONE field — property address with Google Places
  autocomplete — plus button **"Get My Fair Cash Offer →"**. Microcopy under
  the button: "Takes 30 seconds · No obligation · We never share your info."
- **Phone number** top-right and in the mobile sticky bar: "Or call/text Sum
  directly: (7xx) xxx-xxxx" — a tracked local NJ number (CallRail DNI), never
  a toll-free number.
- **Trust strip** directly under the form: ★★★★★ Google reviews badge (linked,
  verifiable) · "Licensed NJ Real Estate Agent" · "Local — based in Monmouth
  County" · "XX houses bought in NJ".

## 4. The form (where deals are won and lost)

**Two steps, never one long form.** Address-first ordering matters: committing
the address is low-friction (it's not "contact info") and triggers completion
bias for step 2.

- **Step 1:** address (autocomplete). On submit, advance instantly — no page
  reload — with a progress cue ("Step 2 of 2 — almost done").
- **Step 2:** name, mobile phone, email (optional), plus ONE qualifier:
  "When do you need to sell?" (ASAP / 1-3 months / 3+ months / just curious).
  Nothing else. Condition, reason, and price expectation are for the phone
  call — every extra field costs more leads than it qualifies.
- **Consent capture (this is an asset, not boilerplate):** unticked checkbox
  above submit — "I agree that House Sold NJ may call or text me at the number
  provided about my inquiry. Msg/data rates may apply. Reply STOP to opt out."
  Log timestamp + IP + page URL + checkbox state into the CRM with the lead.
  The cold lists have zero consent artifacts (PLAYBOOK hard rule); web leads
  WITH stored consent may lawfully be texted for follow-up — the only texting
  lane this business has. Never bury consent in the privacy policy; the
  artifact must be provable per-lead.
- **Step-2 abandoners are still leads.** Address captured + no phone = feed
  the address into the normal pipeline (owner lookup via MOD-IV, skip trace,
  mail). Fire an analytics event on step-1 completion so these are counted.
- **Failure-proof delivery:** form POSTs to the CRM webhook AND sends a
  parallel email/Slack alert. A silent webhook failure at $200/lead is a
  fire; alert on delivery errors.

**Thank-you page:** set expectations ("Sum will call you within 15 minutes,
8am-9pm — from (7xx) xxx-xxxx, save the number"), short intro video, what to
have handy (mortgage balance, timeline), and the Google Ads conversion tag.

## 5. Reputability system (what makes sellers willingly hand over info)

Ordered by evidence weight — everything on this list must be REAL and
verifiable, or it's off the site:

1. **Named, licensed principal.** Photo of Sum, "NJ licensed real estate
   salesperson, [Brokerage name]" — this is simultaneously the NJ REC
   advertising disclosure obligation (license status in writing, brokerage
   identity per office policy) and the strongest trust signal available.
   Compliance requirement and conversion asset are the same element.
2. **The honest-broker positioning.** A visible section: "Two ways we can
   help — a cash offer, or listing it if that nets you more. We'll show you
   both numbers." Nobody else in the ad auction can say this. It converts the
   skeptics who'd never call a bandit sign.
3. **Verifiable reviews.** Google Business Profile reviews embedded and
   LINKED (not screenshot). Seed it: every closed deal, every listed seller,
   every landlord Sum has worked with. 10+ reviews with responses beats any
   badge. Testimonials on-site carry full first name + town ("Maria R.,
   Neptune") — never "J.S."
4. **Transparent process + math.** "How we calculate your offer" section:
   market value, minus repairs, minus our margin — in plain English. Sellers
   don't expect retail; they distrust black boxes. Add "We provide proof of
   funds with every offer" and "Attorney-reviewed NJ contracts."
5. **Local specificity.** County pages name real towns, real sold examples
   ("bought as-is in Keansburg, closed in 19 days"), NJ-specific content
   (attorney review, tenants, flood zones). National-template genericness is
   the #1 scam tell.
6. **Situation empathy pages.** Probate, inherited, foreclosure, divorce,
   tired landlord, hoarder/condition — each with a short "here's how this
   works in NJ" explainer. These double as high-QS PPC targets and as proof
   this operation has seen their problem before.
7. **Footer facts.** Legal entity name, office address, phone, email,
   brokerage, license disclosure, privacy/terms. Anonymous footers kill trust
   at the exact moment a cautious seller scrolls down to check.
8. **60-90s intro video** of Sum on the main page and thank-you page: who I
   am, what happens after you submit, no-pressure promise. Phone-shot and
   authentic beats agency-polished.

**FAQ block** (with FAQ schema markup): Do you charge fees? How fast can you
close? Do I need to clean out the house? What if I owe more than it's worth?
What if it has tenants? Is the offer negotiable? Are you agents or investors?
(— answer the last one honestly; it's the dual-track pitch again.)

## 6. Measurement (non-negotiable from day 1)

- **GA4 + Google Ads** conversion import: step-1 complete (micro), lead
  submit (primary), call ≥60s (primary), thank-you engagement.
- **CallRail** (or equivalent): dynamic number insertion per source/campaign,
  recording ON only after the NJ one-party notice review — script the greeting
  "…this call may be recorded" anyway; it's free professionalism.
- **Microsoft Clarity** (free) for heatmaps/session replays — watch 20
  recordings/week during launch; fix what people actually stumble on.
- **A/B discipline:** one test at a time, ≥100 clicks/variant before judging.
  Test order: headline framing → step-1 CTA copy → trust-strip contents →
  long vs short page. Never test two things in one week at launch volume.

## 7. Tech stack — recommendation and alternatives

**Recommended: custom build. Next.js (App Router) + Tailwind CSS, deployed on
Vercel, code in this GitHub account.**

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js + Tailwind | Static-rendered pages = fastest possible LCP; county/situation pages generated from one data file; full control of forms + params |
| Hosting | Vercel | $0-20/mo, global CDN, preview deploys per branch, analytics built in |
| Forms | Route handler → CRM webhook + email alert | Store consent artifact (timestamp/IP/page) with every lead |
| Address autocomplete | Google Places API | Pennies at this volume; restrict key to the domain |
| Call tracking | CallRail | DNI script + per-campaign pools |
| Analytics | GA4 + Clarity + Vercel Analytics | All free |
| Video | YouTube unlisted embed (lazy-loaded) | Don't self-host video |
| Email/alerts | Resend or SMTP → inbox + phone push | Lead alerts must hit Sum's phone |

Why custom over the usual suspects: the build cost here is near zero (Claude
Code writes it; this repo's owner already lives in GitHub), which deletes the
main argument for template platforms, and page speed + param-driven message
match + consent logging are all first-class in a custom build.

**Alternatives, honestly stated:**
- **Carrot ($84-199/mo):** proven motivated-seller templates, hosted, built-in
  CRM, zero build effort. The right call for an operator with no dev resource
  — that is not this operation. Ongoing cost forever, slower pages, limited
  control over form/consent mechanics.
- **Webflow/Framer ($20-40/mo):** middle ground; fine, but no cost advantage
  over Vercel and worse form/param control.
- **WordPress + page builder:** no. Slow, plugin maintenance, security
  surface, and this stack has no one to babysit it.

**Build order (fits BUSINESS_PLAN wk 1-2):** repo + skeleton + main page →
form flow with webhook/consent/alerts → thank-you + tracking → 3 county pages
+ 2 situation pages → /lp/ param variants → Clarity + first A/B. Roughly 2-3
days of focused build, then PPC goes to learning mode on /lp/ variants only.

**Domain strategy** (restated from BUSINESS_PLAN §3b): HouseSoldNJ.com is
NJ-branded — an asset in NJ, a liability elsewhere. PA/FL expansion gets
sibling domains cloned from this codebase when the §2 triggers fire; one
repo, multiple deploy targets.

## 8. What NOT to do

- No live Zillow-style "instant estimate" widget — it anchors sellers to a
  number before the call and invites tire-kickers.
- No chatbot popup in v1 (an AI receptionist on the PHONE line is the
  PLAYBOOK-approved inbound play; a web chat widget just leaks form
  conversions). Revisit only with data.
- No exit-intent popups, no notification-permission prompts, no cookie-wall
  theater beyond what privacy law actually requires.
- No claims that can't be evidenced on request: fake review counts, "as seen
  on" logos, inflated deal counts. One caught lie costs more than every
  optimization on this page gains.
