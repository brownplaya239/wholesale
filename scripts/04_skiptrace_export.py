"""Export the post-resolution survivor set for bulk skip-trace upload.

Rules (non-negotiable):
  - ONLY rows surviving status resolution (SAME_OWNER, OWNER_CHANGED_NO_SALE,
    SOLD_NON_USABLE estate/family). Never the full 7,989.
  - Use CURRENT owner name from MOD-IV, not the 2019 list name (the listed
    person may be deceased — especially the Inherited cohort).
  - Never dial the 2019 Phone columns. Reassigned numbers = TCPA exposure.
    Old numbers are corroboration only (vendor match => higher confidence).

Vendor notes: bulk CSV to BatchSkipTracing / REISkip / Skip Force,
~$0.07-0.15/record at 500+ volume; get 2 quotes, it's a commodity.
Require in return file: phone_type (wireless/landline), last_seen_date.
Archive raw vendor output to compliance/skiptrace_raw/ (audit trail).

Output: data/processed/skiptrace_upload.csv
  ref_id, first_name, last_name, is_entity, mailing_address, mailing_city,
  mailing_state, mailing_zip, property_address, property_city,
  property_state, property_zip, cohort, tier, trace_group
trace_group collapses one owner holding several properties into one trace.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nj_common import PROCESSED, is_entity  # noqa: E402

SURVIVOR_STATUSES = {"SAME_OWNER", "OWNER_CHANGED_NO_SALE"}


def split_owner_name(name: str) -> tuple[str, str]:
    """MOD-IV style 'SURNAME, FIRST' / 'SURNAME FIRST & SPOUSE' -> first,last."""
    s = re.sub(r"\s+", " ", str(name or "")).strip().upper()
    if not s:
        return "", ""
    if is_entity(s):
        return "", s  # vendors take company names in the last-name field
    s = s.split("&")[0].split(" AND ")[0].strip()
    if "," in s:
        last, _, first = s.partition(",")
        return first.strip().split(" ")[0], last.strip()
    toks = s.split(" ")
    if len(toks) == 1:
        return "", toks[0]
    return toks[1], toks[0]  # MOD-IV leads with the surname


def build_upload(m: pd.DataFrame) -> pd.DataFrame:
    survivors = m[
        m["status"].isin(SURVIVOR_STATUSES)
        | ((m["status"] == "SOLD_NON_USABLE") & (m["cohort"] == "INHERITANCE"))
    ].copy()

    cur = survivors["current_owner"].fillna("")
    use_current = cur.str.strip().ne("") & ~cur.str.contains("REDACT")
    names = [
        split_owner_name(c) if u else (str(f or ""), str(ln or ""))
        for c, u, f, ln in zip(cur, use_current,
                               survivors["First Name"],
                               survivors["Last Name"])
    ]
    survivors["first_name"] = [a for a, _ in names]
    survivors["last_name"] = [b for _, b in names]
    survivors["is_entity"] = survivors["last_name"].map(is_entity)

    # mailing: current MOD-IV owner mailing where we have it, else the list's
    mv_ok = survivors["mv_owner_address"].fillna("").str.strip().ne("")
    survivors["mailing_address"] = survivors["mv_owner_address"].where(
        mv_ok, survivors["Owner Address"])
    survivors["mailing_city"] = survivors["mv_owner_city"].where(
        mv_ok, survivors["Owner City"])
    survivors["mailing_state"] = pd.Series("NJ", index=survivors.index).where(
        mv_ok, survivors["Owner State"].fillna("NJ"))
    survivors["mailing_zip"] = (survivors["mv_owner_zip"].where(
        mv_ok, survivors["Owner Zip Code"]).astype("string").str[:5])
    # MOD-IV owner_city is free-form and often carries the state; NJ default
    # above is a heuristic — the mail house's NCOA pass corrects it.

    out = pd.DataFrame({
        "ref_id": survivors["pkey"],
        "first_name": survivors["first_name"],
        "last_name": survivors["last_name"],
        "is_entity": survivors["is_entity"],
        "mailing_address": survivors["mailing_address"],
        "mailing_city": survivors["mailing_city"],
        "mailing_state": survivors["mailing_state"],
        "mailing_zip": survivors["mailing_zip"],
        "property_address": survivors["Property Address"],
        "property_city": survivors["Property City"],
        "property_state": "NJ",
        "property_zip": survivors["Property Zip Code"],
        "cohort": survivors["cohort"],
        "tier": survivors["Tier"].astype(str),
        "priority": survivors["PriorityScore"],
    })
    out["trace_group"] = (
        out["last_name"].fillna("") + "|" + out["first_name"].fillna("")
        + "|" + out["mailing_zip"].fillna("")
    ).str.upper()
    order = out["cohort"].map({"INHERITANCE": 0}).fillna(1)
    return out.assign(_o=order).sort_values(
        ["_o", "priority"], ascending=[True, False]).drop(columns="_o")


def main() -> None:
    src = PROCESSED / "master_status.parquet"
    if not src.exists():
        raise SystemExit("Run 02_status_resolution.py first.")
    out = build_upload(pd.read_parquet(src))
    dest = PROCESSED / "skiptrace_upload.csv"
    out.to_csv(dest, index=False)
    uniq = out["trace_group"].nunique()
    print(f"{len(out):,} survivor records, {uniq:,} unique owners to trace")
    print(out["cohort"].value_counts(dropna=False).to_string())
    est_lo, est_hi = uniq * 0.07, uniq * 0.15
    print(f"Vendor cost at $0.07-0.15/record: ${est_lo:,.0f}-{est_hi:,.0f}")
    print(f"Wrote {dest}")


if __name__ == "__main__":
    main()
