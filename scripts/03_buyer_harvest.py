"""Buyer harvest: extract active cash buyers from the sold-since set.

Reads the SR1A cache written by 02_status_resolution.py (all recorded sales in
Monmouth/Middlesex/Somerset/Union/Hudson since 2020) and produces the buyer
asset that outlives the seller list:

  1. Keep sales with a real consideration (>= $10k) — family/quitclaim NU
     transfers aren't "buyers". Foreclosure/REO NU purchases ARE kept:
     investors buy at sheriff sales.
  2. Flag entity buyers (LLC/LP/CORP/TRUST/HOLDINGS/...); collapse shells by
     shared grantee mailing address — most operators reuse one address across
     entities, which folds ten shells into one principal cluster.
  3. Rank by acquisition count; 3+ purchases = verified active.

Where the statewide file redacts a grantee (Daniel's Law), the sale row still
carries block/lot + deed book/page — pull the deed image free on the county
clerk portal (Monmouth OPRS; Middlesex/Union/Somerset/Hudson record rooms).
Principals for entity buyers: NJ Division of Revenue business-entity search
(free) using the entity name — fill principal_guess in by hand for the top 25.

Output: data/processed/buyers.csv, one row per buyer cluster:
  cluster_id, top_name, all_names, mailing_address, is_entity,
  n_acquisitions, price_p25/p50/p75, municipalities, first_seen, last_seen
Top 25 clusters -> include in the 04 skip-trace batch for phone/email (+~$5).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nj_common import CACHE, PROCESSED, is_entity, normalize_address  # noqa: E402

MIN_PRICE = 10_000
VERIFIED_MIN = 3


def harvest(sr1a: pd.DataFrame) -> pd.DataFrame:
    s = sr1a[(sr1a["sale_price"].fillna(0) >= MIN_PRICE)
             & sr1a["grantee_name"].fillna("").str.strip().ne("")].copy()
    s["grantee_n"] = (s["grantee_name"].str.upper()
                      .str.replace(r"[^\w\s&]", " ", regex=True)
                      .str.replace(r"\s+", " ", regex=True).str.strip())
    s["mail_n"] = (
        s["grantee_street"].fillna("").map(normalize_address) + "|"
        + s["grantee_city_state"].fillna("").str.upper().str.strip().str[:20]
    )
    # cluster key: shared mailing address when present, else the name itself
    s["cluster"] = s["mail_n"].where(s["mail_n"].str.len() > 3,
                                     "NAME:" + s["grantee_n"])

    g = s.groupby("cluster")
    out = pd.DataFrame({
        "top_name": g["grantee_n"].agg(lambda x: x.value_counts().idxmax()),
        "all_names": g["grantee_n"].agg(
            lambda x: "; ".join(sorted(set(x))[:12])),
        "mailing_address": g["mail_n"].first().str.replace("|", ", "),
        "n_acquisitions": g.size(),
        "price_p25": g["sale_price"].quantile(0.25).round(0),
        "price_p50": g["sale_price"].median().round(0),
        "price_p75": g["sale_price"].quantile(0.75).round(0),
        "municipalities": g["muncode"].agg(
            lambda x: ",".join(sorted(set(x)))),
        "first_seen": g["sale_date"].min().dt.date,
        "last_seen": g["sale_date"].max().dt.date,
    }).reset_index(names="cluster_id")
    out["is_entity"] = out["all_names"].map(is_entity)
    out["verified_active"] = out["n_acquisitions"] >= VERIFIED_MIN
    out["principal_guess"] = ""  # fill via NJ business-entity search (free)
    return out.sort_values(["verified_active", "n_acquisitions"],
                           ascending=[False, False])


def main() -> None:
    pq = CACHE / "sr1a.parquet"
    if not pq.exists():
        raise SystemExit("Run 02_status_resolution.py fetch first.")
    sr1a = pd.read_parquet(pq)
    has_identity = (
        sr1a["grantee_name"].fillna("").str.strip().ne("")
        | sr1a["grantee_street"].fillna("").str.strip().ne("")
    )
    if not has_identity.any():
        raise SystemExit(
            "The statewide SR1A OPRA extract blanks the entire grantee block "
            "(names AND mailing addresses) — only deed book/page survive, so "
            "buyers cannot be identified or clustered from this file.\n"
            "Fix: OPRA the unredacted SR1A from each county tax board "
            "(docs/OPRA_REQUEST.md — the same request covers MOD-IV), drop "
            "the files in a folder, then:\n"
            "  python scripts/02_status_resolution.py fetch --sr1a-dir DIR\n"
            "  python scripts/03_buyer_harvest.py\n"
            "Deed book/page per sale remain available in "
            "data/cache/sr1a.parquet for one-off clerk-portal pulls."
        )
    buyers = harvest(sr1a)
    dest = PROCESSED / "buyers.csv"
    buyers.to_csv(dest, index=False)
    v = buyers["verified_active"].sum()
    print(f"{len(buyers):,} buyer clusters, {v:,} verified active (3+ buys)")
    print(buyers[buyers["verified_active"]]
          [["top_name", "n_acquisitions", "price_p50", "last_seen"]]
          .head(25).to_string(index=False))
    print(f"Wrote {dest}")


if __name__ == "__main__":
    main()
