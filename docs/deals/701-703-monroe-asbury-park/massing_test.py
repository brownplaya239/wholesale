#!/usr/bin/env python3
"""Conceptual massing + parking + land-residual test for 701-703 Monroe Ave,
Asbury Park NJ (Block 2608, Lot 7). Run: python massing_test.py

Tests 35/40/42-unit programs against a Community-Shopping-Zone-equivalent
envelope (the zoning 700 Monroe Ave across the street obtained via the 2021
Main Street Redevelopment Plan boundary amendment), plus the R-1 as-of-right
baseline. All figures are conceptual screens, not architecture.

Sources for constants are cited in DOSSIER.md. Anything marked ASSUMED is a
placeholder to refine with a survey / zoning determination letter.
"""

# ---------------------------------------------------------------- site facts
LOT_SF = 11_000            # county record via listing feeds (0.2525 ac)
FRONTAGE_FT = 73           # ASSUMED from 11,000 SF at a ~150 ft block depth
DEPTH_FT = 150             # ASSUMED - verify with survey/tax map sheet
ASK = 2_499_999            # MLS 22607142 list price (commercial feed)
ASSESSED_2024 = 560_600    # land 312,500 + impr 248,100; taxes $8,301
EXISTING_BLDG_SF = 3_648   # 1965 commercial bldg (class: misc commercial)

# ------------------------------------------------- CS-zone-equivalent envelope
# Pattern from 700 Monroe (56u/14,700 SF), 807 Summerfield (30u, 45 ft cap),
# 1201 Memorial "Braverman" (126u, 5 stories): ground parking podium + 4
# residential floors inside a ~45 ft plane, near-full-lot urban coverage.
COVERAGE = 0.82            # footprint share of lot after rear/side transition
STORIES_RES = 4            # residential floors over the podium
EFFICIENCY = 0.80          # net rentable / gross residential
PODIUM_CORE_SF = 1_300     # lobby, core, trash, bike (700 Monroe pattern)
RETAIL_SF = 900            # small corner retail, mirrors 700 Monroe's 1,087
SF_PER_STALL = 340         # one-way aisle podium layout, incl. circulation

# ------------------------------------------------------------- parking regimes
RSIS_MIDRISE = {"studio": 1.8, "br1": 1.8, "br2": 2.0, "br3": 2.1}
LOCAL_PRACTICE_PER_UNIT = 1.5   # 807 Summerfield: 45 req'd for 30 units
PLAN_STANDARD_PER_UNIT = 0.8    # 700 Monroe: ~44-45 base for 56 units
EV_REDUCTION_CAP = 0.10         # EV stalls count 2x, max 10% reduction

# ------------------------------------------------------------- residual screen
RENT_PSF_MO = 3.55         # ASSUMED west-of-Main new construction, blended
OPEX_RATIO = 0.38          # incl. full taxes; PILOT sensitivity below
PILOT_OPEX_RATIO = 0.29    # 30-yr PILOT ~ 10-12% of EGI (900-904 Springwood)
VACANCY = 0.05
CAP_RATE = 0.0535
HARD_PSF_RES = 250         # wood-frame floors over podium, 2026 NJ shore
HARD_PSF_PODIUM = 115      # ground-level structured parking + shell retail
SOFT_PCT = 0.20            # of hard; incl. A&E, legal, fees, carry
ENTITLE_PROB = 0.40        # odds Council amends the plan for this site
ENTITLE_YEARS = 2.0        # petition -> ordinance -> site plan
DISCOUNT = 0.15            # annual risk discount on the entitled outcome
AFFORDABLE_SHARE = 0.20    # 11/56 at 700 Monroe, 26/126 at Braverman
AFFORDABLE_RENT_DISCOUNT = 0.45  # affordable rents ~55% of market blended

UNIT_MIXES = {  # (studio, 1BR, 2BR) chosen to fit floorplate at each count
    42: (10, 22, 10),
    40: (8, 22, 10),
    35: (4, 19, 12),
}


