"""Shared pieces for the acquisition machine: BatchLeads / Land Portal pulls ->
clean universe -> capacity-driven waves -> GoHighLevel (see
docs/ACQUISITION_SYSTEM.md).

Vendor export layouts are NOT documented publicly and drift, so nothing here
hard-codes a column name. Every canonical field has an alias list matched on
a normalized header (lowercase, alphanumerics only); phone groups are
detected by pattern ("Phone 1", "Phone 1 Type", "Mobile 2 DNC", ...).
`09_acq_ingest.py inspect FILE` prints exactly how a file maps — run it on
the first real export of each provider and extend ALIASES if a field lands
in "unmapped".
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, time, timedelta
from pathlib import Path

import pandas as pd

from nj_common import PROCESSED, ROOT, is_entity, normalize_address

ACQ = PROCESSED / "acq"
RAW_ACQ = ROOT / "data/raw/acq"
SCRUB_DIR = ACQ / "scrub"
MANIFEST = RAW_ACQ / "manifest.csv"
COMPLIANCE = ROOT / "compliance"

# ------------------------------------------------------------------ cohorts --
# key -> asset, GHL label, base score, flag the query itself guarantees,
# minimum equity % below which the record is not a deal (None = no check).
COHORTS: dict[str, dict] = {
    "vacant_equity":     dict(asset="residential", label="Vacant + equity", base=25, flag="vacant", min_equity=10),
    "tax_delinquent":    dict(asset="residential", label="Tax delinquent", base=25, flag="tax_delinquent", min_equity=10),
    "absentee_landlord": dict(asset="residential", label="Absentee / tired landlord", base=15, flag="absentee", min_equity=10),
    "inherited":         dict(asset="residential", label="Inherited / estate", base=25, flag="inherited", min_equity=10),
    "preforeclosure":    dict(asset="residential", label="Preforeclosure", base=30, flag="preforeclosure", min_equity=10),
    "free_clear":        dict(asset="residential", label="Free & clear", base=15, flag="free_clear", min_equity=10),
    "other_distress":    dict(asset="residential", label="Other distress", base=20, flag="code_violation", min_equity=10),
    "land_infill":       dict(asset="land", label="Land: infill 0.10-2 ac", base=15, flag=None, min_equity=None),
    "land_acreage":      dict(asset="land", label="Land: 2-10 ac", base=15, flag=None, min_equity=None),
    "land_strategic":    dict(asset="land", label="Land: strategic", base=20, flag=None, min_equity=None),
    "mpower_2019":       dict(asset="residential", label="M-Power 2019 (resolved)", base=10, flag=None, min_equity=None),
}
PROVIDERS = {"batchleads": "BatchLeads", "landportal": "Land Portal",
             "skiptrace": "Skip-trace return", "mpower": "M-Power 2019"}

# The county allocation for the first 4,000 homes (reporting only — the
# pull itself happens in BatchLeads).
COUNTY_TARGETS = {"CAMDEN": 700, "MERCER": 500, "OCEAN": 500, "ATLANTIC": 400,
                  "MONMOUTH": 400, "CUMBERLAND": 350, "BURLINGTON": 350,
                  "GLOUCESTER": 300, "ESSEX": 300, "MIDDLESEX": 200}

DISTRESS = ("vacant", "tax_delinquent", "preforeclosure", "inherited", "code_violation")
FLAGS = DISTRESS + ("absentee", "free_clear", "owner_occupied")

LAND_RULES = dict(max_wetlands=20.0, max_wetlands_infill=10.0, max_flood_pct=50.0,
                  max_slope=15.0, infill_acres=(0.10, 2.0), acreage_acres=(2.0, 10.0))
RECENT_SALE_MONTHS = 12

# ----------------------------------------------------------- column aliases --
def norm_header(h: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(h).lower())


ALIASES: dict[str, list[str]] = {
    "property_address": ["propertyaddress", "address", "situsaddress", "siteaddress",
                         "propertystreetaddress", "streetaddress", "propertystreet",
                         "parceladdress", "situsfulladdress"],
    "property_city": ["propertycity", "city", "situscity", "sitecity", "parcelcity"],
    "property_state": ["propertystate", "state", "situsstate", "sitestate"],
    "property_zip": ["propertyzip", "propertyzipcode", "zip", "zipcode", "situszip",
                     "sitezip", "situszipcode", "propertypostalcode"],
    "county": ["county", "propertycounty", "countyname", "situscounty"],
    "municipality": ["municipality", "township", "taxdistrict", "jurisdiction"],
    "apn": ["apn", "parcelnumber", "parcelid", "parcel", "parcelapn", "apnnumber",
            "apnformatted", "taxid"],
    "block": ["block", "taxblock"],
    "lot": ["lot", "taxlot"],
    "property_type": ["propertytype", "landuse", "usetype", "propertyuse",
                      "landusedescription", "propertyclass"],
    "units": ["units", "numberofunits", "unitscount", "unitcount", "numunits"],
    "beds": ["bedrooms", "beds", "bedroomcount", "totalbedrooms"],
    "baths": ["bathrooms", "baths", "bathroomcount", "totalbathrooms"],
    "sqft": ["squarefootage", "sqft", "buildingsqft", "livingsqft", "livingarea",
             "buildingarea", "livingareasqft", "buildingsquarefeet"],
    "lot_acres": ["lotsizeacres", "acres", "acreage", "lotacres", "lotacreage",
                  "calculatedacres", "gisacres", "parcelacres"],
    "lot_sqft": ["lotsizesqft", "lotsqft", "lotsquarefeet", "lotsize"],
    "year_built": ["yearbuilt", "effectiveyearbuilt"],
    "est_value": ["estimatedvalue", "estvalue", "avm", "marketvalue",
                  "estimatedmarketvalue", "avmvalue", "estimatedpropertyvalue",
                  "totalmarketvalue"],
    "mortgage_balance": ["estimatedmortgagebalance", "mortgagebalance", "totalloanbalance",
                         "openmortgagebalance", "loanbalance", "estimatedloanbalance",
                         "totalopenloanbalance", "openloanbalance"],
    "equity_pct": ["equitypercent", "estimatedequitypercent", "equitypct",
                   "equitypercentage", "equity"],
    "equity_amount": ["estimatedequity", "equityamount", "equityvalue", "estimatedequityamount"],
    "ltv": ["ltv", "loantovalue", "estimatedltv", "loantovalueratio"],
    "last_sale_date": ["lastsaledate", "saledate", "lastsolddate", "lasttransferdate",
                       "lastsalerecordingdate", "lastmarketsaledate"],
    "last_sale_price": ["lastsaleprice", "saleprice", "lastsoldprice", "lastsaleamount",
                        "lastmarketsaleprice"],
    "owner_occupied": ["owneroccupied", "isowneroccupied", "owneroccupancy"],
    "vacant": ["vacant", "vacancy", "isvacant", "propertyvacant", "vacantflag",
               "uspsvacant", "vacantindicator"],
    "absentee": ["absentee", "absenteeowner", "nonowneroccupied", "isabsentee"],
    "tax_delinquent": ["taxdelinquent", "taxdefault", "delinquenttax", "taxdelinquency",
                       "taxdelinquentflag", "taxlien"],
    "preforeclosure": ["preforeclosure", "foreclosure", "lispendens", "noticeofdefault",
                       "foreclosurestatus", "inforeclosure", "preforeclosureflag"],
    "inherited": ["inherited", "probate", "deceasedowner", "ownerdeceased",
                  "inheritedflag", "estate", "probateflag"],
    "free_clear": ["freeandclear", "freeclear", "freeclearflag", "freeandclearflag"],
    "code_violation": ["codeviolation", "codeviolations", "violations"],
    "mls_status": ["mlsstatus", "listingstatus", "mlslistingstatus", "listedstatus"],
    "wetlands_pct": ["wetlands", "wetlandspercent", "wetlandcoverage", "wetlandspct",
                     "percentwetlands", "wetlandpercent", "wetlandspercentage"],
    "flood_zone": ["floodzone", "femafloodzone", "fldzone", "femazone"],
    "flood_pct": ["floodpercent", "floodzonepercent", "percentinfloodzone",
                  "floodcoverage", "floodplainpercent", "floodzonecoverage"],
    "road_frontage": ["roadfrontage", "frontage", "roadfrontageft", "frontageft",
                      "roadfrontagefeet"],
    "landlocked": ["landlocked", "islandlocked"],
    "road_access": ["roadaccess", "hasroadaccess"],
    "slope_pct": ["slope", "slopepercent", "averageslope", "avgslope", "slopepct"],
    "owner_full": ["ownername", "owner", "owner1name", "owner1fullname", "ownerfullname",
                   "owner1", "fullname"],
    "owner_first": ["firstname", "ownerfirstname", "owner1firstname"],
    "owner_last": ["lastname", "ownerlastname", "owner1lastname"],
    "owner2_full": ["owner2name", "owner2fullname", "owner2"],
    "mailing_address": ["mailingaddress", "owneraddress", "mailaddress",
                        "mailingstreetaddress", "ownermailingaddress", "mailingstreet"],
    "mailing_city": ["mailingcity", "ownercity", "mailcity", "ownermailingcity"],
    "mailing_state": ["mailingstate", "ownerstate", "mailstate", "ownermailingstate"],
    "mailing_zip": ["mailingzip", "mailingzipcode", "ownerzip", "ownerzipcode", "mailzip",
                    "ownermailingzip", "mailingpostalcode"],
    "litigator": ["litigator", "litigatorflag", "islitigator", "tcpalitigator"],
}
_ALIAS_INDEX = {a: canon for canon, al in ALIASES.items() for a in al}

PHONE_HDR = re.compile(
    r"^(?:owner|contact)?(phone|mobile|cell|wireless|landline|voip)(?:phone)?"
    r"(?:number|num|no)?(\d{0,2})"
    r"(type|linetype|phonetype|dnc|dncflag|donotcall|litigator|status|lastseen|"
    r"lastseendate|carrier)?$")
EMAIL_HDR = re.compile(r"^(?:owner|contact)?email(?:address)?(\d{0,2})$")


def map_columns(columns) -> dict:
    """{'fields': {canon: header}, 'phones': {idx: {attr: header}},
        'emails': [headers], 'unmapped': [headers]}"""
    fields, phones, emails, unmapped = {}, {}, [], []
    for col in columns:
        h = norm_header(col)
        m = PHONE_HDR.match(h)
        if m and not (h in _ALIAS_INDEX):
            base, idx, attr = m.group(1), m.group(2) or "1", m.group(3) or "number"
            if attr in ("linetype", "phonetype"):
                attr = "type"
            if attr in ("dncflag", "donotcall"):
                attr = "dnc"
            if attr == "lastseendate":
                attr = "lastseen"
            key = f"{base}{idx}" if base != "phone" else idx
            g = phones.setdefault(key, {"base": base})
            g.setdefault(attr, col)
            continue
        m = EMAIL_HDR.match(h)
        if m:
            emails.append(col)
            continue
        canon = _ALIAS_INDEX.get(h)
        if canon and canon not in fields:
            fields[canon] = col
        else:
            unmapped.append(col)
    # a group with only attributes and no number column is not a phone
    phones = {k: v for k, v in phones.items() if "number" in v}
    return {"fields": fields, "phones": phones, "emails": emails, "unmapped": unmapped}


# ------------------------------------------------------------- normalizers --
_TRUE = {"y", "yes", "true", "t", "1", "x"}
_FALSE = {"n", "no", "false", "f", "0", ""}


def to_bool(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip().lower()
    if s in _TRUE:
        return True
    if s in _FALSE:
        return False
    # "Vacant" / "Pre-Foreclosure" / a dollar amount in a flag column = yes
    return True


def to_num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = re.sub(r"[,$%\s]", "", str(v))
    try:
        return float(s)
    except ValueError:
        return None


def to_date(v):
    if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
        return None
    d = pd.to_datetime(str(v), errors="coerce")
    return None if pd.isna(d) else d.date()


def normalize_phone(v) -> str | None:
    """10-digit NANP string or None. Rejects N11 / 555-01xx / invalid NPA-NXX."""
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    d = re.sub(r"\D", "", str(v).split(".")[0] if re.fullmatch(r"\d+\.0", str(v)) else str(v))
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    if len(d) != 10:
        return None
    npa, nxx = d[:3], d[3:6]
    if npa[0] in "01" or nxx[0] in "01" or npa[1:] == "11" or nxx[1:] == "11":
        return None
    if nxx == "555" and d[6:8] == "01":
        return None
    return d


def phone_type(raw, base: str) -> str:
    s = str(raw or "").strip().lower()
    if base in ("mobile", "cell", "wireless") or any(k in s for k in ("mobile", "cell", "wireless")):
        return "mobile"
    if base == "landline" or "land" in s or "residential" in s:
        return "landline"
    if base == "voip" or "voip" in s:
        return "voip"
    return "unknown"


def norm_name(s) -> str:
    return re.sub(r"[^A-Z0-9 ]", "", str(s or "").upper()).strip()


def split_name(full: str) -> tuple[str, str]:
    """'SMITH JOHN A' / 'Smith, John' / 'John Smith' -> (first, last). Entities
    return ('', NAME). Vendor exports are usually 'First Last' or split."""
    s = re.sub(r"\s+", " ", str(full or "")).strip()
    if not s:
        return "", ""
    if is_entity(s):
        return "", s
    s = re.split(r"\s+(?:&|AND)\s+", s, flags=re.I)[0]
    if "," in s:
        last, _, first = s.partition(",")
        return first.strip().split(" ")[0].title(), last.strip().title()
    toks = s.split(" ")
    if len(toks) == 1:
        return "", toks[0].title()
    if s.isupper():  # assessor style: SURNAME FIRST MIDDLE
        return toks[1].title(), toks[0].title()
    return toks[0].title(), toks[-1].title()


def owner_type(full: str) -> str:
    u = str(full or "").upper()
    if re.search(r"\b(ESTATE|EST OF|HEIRS|DECEASED)\b", u):
        return "Estate"
    if re.search(r"\b(TRUST|TRUSTEE|TR)\b", u):
        return "Trust"
    if is_entity(u):
        return "Entity"
    return "Individual"


def norm_county(v) -> str:
    s = str(v or "").upper().replace(" COUNTY", "").strip()
    return re.sub(r"[^A-Z ]", "", s)


def stable_id(*parts) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


# ------------------------------------------------- calling hours & lanes --
# Internal calling policy (deliberately tighter than federal 8am-9pm so one
# rule clears every state rule we know of — FL/OK 8pm, TX 9am, Sunday bans):
#   Mon-Sat, 9:00-20:00 in the called party's local time, no Sundays, no
#   federal holidays. Location proxy = mailing state (cells are portable).
CALL_START, CALL_END = 9, 20

ET, CT, MT, AZ, PT = ("America/New_York", "America/Chicago", "America/Denver",
                      "America/Phoenix", "America/Los_Angeles")
AKT, HST, ADAK = "America/Anchorage", "Pacific/Honolulu", "America/Adak"
_ET_ONLY = "CT DE DC GA ME MD MA NH NJ NY NC OH PA RI SC VT VA WV".split()
_CT_ONLY = "AL AR IL IA LA MN MS MO OK WI".split()
STATE_ZONES: dict[str, tuple[str, ...]] = {
    **{s: (ET,) for s in _ET_ONLY}, **{s: (CT,) for s in _CT_ONLY},
    # states that span two zones: the call must be inside the window in BOTH
    **{s: (ET, CT) for s in "FL IN KY MI TN".split()},
    **{s: (CT, MT) for s in "KS NE ND SD TX".split()},
    **{s: (MT,) for s in "CO MT NM UT WY".split()}, "AZ": (AZ,),
    **{s: (MT, PT) for s in "ID OR NV".split()}, **{s: (PT,) for s in "CA WA".split()},
    "AK": (AKT, ADAK), "HI": (HST,), "PR": ("America/Puerto_Rico",),
    "VI": ("America/St_Thomas",), "GU": ("Pacific/Guam",),
}

# States whose own telemarketing statutes reach beyond federal TCPA for
# automated dialing (FL FTSA, OK OTSA, MD Stop the Spam Calls Act). Their
# residents are never put in the multi-line queue: manual lane only.
STRICT_STATES = {"FL", "OK", "MD"}
STRICT_AREA_CODES = {
    # FL (incl. overlays)
    "239", "305", "321", "324", "352", "386", "407", "448", "561", "645", "656",
    "689", "727", "728", "754", "772", "786", "813", "850", "863", "904", "941", "954",
    # OK
    "405", "539", "572", "580", "918",
    # MD
    "227", "240", "301", "410", "443", "667",
}

US_FEDERAL_HOLIDAYS_FIXED = {(1, 1), (6, 19), (7, 4), (11, 11), (12, 25)}


def zones_for(state: str | None) -> tuple[str, ...]:
    return STATE_ZONES.get(str(state or "").upper().strip(), ())


def _zone(name: str):
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(name)
    except Exception as e:  # Windows without the tzdata package
        raise SystemExit(f"timezone data missing ({e}) — pip install tzdata") from e


def window_et(zones: tuple[str, ...], on: date) -> tuple[float, float] | None:
    """The policy window expressed on the CALLER's clock (ET hours, float),
    intersected across every zone the owner might be in; None if empty."""
    if not zones:
        return None
    et = _zone(ET)
    starts, ends = [], []
    for z in zones:
        tz = _zone(z)
        for hour, bucket in ((CALL_START, starts), (CALL_END, ends)):
            local = datetime.combine(on, time(hour), tzinfo=tz).astimezone(et)
            # ET hour-of-day; local times that land on the next ET day add 24
            day_shift = (local.date() - on).days * 24
            bucket.append(local.hour + local.minute / 60 + day_shift)
    s, e = max(starts), min(ends)
    return (s, e) if e > s else None


def window_label(w: tuple[float, float] | None) -> str:
    if not w:
        return "Manual check"

    def fmt(h: float) -> str:
        hh = int(h) % 24
        suffix = "a" if hh < 12 else "p"
        h12 = hh % 12 or 12
        mins = int(round((h - int(h)) * 60))
        return f"{h12}{':%02d' % mins if mins else ''}{suffix}"

    return f"{fmt(w[0])}-{fmt(w[1])} ET"


def strict_reason(mailing_state: str | None, phones: list[str]) -> str | None:
    st = str(mailing_state or "").upper()
    if st in STRICT_STATES:
        return f"mailing state {st} (state telemarketing statute)"
    bad = [p for p in phones if p[:3] in STRICT_AREA_CODES]
    if bad:
        return f"area code {bad[0][:3]} (state telemarketing statute)"
    return None


# ------------------------------------------------------------- scrub state --
SCRUB_VALID_DAYS = 31  # 16 CFR 310.4(b)(3)(iv) / 47 CFR 64.1200(c)(2)(i)(D)


def load_scrubs(scrub_dir: Path | None = None) -> pd.DataFrame:
    """Latest scrub result per phone from every file in data/processed/acq/scrub/.
    Expected columns (any casing): phone, status (clean|dnc|litigator|invalid
    — 'federal dnc'/'state dnc'/'wireless' etc. are mapped), scrub_date.
    Files without a scrub_date column take the date in their file name
    (YYYY-MM-DD) or their modification date."""
    scrub_dir = scrub_dir or SCRUB_DIR
    rows = []
    if scrub_dir.exists():
        for f in sorted(scrub_dir.glob("*.csv")):
            df = pd.read_csv(f, dtype=str)
            low = {norm_header(c): c for c in df.columns}
            pc = next((low[k] for k in ("phone", "phonenumber", "number", "telephone") if k in low), None)
            sc = next((low[k] for k in ("status", "result", "dncstatus", "scrubstatus") if k in low), None)
            dc = next((low[k] for k in ("scrubdate", "date", "scrubbedat") if k in low), None)
            if pc is None or sc is None:
                raise SystemExit(f"{f}: scrub file needs phone + status columns")
            m = re.search(r"(\d{4}-\d{2}-\d{2})", f.name)
            fallback = (date.fromisoformat(m.group(1)) if m
                        else date.fromtimestamp(f.stat().st_mtime))
            for _, r in df.iterrows():
                p = normalize_phone(r[pc])
                if not p:
                    continue
                rows.append({"phone": p, "status": scrub_status(r[sc]),
                             "scrub_date": to_date(r[dc]) if dc else fallback,
                             "scrub_file": f.name})
    out = pd.DataFrame(rows, columns=["phone", "status", "scrub_date", "scrub_file"])
    if out.empty:
        return out
    out["scrub_date"] = out["scrub_date"].fillna(date.min)
    return out.sort_values("scrub_date").drop_duplicates("phone", keep="last")


def scrub_status(v) -> str:
    s = str(v or "").strip().lower()
    if "litig" in s or "tcpa" in s:
        return "litigator"
    if "dnc" in s or "do not call" in s or "blocked" in s or s in ("federal", "state", "dncl"):
        return "dnc"
    if "invalid" in s or "disconnect" in s or "bad" in s:
        return "invalid"
    if s in ("clean", "ok", "callable", "pass", "clear", "good", "not on list", "safe"):
        return "clean"
    return "unknown"


def load_internal_dnc() -> set[str]:
    """Every number that ever opted out — compliance/optouts.csv (2019 list
    era) + data/processed/acq/internal_dnc.csv (exported from the CRM
    middleware, /api/admin/acq/dnc). Never re-dialed, ever."""
    out: set[str] = set()
    for p in (COMPLIANCE / "optouts.csv", ACQ / "internal_dnc.csv"):
        if p.exists():
            df = pd.read_csv(p, dtype=str)
            for c in df.columns:
                if "phone" in c.lower() or "number" in c.lower():
                    out |= {n for n in df[c].map(normalize_phone) if n}
    return out


def append_scrub_log(source: str, n_records: int, n_suppressed: int, path: Path) -> None:
    COMPLIANCE.mkdir(parents=True, exist_ok=True)
    log = COMPLIANCE / "scrub_log.csv"
    h = hashlib.sha256(path.read_bytes()).hexdigest()[:16] if path.exists() else ""
    row = {"date": date.today().isoformat(), "source": source, "n_records": n_records,
           "n_suppressed": n_suppressed, "file_hash": h, "file": path.name}
    if log.exists() and log.stat().st_size:
        # append-only: match the header already in the file (05 creates it
        # without a "file" column — fold the file name into source then)
        cols = log.read_text().splitlines()[0].split(",")
        if "file" not in cols:
            row["source"] = f"{source} ({path.name})"
        pd.DataFrame([{c: row.get(c, "") for c in cols}]).to_csv(log, mode="a", header=False, index=False)
    else:
        pd.DataFrame([row]).to_csv(log, mode="a", header=True, index=False)


def phone_state(p: str, vendor_dnc, vendor_litigator, scrubs: dict, internal: set,
                as_of: date, trust_vendor_scrub: bool, pull_date: date) -> tuple[str, date | None]:
    """(status, scrub_date). Callable only when status == 'clean'."""
    if p in internal:
        return "internal_dnc", None
    if vendor_litigator:
        return "litigator", pull_date
    if vendor_dnc:
        return "dnc", pull_date
    s = scrubs.get(p)
    if s is not None:
        status, d = s
        if status in ("dnc", "litigator", "invalid"):
            return status, d
        if status == "clean":
            if (as_of - d).days > SCRUB_VALID_DAYS:
                return "scrub_expired", d
            return "clean", d
    if trust_vendor_scrub and vendor_dnc is False:
        if (as_of - pull_date).days > SCRUB_VALID_DAYS:
            return "scrub_expired", pull_date
        return "clean", pull_date
    return "unscrubbed", None


def is_holiday(d: date) -> bool:
    """Fixed-date federal holidays + the floating Monday/Thursday ones."""
    if (d.month, d.day) in US_FEDERAL_HOLIDAYS_FIXED:
        return True
    nth = (d.day - 1) // 7 + 1
    wd = d.weekday()
    last_week = (d + timedelta(days=7)).month != d.month
    return ((d.month, wd, nth) in {(1, 0, 3), (2, 0, 3), (9, 0, 1), (10, 0, 2), (11, 3, 4)}
            or (d.month == 5 and wd == 0 and last_week))


def address_key(addr, zipc, city="") -> str:
    a = normalize_address(str(addr or "").split(",")[0])
    z = str(zipc or "").strip()[:5]
    return f"{a}|{z or str(city or '').upper().strip()}"
