"""Acquisition-machine checks (scripts/09 + 10), driven from tests/selftest.py.

Synthetic BatchLeads- and Land-Portal-shaped exports (header spellings vary
on purpose) -> ingest -> merge/dedupe -> suppression -> scoring -> lanes ->
call windows -> stratified wave -> re-scrub -> patch.
"""
from __future__ import annotations

import argparse
import contextlib
import io
import json
from datetime import date
from pathlib import Path

import pandas as pd

PULL = "2026-09-25"
AS_OF = "2026-10-01"


def _csv(path: Path, rows: list[dict]) -> Path:
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def _quiet(fn, *a, **kw):
    with contextlib.redirect_stdout(io.StringIO()):
        return fn(*a, **kw)


def test_acq(tmp: Path, check, ac, s09, s10) -> None:
    print("\n[9] acquisition machine: ingest -> dedupe -> lanes -> waves")
    # isolate every path the scripts touch
    ac.ACQ, ac.RAW_ACQ = tmp / "acq", tmp / "raw"
    ac.MANIFEST, ac.SCRUB_DIR, ac.COMPLIANCE = tmp / "raw/manifest.csv", tmp / "acq/scrub", tmp / "compliance"
    s10.WAVES, s10.LEDGER = tmp / "acq/waves", tmp / "acq/releases.csv"
    s09.load_listing_suppression = lambda: set()
    src = tmp / "incoming"
    src.mkdir()

    # --- unit pieces
    check(ac.normalize_phone("(856) 222-1111") == "8562221111", "acq: phone normalized")
    check(ac.normalize_phone("1-856-222-1111") == "8562221111", "acq: leading 1 stripped")
    check(ac.normalize_phone("212-555-0123") is None, "acq: 555-01xx fiction rejected")
    check(ac.normalize_phone("011-222-3333") is None, "acq: invalid NPA rejected")
    m = ac.map_columns(["Property Address", "Phone 1", "Phone 1 Type", "Phone 1 DNC",
                        "Mobile 2", "Email 1", "Situs Zip", "Wetlands %", "Mystery"])
    check(m["fields"]["property_address"] == "Property Address", "acq: alias maps address")
    check(m["fields"]["property_zip"] == "Situs Zip", "acq: alias maps situs zip")
    check(m["fields"]["wetlands_pct"] == "Wetlands %", "acq: alias maps wetlands %")
    check(set(m["phones"]) == {"1", "mobile2"} and m["phones"]["1"]["dnc"] == "Phone 1 DNC",
          "acq: phone groups + DNC attribute detected")
    check(m["unmapped"] == ["Mystery"], "acq: unknown header reported, not guessed")
    d = date(2026, 10, 1)
    check(ac.window_label(ac.window_et(ac.zones_for("NJ"), d)) == "9a-8p ET", "acq: NJ window 9a-8p ET")
    check(ac.window_label(ac.window_et(ac.zones_for("TN"), d)) == "10a-8p ET",
          "acq: two-zone state = intersection (10a-8p ET)")
    check(ac.window_label(ac.window_et(ac.zones_for("CA"), d)) == "12p-11p ET", "acq: CA window on ET clock")
    check(ac.window_et(ac.zones_for("ZZ"), d) is None, "acq: unknown state -> no window")
    check(ac.is_holiday(date(2026, 11, 26)) and ac.is_holiday(date(2026, 5, 25))
          and not ac.is_holiday(date(2026, 11, 19)), "acq: floating federal holidays")
    check(s10.allocate({"a": 10, "b": 30}, 8) == {"a": 2, "b": 6}, "release: proportional allocation")
    check(s10.capacity(2, 30, 40, 8) == {"weekly_dials": 2400, "fresh_per_week": 300},
          "release: 2 callers x 30h x 40/h, 8 attempts -> 300 fresh/week")

    # --- vendor exports
    base = {"Property State": "NJ", "Units": "1", "MLS Status": "Off Market"}
    vacant = _csv(src / "bl_vacant.csv", [
        {**base, "Property Address": "10 Oak St", "Property City": "Camden", "Property Zip": "08102",
         "County": "Camden County", "APN": "123-4", "First Name": "John", "Last Name": "Smith",
         "Mailing Address": "1 Elsewhere Rd", "Mailing City": "Phila", "Mailing State": "PA",
         "Mailing Zip": "19103", "Estimated Value": "$300,000", "Equity Percent": "65",
         "Last Sale Date": "1995-06-01", "Phone 1": "856-222-1111", "Phone 1 Type": "Wireless",
         "Phone 1 DNC": "N", "Phone 2": "609-444-3333", "Phone 2 Type": "Landline", "Phone 2 DNC": "Y"},
        {**base, "Property Address": "20 Elm St", "Property City": "Camden", "Property Zip": "08102",
         "County": "Camden", "APN": "200-1", "First Name": "Ann", "Last Name": "Listed",
         "MLS Status": "Active", "Equity Percent": "50", "Phone 1": "856-222-2000"},
        {**base, "Property Address": "30 Pine St", "Property City": "Trenton", "Property Zip": "08608",
         "County": "Mercer", "APN": "300-1", "First Name": "Rick", "Last Name": "Recent",
         "Last Sale Date": "2026-07-01", "Equity Percent": "50", "Phone 1": "609-222-3000"},
        {**base, "Property Address": "40 Maple St", "Property City": "Trenton", "Property Zip": "08608",
         "County": "Mercer", "APN": "400-1", "First Name": "Flo", "Last Name": "Rida",
         "Mailing Address": "9 Beach Dr", "Mailing City": "Miami", "Mailing State": "FL",
         "Mailing Zip": "33101", "Equity Percent": "70", "Phone 1": "305-222-4000"},
        {**base, "Property Address": "50 Birch St", "Property City": "Toms River", "Property Zip": "08753",
         "County": "Ocean", "APN": "500-1", "First Name": "Jane", "Last Name": "Doe",
         "Equity Percent": "45", "Phone 1": "732-222-5000"},
        {**base, "Property Address": "60 Cedar St", "Property City": "Camden", "Property Zip": "08103",
         "County": "Camden", "APN": "600-1", "Owner Name": "ACME HOLDINGS LLC",
         "Mailing Address": "PO Box 7", "Mailing City": "Cherry Hill", "Mailing State": "NJ",
         "Mailing Zip": "08002", "Equity Percent": "80", "Phone 1": "856-777-6000"},
        {**base, "Property Address": "70 Cedar St", "Property City": "Camden", "Property Zip": "08103",
         "County": "Camden", "APN": "700-1", "Owner Name": "ACME HOLDINGS LLC",
         "Mailing Address": "PO Box 7", "Mailing City": "Cherry Hill", "Mailing State": "NJ",
         "Mailing Zip": "08002", "Equity Percent": "75", "Phone 1": "856-777-6000"},
        {**base, "Property Address": "80 Spruce St", "Property City": "Camden", "Property Zip": "08103",
         "County": "Camden", "APN": "800-1", "First Name": "Sam", "Last Name": "Shared",
         "Equity Percent": "30", "Phone 1": "856-777-6000"},
        {**base, "Property Address": "90 Fir St", "Property City": "Newark", "Property Zip": "07102",
         "County": "Essex", "APN": "900-1", "First Name": "Low", "Last Name": "Equity",
         "Equity Percent": "4", "Phone 1": "973-222-9000"},
    ])
    tax = _csv(src / "bl_tax.csv", [
        {**base, "Property Address": "10 Oak Street", "Property City": "Camden", "Property Zip": "08102",
         "County": "Camden", "APN": "123-4", "First Name": "John", "Last Name": "Smith",
         "Mailing Address": "1 Elsewhere Road", "Mailing City": "Phila", "Mailing State": "PA",
         "Mailing Zip": "19103", "Equity Percent": "65", "Tax Delinquent": "Yes",
         "Phone 1": "856-333-4444", "Phone 1 Type": "Mobile"},
    ])
    land = _csv(src / "lp_infill.csv", [
        {"Parcel ID": "9-1", "Situs Address": "100 Farm Rd", "Situs City": "Vineland", "Situs Zip": "08360",
         "County Name": "Cumberland", "Acres": "1.2", "Wetlands %": "3", "Flood Zone": "X",
         "Road Frontage": "120", "Landlocked": "N", "Owner Name": "Pat Planter",
         "Mailing Address": "5 Main St", "Mailing City": "Austin", "Mailing State": "TX",
         "Mailing Zip": "78701", "Phone 1": "512-222-1000"},
        {"Parcel ID": "9-2", "Situs Address": "110 Farm Rd", "Situs City": "Vineland", "Situs Zip": "08360",
         "County Name": "Cumberland", "Acres": "1.0", "Landlocked": "Y", "Owner Name": "Lou Locked",
         "Phone 1": "856-222-1200"},
        {"Parcel ID": "9-3", "Situs Address": "120 Farm Rd", "Situs City": "Vineland", "Situs Zip": "08360",
         "County Name": "Cumberland", "Acres": "1.5", "Wetlands %": "35", "Owner Name": "Wendy Wet",
         "Phone 1": "856-222-1300"},
    ])
    for f, prov, coh in ((vacant, "batchleads", "vacant_equity"), (tax, "batchleads", "tax_delinquent"),
                         (land, "landportal", "land_infill")):
        _quiet(s09.cmd_add, f, prov, coh, PULL, "batchskiptracing")
    check(len(pd.read_csv(ac.MANIFEST)) == 3, "ingest: 3 pulls registered")

    ac.SCRUB_DIR.mkdir(parents=True, exist_ok=True)
    _csv(ac.SCRUB_DIR / f"scrub_{PULL}.csv", [
        {"phone": n, "status": "Clean"} for n in
        ("8562221111", "8563334444", "3052224000", "8567776000", "5122221000", "8562222000",
         "6092223000", "9732229000", "8562221200", "8562221300")])
    ac.COMPLIANCE.mkdir(parents=True, exist_ok=True)
    _csv(ac.COMPLIANCE / "optouts.csv", [{"date": PULL, "phone": "(856) 222-1300"}])

    props, owners, stats = _quiet(s09.build, date.fromisoformat(AS_OF), False)
    P = props.set_index("apn")
    O = owners.set_index("full_name")
    check(stats["raw_rows"] == 13 and stats["properties"] == 12,
          "dedupe: same parcel from two cohort pulls -> one property")
    oak = P.loc["1234"]
    check(bool(oak["vacant"]) and bool(oak["tax_delinquent"]) and oak["cohorts"] == "tax_delinquent;vacant_equity",
          "dedupe: merged parcel carries BOTH signals")
    check("stacked" in oak["score_reasons"] and "out-of-state" in oak["score_reasons"],
          "score: stacked distress + out-of-state owner explained")
    john = O.loc["John Smith"]
    ph = {p["number"]: p for p in json.loads(john["phones"])}
    check(set(ph) == {"8562221111", "6094443333", "8563334444"}, "dedupe: owner phones unioned across pulls")
    check(ph["6094443333"]["status"] == "dnc", "suppress: vendor-flagged DNC number not callable")
    check(ph["8562221111"]["status"] == "clean", "scrub: scrubbed number callable")
    check(json.loads(john["phones"])[0]["type"] == "mobile", "phones: callable mobiles ordered first")
    check(john["dial_lane"] == "power" and john["call_window_et"] == "9a-8p ET",
          "lane: PA owner -> power, 9a-8p ET")
    check(P.loc["2001"]["suppress_reason"].startswith("listed"), "suppress: vendor MLS 'Active' (NJ REC)")
    check(P.loc["3001"]["suppress_reason"].startswith("sold within"), "suppress: recent sale")
    check(P.loc["9001"]["suppress_reason"].startswith("equity 4%"), "suppress: no-equity record")
    check(O.loc["Ann Listed"]["dial_lane"] == "suppressed", "lane: owner of only a listed parcel suppressed")
    flo = O.loc["Flo Rida"]
    check(flo["dial_lane"] == "manual" and "FL" in flo["lane_reason"], "lane: FL resident -> manual only")
    jane = O.loc["Jane Doe"]
    check(jane["dial_lane"] == "mail_only" and "unscrubbed" in jane["lane_reason"],
          "lane: unscrubbed-only owner -> mail_only")
    acme = O.loc["ACME HOLDINGS LLC"]
    check(int(acme["property_count"]) == 2 and "2 properties" in acme["signals"],
          "dedupe: landlord = one contact, two properties")
    check(acme["owner_type"] == "Entity", "owner type: LLC -> Entity")
    sam = O.loc["Sam Shared"]
    check(json.loads(sam["phones"]) == [] and int(sam["phones_moved_to_other_owner"]) == 1,
          "dedupe: shared phone kept only on the higher-score owner")
    check(P.loc["91"]["asset_class"] == "land" and P.loc["91"]["suppress_reason"] == "",
          "land: clean infill parcel kept")
    check(P.loc["92"]["suppress_reason"] == "landlocked", "land: landlocked removed")
    check(P.loc["93"]["suppress_reason"].startswith("wetlands 35%"), "land: wetlands over infill cap removed")
    pat = O.loc["Pat Planter"]
    check(pat["call_window_et"] == "11a-9p ET" and pat["dial_lane"] == "power",
          "lane: TX owner -> CT/MT intersection window")

    # --- dial-state gate: only cleared mailing states are callable
    _, gated, _ = _quiet(s09.build, date.fromisoformat(AS_OF), False, {"NJ"})
    G = gated.set_index("full_name")
    check(G.loc["John Smith"]["dial_lane"] == "mail_only" and "PA not cleared" in G.loc["John Smith"]["lane_reason"],
          "dial states: PA resident -> mail lane until PA is cleared")
    check(G.loc["ACME HOLDINGS LLC"]["dial_lane"] == "power", "dial states: NJ resident stays callable")
    check(G.loc["Jane Doe"]["dial_lane"] == "mail_only", "dial states: owner with no mailing (assumed NJ) not blocked by the gate")

    # --- persist + release
    ac.ACQ.mkdir(parents=True, exist_ok=True)
    props.to_parquet(ac.ACQ / "universe_properties.parquet", index=False)
    owners.to_parquet(ac.ACQ / "universe_owners.parquet", index=False)
    ns = argparse.Namespace(as_of=AS_OF, callers=2, hours=30, dials_per_hour=40, attempts=8,
                            size=3, asset=None, min_scrub_days=21, greedy=False, dry_run=False)
    _quiet(s10.cmd_wave, ns)
    w1 = [json.loads(x) for x in (s10.WAVES / "W01.jsonl").read_text().splitlines()]
    check(len(w1) == 3, "wave: W01 has the requested 3 owners")
    check(all(r["contact"]["dial_lane"] in ("power", "manual") for r in w1), "wave: only callable lanes")
    check(all(all(p.get("scrub_date") for p in r["contact"]["phones"]) for r in w1),
          "wave: every exported phone carries its scrub date")
    jw = next((r for r in w1 if r["contact"]["full_name"] == "John Smith"), None)
    if jw:
        check([p["number"] for p in jw["contact"]["phones"]] == ["8562221111", "8563334444"],
              "wave: DNC number never leaves the building")
    check((s10.WAVES / "W01_contacts.csv").exists() and (s10.WAVES / "W01_properties.csv").exists(),
          "wave: GHL native-import CSVs written")
    _quiet(s10.cmd_wave, argparse.Namespace(**{**vars(ns), "size": 50}))
    w2 = [json.loads(x) for x in (s10.WAVES / "W02.jsonl").read_text().splitlines()]
    check(not ({r["owner_id"] for r in w1} & {r["owner_id"] for r in w2}), "wave: W02 never re-releases W01")
    callable_ids = set(owners.loc[owners["dial_lane"].isin(["power", "manual"]), "owner_id"])
    check({r["owner_id"] for r in w1 + w2} == callable_ids, "wave: all callable owners released, nothing else")
    held = _quiet(s10.eligible, owners, s10.load_ledger().head(0), None, 21, date(2026, 10, 20))
    check(len(held) == 0, "wave: scrub with <21 days left is held back")

    # --- re-scrub -> DNC appears -> patch
    rescrub = _csv(tmp / "vendor_result.csv", [{"phone": "856-222-1111", "status": "Federal DNC"},
                                              {"phone": "856-333-4444", "status": "clean"}])
    _quiet(s10.cmd_scrub_apply, argparse.Namespace(file=str(rescrub), source="test-vendor", date="2026-10-02"))
    log = pd.read_csv(ac.COMPLIANCE / "scrub_log.csv")
    check(len(log) == 1 and int(log["n_suppressed"].iloc[0]) == 1, "scrub: batch logged to compliance/scrub_log.csv")
    # append-only scrub log keeps whatever header the file was created with
    old_log = ac.COMPLIANCE / "scrub_log.csv"
    legacy = old_log.read_text().splitlines()
    old_log.write_text("date,source,n_records,n_suppressed,file_hash\n")
    ac.append_scrub_log("legacy-vendor", 3, 1, rescrub)
    rows = old_log.read_text().splitlines()
    check(len(rows) == 2 and rows[1].count(",") == 4 and "legacy-vendor (vendor_result.csv)" in rows[1],
          "scrub log: row aligned to a legacy 5-column header")
    old_log.write_text("\n".join(legacy) + "\n")
    _quiet(s10.cmd_compliance_init, argparse.Namespace())
    hdr = (ac.COMPLIANCE / "training_log.csv").read_text()
    check(hdr.startswith("date,caller_name,wavv_user_id") and (ac.COMPLIANCE / "incidents.csv").exists(),
          "compliance-init: training log + incident log created")
    check((ac.COMPLIANCE / "optouts.csv").read_text().startswith("date,phone") and
          len((ac.COMPLIANCE / "scrub_log.csv").read_text().splitlines()) > 1,
          "compliance-init: existing logs never overwritten")
    props2, owners2, _ = _quiet(s09.build, date(2026, 10, 3), False)
    owners2.to_parquet(ac.ACQ / "universe_owners.parquet", index=False)
    props2.to_parquet(ac.ACQ / "universe_properties.parquet", index=False)
    _quiet(s10.cmd_patch, argparse.Namespace())
    patches = sorted(s10.WAVES.glob("patch_*.jsonl"))
    recs = [json.loads(x) for x in patches[-1].read_text().splitlines()] if patches else []
    jp = next((r for r in recs if r["contact"]["full_name"] == "John Smith"), None)
    check(jp is not None and [p["number"] for p in jp["contact"]["phones"]] == ["8563334444"],
          "patch: newly-DNC number pulled from the released contact")
