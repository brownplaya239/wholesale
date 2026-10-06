"""BatchLeads / Land Portal pulls -> one clean, deduped, scored universe.

  python scripts/09_acq_ingest.py inspect FILE
      show how a vendor export's headers map (run on every NEW export format)
  python scripts/09_acq_ingest.py add FILE --provider batchleads --cohort vacant_equity
      [--pull-date 2026-10-01] [--skip-trace batchskiptracing]
      register a pull in data/raw/acq/manifest.csv (one file per cohort query)
  python scripts/09_acq_ingest.py build [--trust-vendor-scrub] [--as-of YYYY-MM-DD]
      [--dial-states NJ,PA | ALL]
      merge every registered pull -> data/processed/acq/universe_{properties,owners}.parquet

What `build` enforces (the rules that keep the GHL database clean):
  - one PROPERTY per parcel (county+APN, else normalized address+zip) — a
    vacant, absentee, tax-delinquent house pulled by three cohort queries is
    ONE record carrying all three signals, not three dial attempts;
  - one OWNER per person/entity (name + mailing address); a landlord with five
    houses is one contact with five properties;
  - a phone number lives on exactly one owner (highest score wins);
  - suppression before anything is callable: another broker's active listing
    (vendor MLS status + data/processed/suppress_active_listings.csv, NJ REC),
    recent sale, not 1-4 units, no equity, land screens (landlocked, wetlands,
    flood, slope);
  - a phone is callable only if a DNC+litigator scrub <=31 days old says
    clean (data/processed/acq/scrub/*.csv), it is not on the internal DNC, and
    the vendor did not flag it. --trust-vendor-scrub lets the vendor's own DNC
    flag count as the scrub; that is only defensible if the vendor scrubbed
    under YOUR registry subscription (SAN) — see docs/ACQUISITION_SYSTEM.md;
  - every owner gets a lane: power (multi-line OK), manual (single-line only:
    FL/OK/MD residents or area codes), mail_only (no callable phone, or a
    mailing state not yet cleared for calling — default only NJ is cleared,
    compliance/DNC_PROCEDURES.md §4.4), and a call window on the caller's
    clock (ET).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acq_common as ac  # noqa: E402
from nj_common import is_suppressed, load_listing_suppression  # noqa: E402

LISTED = re.compile(r"\b(ACTIVE|PENDING|CONTINGENT|COMING SOON|UNDER CONTRACT|"
                    r"FOR SALE|LISTED|BACKUP|HOLD)\b", re.I)
NOT_1_4 = re.compile(r"COMMERCIAL|INDUSTRIAL|OFFICE|RETAIL|APARTMENT 5|5\+|"
                     r"MOBILE HOME PARK|HOTEL|WAREHOUSE", re.I)
FLOODWAY = re.compile(r"FLOODWAY|\bFW\b|\bVE?\b", re.I)


# ------------------------------------------------------------------ reading --
def read_any(path: Path) -> pd.DataFrame:
    if path.suffix.lower() in (".xlsx", ".xls"):
        return pd.read_excel(path, dtype=str)
    return pd.read_csv(path, dtype=str, encoding_errors="replace")


def cmd_inspect(path: Path) -> dict:
    df = read_any(path)
    m = ac.map_columns(df.columns)
    print(f"{path.name}: {len(df):,} rows, {len(df.columns)} columns\n")
    print("Mapped fields:")
    for canon, col in sorted(m["fields"].items()):
        sample = df[col].dropna().astype(str).head(1).tolist()
        print(f"  {canon:<18} <- {col!r:<32} e.g. {sample[0][:40] if sample else ''}")
    print(f"\nPhone groups ({len(m['phones'])}):")
    for k, g in sorted(m["phones"].items()):
        print(f"  {k:<10} " + ", ".join(f"{a}={c!r}" for a, c in g.items() if a != "base"))
    print(f"\nEmails: {m['emails']}")
    print(f"\nUnmapped ({len(m['unmapped'])}): {m['unmapped']}")
    if "property_address" not in m["fields"]:
        print("\n!! no property address column — add its header to ALIASES in acq_common.py")
    if not m["phones"]:
        print("\n!! no phone columns detected — skip-trace not appended, or header pattern unknown")
    return m


def cmd_add(path: Path, provider: str, cohort: str, pull_date: str | None,
            skip_trace: str | None) -> None:
    if cohort not in ac.COHORTS:
        raise SystemExit(f"unknown cohort {cohort!r}; one of {sorted(ac.COHORTS)}")
    if provider not in ac.PROVIDERS:
        raise SystemExit(f"unknown provider {provider!r}; one of {sorted(ac.PROVIDERS)}")
    m = cmd_inspect(path)
    if "property_address" not in m["fields"]:
        raise SystemExit("refusing to register a file without a property address column")
    ac.RAW_ACQ.mkdir(parents=True, exist_ok=True)
    dest = ac.RAW_ACQ / path.name
    if path.resolve() != dest.resolve():
        shutil.copy2(path, dest)
    row = pd.DataFrame([{"file": dest.name, "provider": provider, "cohort": cohort,
                         "pull_date": pull_date or date.today().isoformat(),
                         "skip_trace_provider": skip_trace or ""}])
    if ac.MANIFEST.exists():
        man = pd.read_csv(ac.MANIFEST, dtype=str).fillna("")
        man = man[man["file"] != dest.name]
        row = pd.concat([man, row], ignore_index=True)
    row.to_csv(ac.MANIFEST, index=False)
    print(f"\nRegistered {dest.name} as {provider}/{cohort} in {ac.MANIFEST}")


# ---------------------------------------------------------------- per file --
def _equity(est, mort, eq_pct, eq_amt, ltv, free_clear):
    if eq_pct is not None:
        # some exports put dollars in an "Equity" column
        if eq_pct > 100 and est:
            return round(100 * eq_pct / est, 1)
        if 0 < eq_pct <= 1.0:
            return round(eq_pct * 100, 1)
        return round(eq_pct, 1)
    if eq_amt is not None and est:
        return round(100 * eq_amt / est, 1)
    if ltv is not None:
        return round(100 - (ltv * 100 if ltv <= 1.5 else ltv), 1)
    if est and mort is not None:
        return round(100 * (est - mort) / est, 1)
    if free_clear:
        return 100.0
    return None


def rows_from_file(entry: dict) -> tuple[list[dict], list[dict]]:
    path = ac.RAW_ACQ / entry["file"]
    df = read_any(path)
    cmap = ac.map_columns(df.columns)
    f = cmap["fields"]
    if "property_address" not in f:
        raise SystemExit(f"{path.name}: no property address column (run inspect)")
    cohort = entry["cohort"]
    co = ac.COHORTS[cohort]
    pull = date.fromisoformat(entry["pull_date"])
    props, owners = [], []
    for i, r in df.iterrows():
        def g(canon):
            col = f.get(canon)
            v = r[col] if col is not None else None
            return None if v is None or (isinstance(v, float) and pd.isna(v)) else str(v).strip()

        addr = g("property_address") or ""
        city = g("property_city") or ""
        zipc = (g("property_zip") or "")[:5]
        if not re.match(r"^\d+", addr):
            addr_ok = False
        else:
            addr_ok = True
        county = ac.norm_county(g("county"))
        apn = re.sub(r"[^A-Z0-9]", "", (g("apn") or "").upper())
        pkey = f"{county}|{apn}" if apn and county else ac.address_key(addr, zipc, city)

        est = ac.to_num(g("est_value"))
        mort = ac.to_num(g("mortgage_balance"))
        flags = {k: ac.to_bool(g(k)) for k in ac.FLAGS}
        if co["flag"]:
            flags[co["flag"]] = True  # the query guarantees it
        sale_date = ac.to_date(g("last_sale_date"))
        acres = ac.to_num(g("lot_acres"))
        if acres is None and ac.to_num(g("lot_sqft")):
            acres = round(ac.to_num(g("lot_sqft")) / 43560, 3)
        road_access = ac.to_bool(g("road_access"))
        landlocked = ac.to_bool(g("landlocked"))
        if landlocked is None and road_access is not None:
            landlocked = not road_access

        first, last = g("owner_first") or "", g("owner_last") or ""
        full = g("owner_full") or " ".join(x for x in (first, last) if x)
        if not (first or last) and full:
            first, last = ac.split_name(full)
        maddr = g("mailing_address") or ""
        mcity, mstate = g("mailing_city") or "", (g("mailing_state") or "").upper()[:2]
        mzip = (g("mailing_zip") or "")[:5]
        mailing_inferred = False
        if not maddr:
            maddr, mcity, mstate, mzip, mailing_inferred = addr, city, "NJ", zipc, True
        if flags["absentee"] is None:
            flags["absentee"] = (ac.address_key(maddr, mzip) != ac.address_key(addr, zipc)
                                 and not mailing_inferred)
        okey = ("E|" + ac.norm_name(full) if ac.owner_type(full) != "Individual"
                else "P|" + ac.norm_name(last) + "|" + ac.norm_name(first)[:1])
        okey += "|" + ac.address_key(maddr, mzip, mcity)

        phones = []
        for rank, (k, grp) in enumerate(sorted(cmap["phones"].items(),
                                               key=lambda kv: (len(kv[0]), kv[0]))):
            num = ac.normalize_phone(r[grp["number"]])
            if not num:
                continue
            phones.append({
                "number": num,
                "type": ac.phone_type(r[grp["type"]] if "type" in grp else "", grp["base"]),
                "vendor_dnc": ac.to_bool(r[grp["dnc"]]) if "dnc" in grp else None,
                "vendor_litigator": (ac.to_bool(r[grp["litigator"]]) if "litigator" in grp
                                     else ac.to_bool(g("litigator"))),
                "rank": rank,
            })
        emails = [str(r[c]).strip().lower() for c in cmap["emails"]
                  if isinstance(r[c], str) and "@" in r[c]]

        props.append({
            "property_id": ac.stable_id("P", pkey), "pkey": pkey, "owner_key": okey,
            "asset_class": co["asset"], "address": addr, "address_ok": addr_ok,
            "city": city, "state": (g("property_state") or "NJ").upper()[:2], "zip": zipc,
            "county": county, "municipality": g("municipality") or "", "apn": apn,
            "block": g("block") or "", "lot": g("lot") or "",
            "property_type": g("property_type") or "", "units": ac.to_num(g("units")),
            "beds": ac.to_num(g("beds")), "baths": ac.to_num(g("baths")),
            "sqft": ac.to_num(g("sqft")), "acres": acres,
            "year_built": ac.to_num(g("year_built")), "est_value": est,
            "mortgage_estimate": mort,
            "equity_pct": _equity(est, mort, ac.to_num(g("equity_pct")),
                                  ac.to_num(g("equity_amount")), ac.to_num(g("ltv")),
                                  flags["free_clear"]),
            "last_sale_date": sale_date, "last_sale_price": ac.to_num(g("last_sale_price")),
            "ownership_years": (round((pull - sale_date).days / 365.25, 1) if sale_date else None),
            **flags,
            "mls_status": g("mls_status") or "", "wetlands_pct": ac.to_num(g("wetlands_pct")),
            "flood_zone": g("flood_zone") or "", "flood_pct": ac.to_num(g("flood_pct")),
            "road_frontage_ft": ac.to_num(g("road_frontage")), "landlocked": landlocked,
            "slope_pct": ac.to_num(g("slope_pct")),
            "cohort": cohort, "provider": entry["provider"], "source_file": entry["file"],
            "pull_date": pull, "skip_trace_provider": entry.get("skip_trace_provider", ""),
        })
        owners.append({
            "owner_key": okey, "first_name": first, "last_name": last, "full_name": full,
            "owner2": g("owner2_full") or "", "owner_type": ac.owner_type(full),
            "mailing_address": maddr, "mailing_city": mcity, "mailing_state": mstate,
            "mailing_zip": mzip, "mailing_inferred": mailing_inferred,
            "phones": phones, "emails": emails, "pull_date": pull,
            "provider": entry["provider"], "skip_trace_provider": entry.get("skip_trace_provider", ""),
            "pkey": pkey,
        })
    return props, owners


# ------------------------------------------------------------------- merge --
def merge_properties(props: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(props)
    if df.empty:
        return df
    df = df.sort_values("pull_date")  # later pulls win on scalar fields
    out = []
    for pkey, g in df.groupby("pkey", sort=False):
        rec = {}
        for col in df.columns:
            vals = [v for v in g[col].tolist() if v is not None and not (isinstance(v, float) and pd.isna(v)) and v != ""]
            rec[col] = vals[-1] if vals else None
        for flag in ac.FLAGS:  # a signal seen in ANY pull counts
            vals = [v for v in g[flag].tolist() if v is not None and not pd.isna(v)]
            rec[flag] = True if True in vals else (False if vals else None)
        rec["cohorts"] = sorted(set(g["cohort"]))
        rec["providers"] = sorted(set(g["provider"]))
        rec["source_files"] = sorted(set(g["source_file"]))
        rec["first_pull"] = min(g["pull_date"])
        rec["asset_class"] = ("land" if all(ac.COHORTS[c]["asset"] == "land" for c in rec["cohorts"])
                              else "residential")
        out.append(rec)
    return pd.DataFrame(out)


def suppress_reason(p: dict, listing_keys: set) -> str:
    if not p["address_ok"]:
        return "no usable property address"
    if p["mls_status"] and LISTED.search(str(p["mls_status"])) and not re.search(
            r"OFF|EXPIRED|WITHDRAWN|CANCEL|SOLD|CLOSED", str(p["mls_status"]), re.I):
        return "listed (vendor MLS status) - NJ REC: never solicit"
    if listing_keys and is_suppressed(p["address"], p["city"], p["zip"], listing_keys):
        return "listed (MLS export) - NJ REC: never solicit"
    if p["last_sale_date"] and (p["pull_date"] - p["last_sale_date"]).days < ac.RECENT_SALE_MONTHS * 30.4:
        return f"sold within {ac.RECENT_SALE_MONTHS} months"
    if p["asset_class"] == "residential":
        if (p["units"] or 0) > 4 or NOT_1_4.search(str(p["property_type"] or "")):
            return "not a 1-4 unit residence"
        mins = [ac.COHORTS[c]["min_equity"] for c in p["cohorts"] if ac.COHORTS[c]["min_equity"] is not None]
        if mins and p["equity_pct"] is not None and p["equity_pct"] < min(mins):
            return f"equity {p['equity_pct']:.0f}% < {min(mins)}%"
    else:
        lr = ac.LAND_RULES
        if p["landlocked"]:
            return "landlocked"
        wmax = lr["max_wetlands_infill"] if p["cohorts"] == ["land_infill"] else lr["max_wetlands"]
        if p["wetlands_pct"] is not None and p["wetlands_pct"] > wmax:
            return f"wetlands {p['wetlands_pct']:.0f}% > {wmax:.0f}%"
        if (p["flood_pct"] is not None and p["flood_pct"] > lr["max_flood_pct"]) or (
                p["flood_zone"] and FLOODWAY.search(str(p["flood_zone"]))):
            return "flood-constrained"
        if p["slope_pct"] is not None and p["slope_pct"] > lr["max_slope"]:
            return f"slope {p['slope_pct']:.0f}% > {lr['max_slope']:.0f}%"
    return ""


def score_property(p: dict, out_of_state: bool) -> tuple[int, list[str]]:
    reasons = []
    base = max(ac.COHORTS[c]["base"] for c in p["cohorts"])
    reasons.append(f"cohort {base}")
    s = base
    distress = [k for k in ac.DISTRESS if p.get(k)]
    if len(distress) > 1:
        s += 8 * (len(distress) - 1)
        reasons.append(f"+{8 * (len(distress) - 1)} stacked ({', '.join(distress)})")
    eq = p.get("equity_pct")
    if p.get("free_clear"):
        s += 12; reasons.append("+12 free & clear")
    elif eq is not None and eq >= 60:
        s += 10; reasons.append("+10 equity>=60%")
    elif eq is not None and eq >= 40:
        s += 5; reasons.append("+5 equity>=40%")
    yrs = p.get("ownership_years")
    if yrs is not None and yrs >= 25:
        s += 7; reasons.append("+7 held 25y+")
    elif yrs is not None and yrs >= 15:
        s += 4; reasons.append("+4 held 15y+")
    if out_of_state:
        s += 6; reasons.append("+6 out-of-state owner")
    elif p.get("absentee"):
        s += 3; reasons.append("+3 absentee")
    if p["asset_class"] == "land":
        if (p.get("road_frontage_ft") or 0) >= 50:
            s += 3; reasons.append("+3 road frontage")
        if p.get("wetlands_pct") is not None and p["wetlands_pct"] < 5:
            s += 3; reasons.append("+3 dry")
        unknown = [k for k in ("wetlands_pct", "flood_pct", "slope_pct") if p.get(k) is None]
        if unknown:
            reasons.append("unscreened: " + ", ".join(unknown))
    return min(s, 100), reasons


def signals_label(p: dict, out_of_state: bool) -> list[str]:
    lab = {"vacant": "Vacant", "tax_delinquent": "Tax delinquent", "preforeclosure": "Preforeclosure",
           "inherited": "Inherited", "code_violation": "Code violation", "free_clear": "Free & clear"}
    out = [v for k, v in lab.items() if p.get(k)]
    if out_of_state:
        out.append("Out-of-state owner")
    elif p.get("absentee"):
        out.append("Absentee")
    if (p.get("ownership_years") or 0) >= 15:
        out.append(f"Owned {int(p['ownership_years'])}y")
    return out


def build(as_of: date, trust_vendor_scrub: bool,
          dial_states: set[str] | None = None) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """dial_states: mailing states cleared for calling (state DNC list scrubbed,
    registration handled); owners elsewhere go to the mail lane. None = all."""
    if not ac.MANIFEST.exists():
        raise SystemExit("No pulls registered — run `09_acq_ingest.py add FILE ...` first.")
    man = pd.read_csv(ac.MANIFEST, dtype=str).fillna("")
    all_props, all_owners = [], []
    for entry in man.to_dict("records"):
        p, o = rows_from_file(entry)
        all_props += p
        all_owners += o
    raw_rows = len(all_props)
    props = merge_properties(all_props)
    listing_keys = load_listing_suppression()
    scrubs = {r.phone: (r.status, r.scrub_date) for r in ac.load_scrubs().itertuples()}
    internal = ac.load_internal_dnc()

    # ---- owners: merge rows, collect phones in vendor rank order
    owner_rows: dict[str, dict] = {}
    for o in sorted(all_owners, key=lambda x: x["pull_date"]):
        cur = owner_rows.get(o["owner_key"])
        if cur is None:
            owner_rows[o["owner_key"]] = {**o, "phones": list(o["phones"]),
                                          "emails": list(o["emails"]), "pkeys": {o["pkey"]}}
            continue
        cur["pkeys"].add(o["pkey"])
        seen = {ph["number"] for ph in cur["phones"]}
        cur["phones"] += [ph for ph in o["phones"] if ph["number"] not in seen]
        cur["emails"] += [e for e in o["emails"] if e not in cur["emails"]]
        for k in ("first_name", "last_name", "full_name", "owner2"):
            cur[k] = o[k] or cur[k]
        cur["pull_date"] = o["pull_date"]
        cur["skip_trace_provider"] = o["skip_trace_provider"] or cur["skip_trace_provider"]

    # property -> owner from the latest pull of that parcel
    p_owner = {}
    for p in sorted(all_props, key=lambda x: x["pull_date"]):
        p_owner[p["pkey"]] = p["owner_key"]
    props["owner_key"] = props["pkey"].map(p_owner)

    oos = {k: (o["mailing_state"] not in ("", "NJ")) for k, o in owner_rows.items()}
    sup, scores, reasons, sigs = [], [], [], []
    for p in props.to_dict("records"):
        out = oos.get(p["owner_key"], False)
        sup.append(suppress_reason(p, listing_keys))
        s, r = score_property(p, out)
        scores.append(s)
        reasons.append("; ".join(r))
        sigs.append(" · ".join(signals_label(p, out)))
    props["suppress_reason"] = sup
    props["lead_score"] = scores
    props["score_reasons"] = reasons
    props["signals"] = sigs

    # ---- owner-level rollup
    owners = []
    for okey, o in owner_rows.items():
        mine = props[props["owner_key"] == okey]
        live = mine[mine["suppress_reason"] == ""]
        rec = {k: v for k, v in o.items() if k not in ("pkeys", "pkey")}
        rec["owner_id"] = ac.stable_id("O", okey)
        rec["property_ids"] = live.sort_values("lead_score", ascending=False)["property_id"].tolist()
        rec["suppressed_property_ids"] = mine[mine["suppress_reason"] != ""]["property_id"].tolist()
        rec["property_count"] = len(live)
        if len(live):
            top = live.sort_values("lead_score", ascending=False).iloc[0]
            rec["primary_property_id"] = top["property_id"]
            rec["primary_property"] = f"{top['address']}, {top['city']} {top['zip']}".strip()
            rec["primary_county"] = top["county"]
            rec["primary_cohort"] = top["cohorts"][0] if len(top["cohorts"]) == 1 else max(
                top["cohorts"], key=lambda c: ac.COHORTS[c]["base"])
            rec["asset_class"] = ("both" if live["asset_class"].nunique() > 1 else top["asset_class"])
            rec["lead_score"] = int(min(100, top["lead_score"] + 3 * (len(live) - 1)))
            rec["signals"] = top["signals"] + (f" · {len(live)} properties" if len(live) > 1 else "")
            if len(mine) > len(live) and (mine["suppress_reason"].str.startswith("listed")).any():
                rec["signals"] += " · OTHER PARCEL LISTED - don't discuss it"
        else:
            rec.update(primary_property_id=None, primary_property="", primary_county="",
                       primary_cohort=None, asset_class=None, lead_score=0, signals="")
        owners.append(rec)
    owners_df = pd.DataFrame(owners)

    # ---- phone states + one-owner-per-phone
    holder: dict[str, tuple[int, str]] = {}
    for o in owners_df.itertuples():
        for ph in o.phones:
            cur = holder.get(ph["number"])
            if cur is None or o.lead_score > cur[0]:
                holder[ph["number"]] = (o.lead_score, o.owner_id)
    lanes, reasons_l, phone_out, zones_l, windows, scrub_dates, shared = [], [], [], [], [], [], []
    for o in owners_df.itertuples():
        out_phones, n_shared = [], 0
        for ph in o.phones:
            if holder[ph["number"]][1] != o.owner_id:
                n_shared += 1
                continue
            status, sdate = ac.phone_state(ph["number"], ph["vendor_dnc"], ph["vendor_litigator"],
                                           scrubs, internal, as_of, trust_vendor_scrub, o.pull_date)
            out_phones.append({"number": ph["number"], "type": ph["type"], "status": status,
                               "scrub_date": sdate.isoformat() if sdate else None,
                               "rank": ph["rank"]})
        # callable first, mobiles before landlines, then vendor rank
        out_phones.sort(key=lambda x: (x["status"] != "clean", x["type"] != "mobile", x["rank"]))
        callable_ = [p["number"] for p in out_phones if p["status"] == "clean"]
        zones = ac.zones_for(o.mailing_state) or (ac.zones_for("NJ") if o.mailing_inferred or not o.mailing_state else ())
        w = ac.window_et(zones, as_of)
        mstate = "NJ" if o.mailing_inferred else (o.mailing_state or "")
        if o.property_count == 0:
            lane, why = "suppressed", "every property suppressed"
        elif dial_states is not None and mstate not in dial_states:
            lane, why = "mail_only", f"mailing state {mstate or '?'} not cleared for calling"
        elif not callable_:
            statuses = sorted({p["status"] for p in out_phones}) or ["no phone"]
            lane, why = "mail_only", "no callable phone (" + ", ".join(statuses) + ")"
        elif (sr := ac.strict_reason(o.mailing_state, callable_)):
            lane, why = "manual", sr
        elif w is None:
            lane, why = "manual", f"mailing state {o.mailing_state or '?'} has no known time zone"
        else:
            lane, why = "power", ""
        lanes.append(lane)
        reasons_l.append(why)
        phone_out.append(json.dumps(out_phones))
        zones_l.append(",".join(zones))
        windows.append(ac.window_label(w))
        clean_dates = [p["scrub_date"] for p in out_phones if p["status"] == "clean" and p["scrub_date"]]
        scrub_dates.append(min(clean_dates) if clean_dates else None)
        shared.append(n_shared)
    owners_df["phones"] = phone_out
    owners_df["emails"] = owners_df["emails"].map(json.dumps)
    owners_df["dial_lane"] = lanes
    owners_df["lane_reason"] = reasons_l
    owners_df["call_zones"] = zones_l
    owners_df["call_window_et"] = windows
    owners_df["dnc_scrub_date"] = scrub_dates
    owners_df["phones_moved_to_other_owner"] = shared
    for col in ("cohorts", "providers", "source_files"):
        props[col] = props[col].map(lambda v: ";".join(v) if isinstance(v, list) else v)

    stats = {
        "raw_rows": raw_rows, "properties": len(props),
        "cross_cohort_dupes_merged": raw_rows - len(props),
        "suppressed": props["suppress_reason"].ne("").sum(),
        "owners": len(owners_df), "lanes": owners_df["dial_lane"].value_counts().to_dict(),
    }
    return props, owners_df, stats


def report(props: pd.DataFrame, owners: pd.DataFrame, stats: dict) -> None:
    print(f"\n{stats['raw_rows']:,} raw rows -> {stats['properties']:,} properties "
          f"({stats['cross_cohort_dupes_merged']:,} cross-cohort duplicates merged)")
    print(f"{stats['owners']:,} owners; suppressed properties: {stats['suppressed']:,}")
    sr = props.loc[props["suppress_reason"] != "", "suppress_reason"].value_counts()
    if len(sr):
        print("\nSuppression reasons:\n" + sr.to_string())
    print("\nDial lanes (owners):\n" + owners["dial_lane"].value_counts().to_string())
    phones = [p for js in owners["phones"] for p in json.loads(js)]
    if phones:
        st = pd.Series([p["status"] for p in phones]).value_counts()
        print(f"\nPhone status ({len(phones):,} numbers):\n" + st.to_string())
        if st.get("unscrubbed", 0):
            print("  -> unscrubbed numbers are NOT callable: export them with "
                  "`10_acq_release.py scrub-export`, scrub, then drop the result in "
                  f"{ac.SCRUB_DIR} and rebuild.")
    live = props[(props["suppress_reason"] == "") & (props["asset_class"] == "residential")]
    if len(live):
        by = live["county"].value_counts()
        print("\nResidential by county (live vs target):")
        for c in sorted(set(by.index) | set(ac.COUNTY_TARGETS)):
            print(f"  {c or '(unknown)':<12} {int(by.get(c, 0)):>6,} / {ac.COUNTY_TARGETS.get(c, '-')}")
    print("\nCall windows (power+manual owners):")
    callable_ = owners[owners["dial_lane"].isin(["power", "manual"])]
    print(callable_["call_window_et"].value_counts().to_string() if len(callable_) else "  none")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("inspect"); p.add_argument("file", type=Path)
    p = sub.add_parser("add"); p.add_argument("file", type=Path)
    p.add_argument("--provider", required=True); p.add_argument("--cohort", required=True)
    p.add_argument("--pull-date"); p.add_argument("--skip-trace")
    p = sub.add_parser("build"); p.add_argument("--as-of"); p.add_argument("--trust-vendor-scrub", action="store_true")
    p.add_argument("--dial-states", default=os.environ.get("ACQ_DIAL_STATES", "NJ"),
                   help="comma list of mailing states cleared for calling, or ALL (default NJ)")
    args = ap.parse_args()
    if args.cmd == "inspect":
        cmd_inspect(args.file)
    elif args.cmd == "add":
        cmd_add(args.file, args.provider, args.cohort, args.pull_date, args.skip_trace)
    else:
        as_of = date.fromisoformat(args.as_of) if args.as_of else date.today()
        states = None if args.dial_states.strip().upper() == "ALL" else {
            x.strip().upper() for x in args.dial_states.split(",") if x.strip()}
        print(f"Dial states: {'ALL' if states is None else ', '.join(sorted(states))}")
        props, owners, stats = build(as_of, args.trust_vendor_scrub, states)
        ac.ACQ.mkdir(parents=True, exist_ok=True)
        props.to_parquet(ac.ACQ / "universe_properties.parquet", index=False)
        owners.to_parquet(ac.ACQ / "universe_owners.parquet", index=False)
        report(props, owners, stats)
        print(f"\nWrote {ac.ACQ}/universe_properties.parquet + universe_owners.parquet")


if __name__ == "__main__":
    main()