def massing(units: int) -> dict:
    footprint = LOT_SF * COVERAGE
    res_gsf = footprint * STORIES_RES
    gsf_per_unit = res_gsf / units
    nsf_per_unit = gsf_per_unit * EFFICIENCY

    podium_park_sf = footprint - PODIUM_CORE_SF - RETAIL_SF
    podium_stalls = int(podium_park_sf // SF_PER_STALL)

    s, b1, b2 = UNIT_MIXES[units]
    assert s + b1 + b2 == units
    rsis = s * RSIS_MIDRISE["studio"] + b1 * RSIS_MIDRISE["br1"] + b2 * RSIS_MIDRISE["br2"]
    local = units * LOCAL_PRACTICE_PER_UNIT
    plan = units * PLAN_STANDARD_PER_UNIT
    plan_after_ev = plan * (1 - EV_REDUCTION_CAP)

    return {
        "units": units,
        "mix": f"{s}st/{b1}x1BR/{b2}x2BR",
        "footprint_sf": round(footprint),
        "res_gsf": round(res_gsf),
        "gsf_unit": round(gsf_per_unit),
        "nsf_unit": round(nsf_per_unit),
        "podium_stalls": podium_stalls,
        "rsis": round(rsis),
        "local": round(local),
        "plan": round(plan),
        "plan_ev": round(plan_after_ev),
        "shortfall_plan": max(0, round(plan_after_ev) - podium_stalls),
        "shortfall_local": max(0, round(local) - podium_stalls),
    }


def residual(units: int, pilot: bool) -> dict:
    m = massing(units)
    market_u = round(units * (1 - AFFORDABLE_SHARE))
    afford_u = units - market_u
    nsf = m["res_gsf"] * EFFICIENCY
    nsf_u = nsf / units
    gpr = (market_u + afford_u * (1 - AFFORDABLE_RENT_DISCOUNT)) * nsf_u * RENT_PSF_MO * 12
    gpr += RETAIL_SF * 30  # retail at ~$30/SF/yr NNN-ish contribution
    egi = gpr * (1 - VACANCY)
    noi = egi * (1 - (PILOT_OPEX_RATIO if pilot else OPEX_RATIO))
    value = noi / CAP_RATE

    hard = m["res_gsf"] * HARD_PSF_RES + LOT_SF * COVERAGE * HARD_PSF_PODIUM
    tdc_ex_land = hard * (1 + SOFT_PCT)
    resid = value - tdc_ex_land
    return {"units": units, "value": value, "tdc": tdc_ex_land,
            "residual": resid, "per_unit": resid / units, "pilot": pilot}


def fmt_money(x: float) -> str:
    return f"${x/1e6:,.2f}M" if abs(x) >= 1e6 else f"${x:,.0f}"


if __name__ == "__main__":
    print(f"Site: 11,000 SF | ask {fmt_money(ASK)} "
          f"({ASK/LOT_SF:.0f}/SF land) | assessed {fmt_money(ASSESSED_2024)}")
    print(f"Benchmark: 700 Monroe = 56u on 14,700 SF "
          f"-> {56/14_700*43_560:.0f} u/ac; subject at that density = "
          f"{56/14_700*LOT_SF:.1f} units\n")

    hdr = ("units mix            ftprint resGSF GSF/u NSF/u podium "
           "RSIS local plan(EV) short(plan/local)")
    print(hdr); print("-" * len(hdr))
    for u in (35, 40, 42):
        m = massing(u)
        print(f"{m['units']:>5} {m['mix']:<14} {m['footprint_sf']:>7,} "
              f"{m['res_gsf']:>6,} {m['gsf_unit']:>5} {m['nsf_unit']:>5} "
              f"{m['podium_stalls']:>6} {m['rsis']:>4} {m['local']:>5} "
              f"{m['plan']:>3}({m['plan_ev']}) "
              f"{m['shortfall_plan']:>5}/{m['shortfall_local']}")

    print("\nR-1 as-of-right baseline: 1 single-family dwelling "
          "(+ possible ADU under the 2024-25 ADU ordinances). "
          "35-42 units requires d(1)/d(5)-type relief the ZBA cannot "
          "realistically grant at this scale; the viable path is the same "
          "Council plan-amendment 700 Monroe used.")

    print("\nLand residual (entitled scenario, 20% affordable):")
    for u in (35, 40, 42):
        for pilot in (False, True):
            r = residual(u, pilot)
            tag = "w/ 30-yr PILOT" if pilot else "conventional tax"
            print(f"  {u}u {tag:<16} value {fmt_money(r['value']):>8} "
                  f"TDC-ex-land {fmt_money(r['tdc']):>8} "
                  f"residual {fmt_money(r['residual']):>9} "
                  f"({fmt_money(r['per_unit'])}/u)")

    best = residual(42, True)["residual"]
    conv = residual(42, False)["residual"]
    risk_adj = max(
        ASSESSED_2024,  # as-is floor: annual-reassessment market value
        ENTITLE_PROB * best / (1 + DISCOUNT) ** ENTITLE_YEARS
        + (1 - ENTITLE_PROB) * ASSESSED_2024,
    )
    print(f"\nScreen vs {fmt_money(ASK)} ask")
    print(f"  entitled 42u + PILOT residual (best case) : {fmt_money(best)}")
    print(f"  entitled 42u, conventional taxes          : {fmt_money(conv)}")
    print(f"  risk-adjusted today ({ENTITLE_PROB:.0%} entitle odds,"
          f" {ENTITLE_YEARS:.0f} yr, {DISCOUNT:.0%} disc)     : "
          f"{fmt_money(risk_adj)}")
    print(f"  ask / risk-adjusted                       : "
          f"{ASK / risk_adj:.1f}x")
    print("  NOTE: rents +/-$0.15 PSF/mo move the entitled residual by "
          "roughly +/-$0.8-0.9M; treat bands, not points.")
