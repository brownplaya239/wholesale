# TODO — Wholesaling 8.11.2026

## Deals under evaluation
- [ ] 701-703 Monroe Ave, Asbury Park (Block 2608 Lot 7) — dossier + massing
      test + deal screen in docs/deals/701-703-monroe-asbury-park/. Verdict:
      pass at $2.5M ask (risk-adjusted ~$1.1M). Open items: zoning
      determination letter, OPRA package, 700 Monroe amendment status.

## Now (blocking everything else)
- [x] Implement `scripts/02_status_resolution.py` (2026-08-11):
  - [x] fetch_sr1a: scrapes statdata.shtml links, fixed-width parse per
        SR1Afilelayout.pdf (665-char layout, validated + drift-detected),
        delimited-extract fallback, --sr1a-dir manual override
  - [x] MOD-IV as the address→block/lot join source (owner + situs in one
        file); NJGIN parcels optional via --njgin (muncode names, gap-fill)
  - [x] address normalizer + match cascade (>=90% auto-match: 99.9% on the
        synthetic scale test; real-world rate TBD on first live run)
  - [x] MOD-IV owner-name compare, status + cohort columns
  - [x] report: sold-since %, inheritance cohort, tier_a_unresolved.csv queue
- [x] `scripts/01_consolidate_and_score.py` regenerates master.parquet
- [x] FIRST LIVE RUN done 2026-08-11: 391,734 sales + 929,397 parcels parsed.
      Results: sold-since 27.8% (2,224), inheritance cohort 320, match rate
      85.8%, Tier A manual queue 196.
      DISCOVERY: statewide MOD-IV blanks ALL owner names and SR1A blanks the
      whole grantor/grantee block (Daniel's Law-era redaction; NJGIN redacts
      too). Owner comparison + buyer harvest are gated on OPRA files.
- [ ] SEND OPRA REQUESTS (5 county tax boards, MOD-IV + SR1A) — template in
      docs/OPRA_REQUEST.md. On arrival:
      `02 all --modiv-dir DIR --sr1a-dir DIR` then rerun 03/04/05
- [ ] Work tier_a_unresolved.csv (196 rows) via county portals
- [ ] Consider match-rate tuning pass (85.8% now; 908 unmatched / 226
      ambiguous — mostly city-name and truncation issues)

## Next
- [x] Implement 03_buyer_harvest -> buyers.csv (rank grantees, collapse shells)
- [x] Implement 04_skiptrace_export -> skiptrace_upload.csv
- [x] Implement 05_mail_segments -> mail_s1..s4.csv + compliance templates
- [ ] Get 2 skip-trace vendor quotes (~500-600 records)
- [ ] DPV vacancy API batch on the 546 Vacancy-source Tier A records (~$15)
      -> save as data/processed/vacancy_flags.csv (ref_id,vacant) for S3
- [ ] OPRA requests to top municipalities for registered vacant/abandoned lists

## MOMLS / Spark API (Monmouth coverage only)
- [ ] Get Spark API token (sparkplatform.com w/ flexmls login, or MOMLS
      member services); `set SPARK_ACCESS_TOKEN=...`;
      `python scripts/07_comps.py ping`
- [ ] `07 suppress` before EVERY mail drop / knock day (unions
      suppress_manual.csv for the 4 non-MOMLS counties)
- [ ] `07 expireds` once — overlay failed-retail attempts on the hot list
- [ ] `07 comps` per live lead (ARV band + MAO + listing number)

## Before first outreach
- [ ] NJ RE attorney: draft PSA w/ express assignment clause + assignment addendum
      ($500-1,500 — avoids realtor-form 3-day attorney-review window)
- [ ] Federal DNC portal registration (first 5 area codes free) + litigator scrub acct
- [ ] Mail vendor pick (Click2Mail/Lob/PostGrid), NCOA + Return Service Requested
- [ ] Stand up compliance/ logs per compliance/README.md

## Later
- [ ] Inbound line: AI receptionist for mail-response calls (legally clean; speed-to-lead)
- [ ] ARV comp engine per docs/PLAYBOOK.md Stage 5 (backtest on known sales first)
- [ ] If outcomes accumulate: propensity model (LightGBM, time-split validation)

## Budget guardrail (first cycle): ~$620-875
skip-trace $55-85 | vacancy API $15-40 | 700 letters $450-650 | scrubs $50-100
Touches 2-3: +$400-600 each, gated on touch-1 response.
