"""Build door-knock routes and the call-first list from the hot cohort.

Hot set = inheritance cohort + multi-list overlaps, minus anything already
sold (arm's-length or priced executor sale). Split by where the owner gets
mail:

  doorknock_routes.csv  owner's mailing address IS the property (heir lives
                        there or collects mail there) or mailing unknown —
                        a knock can reach them. Grouped into town clusters,
                        ordered by cluster size then priority, with a stop
                        number and a notes column for the clipboard.
  call_first.csv        absentee owner (mailing elsewhere) — knocking the
                        property reaches nobody; these convert by phone
                        (after DNC + litigator scrub) with mail air-cover.
                        out_of_state flags the strongest-motivation subset.

Run after 02:  python scripts/06_routes.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nj_common import (  # noqa: E402
    PROCESSED, house_number, is_suppressed, load_listing_suppression,
    normalize_address, street_key,
)


def mail_at_property(prop_addr: str, owner_addr: str) -> bool | None:
    """True if the owner's mailing street is the property itself.

    Compares house number + first street token (survives the 25-char MOD-IV
    truncation and suffix spelling differences). None when unknowable.
    """
    o = normalize_address(owner_addr)
    if not o:
        return None
    p = normalize_address(prop_addr)
    return house_number(p) == house_number(o) and street_key(p) == street_key(o)


def build_routes(m: pd.DataFrame,
                 suppress: set | None = None
                 ) -> tuple[pd.DataFrame, pd.DataFrame]:
    hot = m[
        ((m["cohort"] == "INHERITANCE") | (m["SourceCount"] >= 2))
        & (m["status"] != "SOLD_ARMS_LENGTH")
        & (m["cohort"] != "ESTATE_SALE_PRICED")
    ].copy()
    if suppress:
        listed = [is_suppressed(a, c, z, suppress) for a, c, z in
                  zip(hot["Property Address"], hot["Property City"],
                      hot["Property Zip Code"])]
        if sum(listed):
            print(f"  suppressed {sum(listed)} actively-listed properties")
        hot = hot[[not x for x in listed]]

    hot["at_property"] = [
        mail_at_property(pa, oa)
        for pa, oa in zip(hot["Property Address"], hot["mv_owner_address"])
    ]
    mailing = hot["current_owner_mailing"].fillna("")
    hot["out_of_state"] = mailing.str.strip().ne("") & ~mailing.str.upper() \
        .str.replace(".", "", regex=False).str.contains(r"\bNJ\b|\bN J\b",
                                                        regex=True)
    hot["notes"] = (
        hot["cohort"].fillna("").replace("", "multi-list")
        + "; " + hot["Sources"].fillna("")
        + "; deed " + hot["sale_date"].astype(str).str[:10].replace("NaT", "-")
        + " $" + hot["sale_price"].fillna(0).astype(int).astype(str)
        + "; " + hot["status"]
    )

    knock = hot[hot["at_property"].isin([True, None])
                | hot["at_property"].isna()].copy()
    calls = hot[hot["at_property"] == False].copy()  # noqa: E712

    # cluster = town; biggest clusters first, best score first within
    sizes = knock.groupby("Property City")["pkey"].transform("size")
    knock = knock.assign(_sz=sizes).sort_values(
        ["_sz", "Property City", "PriorityScore"],
        ascending=[False, True, False]).drop(columns="_sz")
    knock["stop"] = range(1, len(knock) + 1)
    calls = calls.sort_values(
        ["out_of_state", "PriorityScore"], ascending=[False, False])

    cols = ["stop", "Property Address", "Property City", "County", "Tier",
            "PriorityScore", "cohort", "status", "sale_date", "sale_price",
            "current_owner", "current_owner_mailing", "notes"]
    kcols = [c for c in cols if c in knock.columns]
    ccols = [c for c in cols if c != "stop" and c in calls.columns] + \
        ["out_of_state"]
    return knock[kcols], calls[ccols]


def main() -> None:
    src = PROCESSED / "master_status.parquet"
    if not src.exists():
        raise SystemExit("Run 02_status_resolution.py first.")
    knock, calls = build_routes(pd.read_parquet(src),
                                load_listing_suppression())
    knock.to_csv(PROCESSED / "doorknock_routes.csv", index=False)
    calls.to_csv(PROCESSED / "call_first.csv", index=False)
    print(f"Door-knock: {len(knock)} stops across "
          f"{knock['Property City'].nunique()} towns "
          f"-> doorknock_routes.csv")
    print(knock.groupby("Property City")["stop"].count()
          .sort_values(ascending=False).head(10).to_string())
    print(f"\nCall-first (absentee): {len(calls)}, "
          f"{int(calls['out_of_state'].sum())} out-of-state "
          f"-> call_first.csv")
    print("Reminder: NO dial before DNC + litigator scrub "
          "(compliance/scrub_log.csv).")


if __name__ == "__main__":
    main()
