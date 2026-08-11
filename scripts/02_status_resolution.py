"""Status resolution: has each listed property sold since the ~2019-21 pull?

Free NJ public data, no vendor subscriptions:

  1. SR1A statewide sales files (2020..current + YTD), NJ Division of Taxation:
     https://www.nj.gov/treasury/taxation/lpt/statdata.shtml
     Fixed-width layout: https://www.nj.gov/treasury/taxation/pdf/lpt/SR1Afilelayout.pdf
     Every recorded deed sale: county/district/block/lot, sale date, price, and
     the NU (non-usable) code — NU codes pre-label non-arm's-length transfers
     (estate sales, family deeds, foreclosures) for us.
  2. MOD-IV county tax lists (current owner of record, assessed values), same
     Treasury page. MOD-IV also carries the situs address per block/lot, so it
     doubles as the address -> block/lot join source; NJGIN parcels are an
     OPTIONAL supplement (--njgin) for municipality names and gap-filling.
     NOTE: Daniel's Law redacts a small protected class of owner names in the
     statewide OPRA downloads; those rows resolve to UNRESOLVED/owner_redacted
     — look them up one-off on the county portals.
  3. NJGIN statewide parcel layer (optional):
     https://njogis-newjersey.opendata.arcgis.com/

Usage:
  python scripts/02_status_resolution.py fetch            # download + cache
  python scripts/02_status_resolution.py resolve          # match + status
  python scripts/02_status_resolution.py all              # both
  Options:
    --years 2020-2026        SR1A sale-year window (default 2020..today)
    --sr1a-dir DIR           use manually downloaded SR1A .txt/.csv files
    --modiv-dir DIR          use manually downloaded MOD-IV files
    --njgin                  also fetch NJGIN parcels (muncode names, lat/lon)
    --njgin-url URL          override the NJGIN FeatureServer layer URL

If the automated download 404s (Treasury moves links), grab the SR1A zips and
the five county MOD-IV zips by hand from statdata.shtml, unzip, and point
--sr1a-dir/--modiv-dir at them. Everything downstream is identical.

Output columns appended to master (data/processed/master_status.parquet):
  status            in {SOLD_ARMS_LENGTH, SOLD_NON_USABLE, OWNER_CHANGED_NO_SALE,
                        SAME_OWNER, UNRESOLVED}
  status_reason, cohort, sale_date, sale_price, nu_code, current_owner,
  current_owner_mailing, muncode, block_lot, match_method
Decision map:
  SOLD_ARMS_LENGTH        -> suppress as seller lead; feeds 03_buyer_harvest
  SOLD_NON_USABLE (estate/family NU) or OWNER_CHANGED_NO_SALE
                          -> inheritance cohort: TOP outreach priority,
                             skip-trace the *new* owner name
  SAME_OWNER              -> keep, standard priority
  UNRESOLVED (Tier A only)-> manual lookup via county portals
                             (data/processed/tier_a_unresolved.csv)
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nj_common import (  # noqa: E402
    CACHE, COUNTY_CODES, ESTATE_FAMILY_NU, FORECLOSURE_NU, MODIV_URL_TPL,
    NJGIN_CANDIDATE_SERVICES, PROCESSED, STATDATA_URL, TARGET_COUNTIES,
    TARGET_COUNTY_CODES, download, extract_data_files, fetch_arcgis_layer,
    house_number, http_session, is_entity, load_master, normalize_address,
    parse_modiv_file, parse_sr1a_file, same_owner, scrape_links, street_key,
)

SR1A_CACHE = CACHE / "sr1a"
MODIV_CACHE = CACHE / "modiv"


# ------------------------------------------------------------------ fetch --
def fetch_sr1a(years: range, manual_dir: Path | None) -> pd.DataFrame:
    """Download (or ingest) SR1A files, parse, cache to parquet."""
    out_pq = CACHE / "sr1a.parquet"
    files: list[Path] = []
    if manual_dir:
        files = sorted(p for p in Path(manual_dir).iterdir()
                       if re.search(r"\.(txt|csv|dat|psv)$", p.name, re.I))
        if not files:
            raise SystemExit(f"--sr1a-dir {manual_dir}: no data files found")
    else:
        SR1A_CACHE.mkdir(parents=True, exist_ok=True)
        s = http_session()
        # 2026 vintage: yearly files are named Sales<YYYY>.zip, plus a
        # YTDSR1A<YYYY>.zip for the year in progress.
        links = scrape_links(STATDATA_URL,
                             r"(sales\d{4}|sr.?1.?a[^/]*)\.zip", s)
        wanted = [u for u in links
                  if any(str(y) in Path(u).stem for y in years)] or links
        if not wanted:
            raise SystemExit(
                "No SR1A links found on statdata.shtml — download the SR1A "
                "zips manually and re-run with --sr1a-dir DIR."
            )
        for url in wanted:
            print(f"  downloading {Path(url).name} ...")
            zp = download(url, SR1A_CACHE / Path(url).name.split("?")[0], s)
            files.extend(extract_data_files(zp, SR1A_CACHE / "extracted"))
        files = sorted(set(files))

    frames = []
    for f in files:
        df = parse_sr1a_file(f, TARGET_COUNTY_CODES)
        frames.append(df)
        print(f"  SR1A {f.name}: {len(df):,} rows in target counties")
    sr1a = pd.concat(frames, ignore_index=True)
    sr1a = sr1a.drop_duplicates(
        subset=["pin", "sale_date", "sale_price", "grantee_name"]
    )
    got_years = sorted(sr1a["sale_date"].dt.year.dropna().unique().astype(int))
    span = f"{got_years[0]}-{got_years[-1]}" if got_years else "none"
    print(f"SR1A cache: {len(sr1a):,} sales, deed years {span} -> {out_pq}")
    missing = [y for y in years if y not in got_years]
    if missing:
        print(f"  WARNING: no sales with deed year(s) {missing} — if those "
              "years should exist, their files were not found/parsed. "
              "'Sold since' will be UNDERSTATED until fixed.")
    sr1a.to_parquet(out_pq, index=False)
    return sr1a


def fetch_modiv(year: int, manual_dir: Path | None) -> pd.DataFrame:
    """Download (or ingest) the 5 county MOD-IV lists, parse, cache."""
    out_pq = CACHE / "modiv.parquet"
    files: list[Path] = []
    if manual_dir:
        files = sorted(p for p in Path(manual_dir).iterdir()
                       if re.search(r"\.(txt|csv|dat|psv)$", p.name, re.I))
        if not files:
            raise SystemExit(f"--modiv-dir {manual_dir}: no data files found")
    else:
        MODIV_CACHE.mkdir(parents=True, exist_ok=True)
        s = http_session()
        # 2026 vintage: ONE statewide zip per year (pdf/lpt/modiv-<YYYY>.zip);
        # the parser filters to our 5 counties while streaming.
        links = scrape_links(STATDATA_URL, r"modiv[-_]?\d{4}\.zip", s)

        def _yr(u: str) -> int:
            m = re.search(r"(\d{4})", Path(u).name)
            return int(m.group(1)) if m else 0

        pick = ([u for u in links if _yr(u) == year]
                or [u for u in links if _yr(u) == year - 1]
                or sorted(links, key=_yr)[-1:])
        if pick:
            url = pick[-1]
            print(f"  downloading statewide MOD-IV {Path(url).name} "
                  "(large file, be patient) ...")
            zp = download(url, MODIV_CACHE / Path(url).name, s)
            files.extend(extract_data_files(zp, MODIV_CACHE / "extracted"))
        else:  # legacy per-county layout (pre-2026 site)
            for county in TARGET_COUNTIES:
                name = county.capitalize()
                got = None
                for yr in (year, year - 1):
                    url = MODIV_URL_TPL.format(year=yr, county=name,
                                               yy=f"{yr % 100:02d}")
                    try:
                        got = download(url, MODIV_CACHE / Path(url).name, s)
                        break
                    except Exception as e:  # noqa: BLE001 - try prior year
                        print(f"  {name} {yr}: {e}")
                if got is None:
                    raise SystemExit(
                        f"Could not download MOD-IV for {name}. Grab the "
                        "zips from statdata.shtml manually and re-run with "
                        "--modiv-dir DIR."
                    )
                files.extend(extract_data_files(got,
                                                MODIV_CACHE / "extracted"))

    frames = []
    for f in sorted(set(files)):
        df = parse_modiv_file(f, TARGET_COUNTY_CODES)
        frames.append(df)
        print(f"  MOD-IV {f.name}: {len(df):,} parcels")
    modiv = pd.concat(frames, ignore_index=True)
    modiv = modiv.drop_duplicates(subset=["pin", "qual"])
    modiv.to_parquet(out_pq, index=False)
    print(f"MOD-IV cache: {len(modiv):,} parcels -> {out_pq}")
    return modiv


def fetch_njgin(layer_url: str | None) -> pd.DataFrame | None:
    """Optional: muncode -> municipality-name reference (+ parcel centroids).

    Improves city-name disambiguation in match_addresses; the pipeline works
    without it (falls back to owner-zip + surname disambiguation).
    """
    urls = [layer_url] if layer_url else NJGIN_CANDIDATE_SERVICES
    for u in urls:
        try:
            df = fetch_arcgis_layer(
                u,
                where="1=1",
                out_fields="PCL_MUN,MUN_NAME,COUNTY",
                page=2000,
            )
            if len(df):
                ref = (df.rename(columns=str.upper)
                       .groupby("PCL_MUN")["MUN_NAME"].first().reset_index())
                ref.columns = ["muncode", "mun_name"]
                ref["muncode"] = ref["muncode"].astype(str).str.zfill(4)
                dest = CACHE / "muncode_names.csv"
                ref.to_csv(dest, index=False)
                print(f"NJGIN muncode names: {len(ref)} -> {dest}")
                return ref
        except Exception as e:  # noqa: BLE001
            print(f"  NJGIN {u}: {e}")
    print("NJGIN unavailable — continuing without municipality names.")
    return None


# ---------------------------------------------------------------- matching --
def match_addresses(master: pd.DataFrame, modiv: pd.DataFrame,
                    mun_names: pd.DataFrame | None = None) -> pd.DataFrame:
    """Attach muncode/block/lot/current-owner to master rows via MOD-IV.

    Cascade per county:
      1. unique (county, normalized situs address)
      2. ambiguous -> prefer candidate whose situs/mailing city or zip agrees,
         then whose owner surname matches the list owner
      3. fuzzy: unique (county, house number, street key)
    MOD-IV property_location is 25 chars, so comparisons use the truncated
    prefix where needed. Returns master + match columns.
    """
    m = master.copy()
    m["county_code"] = (m["County"].astype(str).str.upper()
                        .str.replace(r"[^A-Z]", "", regex=True)
                        .map(COUNTY_CODES))
    m["addr_n"] = m["Property Address"].map(normalize_address)
    m["city_n"] = (m["Property City"].astype(str).str.upper()
                   .str.replace(r"[^A-Z ]", "", regex=True).str.strip())
    m["zip_n"] = m["Property Zip Code"].astype(str).str[:5]

    p = modiv.copy()
    p["county_code"] = p["muncode"].str[:2]
    p["addr_n"] = p["property_location"].map(normalize_address)
    p["hn"] = p["addr_n"].map(house_number)
    p["sk"] = p["addr_n"].map(street_key)
    p["owner_zip5"] = p["owner_zip"].astype("string").str[:5]
    if mun_names is not None:
        p = p.merge(mun_names, on="muncode", how="left")
        p["mun_n"] = (p["mun_name"].astype(str).str.upper()
                      .str.replace(r"\b(TOWNSHIP|TWP|BOROUGH|BORO|CITY|TOWN"
                                   r"|VILLAGE)\b", "", regex=True)
                      .str.replace(r"[^A-Z ]", "", regex=True).str.strip())
    else:
        p["mun_n"] = pd.NA

    # MOD-IV situs is truncated at 25 chars; truncate ours to the same width
    # for the join key.
    m["addr_key"] = m["addr_n"].str[:24].str.strip()
    p["addr_key"] = p["addr_n"].str[:24].str.strip()

    cand = m.reset_index().merge(
        p, on=["county_code", "addr_key"], how="inner",
        suffixes=("", "_mv"),
    )
    cand = cand[cand["addr_key"].str.len() > 3]
    sizes = cand.groupby("index")["pin"].transform("size")
    matched_rows = [(r["index"], r, "exact_unique")
                    for _, r in cand[sizes == 1].iterrows()]

    for idx, grp in cand[sizes > 1].groupby("index"):
        row = m.loc[idx]
        # prefer agreement on municipality name, then owner zip == situs zip
        if grp["mun_n"].notna().any():
            hit = grp[grp["mun_n"] == row["city_n"]]
            if len(hit) == 1:
                matched_rows.append((idx, hit.iloc[0], "exact_city"))
                continue
        hit = grp[grp["owner_zip5"] == row["zip_n"]]
        if len(hit) == 1:
            matched_rows.append((idx, hit.iloc[0], "exact_zip"))
            continue
        want = str(row["Last Name"] or "").strip().upper()
        hit = grp[grp["owner_name"].fillna("").str.contains(
            re.escape(want), regex=True)] if want else grp.iloc[0:0]
        if len(hit) == 1:
            matched_rows.append((idx, hit.iloc[0], "exact_surname"))
            continue
        matched_rows.append((idx, None, "ambiguous"))

    got = {idx for idx, r, _ in matched_rows if r is not None}
    amb = {idx for idx, r, how in matched_rows if r is None}

    # fuzzy pass for the remainder: unique (county, house number, street key)
    rest = m.loc[~m.index.isin(got | amb)].copy()
    rest["hn"] = rest["addr_n"].map(house_number)
    rest["sk"] = rest["addr_n"].map(street_key)
    pk = p.drop_duplicates(subset=["county_code", "hn", "sk"], keep=False)
    fz = rest.reset_index().merge(
        pk[pk["hn"] != ""], on=["county_code", "hn", "sk"], how="inner",
        suffixes=("", "_mv"),
    )
    for _, r in fz.iterrows():
        matched_rows.append((r["index"], r, "fuzzy_hn_street"))

    keep = ["pin", "muncode", "block", "lot", "qual", "property_location",
            "owner_name", "owner_address", "owner_city", "owner_zip",
            "net_value", "sale_date", "sale_price"]
    rows = {}
    for idx, r, how in matched_rows:
        if r is not None:
            rows[idx] = {**{k: r.get(k) for k in keep}, "match_method": how}
        else:
            rows[idx] = {"match_method": "ambiguous"}
    mm = pd.DataFrame.from_dict(rows, orient="index")
    out = master.join(mm.add_prefix("mv_"))
    out = out.rename(columns={"mv_match_method": "match_method"})
    out["match_method"] = out["match_method"].fillna("unmatched")
    return out


# ------------------------------------------------------------------ status --
def resolve_status(master_m: pd.DataFrame, sr1a: pd.DataFrame,
                   since: str = "2020-01-01") -> pd.DataFrame:
    """Append status columns per the module-docstring decision map."""
    m = master_m.copy()
    sales = sr1a[sr1a["sale_date"] >= pd.Timestamp(since)].copy()

    # latest sale per pin, arm's-length preferred for the "sold" verdict
    sales["is_usable"] = sales["nu_code"].isna() | (sales["nu_code"] == 0)
    latest = (sales.sort_values("sale_date")
              .groupby("pin")
              .agg(sale_date=("sale_date", "last"),
                   sale_price=("sale_price", "last"),
                   nu_code=("nu_code", "last"),
                   grantee_name=("grantee_name", "last"),
                   any_usable=("is_usable", "any")))
    m = m.merge(latest, left_on="mv_pin", right_index=True, how="left")

    owner_cmp = m.apply(
        lambda r: same_owner(r.get("Last Name"), r.get("Owner 2"),
                             r.get("mv_owner_name")),
        axis=1,
    )
    sold = m["sale_date"].notna()
    nu = m["nu_code"]
    estate_family = nu.isin(list(ESTATE_FAMILY_NU))
    foreclosure = nu.isin(list(FORECLOSURE_NU))

    conditions = [
        sold & m["any_usable"].fillna(False),
        sold,                                # non-usable NU sale
        (~sold) & (owner_cmp == False),      # noqa: E712
        (~sold) & (owner_cmp == True),       # noqa: E712
    ]
    choices = ["SOLD_ARMS_LENGTH", "SOLD_NON_USABLE",
               "OWNER_CHANGED_NO_SALE", "SAME_OWNER"]
    m["status"] = np.select(conditions, choices, default="UNRESOLVED")

    unmatched = m["match_method"].isin(["unmatched", "ambiguous"])
    m.loc[unmatched, "status"] = "UNRESOLVED"
    m["status_reason"] = ""
    m.loc[unmatched, "status_reason"] = m.loc[unmatched, "match_method"]
    redacted = (~unmatched) & (~sold) & owner_cmp.isna()
    m.loc[redacted, "status"] = "UNRESOLVED"
    m.loc[redacted, "status_reason"] = "owner_redacted_or_blank"

    m["cohort"] = ""
    inherit = (
        ((m["status"] == "SOLD_NON_USABLE") & estate_family)
        | ((m["status"] == "OWNER_CHANGED_NO_SALE")
           & ~m["mv_owner_name"].fillna("").map(is_entity))
    )
    m.loc[inherit, "cohort"] = "INHERITANCE"
    m.loc[(m["status"] == "SOLD_NON_USABLE") & foreclosure,
          "cohort"] = "FORECLOSURE"
    m.loc[(m["status"] == "OWNER_CHANGED_NO_SALE")
          & m["mv_owner_name"].fillna("").map(is_entity),
          "cohort"] = "ENTITY_XFER"

    m = m.rename(columns={
        "mv_pin": "block_lot", "mv_muncode": "muncode",
        "mv_owner_name": "current_owner",
    })
    m["current_owner_mailing"] = (
        m["mv_owner_address"].fillna("") + ", " + m["mv_owner_city"].fillna("")
        + " " + m["mv_owner_zip"].fillna("")
    ).str.strip(", ")
    return m


def report(m: pd.DataFrame) -> None:
    n = len(m)
    print("\n=== Status resolution report ===")
    print(m["status"].value_counts().to_string())
    sold = m["status"].str.startswith("SOLD").sum()
    print(f"\nSold since pull: {sold:,} ({sold / n:.1%} of {n:,})")
    print(f"Inheritance cohort: {(m['cohort'] == 'INHERITANCE').sum():,}")
    matched = (~m["match_method"].isin(["unmatched", "ambiguous"])).sum()
    print(f"Address match rate: {matched / n:.1%}")
    print(m["match_method"].value_counts().to_string())
    ta = m[(m["Tier"] == "A") & (m["status"] == "UNRESOLVED")]
    print(f"Tier A unresolved (manual queue): {len(ta):,}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("command", choices=["fetch", "resolve", "all"],
                    nargs="?", default="all")
    ap.add_argument("--years", default=f"2020-{date.today().year}")
    ap.add_argument("--sr1a-dir", type=Path)
    ap.add_argument("--modiv-dir", type=Path)
    ap.add_argument("--njgin", action="store_true")
    ap.add_argument("--njgin-url")
    ap.add_argument("--since", default="2020-01-01",
                    help="count sales on/after this date as 'sold since'")
    args = ap.parse_args()
    y0, y1 = (int(x) for x in args.years.split("-"))
    CACHE.mkdir(parents=True, exist_ok=True)

    if args.command in ("fetch", "all"):
        fetch_sr1a(range(y0, y1 + 1), args.sr1a_dir)
        fetch_modiv(y1, args.modiv_dir)
        if args.njgin or args.njgin_url:
            fetch_njgin(args.njgin_url)

    if args.command in ("resolve", "all"):
        master = load_master()
        sr1a = pd.read_parquet(CACHE / "sr1a.parquet")
        modiv = pd.read_parquet(CACHE / "modiv.parquet")
        names_csv = CACHE / "muncode_names.csv"
        mun_names = (pd.read_csv(names_csv, dtype=str)
                     if names_csv.exists() else None)

        matched = match_addresses(master, modiv, mun_names)
        resolved = resolve_status(matched, sr1a, args.since)

        out = PROCESSED / "master_status.parquet"
        resolved.to_parquet(out, index=False)
        cohort_cols = ["Property Address", "Property City", "County",
                       "Tier", "PriorityScore", "status", "status_reason",
                       "cohort", "sale_date", "sale_price", "nu_code",
                       "current_owner", "current_owner_mailing",
                       "muncode", "block_lot", "match_method"]
        resolved[resolved["cohort"] == "INHERITANCE"][cohort_cols].to_csv(
            PROCESSED / "inheritance_cohort.csv", index=False)
        resolved[(resolved["Tier"] == "A")
                 & (resolved["status"] == "UNRESOLVED")][cohort_cols].to_csv(
            PROCESSED / "tier_a_unresolved.csv", index=False)
        report(resolved)
        print(f"\nWrote {out}")
        print("Next: scripts/03_buyer_harvest.py, then 04, then 05.")


if __name__ == "__main__":
    main()
