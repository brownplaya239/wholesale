"""Offline self-test for the status-resolution pipeline.

Network-free: builds synthetic SR1A / MOD-IV fixed-width files byte-by-byte
from the layouts in nj_common.py, then drives parse -> match -> resolve ->
buyer harvest -> skip-trace export -> mail segments and asserts each status
path. Run:  python tests/selftest.py

This proves the parsing/matching/decision logic end to end. It does NOT prove
the Treasury download URLs or that the published layout hasn't drifted — the
parsers validate that at first real run and fail loudly if so.
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import nj_common as nc  # noqa: E402
from nj_common import SR1A_LAYOUT, SR1A_RECLEN, MODIV_LAYOUT, MODIV_RECLEN  # noqa: E402

importlib_spec = __import__("importlib.util", fromlist=["util"])


def _load(name: str, path: Path):
    spec = importlib_spec.spec_from_file_location(name, path)
    mod = importlib_spec.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


s02 = _load("s02", ROOT / "scripts/02_status_resolution.py")
s03 = _load("s03", ROOT / "scripts/03_buyer_harvest.py")
s04 = _load("s04", ROOT / "scripts/04_skiptrace_export.py")
s05 = _load("s05", ROOT / "scripts/05_mail_segments.py")

PASS = 0


def check(cond, msg):
    global PASS
    assert cond, f"FAIL: {msg}"
    PASS += 1
    print(f"  ok - {msg}")


def fw_record(layout, reclen, **values) -> str:
    rec = [" "] * reclen
    fields = {n: (a, ln) for n, a, ln in layout}
    for name, val in values.items():
        a, ln = fields[name]
        s = str(val)[:ln].ljust(ln)
        rec[a:a + ln] = s
    return "".join(rec)


def sr1a_line(county="13", district="05", block="123", lot="4",
              nu="", price=500000, deed="240315", grantee="ACME HOMES LLC",
              grantee_street="1 SHELL PLAZA", grantee_cs="FREEHOLD NJ",
              loc="15 OAK ST") -> str:
    return fw_record(
        SR1A_LAYOUT, SR1A_RECLEN,
        county_code=county, district_code=district,
        block_prefix=block.rjust(5, "0"), lot_prefix=lot.rjust(5, "0"),
        nu_code=nu, verified_price=str(price).rjust(9, "0"),
        reported_price=str(price).rjust(9, "0"), deed_date=deed,
        date_recorded=deed, grantee_name=grantee,
        grantee_street=grantee_street, grantee_city_state=grantee_cs,
        grantor_name="SELLER, SOME", property_location=loc,
        property_class="2", qual="",
    )


def modiv_line(muncode="1305", block="123", lot="4", loc="15 OAK ST",
               owner="DOE, JANE", oaddr="15 OAK ST", ocity="HAZLET NJ",
               ozip="077300000") -> str:
    return fw_record(
        MODIV_LAYOUT, MODIV_RECLEN,
        muncode=muncode,
        block_raw=block.rjust(5, "0") + "    ",
        lot_raw=lot.rjust(5, "0") + "    ",
        property_location=loc, owner_name=owner, owner_address=oaddr,
        owner_city=ocity, owner_zip=ozip, property_class="2",
        sale_date="150601", sale_price="000350000",
        land_value="000100000", improvement_value="000200000",
        net_value="000300000",
    )


def test_parsers(tmp: Path):
    print("\n[1] fixed-width parsers")
    sr = tmp / "sr1a_test.txt"
    sr.write_text("\n".join([
        sr1a_line(),                                        # usable sale
        sr1a_line(block="200", lot="7", nu="010", deed="230710",
                  grantee="SMITH, BOB JR", price=1),        # estate NU sale
        sr1a_line(county="01", district="01"),              # out-of-footprint
    ]))
    df = nc.parse_sr1a_file(sr)
    check(len(df) == 3, "SR1A: 3 records parsed")
    filt = nc.parse_sr1a_file(sr, nc.TARGET_COUNTY_CODES)
    check(len(filt) == 2 and (filt["muncode"].str[:2]
          .isin(nc.TARGET_COUNTY_CODES)).all(),
          "SR1A: county prefilter drops out-of-footprint rows")
    other = tmp / "sr1a_atlantic.txt"
    other.write_text(sr1a_line(county="01", district="01"))
    check(len(nc.parse_sr1a_file(other, nc.TARGET_COUNTY_CODES)) == 0,
          "SR1A: fully out-of-footprint file returns empty, no raise")
    mv_other = tmp / "modiv_atlantic.txt"
    mv_other.write_text(modiv_line(muncode="0101"))
    check(len(nc.parse_modiv_file(mv_other, nc.TARGET_COUNTY_CODES)) == 0,
          "MOD-IV: fully out-of-footprint file returns empty, no raise")
    r = df.iloc[0]
    check(r["muncode"] == "1305", "SR1A: muncode assembled")
    check(r["block"] == "123" and r["lot"] == "4", "SR1A: block/lot stripped")
    check(r["sale_price"] == 500000, "SR1A: verified price wins")
    check(str(r["sale_date"])[:10] == "2024-03-15", "SR1A: deed date parsed")
    check(pd.isna(r["nu_code"]), "SR1A: blank NU -> NaN (usable)")
    check(df.iloc[1]["nu_code"] == 10, "SR1A: NU code 010 -> 10")
    check(r["grantee_name"] == "ACME HOMES LLC", "SR1A: grantee name")

    mv = tmp / "modiv_test.txt"
    mv.write_text("\n".join([
        modiv_line(),
        modiv_line(muncode="1305", block="200", lot="7", loc="9 ELM AVENUE",
                   owner="SMITH, ALICE EXECUTRIX"),
    ]))
    dm = nc.parse_modiv_file(mv)
    check(len(dm) == 2, "MOD-IV: 2 records parsed")
    check(dm.iloc[0]["pin"] == "1305_123_4", "MOD-IV: pin built")
    check(dm.iloc[0]["owner_name"] == "DOE, JANE", "MOD-IV: owner name")
    check(dm.iloc[0]["net_value"] == 300000, "MOD-IV: net value")

    bad = tmp / "bad.txt"
    bad.write_text("GARBAGE" * 100 + "\n" + "XX" * 400)
    try:
        nc.parse_sr1a_file(bad)
        raised = False
    except RuntimeError:
        raised = True
    check(raised, "SR1A: layout drift raises loudly")


def test_normalizers():
    print("\n[2] normalizers")
    na = nc.normalize_address
    check(na("956 Myrtle Ave # 60") == "956 MYRTLE AVE",
          "address: unit '# 60' stripped")
    check(na("9 Elm Avenue") == na("9 ELM AVE"), "address: AVENUE == AVE")
    check(na("15 North Oak Street Apt 2B") == "15 N OAK ST",
          "address: directional + suffix + APT")
    check(nc.house_number("123 MAIN ST") == "123", "house number")
    check(nc.street_key("123 W MAIN ST") == "MAIN", "street key skips direction")
    check(nc.same_owner("Doe", "", "DOE, JANE") is True, "owner: same surname")
    check(nc.same_owner("Doe", "", "GARCIA, LUIS") is False, "owner: changed")
    check(nc.same_owner("Doe", "", "") is None, "owner: blank -> None")
    check(nc.same_owner("Doe", "", "REDACTED") is None, "owner: redacted")
    check(nc.is_entity("ACME HOMES LLC"), "entity regex: LLC")
    check(not nc.is_entity("DOE, JANE"), "entity regex: person")


def make_master() -> pd.DataFrame:
    rows = [
        # A: sold arm's-length since 2020
        dict(pkey="15 OAK ST|HAZLET", addr="15 Oak St", city="Hazlet",
             zipc="07730", first="Jane", last="Doe", county="Monmouth"),
        # B: estate/NU-10 sale -> inheritance cohort
        dict(pkey="9 ELM AVE|HAZLET", addr="9 Elm Avenue", city="Hazlet",
             zipc="07730", first="Carl", last="Smith", county="Monmouth"),
        # C: owner changed, no recorded sale -> inheritance cohort
        dict(pkey="4 PINE CT|EDISON", addr="4 Pine Ct", city="Edison",
             zipc="08817", first="Raj", last="Patel", county="Middlesex"),
        # D: same owner
        dict(pkey="8 BIRCH RD|UNION", addr="8 Birch Rd", city="Union",
             zipc="07083", first="Maria", last="Lopez", county="Union"),
        # E: no parcel match anywhere
        dict(pkey="1 GHOST WAY|NOWHERE", addr="1 Ghost Way", city="Nowhere",
             zipc="00000", first="No", last="Match", county="Hudson"),
        # F: ambiguous in county, disambiguated by owner zip
        dict(pkey="5 MAIN ST|FREEHOLD", addr="5 Main St", city="Freehold",
             zipc="07728", first="Ann", last="Kim", county="Monmouth"),
        # G: matched, no sale, owner name blank (statewide redaction)
        dict(pkey="7 CEDAR LN|HAZLET", addr="7 Cedar Ln", city="Hazlet",
             zipc="07730", first="Omar", last="Haddad", county="Monmouth"),
    ]
    m = pd.DataFrame({
        "pkey": [r["pkey"] for r in rows],
        "Property Address": [r["addr"] for r in rows],
        "Property City": [r["city"] for r in rows],
        "Property Zip Code": [r["zipc"] for r in rows],
        "First Name": [r["first"] for r in rows],
        "Last Name": [r["last"] for r in rows],
        "Owner 2": "",
        "Owner Address": [r["addr"] for r in rows],
        "Owner City": [r["city"] for r in rows],
        "Owner State": "NJ",
        "Owner Zip Code": [r["zipc"] for r in rows],
        "County": [r["county"] for r in rows],
        "Sources": ["Vacancy", "Inherited", "Inherited", "High Equity",
                    "Vacancy", "Vacancy + Inherited", "High Equity"],
        "SourceCount": [1, 1, 1, 1, 1, 2, 1],
        "Tier": ["A", "A", "A", "B", "A", "A", "A"],
        "PriorityScore": [60.0, 70.0, 65.0, 40.0, 60.0, 80.0, 55.0],
    })
    return m


def test_pipeline(tmp: Path):
    print("\n[3] match + resolve")
    mv = tmp / "modiv_pipe.txt"
    mv.write_text("\n".join([
        modiv_line(),                                             # A
        modiv_line(block="200", lot="7", loc="9 ELM AVENUE",
                   owner="SMITH, ALICE"),                         # B
        modiv_line(muncode="1205", block="30", lot="2",
                   loc="4 PINE COURT", owner="NGUYEN, MINH",
                   ozip="088170000"),                             # C new owner
        modiv_line(muncode="2015", block="44", lot="1",
                   loc="8 BIRCH ROAD", owner="LOPEZ, MARIA",
                   ozip="070830000"),                             # D same owner
        modiv_line(muncode="1310", block="9", lot="9",
                   loc="5 MAIN ST", owner="OTHER, GUY",
                   ozip="999990000"),                             # F decoy
        modiv_line(muncode="1311", block="8", lot="8",
                   loc="5 MAIN ST", owner="KIM, ANN",
                   ozip="077280000"),                             # F real
        modiv_line(muncode="1305", block="500", lot="3",
                   loc="7 CEDAR LANE", owner="",
                   ozip="077300000"),                             # G no name
    ]))
    modiv = nc.parse_modiv_file(mv)

    sr = tmp / "sr1a_pipe.txt"
    sr.write_text("\n".join([
        sr1a_line(),                                              # A usable
        sr1a_line(block="200", lot="7", nu="010", deed="230710",
                  grantee="SMITH, ALICE", price=1),               # B estate
    ]))
    sr1a = nc.parse_sr1a_file(sr)
    master = make_master()

    matched = s02.match_addresses(master, modiv)
    got = dict(zip(matched["pkey"], matched["match_method"]))
    check(got["15 OAK ST|HAZLET"] == "exact_unique", "match: exact unique")
    check(got["9 ELM AVE|HAZLET"] == "exact_unique",
          "match: AVENUE vs AVE normalized")
    check(got["1 GHOST WAY|NOWHERE"] == "unmatched", "match: ghost unmatched")
    check(got["5 MAIN ST|FREEHOLD"] == "exact_zip",
          "match: county-ambiguous resolved by owner zip")

    resolved = s02.resolve_status(matched, sr1a)
    st = dict(zip(resolved["pkey"], resolved["status"]))
    co = dict(zip(resolved["pkey"], resolved["cohort"]))
    check(st["15 OAK ST|HAZLET"] == "SOLD_ARMS_LENGTH", "status: sold arm's")
    check(st["9 ELM AVE|HAZLET"] == "SOLD_NON_USABLE", "status: NU sale")
    check(co["9 ELM AVE|HAZLET"] == "INHERITANCE", "cohort: estate NU-10")
    check(st["4 PINE CT|EDISON"] == "OWNER_CHANGED_NO_SALE",
          "status: owner changed no sale")
    check(co["4 PINE CT|EDISON"] == "INHERITANCE", "cohort: person xfer")
    check(st["8 BIRCH RD|UNION"] == "SAME_OWNER", "status: same owner")
    check(st["1 GHOST WAY|NOWHERE"] == "UNRESOLVED", "status: unresolved")
    check(st["7 CEDAR LN|HAZLET"] == "NO_SALE_OWNER_UNVERIFIED",
          "status: matched + no sale + blank owner -> survivor, not dead end")
    check(resolved.loc[resolved["pkey"] == "15 OAK ST|HAZLET",
                       "sale_price"].iloc[0] == 500000, "sale price carried")

    print("\n[4] buyer harvest")
    big = pd.concat([sr1a] + [
        nc.parse_sr1a_file(sr)  # duplicate ACME purchases at new block/lots
        for _ in range(1)
    ])
    # 3 ACME purchases from one mailing address via distinct sales
    sr2 = tmp / "sr1a_buyers.txt"
    sr2.write_text("\n".join([
        sr1a_line(block=b, lot="1", deed=d)
        for b, d in [("301", "240101"), ("302", "240202"), ("303", "240303")]
    ]))
    buyers = s03.harvest(pd.concat([big, nc.parse_sr1a_file(sr2)],
                                   ignore_index=True))
    acme = buyers[buyers["top_name"].str.contains("ACME")]
    check(len(acme) == 1, "buyers: ACME shells collapsed to one cluster")
    check(int(acme["n_acquisitions"].iloc[0]) >= 3
          and bool(acme["verified_active"].iloc[0]),
          "buyers: 3+ acquisitions -> verified active")
    check(bool(acme["is_entity"].iloc[0]), "buyers: flagged entity")
    check((buyers["price_p50"] >= s03.MIN_PRICE).all(),
          "buyers: $1 family transfer excluded")

    print("\n[5] skip-trace export")
    upload = s04.build_upload(resolved)
    refs = set(upload["ref_id"])
    check("15 OAK ST|HAZLET" not in refs, "skiptrace: sold suppressed")
    check("1 GHOST WAY|NOWHERE" not in refs, "skiptrace: unresolved excluded")
    check({"9 ELM AVE|HAZLET", "4 PINE CT|EDISON",
           "8 BIRCH RD|UNION"} <= refs, "skiptrace: survivors present")
    unv = upload[upload["ref_id"] == "7 CEDAR LN|HAZLET"]
    check(len(unv) == 1 and unv.iloc[0]["last_name"] == "Haddad",
          "skiptrace: owner-unverified traced under list name")
    row = upload[upload["ref_id"] == "4 PINE CT|EDISON"].iloc[0]
    check(row["last_name"] == "NGUYEN",
          "skiptrace: CURRENT owner traced, not 2019 name")
    check(list(upload["cohort"])[:2] == ["INHERITANCE", "INHERITANCE"],
          "skiptrace: inheritance cohort sorted first")
    check(not any(c.lower().startswith("phone") for c in upload.columns),
          "skiptrace: no 2019 phone columns exported")

    print("\n[6] mail segments")
    vac = pd.DataFrame({"ref_id": ["8 BIRCH RD|UNION"], "vacant": ["true"]})
    segs = s05.build_segments(resolved, vac)
    al = segs["all"].set_index("ref_id")
    check(al.loc["5 MAIN ST|FREEHOLD", "segment"] == "S1",
          "mail: multi-list -> S1 (beats inheritance)"
          if al.loc["5 MAIN ST|FREEHOLD", "segment"] == "S1" else
          "mail: multi-list -> S1")
    check(al.loc["9 ELM AVE|HAZLET", "segment"] == "S2",
          "mail: inheritance -> S2")
    check(al.loc["8 BIRCH RD|UNION", "segment"] == "S3",
          "mail: DPV vacant (Tier B) -> S3")
    check(al.loc["1 GHOST WAY|NOWHERE", "segment"] == "S4",
          "mail: unresolved Tier A still mailed -> S4")
    check("15 OAK ST|HAZLET" not in al.index, "mail: sold suppressed")
    check(al.loc["7 CEDAR LN|HAZLET", "segment"] == "S4",
          "mail: owner-unverified Tier A mailed -> S4")
    check((al["endorsement"] == "Return Service Requested").all(),
          "mail: RSR endorsement on every piece")
    check(al.loc["4 PINE CT|EDISON", "mail_name"] == "Nguyen, Minh",
          "mail: addressed to CURRENT owner")


def test_scale():
    """Matcher at real scale: synthesize MOD-IV from the actual master."""
    pq = ROOT / "data/processed/master.parquet"
    if not pq.exists():
        print("\n[7] scale test skipped (run script 01 first)")
        return
    print("\n[7] matcher at 7,989-row scale (synthesized MOD-IV)")
    import time
    master = pd.read_parquet(pq)
    n = len(master)
    fake = pd.DataFrame({
        "muncode": "1305",
        "block": pd.Series(range(n)).astype(str),
        "lot": "1",
        "qual": "",
        "property_location": master["Property Address"]
        .astype(str).str.upper().str[:25],
        "owner_name": (master["Last Name"].astype(str) + ", "
                       + master["First Name"].astype(str)).str.upper(),
        "owner_address": "PO BOX 1", "owner_city": "TRENTON NJ",
        "owner_zip": master["Property Zip Code"].astype(str) + "0000",
        "net_value": 1.0, "sale_date": pd.NaT, "sale_price": 1.0,
    })
    fake["muncode"] = master["County"].astype(str).str.upper().map(
        nc.COUNTY_CODES).fillna("13") + "05"
    fake["pin"] = nc.make_pin(fake["muncode"], fake["block"], fake["lot"])
    t0 = time.time()
    matched = s02.match_addresses(master, fake)
    dt = time.time() - t0
    rate = (~matched["match_method"].isin(["unmatched", "ambiguous"])).mean()
    print(f"  match rate {rate:.1%} in {dt:.1f}s")
    check(rate >= 0.90, f"scale: >=90% auto-match target (got {rate:.1%})")
    check(dt < 120, f"scale: completes in reasonable time ({dt:.1f}s)")


def main():
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        test_parsers(tmp)
        test_normalizers()
        test_pipeline(tmp)
    test_scale()
    print(f"\nAll {PASS} checks passed.")


if __name__ == "__main__":
    main()
