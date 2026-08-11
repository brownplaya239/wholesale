"""MOMLS (Spark RESO API) integration: suppression, comps/MAO, expireds.

Coverage: MOMLS = Monmouth (+Ocean) ONLY. Middlesex/Somerset/Union/Hudson
stay on manual MLS exports — put those rows in
data/processed/suppress_manual.csv (address,city) and `suppress` unions
them in.

Subcommands:
  ping        auth smoke test (run this first)
  suppress    pull Active/UnderContract/Pending/ComingSoon in Monmouth ->
              rebuild data/processed/suppress_active_listings.csv
              (unioned with suppress_manual.csv). Run before EVERY mail
              drop and knock day — REC: never solicit a listed property.
  comps       sold comps + ARV band + MAO for one subject:
                python scripts/07_comps.py comps --address "99 Church St"
                    --city Belford --sqft 1400 [--months 6]
                    [--rehab-tier cosmetic|standard|heavy|gut]
                    [--margin 0.18] [--holding-pct 0.05]
                    [--closing-pct 0.05] [--fee 0]
              MAO = ARV_p25 x (1 - margin) - rehab - holding - closing - fee.
              Rehab uses the tier's UPPER $/sf (playbook: carry the top of
              the band until you've walked the interior).
  expireds    Expired/Withdrawn/Canceled since 2019 matched against
              hot_list.csv -> hot_list_expired_overlay.csv. A hot lead
              that already failed to sell retail is the most motivated
              profile in the stack (and had an agent — tread politely).

First live run happens on your machine (needs SPARK_ACCESS_TOKEN; the dev
sandbox has no MLS egress). Data-use: pull-and-use for your own brokerage
activity; don't archive feeds or republish.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nj_common import PROCESSED, normalize_address  # noqa: E402
from spark_client import SparkClient, pick  # noqa: E402

SOLICITABLE_NOT = ["Active", "ActiveUnderContract", "Pending", "ComingSoon"]
REHAB_PSF = {"cosmetic": 35, "standard": 60, "heavy": 100, "gut": 175}
RENOVATED_RE = re.compile(
    r"renovat|updated|remodel|new kitchen|new bath|gut rehab|brand new",
    re.I,
)


# ---------------------------------------------------------------- helpers --
def rows_to_frame(rows: list[dict]) -> pd.DataFrame:
    out = []
    for r in rows:
        ua = str(pick(r, "UnparsedAddress", "UnparsedFirstLineAddress",
                      default=""))
        zm = re.search(r"(\d{5})(?:-\d{4})?\s*$", ua)
        out.append({
            "address": ua,
            # UnparsedAddress is usually the FULL line ("99 Church St,
            # Middletown, NJ 07718") — matching uses the street part + zip,
            # because MLS city is the municipality, not the postal city.
            "street": ua.split(",")[0].strip(),
            "zip": str(pick(r, "PostalCode",
                            default=zm.group(1) if zm else ""))[:5],
            "city": pick(r, "City", "PostalCity", default=""),
            "status": pick(r, "StandardStatus", "MlsStatus", default=""),
            "close_price": pick(r, "ClosePrice", "ClosedPrice"),
            "close_date": pick(r, "CloseDate"),
            "list_price": pick(r, "ListPrice"),
            "sqft": pick(r, "LivingArea", "BuildingAreaTotal"),
            "beds": pick(r, "BedroomsTotal"),
            "dom": pick(r, "DaysOnMarket", "CumulativeDaysOnMarket"),
            "remarks": pick(r, "PublicRemarks", default=""),
        })
    return pd.DataFrame(out)


def comp_stats(comps: pd.DataFrame, subject_sqft: float) -> dict:
    """ARV band from sold comps. Renovated-condition comps set the ceiling;
    p25 of $/sf is the conservative basis the playbook uses."""
    c = comps.copy()
    c["close_price"] = pd.to_numeric(c["close_price"], errors="coerce")
    c["sqft"] = pd.to_numeric(c["sqft"], errors="coerce")
    c = c[(c["close_price"] > 50_000) & (c["sqft"] > 300)]
    if len(c) == 0:
        return {"n": 0}
    c["ppsf"] = c["close_price"] / c["sqft"]
    c["renovated"] = c["remarks"].fillna("").map(
        lambda s: bool(RENOVATED_RE.search(str(s))))
    basis = c[c["renovated"]] if c["renovated"].sum() >= 3 else c
    return {
        "n": int(len(c)),
        "n_renovated": int(c["renovated"].sum()),
        "basis": "renovated" if c["renovated"].sum() >= 3 else "all",
        "ppsf_p25": round(float(basis["ppsf"].quantile(0.25)), 2),
        "ppsf_median": round(float(basis["ppsf"].median()), 2),
        "arv_p25": round(float(basis["ppsf"].quantile(0.25)) * subject_sqft),
        "arv_median": round(float(basis["ppsf"].median()) * subject_sqft),
        "dom_median": float(pd.to_numeric(c["dom"], errors="coerce")
                            .median()),
    }


def mao(arv_p25: float, sqft: float, rehab_psf: float, margin: float,
        holding_pct: float, closing_pct: float, fee: float) -> dict:
    rehab = rehab_psf * sqft
    holding = holding_pct * arv_p25
    closing = closing_pct * arv_p25
    val = arv_p25 * (1 - margin) - rehab - holding - closing - fee
    return {"rehab": round(rehab), "holding": round(holding),
            "closing": round(closing), "mao": round(val),
            "opening_offer": round(val * 0.90)}


def match_expireds(hot: pd.DataFrame, exp: pd.DataFrame) -> pd.DataFrame:
    """Street+zip primary key (immune to MLS municipality-vs-postal-city
    naming); street+city as fallback."""
    exp_keys: dict = {}
    for _, e in exp.iterrows():
        a = normalize_address(e.get("street") or e.get("address"))
        if str(e.get("zip") or "").strip():
            exp_keys[(a, str(e["zip"])[:5])] = e["status"]
        exp_keys[(a, str(e.get("city") or "").upper().strip())] = e["status"]
    hits = []
    for _, r in hot.iterrows():
        a = normalize_address(r["Property Address"])
        k_zip = (a, str(r.get("Property Zip Code") or "")[:5])
        k_city = (a, str(r.get("Property City") or "").upper().strip())
        st = exp_keys.get(k_zip) or exp_keys.get(k_city)
        if st:
            hits.append({**r, "mls_status": st, "was_listed": True})
    return pd.DataFrame(hits)


# ------------------------------------------------------------ subcommands --
def cmd_suppress(client: SparkClient) -> None:
    flt = ("CountyOrParish eq 'Monmouth' and ("
           + " or ".join(f"StandardStatus eq '{s}'" for s in SOLICITABLE_NOT)
           + ")")
    rows = client.query(
        flt=flt,
        select="UnparsedAddress,City,PostalCode,StandardStatus,ListPrice",
    )
    df = rows_to_frame(rows)[["street", "city", "zip", "status",
                              "list_price"]].rename(
        columns={"street": "address"})
    manual = PROCESSED / "suppress_manual.csv"
    n_manual = 0
    if manual.exists():
        mdf = pd.read_csv(manual, dtype=str)
        mdf.columns = [c.lower().strip() for c in mdf.columns]
        mdf = mdf.rename(columns={"property address": "address",
                                  "property city": "city",
                                  "postal code": "zip", "zip code": "zip"})
        keep_cols = [c for c in ("address", "city", "zip") if c in mdf]
        df = pd.concat([df, mdf[keep_cols]], ignore_index=True)
        n_manual = len(mdf)
    dest = PROCESSED / "suppress_active_listings.csv"
    df.drop_duplicates(subset=["address", "zip"]).to_csv(dest, index=False)
    print(f"{len(rows)} MOMLS active/UC/pending + {n_manual} manual rows "
          f"-> {dest}")
    print("Middlesex/Somerset/Union/Hudson are NOT covered by MOMLS — keep "
          "suppress_manual.csv current from those MLSs until you join them.")
    print("Now re-run: python scripts/05_mail_segments.py && "
          "python scripts/06_routes.py")


def cmd_comps(client: SparkClient, args) -> None:
    since = (pd.Timestamp.today() - pd.DateOffset(months=args.months)
             ).strftime("%Y-%m-%d")
    flt = (f"StandardStatus eq 'Closed' and City eq '{args.city}' "
           f"and CloseDate ge {since}")
    rows = client.query(
        flt=flt,
        select="UnparsedAddress,City,ClosePrice,CloseDate,ListPrice,"
               "LivingArea,BedroomsTotal,DaysOnMarket,PublicRemarks,"
               "StandardStatus",
    )
    comps = rows_to_frame(rows)
    stats = comp_stats(comps, args.sqft)
    if stats["n"] == 0:
        raise SystemExit(f"No usable closed comps in {args.city} since "
                         f"{since}. Widen --months or check the city name "
                         "(MLS city may differ from postal city).")
    m = mao(stats["arv_p25"], args.sqft, REHAB_PSF[args.rehab_tier],
            args.margin, args.holding_pct, args.closing_pct, args.fee)
    slug = re.sub(r"\W+", "_", f"{args.address}_{args.city}").strip("_")
    comps.to_csv(PROCESSED / f"comps_{slug}.csv", index=False)
    print(f"Subject: {args.address}, {args.city} ({args.sqft:.0f} sf)")
    print(f"Comps: {stats['n']} closed since {since} "
          f"({stats['n_renovated']} renovated; basis={stats['basis']}); "
          f"median DOM {stats['dom_median']:.0f}")
    print(f"$/sf p25 {stats['ppsf_p25']} | median {stats['ppsf_median']}")
    print(f"ARV band: ${stats['arv_p25']:,} (p25) — "
          f"${stats['arv_median']:,} (median)  <- listing-track number")
    print(f"Rehab ({args.rehab_tier} @ ${REHAB_PSF[args.rehab_tier]}/sf): "
          f"${m['rehab']:,} | holding ${m['holding']:,} | "
          f"closing ${m['closing']:,}")
    print(f"MAO (reservation, never spoken): ${m['mao']:,}")
    print(f"Opening offer (~10% under):      ${m['opening_offer']:,}")
    print(f"Comp detail -> comps_{slug}.csv  "
          "(cross-check vs assessed x equalization before offering)")


def cmd_expireds(client: SparkClient, args) -> None:
    flt = ("CountyOrParish eq 'Monmouth' and ("
           "StandardStatus eq 'Expired' or StandardStatus eq 'Withdrawn' "
           "or StandardStatus eq 'Canceled') "
           f"and ListingContractDate ge {args.since}")
    rows = client.query(
        flt=flt,
        select="UnparsedAddress,City,PostalCode,StandardStatus,ListPrice")
    exp = rows_to_frame(rows)
    src = PROCESSED / "master_status.parquet"
    if not src.exists():
        raise SystemExit("Run 02_status_resolution.py first.")
    m = pd.read_parquet(src)
    hot = m[((m["cohort"] == "INHERITANCE") | (m["SourceCount"] >= 2))
            & (m["status"] != "SOLD_ARMS_LENGTH")
            & (m["cohort"] != "ESTATE_SALE_PRICED")]
    hits = match_expireds(hot, exp)
    dest = PROCESSED / "hot_list_expired_overlay.csv"
    hits.to_csv(dest, index=False)
    print(f"{len(exp)} expired/withdrawn MOMLS listings since {args.since}; "
          f"{len(hits)} overlap the hot list -> {dest}")
    if len(hits):
        print(hits[["Property Address", "Property City", "mls_status"]]
              .to_string(index=False))
        print("These already tried retail and failed = top of the dial "
              "order. They had an agent — lead with the buy option.")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("ping")
    sub.add_parser("suppress")
    c = sub.add_parser("comps")
    c.add_argument("--address", required=True)
    c.add_argument("--city", required=True)
    c.add_argument("--sqft", type=float, required=True)
    c.add_argument("--months", type=int, default=6)
    c.add_argument("--rehab-tier", choices=REHAB_PSF, default="standard")
    c.add_argument("--margin", type=float, default=0.18)
    c.add_argument("--holding-pct", type=float, default=0.05)
    c.add_argument("--closing-pct", type=float, default=0.05)
    c.add_argument("--fee", type=float, default=0.0)
    e = sub.add_parser("expireds")
    e.add_argument("--since", default="2019-01-01")
    args = ap.parse_args()

    client = SparkClient()
    if args.cmd == "ping":
        row = client.ping()
        print("Auth OK." if row else "Auth OK but zero rows returned.")
        if row:
            print(f"Sample fields: {sorted(row)[:12]} ...")
    elif args.cmd == "suppress":
        cmd_suppress(client)
    elif args.cmd == "comps":
        cmd_comps(client, args)
    elif args.cmd == "expireds":
        cmd_expireds(client, args)


if __name__ == "__main__":
    main()
