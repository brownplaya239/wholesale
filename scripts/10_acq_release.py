"""Capacity-driven lead release: never dump the whole pull on the callers.

  python scripts/10_acq_release.py plan --callers 2 --hours 30 --dials-per-hour 40
      how many fresh owners per week the team can actually work, and how much
      callable inventory is about to go stale (DNC scrub > 31 days)
  python scripts/10_acq_release.py wave [--size N] [--asset residential|land]
      [--min-scrub-days 21] [--greedy] [--dry-run]
      select the next wave -> data/processed/acq/waves/W##.jsonl (for
      `npm run ghl:push`) + W##_contacts.csv / W##_properties.csv (GHL native
      import fallback); records the release in releases.csv
  python scripts/10_acq_release.py scrub-export [--days-left 10]
      phones that need a (re)scrub -> scrub_request_YYYY-MM-DD.csv for the
      DNC/litigator vendor
  python scripts/10_acq_release.py scrub-apply FILE --source "DNC.com"
      file the vendor's result in data/processed/acq/scrub/ + compliance/scrub_log.csv
      (then: 09 build, then `patch`)
  python scripts/10_acq_release.py patch
      released owners whose phones/lane changed since release ->
      waves/patch_YYYY-MM-DD.jsonl (push it the same way as a wave)
  python scripts/10_acq_release.py mail-export
      mail_only owners (no callable phone) -> mail_only_YYYY-MM-DD.csv
  python scripts/10_acq_release.py compliance-init
      create the append-only logs in compliance/ (training_log, optouts,
      incidents, scrub_log, ...) if missing — never overwrites

Why capacity-driven: a contact needs ~6-8 attempts over ~30 days. Fresh
owners per week = weekly dials / attempts per owner. Releasing faster than
that just ages records (and their 31-day DNC scrub) before anyone dials them.
The first waves are STRATIFIED across county x cohort so that 30 days in,
the conversion data says which BatchLeads queries are worth re-buying.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from datetime import date, datetime
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acq_common as ac  # noqa: E402

WAVES = ac.ACQ / "waves"
LEDGER = ac.ACQ / "releases.csv"
LEDGER_COLS = ["owner_id", "wave", "released_at", "dial_lane", "phones", "dnc_scrub_date"]


def load_universe() -> tuple[pd.DataFrame, pd.DataFrame]:
    po, pp = ac.ACQ / "universe_owners.parquet", ac.ACQ / "universe_properties.parquet"
    if not po.exists():
        raise SystemExit("Run scripts/09_acq_ingest.py build first.")
    return pd.read_parquet(po), pd.read_parquet(pp)


def load_ledger() -> pd.DataFrame:
    if LEDGER.exists():
        return pd.read_csv(LEDGER, dtype=str).fillna("")
    return pd.DataFrame(columns=LEDGER_COLS)


def clean(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, (date, datetime, pd.Timestamp)):
        return v.isoformat()[:10]
    if hasattr(v, "item"):  # numpy scalar
        return clean(v.item())
    return v


def as_of(args) -> date:
    v = getattr(args, "as_of", None)
    return date.fromisoformat(v) if v else date.today()


# ------------------------------------------------------------------- plan --
def capacity(callers: int, hours: float, dph: float, attempts: int) -> dict:
    weekly = callers * hours * dph
    return {"weekly_dials": weekly, "fresh_per_week": int(weekly // max(attempts, 1))}


def cmd_plan(args) -> None:
    owners, _ = load_universe()
    led = load_ledger()
    cap = capacity(args.callers, args.hours, args.dials_per_hour, args.attempts)
    callable_ = owners[owners["dial_lane"].isin(["power", "manual"]) & ~owners["owner_id"].isin(led["owner_id"])]
    print(f"Weekly dial capacity: {cap['weekly_dials']:,.0f} "
          f"({args.callers} callers x {args.hours}h x {args.dials_per_hour}/h)")
    print(f"Attempts per owner over the cadence: {args.attempts}")
    print(f"=> fresh owners per week: {cap['fresh_per_week']:,}")
    buffer = int(cap["fresh_per_week"] * args.buffer_days / 7)
    print(f"=> keep ~{buffer:,} released-but-undialed owners ahead ({args.buffer_days} days), not a fixed 1,500")
    print(f"\nUnreleased callable inventory: {len(callable_):,} owners "
          f"(power {int((callable_['dial_lane'] == 'power').sum()):,}, "
          f"manual {int((callable_['dial_lane'] == 'manual').sum()):,})")
    if cap["fresh_per_week"]:
        weeks = len(callable_) / cap["fresh_per_week"]
        print(f"   = {weeks:.1f} weeks of work at this capacity")
        if weeks > 4.3:
            print("   !! more than ~31 days of inventory: phones scrubbed today will need a "
                  "re-scrub before they are reached. Scrub per wave, not per pull.")
    today = as_of(args)
    sd = pd.to_datetime(callable_["dnc_scrub_date"], errors="coerce")
    left = (sd.dt.date.map(lambda d: ac.SCRUB_VALID_DAYS - (today - d).days if pd.notna(d) else None))
    soon = (left.dropna() < 14).sum()
    if soon:
        print(f"   {soon:,} unreleased owners have <14 days of scrub validity left")


# ------------------------------------------------------------------- wave --
def allocate(strata_sizes: dict, n: int) -> dict:
    """Largest-remainder proportional allocation of n across strata."""
    total = sum(strata_sizes.values())
    if total == 0 or n <= 0:
        return {k: 0 for k in strata_sizes}
    n = min(n, total)
    raw = {k: n * v / total for k, v in strata_sizes.items()}
    alloc = {k: min(int(math.floor(x)), strata_sizes[k]) for k, x in raw.items()}
    rest = n - sum(alloc.values())
    for k in sorted(raw, key=lambda k: raw[k] - math.floor(raw[k]), reverse=True):
        if rest <= 0:
            break
        if alloc[k] < strata_sizes[k]:
            alloc[k] += 1
            rest -= 1
    return alloc


def eligible(owners: pd.DataFrame, led: pd.DataFrame, asset: str | None,
             min_scrub_days: int, today: date) -> pd.DataFrame:
    e = owners[owners["dial_lane"].isin(["power", "manual"]) & ~owners["owner_id"].isin(led["owner_id"])].copy()
    if asset:
        e = e[e["asset_class"].isin([asset, "both"])]
    sd = pd.to_datetime(e["dnc_scrub_date"], errors="coerce").dt.date
    days_left = sd.map(lambda d: ac.SCRUB_VALID_DAYS - (today - d).days if pd.notna(d) else -1)
    stale = days_left < min_scrub_days
    if stale.any():
        print(f"  {int(stale.sum()):,} owners held back: scrub has < {min_scrub_days} days left "
              "(re-scrub with scrub-export)")
    return e[~stale]


def select_wave(e: pd.DataFrame, size: int, greedy: bool) -> pd.DataFrame:
    e = e.sort_values("lead_score", ascending=False)
    if greedy:
        return e.head(size)
    e["stratum"] = (e["asset_class"].fillna("") + "|" + e["primary_county"].fillna("")
                    + "|" + e["primary_cohort"].fillna(""))
    alloc = allocate(e["stratum"].value_counts().to_dict(), size)
    parts = [g.head(alloc.get(k, 0)) for k, g in e.groupby("stratum", sort=False)]
    return pd.concat(parts).sort_values("lead_score", ascending=False) if parts else e.head(0)


PROPERTY_FIELDS = [
    "property_id", "asset_class", "address", "city", "state", "zip", "county", "municipality",
    "apn", "block", "lot", "property_type", "units", "beds", "baths", "sqft", "acres",
    "year_built", "est_value", "mortgage_estimate", "equity_pct", "ownership_years",
    "last_sale_date", "last_sale_price", "vacant", "absentee", "tax_delinquent",
    "preforeclosure", "inherited", "free_clear", "code_violation", "owner_occupied",
    "wetlands_pct", "flood_zone", "flood_pct", "road_frontage_ft", "landlocked", "slope_pct",
    "mls_status", "cohorts", "providers", "pull_date", "skip_trace_provider", "lead_score",
    "score_reasons", "signals",
]


def owner_record(o: pd.Series, props: pd.DataFrame, wave: str, op: str = "upsert") -> dict:
    phones = [p for p in json.loads(o["phones"]) if p["status"] == "clean"]
    mine = props[props["property_id"].isin(list(o["property_ids"]))]
    order = {pid: i for i, pid in enumerate(o["property_ids"])}
    mine = mine.assign(_o=mine["property_id"].map(order)).sort_values("_o")
    return {
        "op": op, "owner_id": o["owner_id"], "wave": wave,
        "primary_property_id": o["primary_property_id"],
        "contact": {
            "first_name": o["first_name"], "last_name": o["last_name"], "full_name": o["full_name"],
            "owner_type": o["owner_type"], "mailing_address": o["mailing_address"],
            "mailing_city": o["mailing_city"], "mailing_state": o["mailing_state"],
            "mailing_zip": o["mailing_zip"],
            "phones": [{"number": p["number"], "type": p["type"], "scrub_date": p["scrub_date"]} for p in phones],
            "emails": json.loads(o["emails"]),
            "dial_lane": o["dial_lane"], "lane_reason": o["lane_reason"],
            "call_zones": o["call_zones"], "call_window_et": o["call_window_et"],
            "dnc_scrub_date": clean(o["dnc_scrub_date"]),
            "lead_source": ac.PROVIDERS.get(o["provider"], o["provider"]),
            "primary_cohort": o["primary_cohort"],
            "source_list": ac.COHORTS.get(o["primary_cohort"] or "", {}).get("label", ""),
            "primary_county": o["primary_county"], "asset_class": o["asset_class"],
            "primary_property": o["primary_property"], "property_count": int(o["property_count"]),
            "lead_score": int(o["lead_score"]), "signals": o["signals"],
            "pull_date": clean(o["pull_date"]), "skip_trace_provider": o["skip_trace_provider"],
        },
        "properties": [{k: clean(r.get(k)) for k in PROPERTY_FIELDS} for r in mine.to_dict("records")],
    }


def next_wave_id(led: pd.DataFrame) -> str:
    nums = [int(w[1:]) for w in led["wave"].unique() if w.startswith("W") and w[1:].isdigit()]
    return f"W{(max(nums) + 1) if nums else 1:02d}"


def write_wave(records: list[dict], name: str) -> Path:
    WAVES.mkdir(parents=True, exist_ok=True)
    out = WAVES / f"{name}.jsonl"
    with out.open("w") as f:
        for r in records:
            f.write(json.dumps(r, default=str) + "\n")
    return out


def cmd_wave(args) -> None:
    owners, props = load_universe()
    led = load_ledger()
    today = as_of(args)
    e = eligible(owners, led, args.asset, args.min_scrub_days, today)
    size = args.size or capacity(args.callers, args.hours, args.dials_per_hour, args.attempts)["fresh_per_week"]
    w = select_wave(e, size, args.greedy)
    wave = next_wave_id(led)
    print(f"{wave}: {len(w):,} owners selected of {len(e):,} eligible "
          f"({'greedy' if args.greedy else 'stratified county x cohort'})")
    if len(w):
        print(w.groupby(["asset_class", "dial_lane"]).size().to_string())
        print("\nBy county:\n" + w["primary_county"].value_counts().to_string())
        print("\nBy cohort:\n" + w["primary_cohort"].value_counts().to_string())
    if args.dry_run or not len(w):
        print("\n(dry run — nothing written)" if args.dry_run else "")
        return
    records = [owner_record(o, props, wave) for _, o in w.iterrows()]
    path = write_wave(records, wave)
    # CSV fallback for GHL's native importer (contacts + properties)
    contacts = pd.DataFrame([{
        "Owner ID": r["owner_id"], "First Name": r["contact"]["first_name"],
        "Last Name": r["contact"]["last_name"],
        "Phone": r["contact"]["phones"][0]["number"] if r["contact"]["phones"] else "",
        "Phone 2": r["contact"]["phones"][1]["number"] if len(r["contact"]["phones"]) > 1 else "",
        "Phone 3": r["contact"]["phones"][2]["number"] if len(r["contact"]["phones"]) > 2 else "",
        "Email": (r["contact"]["emails"] or [""])[0], "Address": r["contact"]["mailing_address"],
        "City": r["contact"]["mailing_city"], "State": r["contact"]["mailing_state"],
        "Postal Code": r["contact"]["mailing_zip"], "Dial Lane": r["contact"]["dial_lane"],
        "Call Window ET": r["contact"]["call_window_et"], "Call Zones": r["contact"]["call_zones"],
        "DNC Scrub Date": r["contact"]["dnc_scrub_date"], "Lead Score": r["contact"]["lead_score"],
        "Signals": r["contact"]["signals"], "Primary Property": r["contact"]["primary_property"],
        "Primary County": r["contact"]["primary_county"], "Source List": r["contact"]["source_list"],
        "Lead Source": r["contact"]["lead_source"], "Wave": wave,
        "Tags": f"acq:cold,acq:wave-{wave.lower()},lane:{r['contact']['dial_lane']},no-sms",
    } for r in records])
    contacts.to_csv(WAVES / f"{wave}_contacts.csv", index=False)
    pd.DataFrame([{"Owner ID": r["owner_id"], **p} for r in records for p in r["properties"]]) \
        .to_csv(WAVES / f"{wave}_properties.csv", index=False)
    now = datetime.now().isoformat(timespec="seconds")
    add = pd.DataFrame([{"owner_id": o["owner_id"], "wave": wave, "released_at": now,
                         "dial_lane": o["dial_lane"],
                         "phones": json.dumps([p["number"] for p in json.loads(o["phones"]) if p["status"] == "clean"]),
                         "dnc_scrub_date": clean(o["dnc_scrub_date"]) or ""} for _, o in w.iterrows()])
    pd.concat([led, add], ignore_index=True).to_csv(LEDGER, index=False)
    print(f"\nWrote {path} (+ {wave}_contacts.csv, {wave}_properties.csv); ledger updated.")
    print(f"Next: cd site && npm run ghl:push -- ../data/processed/acq/waves/{wave}.jsonl --dry-run")


# ------------------------------------------------------------------ scrubs --
def cmd_scrub_export(args) -> None:
    owners, _ = load_universe()
    today = as_of(args)
    rows = []
    for o in owners[owners["dial_lane"] != "suppressed"].itertuples():
        for p in json.loads(o.phones):
            left = (ac.SCRUB_VALID_DAYS - (today - date.fromisoformat(p["scrub_date"])).days
                    if p["scrub_date"] else -1)
            if p["status"] in ("unscrubbed", "scrub_expired") or (p["status"] == "clean" and left < args.days_left):
                rows.append({"phone": p["number"], "owner_id": o.owner_id, "status_now": p["status"]})
    df = pd.DataFrame(rows).drop_duplicates("phone") if rows else pd.DataFrame(columns=["phone"])
    ac.ACQ.mkdir(parents=True, exist_ok=True)
    out = ac.ACQ / f"scrub_request_{today.isoformat()}.csv"
    df[["phone"]].to_csv(out, index=False)
    print(f"{len(df):,} numbers to scrub (federal + NJ DNC + litigator) -> {out}")
    print("Return file needs columns phone,status[,scrub_date]; then `scrub-apply`.")


def cmd_scrub_apply(args) -> None:
    src = Path(args.file)
    ac.SCRUB_DIR.mkdir(parents=True, exist_ok=True)
    stamp = args.date or date.today().isoformat()
    dest = ac.SCRUB_DIR / f"{src.stem}_{stamp}.csv"
    shutil.copy2(src, dest)
    df = ac.load_scrubs(ac.SCRUB_DIR)
    mine = df[df["scrub_file"] == dest.name]
    n_bad = int(mine["status"].isin(["dnc", "litigator", "invalid"]).sum())
    ac.append_scrub_log(args.source, len(mine), n_bad, dest)
    print(f"Filed {dest.name}: {len(mine):,} numbers, {n_bad:,} suppressed "
          f"({mine['status'].value_counts().to_dict()}); logged to compliance/scrub_log.csv")
    unknown = int((mine["status"] == "unknown").sum())
    if unknown:
        print(f"!! {unknown} rows had an unrecognized status value — they stay NOT callable. "
              "Map the vendor's wording in acq_common.scrub_status().")
    print("Next: python scripts/09_acq_ingest.py build && python scripts/10_acq_release.py patch")


def cmd_patch(args) -> None:
    owners, props = load_universe()
    led = load_ledger()
    if led.empty:
        print("Nothing released yet.")
        return
    latest = led.sort_values("released_at").drop_duplicates("owner_id", keep="last").set_index("owner_id")
    cur = owners.set_index("owner_id")
    records = []
    for oid, row in latest.iterrows():
        if oid not in cur.index:
            continue
        o = cur.loc[oid]
        now_phones = [p["number"] for p in json.loads(o["phones"]) if p["status"] == "clean"]
        changed = (json.dumps(now_phones) != row["phones"] or o["dial_lane"] != row["dial_lane"]
                   or (clean(o["dnc_scrub_date"]) or "") != row["dnc_scrub_date"])
        if not changed:
            continue
        op = "patch" if o["dial_lane"] in ("power", "manual") else "suppress"
        o = o.copy()
        o["owner_id"] = oid
        records.append(owner_record(o, props, row["wave"], op))
    if not records:
        print("No released owner changed since release.")
        return
    name = f"patch_{date.today().isoformat()}"
    path = write_wave(records, name)
    ops = pd.Series([r["op"] for r in records]).value_counts().to_dict()
    print(f"{len(records):,} changes {ops} -> {path}")
    led2 = led.copy()
    for r in records:
        m = led2["owner_id"] == r["owner_id"]
        led2.loc[m, "phones"] = json.dumps([p["number"] for p in r["contact"]["phones"]])
        led2.loc[m, "dial_lane"] = r["contact"]["dial_lane"]
        led2.loc[m, "dnc_scrub_date"] = r["contact"]["dnc_scrub_date"] or ""
    led2.to_csv(LEDGER, index=False)
    print(f"Push it: cd site && npm run ghl:push -- ../data/processed/acq/waves/{name}.jsonl")


def cmd_mail_export(args) -> None:
    owners, _ = load_universe()
    m = owners[owners["dial_lane"] == "mail_only"]
    out = ac.ACQ / f"mail_only_{date.today().isoformat()}.csv"
    m[["owner_id", "full_name", "mailing_address", "mailing_city", "mailing_state", "mailing_zip",
       "primary_property", "primary_county", "primary_cohort", "lead_score", "signals",
       "lane_reason"]].sort_values("lead_score", ascending=False).to_csv(out, index=False)
    print(f"{len(m):,} mail-only owners -> {out} (First-Class, Return Service Requested)")


def cmd_compliance_init(args) -> None:
    from nj_common import COMPLIANCE_TEMPLATES
    ac.COMPLIANCE.mkdir(parents=True, exist_ok=True)
    (ac.COMPLIANCE / "skiptrace_raw").mkdir(exist_ok=True)
    (ac.COMPLIANCE / "signed").mkdir(exist_ok=True)
    for name, header in COMPLIANCE_TEMPLATES.items():
        p = ac.COMPLIANCE / name
        if p.exists():
            print(f"  exists  {p.name}")
        else:
            p.write_text(header)
            print(f"  created {p.name}")
    print("Signed acknowledgements go in compliance/signed/ (kept out of git).")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def cap_args(p):
        p.add_argument("--as-of", help="evaluate scrub ages as of this date (default today)")
        p.add_argument("--callers", type=int, default=2)
        p.add_argument("--hours", type=float, default=30)
        p.add_argument("--dials-per-hour", type=float, default=40)
        p.add_argument("--attempts", type=int, default=8)

    p = sub.add_parser("plan"); cap_args(p); p.add_argument("--buffer-days", type=int, default=7)
    p = sub.add_parser("wave"); cap_args(p)
    p.add_argument("--size", type=int); p.add_argument("--asset", choices=["residential", "land"])
    p.add_argument("--min-scrub-days", type=int, default=21)
    p.add_argument("--greedy", action="store_true"); p.add_argument("--dry-run", action="store_true")
    p = sub.add_parser("scrub-export"); p.add_argument("--days-left", type=int, default=10)
    p.add_argument("--as-of")
    p = sub.add_parser("scrub-apply"); p.add_argument("file")
    p.add_argument("--source", required=True); p.add_argument("--date")
    sub.add_parser("patch")
    sub.add_parser("mail-export")
    sub.add_parser("compliance-init")
    args = ap.parse_args()
    {"plan": cmd_plan, "wave": cmd_wave, "scrub-export": cmd_scrub_export,
     "scrub-apply": cmd_scrub_apply, "patch": cmd_patch, "mail-export": cmd_mail_export,
     "compliance-init": cmd_compliance_init}[args.cmd](args)


if __name__ == "__main__":
    main()
