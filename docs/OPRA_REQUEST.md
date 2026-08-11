# Getting owner names back: OPRA requests

## Why this exists

As of the 2026 pulls, BOTH free statewide sources blank owner names:

- The Treasury statewide MOD-IV download (`modiv-<year>.zip`) ships with the
  35-char owner-name field blank on every record (mailing street/city/zip
  remain populated).
- The NJGIN "Parcels and MOD-IV Composite" redacts OWNER_NAME for public web
  access, per its own metadata.

This is fallout from Daniel's Law (N.J.S.A. 47:1B-1 et seq.). The underlying
records are still public: tax lists with owner names are obtainable via OPRA,
with redactions applied only to the statutorily protected class (judges,
prosecutors, law-enforcement). County tax boards and municipal assessors
fulfill these routinely.

Until the OPRA files arrive, the pipeline runs fine without names — matched
parcels with no sale since 2020 get status NO_SALE_OWNER_UNVERIFIED and are
mailed/skip-traced under the 2019 list name. When the files arrive, drop them
in a folder and re-run:

    python scripts/02_status_resolution.py all --modiv-dir <folder>

and those records upgrade to SAME_OWNER / OWNER_CHANGED_NO_SALE, which
sharpens the inheritance cohort (the highest-value segment).

## Where to send

One request per county tax board (5 total). County tax board contact pages
list an OPRA custodian or records-request form; some accept email. Monmouth
and Middlesex also run their own open-records portals which may be faster.
Alternative single-stop: NJ Division of Taxation, Property Administration
(records custodian via the state OPRA central portal) for the MOD-IV master
file of the five counties.

## Request text (adapt per county)

> Pursuant to the Open Public Records Act, I request a copy of the current
> year MOD-IV Tax List master file (flat file / "RE" format, per the MOD-IV
> User Manual layout) for all taxing districts in <COUNTY> County, in
> electronic format (download link or email preferred; I will supply media if
> required). I understand owner names for persons protected under Daniel's
> Law will be redacted; I request the file otherwise unredacted, including
> owner names and mailing addresses.
>
> If the full master file cannot be provided, I request the following fields
> per line item as maintained: district, block, lot, qualifier, property
> location, property class, owner name, owner mailing address, deed book/page,
> deed date, sale price, assessed values.
>
> This request is for a commercial purpose as defined by P.L. 2021 c.179;
> please advise of any applicable fees before fulfilling.

Notes:
- The commercial-purpose disclosure is required for commercial requestors in
  NJ; misstating it risks the request (and worse). Keep it in.
- Expect 7 business days statutory response, sometimes an extension letter.
- If a county pushes back on the flat file, ask for their standard
  "Tax List export" in CSV — `nj_common.py` auto-detects delimited files, so
  a CSV with a header row drops straight into --modiv-dir unchanged.
- SR1A note: if the sales files' grantor/grantee names ever go blank the same
  way (check `buyers.csv` quality), the same request template works for the
  county's SR1A / "Grantor's Listing" export — that feeds 03_buyer_harvest.
