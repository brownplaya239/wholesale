# Wholesaling 8.11.2026

NJ real-estate wholesaling pipeline built around an old (~2019-21 vintage) vendor lead list,
now extended (2026-10-01) into a GHL-centered acquisition machine fed by BatchLeads + Land Portal.
Owner: Sum. Footprint: original list = Monmouth, Middlesex, Somerset, Union, Hudson; the
BatchLeads pull adds Camden, Mercer, Atlantic, Cumberland, Ocean, Burlington, Gloucester, Essex.

## Current state (as of 2026-08-11)

- `data/raw/M_Power_Full_List__1_.xlsx` — original vendor pull. 4 sheets (Vacancy,
  High Equity, Bad Credit, Inherited), 8,000 raw rows, 7,989 unique properties after
  dedupe. Latest recorded sale in file: Oct 2019 → list is ~6 years stale.
  Known defects: Inherited sheet has 3,453 fully-empty rows + 12 orphaned phone
  fragments; Bad Credit sheet has a thinner schema (no beds/baths/sqft, no owner
  mailing address).
- `data/processed/M_Power_Scored_Master.xlsx` — consolidated, deduped, rule-scored.
  Tiers: A=749, B=2,655, C=3,171, D=1,414. README sheet documents scoring and the
  appreciation-factor input cell (yellow, default 1.50) that drives Adj Est Value /
  Adj Equity formulas on the Master sheet.
- `scripts/01_consolidate_and_score.py` reproduces the processed workbook from raw.
- Pipeline scripts 02-05 are IMPLEMENTED (2026-08-11) with an offline test rig
  (`python tests/selftest.py`, 55 checks: parsers, matcher, decision map, all
  downstream exports). `scripts/nj_common.py` holds the SR1A (665-char) and
  MOD-IV (701-char) fixed-width layouts — transcribed from the state specs and
  cross-checked against johnjreiser/NJParcelTools — plus normalizers and the
  download helpers. Parsers validate on read and fail loudly on layout drift;
  delimited OPRA extracts are auto-detected as a fallback. The live download
  path could NOT be exercised from the dev sandbox (nj.gov egress blocked):
  first real `02 fetch` happens on a normal machine, with --sr1a-dir /
  --modiv-dir as the manual fallback if Treasury moved the links.
- `site/` — HouseSoldNJ.com conversion site (2026-08-13): Next.js 15 +
  Tailwind 4, built to the PPC conversion spec. County/situation pages from
  `site/src/data/`, /lp/{campaign} noindexed landing variants with param-driven
  headlines, two-step lead form with per-lead TCPA consent artifact, delivery
  via CRM webhook + Resend + Slack (env-gated). ALL business facts are
  placeholders in `site/src/config/site.ts`; launch checklist in
  `site/README.md`. Deploy: Vercel, root dir `site/`. Web leads with stored
  consent are the ONLY texting lane this business has.
- ACQUISITION MACHINE (2026-10-01) — docs/ACQUISITION_SYSTEM.md is the operating doc.
  GoHighLevel is the system of record (Contact = person + dial state, Property =
  custom object, Opportunity = deal; schema as code in `site/src/lib/acq/schema.ts`,
  `npm run ghl:provision`). `scripts/09_acq_ingest.py` (vendor exports -> deduped,
  suppressed, scored universe with lanes + call windows) and
  `scripts/10_acq_release.py` (capacity-driven stratified waves, re-scrub, patch)
  feed `npm run ghl:push`. WAVV (embedded in GHL) dials; its signed webhooks hit
  `/api/hooks/wavv` -> call log in Postgres -> compliance audit -> disposition
  engine (`dispositions.ts`, the ONLY writer of dial state) -> GHL; recorded calls
  -> WAVV transcript -> Claude review (`callIntel.ts`, writes only AI fields) ->
  auto-DNC on missed opt-outs, hidden-hot alerts, QA. Hot/Booked outbound sellers
  get the site's property report. `/admin/calls` = funnel by caller x county x
  cohort, compliance, QA listen-list. Web-form leads also land in GHL.
  Tests: `python tests/selftest.py` (incl. acquisition section) +
  `cd site && npm run test:unit`. Live GHL/WAVV calls were NOT exercised from the
  dev sandbox — section 12 of the doc lists what to verify on first run.

## Pipeline (docs/PLAYBOOK.md has full detail + budget)

1. **Status resolution** (`scripts/02_status_resolution.py`) — join list to NJ SR1A
   statewide sales files (2020–present, free from nj.gov/treasury/taxation, fixed-width
   layout per SR1Afilelayout.pdf) + current MOD-IV assessment file + NJGIN parcel layer
   for address→block/lot. Output per property: sold-since (date/price/usability code),
   same owner, or owner-name change w/o arm's-length sale (inheritance cohort).
