# Playbook — old-list revival, NJ (5 counties)

Condensed from the working sessions of 2026-08-11. Full reasoning lives in the
chat history; this is the operating doc.

## The list, honestly stated

Vendor pull, 4 segments, 7,989 unique NJ properties, vintage ~2019-21 (latest
recorded sale on file: Oct 2019). Consequences: expect 15-25%+ sold since;
2019 vacancy flags near-worthless; loan balances stale (true equity HIGHER than
shown — NJ appreciated heavily since); phone columns dangerous (reassignment =
TCPA exposure). No touch history or outcomes exist, so no propensity-model
training on this file — scoring is rule-based (see processed workbook README).

## Five steps, cheapest path (~$620-875 first cycle)

1. **Status resolution — $0.** NJ SR1A statewide sales files (free, 2020-present
   + YTD) x current MOD-IV x NJGIN parcels for address->block/lot. SR1A NU codes
   pre-label non-arm's-length transfers (estate/family) = the inheritance cohort.
   Daniel's Law redacts a small class of owner names in statewide files; county
   portals fill gaps (Tier A only).
2. **Buyer harvest — $0.** Sold-since grantees: flag entities, collapse shells by
   shared mailing address, NJ business-entity search for principals, rank by
   repeat count (3+ = verified). County clerk deed search is free. This asset may
   outvalue the remaining seller leads.
3. **Skip-trace survivors only — $55-85.** ~500-600 records post-resolution,
   CURRENT owner names from MOD-IV, bulk vendor at ~$0.07-0.15/rec. Keep raw
   vendor output (compliance). Never dial 2019 numbers.
4. **Vacancy re-verify — $15-40.** DPV vacancy API on the 546 Vacancy-source
   Tier A records; NCOA + "Return Service Requested" on the mailing covers the
   rest free. Also: OPRA the municipal registered vacant/abandoned lists.
5. **Outreach — $500-750.** First-Class letters (3 touches, 3-4 wks apart,
   ~$0.75-0.95/piece) to segments S1-S4; human manual dials 5 days behind each
   drop, 8am-9pm local, DNC (<=31-day refresh) + litigator scrub first.
   Door-knock the top ~40 (multi-list + verified vacant): $0, best conversion,
   doubles as condition inspection. Dial order: multi-list overlaps (8) ->
   inheritance cohort -> verified vacant -> rest.

Don't cheap out on: litigator scrub; First-Class postage (returns = data).

## Legal rails (NJ)

- No wholesaling-specific NJ statute; enforcement via licensing framework
  (N.J.S.A. 45:15). Market equitable interest / buy as principal — never the
  property itself.
- Contracts not automatically assignable: express assignment clause + addendum;
  attorney-drafted PSA avoids the realtor-form 3-day attorney-review window.
- FCC 24-17: AI voice = "artificial or prerecorded voice" under TCPA §227(b);
  $500-1,500/call uncapped, private right of action. No AI voice / ringless VM /
  bulk SMS on this file. AI belongs on INBOUND (receptionist, 24/7 qualification)
  and on prep/summarization for human dialers.
- Consent revocation rules (eff. 2025-04-11): honor any reasonable revocation
  <=10 business days; we honor immediately (compliance/optouts.csv).
- Watch: state wholesaling statutes accelerating (CT registration eff. 2026-07-01,
  OK, MD, TN, OR, IL caps). NJ passing something in 24 months is a live risk.

## Underwriting (when leads convert)

- ARV: own comp engine (arm's-length, renovated-condition comps, <=90d, <=0.5mi,
  never cross municipal/school boundaries); Zestimate is a prior only (~7%+
  median error off-market). Cross-check: comps vs assessed-value x municipal
  equalization ratio (NJ publishes annually) vs third-party AVM; 3 numbers
  within 8% = proceed, 20% spread = stop.
- Rehab tiers (NJ metro 2026, calibrate vs real bids within 2 deals):
  cosmetic $20-35/sf | standard $40-60 | heavy $70-100 | gut $110-175; +15-20%
  contingency unwalked; unknown interiors carry the upper bound.
- MAO = ARV_p25 x (1 - buyer margin 15-20%) - rehab_high - holding (6-9mo hard
  money) - closing (4-6% combined) - assignment fee (hard input). Lands at
  65-72% of (ARV - rehab) normal market, 58-65% slow.
- Three prices per deal: reservation (MAO, never disclosed) / opening offer
  (8-15% under MAO, anchored to documented comps+rehab) / seller anchor estimate.
  Seller anchor >35% above MAO = dead lead, move on.
- Fees >$15k: prefer double-close (transactional funding $1.5-3k) over assignment.
