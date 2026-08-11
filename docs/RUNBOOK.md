# Runbook — first full cycle, step by step

Operating checklist for running the pipeline end to end. PLAYBOOK.md holds the
reasoning and budget; this is the do-this-then-this version. Steps marked 💻
are script runs; 👤 are human tasks; 💵 cost money.

## Phase 0 — setup (once, ~15 min)

1. 💻 Clone the repo and check out the pipeline branch.
2. 💻 Copy `M_Power_Full_List__1_.xlsx` from the original project zip into
   `data/raw/`. Lead data is gitignored (PII) — the clone arrives without it.
3. 💻 `pip install pandas openpyxl pyarrow requests`
4. 💻 `python scripts/01_consolidate_and_score.py`
   Expect tier counts A=749 / B=2655 / C=3171 / D=1414. Writes
   `data/processed/master.parquet` + `tier_a.csv`.
5. 💻 `python tests/selftest.py` — 55 checks, all should pass. Proves the
   pipeline logic on this machine before any network work.

## Phase 1 — status resolution ($0)

6. 💻 `python scripts/02_status_resolution.py all`
   Downloads SR1A 2020→present + the 5 county MOD-IV files (cached in
   `data/cache/`), matches addresses to block/lot, joins sales, compares
   owners. Prints the report; writes `master_status.parquet`,
   `inheritance_cohort.csv`, `tier_a_unresolved.csv`.
7. 👤 If the download 404s: grab the SR1A zips + county MOD-IV zips by hand
   from https://www.nj.gov/treasury/taxation/lpt/statdata.shtml, unzip, rerun
   with `--sr1a-dir DIR --modiv-dir DIR`. If the parser reports layout drift,
   update the layout table in `scripts/nj_common.py` against the current
   SR1Afilelayout.pdf — it names the file and the failing check.
8. 👤 Sanity-check the report:
   - Sold-since should land roughly 15–25%. Wildly off → inspect a few rows.
   - Match rate ≥90%. Below that: add suffix/city aliases in
     `nj_common.normalize_address`, rerun `resolve` (fetch is cached).
   - `tier_a_unresolved.csv` is the manual queue — resolve Tier A rows via
     county portals (Monmouth OPRS etc.); ignore Tier C/D misses.

## Phase 2 — buyer harvest ($0)

9. 💻 `python scripts/03_buyer_harvest.py` → `data/processed/buyers.csv`,
   clusters ranked by acquisition count; 3+ = verified active.
10. 👤 For the top ~25 clusters: NJ business-entity search (Division of
    Revenue, free) on the entity names → fill `principal_guess`. Where the
    grantee was redacted (Daniel's Law), pull the deed image free on the
    county clerk portal using block/lot + deed book/page from the row.

## Phase 3 — skip-trace the survivors (💵 ~$55–85)

11. 💻 `python scripts/04_skiptrace_export.py` → `skiptrace_upload.csv`
    (survivors only, CURRENT owner names, inheritance cohort first; the
    console prints unique-owner count and the cost estimate).
12. 👤💵 Get TWO quotes (BatchSkipTracing / REISkip / Skip Force, ~$0.07–0.15
    per record). Add the top-25 buyer clusters to the same batch (+~$5).
    Require phone_type (wireless/landline) + last_seen_date in the return.
13. 👤 Archive the raw vendor return file untouched in
    `compliance/skiptrace_raw/`. Never dial the 2019 phone columns from the
    original list — vendor-match against them is corroboration only.

## Phase 4 — vacancy re-verification (💵 ~$15–40)

14. 👤💵 DPV/vacancy batch (Smarty or Melissa, ~$0.01–0.03/record) on the
    Vacancy-source Tier A records. Save the result as
    `data/processed/vacancy_flags.csv` with columns `ref_id,vacant`
    (ref_id = the pkey from skiptrace_upload/mail files). This feeds S3.
15. 👤 OPRA-request the registered vacant/abandoned property lists from your
    top municipalities (free; stronger signal than any API flag).
16. (Everyone else gets vacancy-checked free via returned mail in Phase 5.)

## Phase 5 — outreach (💵 ~$500–750 first touch)

Legal prep, before the first letter goes out:
17. 👤💵 NJ real-estate attorney: PSA with express assignment clause +
    assignment addendum ($500–1,500 one-time). Realtor-form contracts drag in
    the 3-day attorney-review window; attorney-drafted avoids it.
18. 👤 Register at the FTC telemarketing DNC portal (first 5 area codes
    free — covers 732/908/201/551/862). NJ's list piggybacks federal.
19. 👤💵 Litigator-scrub account (Blacklist Alliance / DNC.com, ~$50–100).
    Do not skip this one.

Mail:
20. 💻 `python scripts/05_mail_segments.py` → `mail_s1..s4.csv` +
    `mail_touch1_all.csv`, and creates the append-only templates in
    `compliance/`. Rerun after vacancy_flags.csv exists so S3 populates.
21. 👤💵 Upload to Click2Mail / Lob / PostGrid: First-Class letter, windowed
    envelope, plain typed, "Return Service Requested", NCOA on. Copy rule:
    you are offering to BUY as principal — no brokering language, entity
    name + real callback number on the letter.
22. 👤 Log every returned piece in `compliance/mail_returns.csv` (the reason
    code is your free vacancy signal). Honor any opt-out immediately in
    `compliance/optouts.csv`.

Phones (only after 18–19):
23. 👤 Scrub the skip-traced numbers: federal+NJ DNC (re-scrub every ≤31
    days) AND litigator list. Log each batch in `compliance/scrub_log.csv`.
24. 👤 Manual/click-to-dial by a human, 8am–9pm recipient local time, ~5 days
    after each mail drop. Dial order: multi-list overlaps → inheritance
    cohort with confirmed new owner → verified vacant → rest. Every dial goes
    in `compliance/dial_log.csv`. No AI voice / ringless VM / bulk SMS, ever,
    on this file.
25. 👤 Door-knock the top ~40 (multi-list + verified-vacant in
    Monmouth/Middlesex): $0, best conversion, doubles as the condition
    inspection. Vacant = inspect + leave a note.

Touches 2–3: repeat steps 20–24 at 3–4 week intervals (~$400–600 each),
gated on touch-1 response. Refresh status resolution (step 6, cached fetch)
before each touch so fresh sales drop out of the mail file.

## Budget recap (first cycle)

| Step | Item | Cost |
|---|---|---|
| 1–2 | SR1A + MOD-IV pulls, match, buyer harvest | $0 |
| 3 | Skip-trace ~550 survivors | $55–85 |
| 4 | DPV vacancy batch (+ NCOA bundled) | $15–40 |
| 5 | ~700 First-Class letters, touch 1 | $450–650 |
| 5 | Litigator scrub + DNC registration | $50–100 |
| | **Total, first cycle** | **~$620–875** |

One-time legal (attorney PSA): $500–1,500, before first contract — not
before first mail.