2. **Buyer harvest** (`scripts/03_buyer_harvest.py`) — from sold-since set, extract
   LLC/repeat grantees; collapse entities by shared mailing address; NJ business-entity
   search for principals. Deliverable: verified cash-buyer list.
3. **Skip-trace prep** (`scripts/04_skiptrace_export.py`) — export ONLY post-resolution
   survivors (~500-600), using CURRENT owner names from MOD-IV, for bulk vendor upload.
   Never dial the 2019 phone columns (reassigned-number TCPA risk).
4. **Vacancy re-verification** — DPV vacancy API on the 546 Vacancy-source Tier A
   records; NCOA + "Return Service Requested" on the mail run covers the rest.
5. **Outreach** (`scripts/05_mail_segments.py`) — First-Class letter sequence (3 touches)
   to segmented Tier A; manual-dial calls 8am–9pm local only after federal+NJ DNC scrub
   (refresh ≤31 days) AND litigator scrub. Append-only dial log in `compliance/`.

## Hard rules

- No AI voice, ringless VM, bulk SMS, or PRERECORDED VOICEMAIL DROPS on this file or
  any BatchLeads / Land Portal list — zero consent artifacts exist. FCC 24-17 puts AI
  voice inside TCPA §227(b): $500–$1,500/call, uncapped. WAVV auto-drops a recorded
  voicemail in multi-line mode: never upload one. Cold GHL contacts carry SMS DND +
  `no-sms`.
- Dialing (WAVV): DNC+litigator scrub ≤31 days under Sum's own registry SAN, power
  lane only, 1 line until counsel signs off on abandonment (3%/30 days, 47 CFR
  64.1200(a)(7)); FL/OK/MD owners or area codes = manual lane, single line.
  Calling policy Mon–Sat 9am–8pm in the owner's zone (mailing state), no Sundays or
  federal holidays. "This call may be recorded" + Sum's license/Coldwell Banker in
  the opening. Callers never quote price, offers, commission or listing terms.
- Sum IS a licensed NJ real estate agent (updated 2026-08-11) — the
  unlicensed-brokering concern is moot; the binding rules are NJ REC's:
  disclose license status at first contact and in writing (and in any
  contract where Sum buys as principal); solicitation runs under the
  brokerage identity per office policy; NEVER solicit another broker's
  active listings (05/06 suppress via
  data/processed/suppress_active_listings.csv — keep the MLS export fresh);
  leads may be converted to listings — present buy-vs-list options honestly.
- NJ purchase contracts are not automatically assignable — express assignment clause
  required; attorney-drafted PSA (avoids the 3-day attorney-review window that
  attaches to realtor-form contracts).
- Three deal paths, chosen buyer-first: great deal → buy directly; OK deal →
  assign the contract to an investor partner; not an investor deal → list it
  as the seller's agent through Coldwell Banker. The seller learns which in
  writing before signing, via Sum's own contracts
  (docs/SELLER_ROLE_DISCLOSURE.html is a shelved optional one-pager — don't
  push it unless asked). Coldwell
  Banker office policy permits assignment; NJ does not require disclosing
  the assignment-fee amount (both confirmed by Sum 2026-09-28). No NJ
  wholesaling statute exists yet — S3824 (2023, not enacted) proposed a
  wholesaler license + 3-day pre-offer disclosure; recheck before scaling.
  Site copy must never claim a direct purchase unconditionally —
  `site/src/components/RoleDisclosure.tsx` is the canonical wording. Never
  start as listing agent and then buy or assign without separate written,
  informed consent.
- `compliance/DNC_PROCEDURES.md` is the binding written calling policy; no caller dials
  before training + a signed acknowledgement (`compliance/CALLER_TRAINING.md`) and their
  WAVV id is in `ACQ_TRAINED_CALLERS`. Only cleared mailing states are callable
  (`09 build --dial-states`, default NJ). NJ telemarketer registration: deferred by
  owner decision 2026-10-06 — open item.
- Every dial/scrub/consent event gets logged to `compliance/` before outreach scales
  (dial log: `/api/admin/acq/export?kind=calls`; scrubs: `10 scrub-apply` appends
  scrub_log.csv; internal DNC: `acq_suppression` table, append-only).

## Conventions

- Python 3.11+, pandas/openpyxl. Data files stay out of git if this becomes a repo
  (contains PII) — see .gitignore.
- Property primary key: normalized `PROPERTY ADDRESS|CITY` until block/lot join lands,
  then `(county, district, block, lot, qualifier)`.
- All dollar figures in processed outputs are labeled as-pulled (~2019-21) vs adjusted.
