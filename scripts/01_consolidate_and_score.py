"""Consolidate the 4-sheet M-Power vendor list, dedupe, derive fields, score, tier.

Input : data/raw/M_Power_Full_List__1_.xlsx
Output: data/processed/master.parquet (or master.pkl if no parquet engine)
        data/processed/tier_a.csv      (top targets, for downstream steps)

The formatted Excel deliverable (M_Power_Scored_Master.xlsx) was built from the same
logic; this script is the canonical reproducible version.
"""
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/M_Power_Full_List__1_.xlsx"
OUT = ROOT / "data/processed"
ASOF = pd.Timestamp("2026-08-11")


def load(xl: pd.ExcelFile, sheet: str) -> pd.DataFrame:
    df = pd.read_excel(xl, sheet_name=sheet)
    if "Address" in df.columns:  # Bad Credit sheet has a thinner schema
        df = df.rename(
            columns={
                "Address": "Property Address",
                "City": "Property City",
                "State": "Property State",
                "Zip": "Property Zip Code",
                "Owner 1 First Name": "First Name",
                "Owner 1 Last Name": "Last Name",
            }
        )
        df["Owner 2"] = (
            df.get("Owner 2 First Name", pd.Series(dtype=str)).fillna("")
            + " "
            + df.get("Owner 2 Last Name", pd.Series(dtype=str)).fillna("")
        ).str.strip()
        for c in ["Owner Address", "Owner City", "Owner State", "Owner Zip Code",
                  "Beds", "Baths", "Square Footage", "Lot Sq Footage"]:
            df[c] = np.nan
    else:
        df["Owner 2"] = ""
    df = df[df["Property Address"].notna()].copy()  # drops Inherited junk rows
    df["source"] = sheet
    return df


def norm_zip(v) -> object:
    """5-digit zero-padded string for US zips (Excel reads them as floats and
    drops NJ's leading 0); alphanumeric (e.g. Canadian) kept verbatim."""
    if pd.isna(v):
        return pd.NA
    s = str(v).strip().upper()
    if s.endswith(".0"):
        s = s[:-2]
    if s.isdigit():
        return s.zfill(5)[:5] if len(s) <= 5 else s[:5]
    return s


def main() -> None:
    xl = pd.ExcelFile(RAW)
    frames = [load(xl, s) for s in xl.sheet_names]
    phone_cols = sorted(
        {c for f in frames for c in f.columns if c.startswith("Phone")}
    )
    keep = [
        "First Name", "Last Name", "Owner 2", "Owner Address", "Owner City",
        "Owner State", "Owner Zip Code", "Property Address", "Property City",
        "Property State", "Property Zip Code", "County", "Beds", "Baths",
        "Square Footage", "Lot Sq Footage", "Year Built", "Property Type",
        "Last Sales Date", "Last Sales Price", "Estimated Value",
        "Estimated Total Loans", "source", *phone_cols,
    ]
    allf = pd.concat([f.reindex(columns=keep) for f in frames], ignore_index=True)
    allf["pkey"] = (
        allf["Property Address"].astype(str).str.upper().str.strip()
        + "|"
        + allf["Property City"].astype(str).str.upper().str.strip()
    )

    # keep the richest row per property; aggregate source membership
    allf["nn"] = allf.notna().sum(axis=1)
    src = allf.groupby("pkey")["source"].apply(
        lambda x: " + ".join(sorted(set(x)))
    ).rename("Sources")
    nsrc = allf.groupby("pkey")["source"].nunique().rename("SourceCount")
    m = (
        allf.sort_values("nn", ascending=False)
        .drop_duplicates("pkey")
        .merge(src, on="pkey")
        .merge(nsrc, on="pkey")
    )

    m["Last Sales Date"] = pd.to_datetime(m["Last Sales Date"], errors="coerce")
    m["TenureYears"] = ((ASOF - m["Last Sales Date"]).dt.days / 365.25).round(1)
    m["EstValue"] = pd.to_numeric(m["Estimated Value"], errors="coerce")
    m["EstLoans"] = pd.to_numeric(m["Estimated Total Loans"], errors="coerce").fillna(0)
    m["EquityPct_AsPulled"] = ((m["EstValue"] - m["EstLoans"]) / m["EstValue"]).round(3)
    m["Absentee"] = np.where(
        m["Owner Address"].notna(),
        m["Owner Address"].astype(str).str.upper().str.strip()
        != m["Property Address"].astype(str).str.upper().str.strip(),
        np.nan,
    )
    m["OutOfState"] = np.where(
        m["Owner State"].notna(), m["Owner State"] != "NJ", np.nan
    )

    # rule-based priority score (documented in processed workbook README)
    sc = pd.Series(0.0, index=m.index)
    sc += m["Sources"].str.contains("Vacancy").astype(int) * 30
    sc += m["Sources"].str.contains("Inherited").astype(int) * 25
    sc += m["Sources"].str.contains("Bad Credit").astype(int) * 15
    sc += (m["Sources"] == "High Equity").astype(int) * 5
    sc += np.select(
        [m["EquityPct_AsPulled"] >= 0.7, m["EquityPct_AsPulled"] >= 0.5,
         m["EquityPct_AsPulled"] < 0.3],
        [15, 8, -10], default=0,
    )
    sc += np.where(m["Absentee"] == True, 10, 0)  # noqa: E712 (NaN-safe)
    sc += np.where(m["OutOfState"] == True, 5, 0)  # noqa: E712
    sc += np.select([m["TenureYears"] >= 25, m["TenureYears"] >= 15], [15, 10], 0)
    sc += np.where(m["SourceCount"] >= 2, 15, 0)
    m["PriorityScore"] = sc
    m["Tier"] = pd.cut(sc, bins=[-99, 29, 44, 59, 999], labels=["D", "C", "B", "A"])

    for c in ["Owner Zip Code", "Property Zip Code"]:
        m[c] = m[c].map(norm_zip).astype("string")
    for c in m.columns:  # mixed-type object cols break parquet
        if m[c].dtype == object:
            m[c] = m[c].astype("string")

    OUT.mkdir(parents=True, exist_ok=True)
    try:
        m.to_parquet(OUT / "master.parquet", index=False)
    except ImportError:  # no pyarrow/fastparquet in env
        m.to_pickle(OUT / "master.pkl")
    m[m["Tier"] == "A"].sort_values("PriorityScore", ascending=False).to_csv(
        OUT / "tier_a.csv", index=False
    )
    print(m["Tier"].value_counts().reindex(["A", "B", "C", "D"]))


if __name__ == "__main__":
    main()
