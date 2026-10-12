# Lead pull spec — first 5,000 (BatchLeads 4,000 + Land Portal 1,000)

Where the files go:
- Google Drive → **HouseSoldNJ Lead Pulls**
  (https://drive.google.com/drive/folders/13BP4rvfP3ApN0kjb-dvuRG5XIluOvJKZ)
  - `BatchLeads/`
  - `Land Portal/`
  - `Scrub results/` (the DNC/litigator vendor's return files)

Claude pulls them into `data/raw/acq/`, which is git-ignored because it holds
PII. They then go through `scripts/09_acq_ingest.py inspect` → `add` → `build`.

## Rules that apply to every export

1. **One export per cohort.** Never one blended "distressed" query. Each file
   covers all 10 counties, with the County column included.
   - The dedupe after the pull merges a property that shows up in several
     cohorts into one record that keeps every signal.
2. **File name:** `<provider>_<cohort>_<YYYY-MM-DD>.csv`, for example
   `batchleads_vacant_equity_2026-10-07.csv` or
   `landportal_land_infill_2026-10-07.csv`. Cohort keys are listed in the tables
   below.
3. **Skip-trace before exporting** so the phones are in the same file. Land:
   apply the land filters first and skip-trace only the survivors.
4. **Export every column the tool offers.** At minimum (names don't matter;
   `inspect` maps them):
   - property address, city, ZIP, county, APN / parcel ID;
   - owner first and last name (or full name), owner 2;
   - mailing address, city, state, ZIP;
   - property type, units, beds, baths, sqft, lot size / acres, year built;
   - estimated value, mortgage balance, equity % and/or equity $, LTV;
   - last sale date, last sale price;
   - MLS / listing status;
   - flags: vacant, absentee / owner-occupied, tax delinquent, preforeclosure,
     inherited / probate, free & clear;
   - **phones 1–N, each with its phone type (mobile/landline) and the DNC and
     litigator flags if offered**;
   - emails;
   - land only: acres, wetlands %, flood zone and flood %, road frontage,
     landlocked / road access, slope.
5. **The vendor's DNC flag is not our scrub.** Numbers become callable only
   after our own registry and litigator scrub, done under your SAN. The
   vendor's "DNC = Yes" still removes a number.
6. **Common residential baseline** (every BatchLeads cohort):
   - off-market: exclude Active / Pending / Contingent / Coming Soon;
   - single-family + 2–4 units;
   - no sale in the last 24 months. The ingest also drops any sale in the last
     12 months.
   - Then apply the cohort's primary filter below.

## BatchLeads — 4,000 homes

Per-cohort primary filter and equity floor:

| Cohort key | Primary filter | Equity floor | Target |
|---|---|---|---|
| `vacant_equity` | Vacant | 40%+ | 950 |
| `tax_delinquent` | Tax delinquent | 30%+ | 700 |
| `absentee_landlord` | Absentee owner, owned 10+ years (tired landlord) | 30%+ | 650 |
| `inherited` | Inherited / probate / deceased owner | 20%+ | 550 |
| `preforeclosure` | Preforeclosure / lis pendens / notice of default | 20%+ | 500 |
| `free_clear` | Free & clear AND (absentee OR owned 15+ years) | 100% | 450 |
| `other_distress` | Code violation / municipal or physical distress | 30%+ | 200 |

Cohort × county targets. This is your county allocation split in proportion
to each cohort. If a cell has fewer matches, take what exists; don't backfill
across cohorts.

| Cohort | Camden | Mercer | Ocean | Atlantic | Monmouth | Cumberland | Burlington | Gloucester | Essex | Middlesex | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| vacant_equity | 166 | 119 | 119 | 95 | 95 | 83 | 83 | 71 | 71 | 48 | 950 |
| tax_delinquent | 123 | 88 | 88 | 70 | 70 | 61 | 61 | 52 | 52 | 35 | 700 |
| absentee_landlord | 114 | 81 | 81 | 65 | 65 | 57 | 57 | 49 | 49 | 32 | 650 |
| inherited | 96 | 69 | 69 | 55 | 55 | 48 | 48 | 41 | 41 | 28 | 550 |
| preforeclosure | 88 | 63 | 62 | 50 | 50 | 44 | 44 | 37 | 37 | 25 | 500 |
| free_clear | 79 | 56 | 56 | 45 | 45 | 39 | 39 | 34 | 34 | 23 | 450 |
| other_distress | 35 | 25 | 25 | 20 | 20 | 18 | 17 | 15 | 15 | 10 | 200 |
| **Total** | **701** | **501** | **500** | **400** | **400** | **350** | **349** | **299** | **299** | **201** | **4,000** |

## Land Portal — 1,000 parcels

| Cohort key | Acreage | Target |
|---|---|---|
| `land_infill` | 0.10–2 ac | 450 |
| `land_acreage` | 2–10 ac | 350 |
| `land_strategic` | larger / subdivision / assemblage | 200 |

Filters to apply **before** skip-tracing:

| Filter | Rule |
|---|---|
| Road access | Exclude landlocked parcels (keep frontage > 0) |
| Wetlands | Under 20% (under 10% for infill) |
| Flood | Under 50% in the flood zone; no floodway / V zones |
| Slope | Under 15% |
| Ownership | Absentee and/or held 10+ years preferred |
| Listing | Off-market |
| Mailing address | Valid |

- **Pinelands.** Atlantic, Burlington, Camden, Cumberland, Gloucester and
  Ocean overlap the Pinelands. Parcels in its Preservation and Forest areas are
  close to unbuildable. If Land Portal has a Pinelands or zoning layer, exclude
  those areas. If not, note it and the ingest will flag it once that check is
  added.
- **Owners with several parcels:** call them once, but keep every parcel. The
  ingest does this automatically.

## After upload

Tell Claude the files are in. It will:
1. pull them and run `inspect` on each, fixing any column that doesn't map;
2. `add` them, then `build` the NJ-only universe;
3. produce the scrub request file. Put the vendor's return in
   `Scrub results/`.
4. `scrub-apply` → `build` → `plan` → the 25-record test wave.
