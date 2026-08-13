# HouseSoldNJ.com

Conversion site for motivated NJ sellers (PPC + organic). Next.js 15 (App
Router) + Tailwind 4, built to the 2026-08-13 conversion-site spec: one job —
turn paid clicks into address + phone submissions and inbound calls, while
reading as the most legitimate buyer they've talked to all week.

## Run it

```bash
cd site
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (must pass before deploy)
```

## Page map

| Route | Indexed | What it is |
| --- | --- | --- |
| `/` | yes | Main page (nav, full trust stack) |
| `/{county-slug}` ×8 | yes | County pages from `src/data/counties.ts` |
| `/{situation-slug}` ×6 | yes | Situation pages from `src/data/situations.ts` |
| `/how-it-works` `/about` `/reviews` | yes | Trust pages |
| `/lp/{campaign}?loc=City&sit=slug` | **no** | PPC variants — no nav, geo/situation injected from params |
| `/thank-you` | **no** | Conversion page (Google Ads tag) |
| `/privacy` `/terms` | yes | Linked in every footer |

Landing pages are noindexed twice: `robots` metadata AND an `X-Robots-Tag`
header (next.config.ts); `/lp/` + `/thank-you` are also disallowed in
robots.txt.

### Ad URL convention

```
https://housesoldnj.com/lp/oc-tomsriver-fast?loc=Toms%20River
https://housesoldnj.com/lp/probate-monmouth?loc=Freehold&sit=probate
```

`loc` fills the headline geo token (sanitized, defaults to "New Jersey");
`sit` must match a situation slug to switch headline/lead. The campaign slug
itself is free-form and rides along in every lead's `pageUrl`.

## The form / lead flow

Two steps (address → contact + ONE qualifier + unticked consent checkbox).
Both steps POST to `/api/lead`:

- `stage: "step1"` — address-only partial. **Abandoners are leads**: feed
  these addresses into the pipeline (MOD-IV owner lookup → skip trace → mail).
- `stage: "full"` — the real lead, with a consent artifact (timestamp, IP,
  page URL, checkbox state, exact consent wording) stored per-lead. Web leads
  WITH this artifact are the business's only lawful texting lane.

Delivery fans out in parallel to every configured channel — CRM webhook,
Resend email, Slack. Any one success = delivered; all-fail returns 502 and the
UI shows the "call Sum directly" fallback. Per-channel failures log
`LEAD DELIVERY FAILURE` (set a Vercel log-drain alert on that string).

## Launch checklist (placeholders that MUST be replaced)

Everything lives in `src/config/site.ts` unless noted:

1. **Phone** — CallRail-tracked local NJ number (display + E.164).
2. **Brokerage name + license number** — NJ REC advertising disclosure;
   brokerage is REQUIRED before launch.
3. **Legal entity + office address** — footer facts.
4. **Photo** — real photo of Sum → `public/sum.jpg`, update `principal.photo`.
5. **Proof numbers** — houses bought, Google review count + review URL
   (stat/badge stay hidden while zero — nothing fake ships).
6. **Intro video** — unlisted YouTube ID → `introVideoId`.
7. **Env vars** — copy `.env.example`; set `CRM_WEBHOOK_URL` and/or
   `RESEND_API_KEY` **before spending a dollar on ads** (leads-only-in-logs is
   a dev mode, not a launch mode), then Places key, GA4, Clarity, CallRail,
   Google Ads conversion label.
8. **County proof points** — add real `proofPoint`/`testimonial` entries in
   `src/data/counties.ts` as deals close (full first name + town only).
9. Attorney review of `/privacy` + `/terms` text.

## Deploy (Vercel)

Import the repo in Vercel with **Root Directory = `site/`**, add the env
vars, then point the GoDaddy domain: `A @ → 76.76.21.21`,
`CNAME www → cname.vercel-dns.com` (Vercel → Project → Domains shows the
exact records). Preview deploys per branch come free.

## A/B discipline (spec §6)

One test at a time, ≥100 clicks/variant. Order: headline framing → step-1 CTA
copy → trust-strip contents → long vs short page. Duplicate a `/lp/` campaign
slug per variant and split at the ad level.
