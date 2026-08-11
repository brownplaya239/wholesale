"""One ranked target board: every hot lead, its contact method, and why.

Merges master_status + the MLS overlay (hot_list_expired_overlay.csv, if
present) + active-listing suppression into data/processed/targets.csv,
encoding the session's triage rules:

Score adjustments (on top of PriorityScore):
  +15  RENTED overlay          heir-landlord, strongest pitch angle
  +10  deed within 18 months   estate still settling, you're early
  +10  out-of-state mailing    distance = motivation
   +8  FAILED_SALE overlay     tried retail, failed — primed for the buy
  -15  NU-1 deed after an in-window MLS purchase = estate PLANNING
       (living owner reorganizing title), not bereavement

Method assignment:
  DROP           MLS sale same day as the $1 deed (buyer's closing
                 maneuver — current owner is a recent purchaser)
  WATCH          actively listed now (never solicit; becomes #1 if the
                 listing expires — re-run 07 suppress/expireds monthly)
  MANUAL_LOOKUP  unmatched/ambiguous — county portal, 10 min each
  KNOCK          owner gets mail at the property (or mailing unknown)
  CALL_FIRST     absentee owner — phone after DNC+litigator scrub,
                 mail meanwhile

Everything except DROP/WATCH also receives the mail sequence.
Run after 02 (and ideally 07 suppress + 07 expireds):
  python scripts/08_targets.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nj_common import PROCESSED, is_suppressed, load_listing_suppression  # noqa: E402

_r = __import__("importlib.util", fromlist=["util"])
_spec = _r.spec_from_file_location(
    "s06", Path(__file__).resolve().parent / "06_routes.py")
s06 = _r.module_from_spec(_spec)
_spec.loader.exec_module(s06)


def build_targets(m: pd.DataFrame, overlay: pd.DataFrame | None,
                  suppress: set | None = None) -> pd.DataFrame:
    hot = m[
        ((m["cohort"] == "INHERITANCE") | (m["SourceCount"] >= 2))
        & (m["status"] != "SOLD_ARMS_LENGTH")
        & (m["cohort"] != "ESTATE_SALE_PRICED")
    ].copy()

    hot["mls_type"] = ""
    hot["mls_close_date"] = ""
    if overlay is not None and len(overlay):
        ov = overlay.set_index("pkey")
        for col in ("mls_type", "mls_close_date"):
            if col in ov.columns:
                hot.loc[hot["pkey"].isin(ov.index), col] = (
                    hot.loc[hot["pkey"].isin(ov.index), "pkey"]
                    .map(ov[col]).fillna(""))

    hot["at_property"] = [
        s06.mail_at_property(pa, oa)
        for pa, oa in zip(hot["Property Address"], hot["mv_owner_address"])
    ]
    mailing = hot["current_owner_mailing"].fillna("")
    hot["out_of_state"] = mailing.str.strip().ne("") & ~mailing.str.upper() \
        .str.replace(".", "", regex=False).str.contains(r"\bNJ\b|\bN J\b",
                                                        regex=True)
    fresh = hot["sale_date"].notna() & (
        hot["sale_date"] >= pd.Timestamp.today() - pd.DateOffset(months=18))
    mls_close = pd.to_datetime(hot["mls_close_date"], errors="coerce")
    same_day = (hot["mls_type"] == "SOLD_VIA_MLS") & mls_close.notna() & (
        mls_close.dt.normalize()
        == pd.to_datetime(hot["sale_date"]).dt.normalize())
    planning = (hot["mls_type"] == "SOLD_VIA_MLS") & ~same_day & (
        hot["nu_code"] == 1) & (mls_close >= "2020-01-01")

    score = hot["PriorityScore"].fillna(0).astype(float)
    score += (hot["mls_type"] == "RENTED") * 15
    score += fresh * 10
    score += hot["out_of_state"] * 10
    score += hot["mls_type"].isin(["FAILED_SALE", "RENTAL_FAILED"]) * 8
    score -= planning * 15
    hot["score"] = score

    listed_now = hot["mls_type"] == "LISTED_NOW"
    if suppress:
        listed_now = listed_now | pd.Series(
            [is_suppressed(a, c, z, suppress) for a, c, z in
             zip(hot["Property Address"], hot["Property City"],
                 hot["Property Zip Code"])], index=hot.index)

    method = pd.Series("CALL_FIRST", index=hot.index)
    method[hot["at_property"].isin([True]) | hot["at_property"].isna()] = \
        "KNOCK"
    method[hot["status"] == "UNRESOLVED"] = "MANUAL_LOOKUP"
    method[listed_now] = "WATCH"
    method[same_day] = "DROP"
    hot["method"] = method

    def note(r):
        bits = []
        if r["method"] == "DROP":
            bits.append("MLS sale same day as $1 deed = recent buyer")
        if r["method"] == "WATCH":
            bits.append("actively listed — becomes #1 if it expires")
        if r["mls_type"] == "RENTED":
            bits.append("heir-landlord (closed rental on file)")
        if r["mls_type"] in ("FAILED_SALE", "RENTAL_FAILED"):
            bits.append("failed listing — retail already disappointed")
        if bool(r["_planning"]):
            bits.append("estate-planning transfer (bought then family-"
                        "deeded) — softer motivation")
        if bool(r["_fresh"]):
            bits.append("deed <18mo — early window")
        if bool(r["out_of_state"]):
            bits.append("out-of-state owner")
        return "; ".join(bits)

    hot["_planning"], hot["_fresh"] = planning, fresh
    hot["why"] = hot.apply(note, axis=1)
    hot = hot.drop(columns=["_planning", "_fresh"])

    order = {"KNOCK": 0, "CALL_FIRST": 0, "MANUAL_LOOKUP": 1,
             "WATCH": 2, "DROP": 3}
    hot = hot.sort_values("score", ascending=False).sort_values(
        "method", key=lambda s: s.map(order), kind="stable")
    hot["rank"] = range(1, len(hot) + 1)

    cols = ["rank", "method", "Property Address", "Property City", "County",
            "Tier", "score", "cohort", "status", "sale_date", "sale_price",
            "nu_code", "mls_type", "current_owner", "current_owner_mailing",
            "why", "pkey"]
    return hot[[c for c in cols if c in hot.columns]]


def main() -> None:
    src = PROCESSED / "master_status.parquet"
    if not src.exists():
        raise SystemExit("Run 02_status_resolution.py first.")
    ov_csv = PROCESSED / "hot_list_expired_overlay.csv"
    overlay = pd.read_csv(ov_csv, dtype=str) if ov_csv.exists() else None
    if overlay is None:
        print("No MLS overlay found — run 07_comps.py expireds for the "
              "listing-history adjustments.")
    board = build_targets(pd.read_parquet(src), overlay,
                          load_listing_suppression())
    dest = PROCESSED / "targets.csv"
    board.to_csv(dest, index=False)
    print(f"{len(board)} targets -> {dest}")
    print(board["method"].value_counts().to_string())
    print("\nTop 15:")
    print(board[["rank", "method", "Property Address", "Property City",
                 "score", "why"]].head(15).to_string(index=False))


if __name__ == "__main__":
    main()
