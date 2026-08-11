# Wholesaling 8.11.2026

NJ real-estate wholesaling pipeline built around an old (~2019-21 vintage) vendor lead list.
Owner: Sum. Footprint: Monmouth, Middlesex, Somerset, Union, Hudson counties, NJ.

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

- No AI voice, ringless VM, or bulk SMS on this file — zero consent artifacts exist.
  FCC 24-17 puts AI voice inside TCPA §227(b): $500–$1,500/call, uncapped.
- Market the equitable interest / offer to buy as principal — never the property
  itself (NJ unlicensed-brokering line, N.J.S.A. 45:15).
- NJ purchase contracts are not automatically assignable — express assignment clause
  required; attorney-drafted PSA (avoids the 3-day attorney-review window that
  attaches to realtor-form contracts).
- Every dial/scrub/consent event gets logged to `compliance/` before outreach scales.

## Conventions

- Python 3.11+, pandas/openpyxl. Data files stay out of git if this becomes a repo
  (contains PII) — see .gitignore.
- Property primary key: normalized `PROPERTY ADDRESS|CITY` until block/lot join lands,
  then `(county, district, block, lot, qualifier)`.
- All dollar figures in processed outputs are labeled as-pulled (~2019-21) vs adjusted.
