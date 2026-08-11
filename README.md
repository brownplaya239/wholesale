# Wholesaling 8.11.2026

NJ wholesaling pipeline: old-list revival, status resolution against free NJ public
data (SR1A / MOD-IV / NJGIN), buyer harvest, skip-trace prep, and compliant outreach.

Start with `CLAUDE.md` (project context) and `docs/PLAYBOOK.md` (the 5-step plan,
budget, and compliance checklist). `TODO.md` tracks next actions.

Quick start:
    pip install pandas openpyxl pyarrow requests
    python scripts/01_consolidate_and_score.py    # rebuild data/processed from raw
    python tests/selftest.py                      # offline pipeline check (no network)
    python scripts/02_status_resolution.py all    # SR1A+MOD-IV download, match, status
    python scripts/03_buyer_harvest.py            # cash-buyer clusters -> buyers.csv
    python scripts/04_skiptrace_export.py         # survivors-only vendor upload CSV
    python scripts/05_mail_segments.py            # mail S1-S4 + compliance templates

If the Treasury downloads 404 (links move), fetch the SR1A zips and the five
county MOD-IV zips by hand from
https://www.nj.gov/treasury/taxation/lpt/statdata.shtml, unzip, then:
    python scripts/02_status_resolution.py all --sr1a-dir DIR --modiv-dir DIR
