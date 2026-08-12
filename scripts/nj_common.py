"""Shared constants, parsers, and normalizers for the NJ status-resolution pipeline.

Data sources (all free):
  SR1A statewide sales files  https://www.nj.gov/treasury/taxation/lpt/statdata.shtml
  MOD-IV county tax lists     same page (MODIV-Counties/<year>/<County><yy>.zip)
  NJGIN parcels (optional)    https://njogis-newjersey.opendata.arcgis.com/

Fixed-width layouts below are transcribed from the state's published specs
(SR1Afilelayout.pdf "SR1A OPRA Layout", MOD-IV file layout) and cross-checked
against johnjreiser/NJParcelTools (GPLv3, used as reference only — this is an
independent implementation). SR1A records are 665 chars (post-2013 layout);
MOD-IV records are 701 chars. parse_* validates and raises loudly on drift,
and both parsers fall back to delimiter-sniffed parsing in case Treasury ever
ships a delimited OPRA extract instead of flat files.
"""
from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/cache"
PROCESSED = ROOT / "data/processed"
COMPLIANCE = ROOT / "compliance"

STATDATA_URL = "https://www.nj.gov/treasury/taxation/lpt/statdata.shtml"
MODIV_URL_TPL = (
    "https://www.nj.gov/treasury/taxation/lpt/MODIV-Counties/{year}/{county}{yy}.zip"
)

# NJ county codes (first 2 digits of the 4-digit taxing-district code).
COUNTY_CODES = {
    "ATLANTIC": "01", "BERGEN": "02", "BURLINGTON": "03", "CAMDEN": "04",
    "CAPEMAY": "05", "CUMBERLAND": "06", "ESSEX": "07", "GLOUCESTER": "08",
    "HUDSON": "09", "HUNTERDON": "10", "MERCER": "11", "MIDDLESEX": "12",
    "MONMOUTH": "13", "MORRIS": "14", "OCEAN": "15", "PASSAIC": "16",
    "SALEM": "17", "SOMERSET": "18", "SUSSEX": "19", "UNION": "20",
    "WARREN": "21",
}
TARGET_COUNTIES = ["HUDSON", "MIDDLESEX", "MONMOUTH", "SOMERSET", "UNION"]
TARGET_COUNTY_CODES = {COUNTY_CODES[c] for c in TARGET_COUNTIES}

# SR1A non-usable deed categories, N.J.A.C. 18:12-1.1(a). Blank/0 NU = usable
# arm's-length sale. Verify code text against the current regulation on first
# real run; the groupings below drive cohort assignment.
ESTATE_FAMILY_NU = {1, 2, 10}       # 1 immediate family, 2 love & affection,
                                    # 10 guardians/trustees/executors (estates)
FORECLOSURE_NU = {11, 12, 13, 18, 31}  # judicial/sheriff/bankruptcy/in-lieu/REO
GOVERNMENT_NU = {15, 17}

ENTITY_RE = re.compile(
    r"\b(LLC|L\s*L\s*C|LP|L\s*P|LLP|CORP|INC|TRUST|TR|HOLDINGS?|PROPERTIES|"
    r"PROPERTY|HOMES|HOME\s*BUYERS?|CAPITAL|VENTURES?|GROUP|PARTNERS?|"
    r"ASSOCIATES|ASSOC|REALTY|INVESTMENTS?|ENTERPRISES?|COMPANY|CO)\b"
)

# ---------------------------------------------------------------- layouts --
# (canonical_name, start_0based, length)
SR1A_LAYOUT = [
    ("county_code", 0, 2), ("district_code", 2, 2),
    ("u_n_type", 33, 1), ("nu_code", 34, 3),
    ("reported_price", 37, 9), ("verified_price", 46, 9),
    ("assessed_total", 73, 9), ("serial_number", 98, 7),
    ("grantor_name", 109, 35), ("grantor_street", 144, 25),
    ("grantor_city_state", 169, 25), ("grantor_zip", 194, 9),
    ("grantee_name", 203, 35), ("grantee_street", 238, 25),
    ("grantee_city_state", 263, 25), ("grantee_zip", 288, 9),
    ("property_location", 297, 25),
    ("deed_book", 328, 5), ("deed_page", 333, 5),
    ("deed_date", 338, 6), ("date_recorded", 344, 6),
    ("block_prefix", 350, 5), ("block_suffix", 355, 4),
    ("lot_prefix", 359, 5), ("lot_suffix", 364, 4),
    ("qual", 619, 5), ("property_class", 626, 3),
    ("year_built", 652, 4), ("living_space", 656, 7),
]
SR1A_RECLEN = 665

MODIV_LAYOUT = [
    ("muncode", 0, 4),
    ("block_raw", 4, 9), ("lot_raw", 13, 9), ("qual", 22, 11),
    ("property_class", 55, 3), ("property_location", 58, 25),
    ("owner_name", 175, 35), ("owner_address", 210, 25),
    ("owner_city", 235, 25), ("owner_zip", 260, 9),
    ("deed_book", 295, 5), ("deed_page", 300, 5),
    ("sale_date", 306, 6), ("sale_price", 312, 9),
    ("year_constructed", 415, 4),
    ("land_value", 420, 9), ("improvement_value", 429, 9),
    ("net_value", 438, 9),
]
MODIV_RECLEN = 701

# Aliases used to map a delimited/heading-bearing extract onto canonical names
# (headers are squashed to lowercase alphanumerics before lookup).
HEADER_ALIASES = {
    "county_code": ["countycode", "county"],
    "district_code": ["districtcode", "district", "muncode4"],
    "muncode": ["muncode", "municipalitycode", "countydistrict", "pclmun"],
    "nu_code": ["nucode", "srnucode", "nonusablecode", "nu"],
    "reported_price": ["reportedsalesprice", "reportedprice", "salesprice",
                       "saleprice", "consideration"],
    "verified_price": ["verifiedsalesprice", "verifiedprice"],
    "grantor_name": ["grantorname", "grantor", "sellername"],
    "grantee_name": ["granteename", "grantee", "buyername"],
    "grantee_street": ["granteestreet", "granteeaddress", "buyeraddress"],
    "grantee_city_state": ["granteecitystate", "granteecity"],
    "grantee_zip": ["granteezip", "buyerzip"],
    "property_location": ["propertylocation", "proploc", "propertyaddress",
                          "location"],
    "deed_date": ["deeddate", "dateofdeed"],
    "date_recorded": ["daterecorded", "recordeddate", "recordingdate"],
    "deed_book": ["deedbook", "book"], "deed_page": ["deedpage", "page"],
    "block_prefix": ["blockprefix"], "block_suffix": ["blocksuffix"],
    "lot_prefix": ["lotprefix"], "lot_suffix": ["lotsuffix"],
    "block_raw": ["block", "blockno"], "lot_raw": ["lot", "lotno"],
    "qual": ["qual", "qualifier", "qualificationcodes", "propertyqualifier"],
    "property_class": ["propertyclass", "propclass", "class"],
    "owner_name": ["ownername", "owner", "ownersname"],
    "owner_address": ["owneraddress", "ownerstreet", "mailingaddress",
                      "staddress"],
    "owner_city": ["ownercity", "ownercitystate", "citystate"],
    "owner_zip": ["ownerzip", "zipcode", "mailingzip"],
    "sale_date": ["saledate", "lastsaledate"],
    "sale_price": ["saleprice", "lastsaleprice"],
    "land_value": ["landvalue", "landval"],
    "improvement_value": ["improvementvalue", "imprvtval", "improvval"],
    "net_value": ["netvalue", "totalvalue", "netval"],
    "year_built": ["yearbuilt", "yearconstructed", "yrbuilt"],
    "year_constructed": ["yearconstructed", "yearbuilt", "yrbuilt"],
    "serial_number": ["serialnumber", "serial"],
    "u_n_type": ["untype"],
    "assessed_total": ["assessedvaluetotal", "assessedtotal", "totalassessed"],
    "living_space": ["livingspace", "sqft", "squarefeet"],
}


# ----------------------------------------------------------------- helpers --
def http_session():
    import requests
    from requests.adapters import HTTPAdapter, Retry

    s = requests.Session()
    retry = Retry(total=4, backoff_factor=2,
                  status_forcelist=[429, 500, 502, 503, 504])
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    s.headers["User-Agent"] = "nj-status-resolution/1.0 (research use)"
    return s


def download(url: str, dest: Path, session=None) -> Path:
    """Download url to dest unless it already exists (cache-friendly)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    s = session or http_session()
    with s.get(url, stream=True, timeout=120) as r:
        r.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.rename(dest)
    return dest


def scrape_links(page_url: str, pattern: str, session=None) -> list[str]:
    """Return absolute hrefs on page_url whose URL matches pattern (regex, i)."""
    from urllib.parse import urljoin

    s = session or http_session()
    html = s.get(page_url, timeout=60).text
    hrefs = re.findall(r'href=["\']([^"\']+)["\']', html, re.I)
    rx = re.compile(pattern, re.I)
    return sorted({urljoin(page_url, h) for h in hrefs if rx.search(h)})


def extract_data_files(zip_path: Path, out_dir: Path) -> list[Path]:
    """Extract .txt/.csv/.dat members from a zip; returns extracted paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out = []
    with zipfile.ZipFile(zip_path) as z:
        for name in z.namelist():
            if re.search(r"\.(txt|csv|dat|psv)$", name, re.I):
                target = out_dir / Path(name).name
                if not target.exists():
                    with z.open(name) as src, open(target, "wb") as dst:
                        dst.write(src.read())
                out.append(target)
            elif re.search(r"\.(mdb|accdb)$", name, re.I):
                raise RuntimeError(
                    f"{zip_path.name} contains an Access DB ({name}); "
                    "export it to CSV (mdbtools: mdb-export) and pass the "
                    "directory via --sr1a-dir/--modiv-dir."
                )
    return out


# ------------------------------------------------------------ fixed-width --
def _read_lines(path: Path, min_len: int,
                prefixes: set[str] | None = None) -> pd.Series:
    """Stream lines; optionally keep only lines starting with one of
    `prefixes` (2-char county codes) — the statewide MOD-IV file is ~2.4GB
    uncompressed, so filtering before building the frame matters."""
    lines = []
    with open(path, "r", encoding="latin-1", errors="replace") as f:
        for ln in f:
            ln = ln.rstrip("\r\n")
            if not ln.strip():
                continue
            if prefixes is not None and ln[:2] not in prefixes:
                continue
            lines.append(ln)
    return pd.Series(lines, dtype="string").str.pad(min_len, side="right")


def parse_fixed(path: Path, layout, reclen: int,
                prefixes: set[str] | None = None) -> pd.DataFrame:
    s = _read_lines(path, reclen, prefixes)
    df = pd.DataFrame({name: s.str[a:a + n].str.strip()
                       for name, a, n in layout})
    return df


def sniff_delimited(path: Path) -> pd.DataFrame | None:
    """If the file looks delimited-with-header, parse it; else None."""
    with open(path, "r", encoding="latin-1", errors="replace") as f:
        head = f.readline()
    for sep in ("|", "\t", ","):
        if head.count(sep) >= 5 and re.search(r"[A-Za-z]{3}", head):
            fields = head.rstrip("\n").split(sep)
            # header row = mostly alphabetic names, no long digit runs
            alpha = sum(bool(re.fullmatch(r'[\sA-Za-z_\-"/.]+', c or " "))
                        for c in fields)
            if alpha >= 0.8 * len(fields):
                return pd.read_csv(path, sep=sep, dtype=str,
                                   encoding="latin-1", engine="python",
                                   on_bad_lines="warn")
    return None


def map_headers(df: pd.DataFrame, wanted: list[str]) -> pd.DataFrame:
    """Rename a delimited extract's columns onto canonical names."""
    squash = {re.sub(r"[^a-z0-9]", "", c.lower()): c for c in df.columns}
    out = {}
    for canon in wanted:
        for alias in [canon.replace("_", "")] + HEADER_ALIASES.get(canon, []):
            if alias in squash:
                out[canon] = df[squash[alias]]
                break
    return pd.DataFrame(out)


def yymmdd_to_date(s: pd.Series) -> pd.Series:
    """SR1A/MOD-IV 6-digit dates; yy>32 pivots to 1900s (matches state usage)."""
    s = s.astype("string").str.replace(r"\D", "", regex=True).str.zfill(6)
    yy = pd.to_numeric(s.str[:2], errors="coerce")
    century = np.where(yy > 32, "19", "20")
    iso = pd.Series(century, index=s.index, dtype="string") + s.str[:2] + \
        "-" + s.str[2:4] + "-" + s.str[4:6]
    iso = iso.where(s.notna() & (s != "000000"))
    return pd.to_datetime(iso, format="%Y-%m-%d", errors="coerce")


def to_num(s: pd.Series | None) -> pd.Series:
    if s is None:  # optional column absent in a delimited/OPRA extract
        return pd.Series(dtype="float64")
    return pd.to_numeric(
        s.astype("string").str.replace(r"[^\d.\-]", "", regex=True),
        errors="coerce",
    )


def norm_block_lot(prefix: pd.Series, suffix: pd.Series) -> pd.Series:
    p = prefix.astype("string").str.strip().str.lstrip("0")
    x = suffix.astype("string").str.strip().str.strip("0 ").fillna("")
    return (p + ("." + x).where(x != "", "")).astype("string")


def make_pin(muncode, block, lot, qual=None) -> pd.Series:
    pin = muncode.astype("string") + "_" + block.astype("string") + "_" + \
        lot.astype("string")
    if qual is not None:
        q = qual.astype("string").str.strip().str.upper().str[:5].fillna("")
        pin = pin + ("_" + q).where(q != "", "")
    return pin.astype("string")


# ------------------------------------------------------------- SR1A parse --
def parse_sr1a_file(path: Path,
                    county_prefixes: set[str] | None = None) -> pd.DataFrame:
    delim = sniff_delimited(path)
    if delim is not None:
        df = map_headers(delim, [n for n, _, _ in SR1A_LAYOUT])
        missing = {"county_code", "grantee_name"} - set(df.columns)
        if missing:
            raise RuntimeError(
                f"{path.name}: delimited SR1A extract missing {missing}; "
                "extend HEADER_ALIASES in nj_common.py for this vintage."
            )
        if county_prefixes is not None:
            df = df[df["county_code"].astype("string").str.zfill(2)
                    .isin(county_prefixes)]
    else:
        # zero rows after a county prefilter is legitimate (out-of-footprint
        # file) — callers enforce non-emptiness on the aggregate instead
        df = parse_fixed(path, SR1A_LAYOUT, SR1A_RECLEN, county_prefixes)
        ok = df["county_code"].str.fullmatch(r"0[1-9]|1\d|2[01]").fillna(False)
        if len(df) and ok.mean() < 0.95:
            raise RuntimeError(
                f"{path.name}: only {ok.mean():.0%} of rows have a valid "
                "county code — layout drift vs SR1Afilelayout.pdf. Update "
                "SR1A_LAYOUT in nj_common.py against the current PDF."
            )

    out = pd.DataFrame()
    out["muncode"] = (
        df["county_code"].astype("string").str.zfill(2)
        + df.get("district_code", pd.Series(dtype="string")).astype(
            "string").str.zfill(2)
    )
    if "block_prefix" in df.columns:
        out["block"] = norm_block_lot(df["block_prefix"], df["block_suffix"])
        out["lot"] = norm_block_lot(df["lot_prefix"], df["lot_suffix"])
    else:  # delimited vintage with pre-joined block/lot
        out["block"] = df["block_raw"].astype("string").str.strip()
        out["lot"] = df["lot_raw"].astype("string").str.strip()
    out["qual"] = df.get("qual", pd.Series(dtype="string"))
    out["nu_code"] = to_num(df.get("nu_code")).astype("Int64")
    price_v = to_num(df.get("verified_price"))
    price_r = to_num(df.get("reported_price"))
    out["sale_price"] = price_v.where(price_v > 0, price_r)
    dd = yymmdd_to_date(df.get("deed_date", pd.Series(dtype="string")))
    dr = yymmdd_to_date(df.get("date_recorded", pd.Series(dtype="string")))
    out["sale_date"] = dd.fillna(dr)
    out["date_recorded"] = dr
    for c in ["grantor_name", "grantee_name", "grantee_street",
              "grantee_city_state", "grantee_zip", "property_location",
              "deed_book", "deed_page", "property_class", "serial_number"]:
        if c in df.columns:
            out[c] = df[c].astype("string").str.strip().str.upper()
    out["source_file"] = path.name
    out["pin"] = make_pin(out["muncode"], out["block"], out["lot"])
    return out


def parse_modiv_file(path: Path,
                     county_prefixes: set[str] | None = None) -> pd.DataFrame:
    if path.suffix.lower() in (".xlsx", ".xls"):  # OPRA responses often are
        delim = pd.read_excel(path, dtype=str)
    else:
        delim = sniff_delimited(path)
    if delim is not None:
        df = map_headers(delim, [n for n, _, _ in MODIV_LAYOUT])
        if "muncode" not in df.columns or "owner_name" not in df.columns:
            raise RuntimeError(
                f"{path.name}: delimited MOD-IV extract missing key columns; "
                "extend HEADER_ALIASES in nj_common.py."
            )
        if county_prefixes is not None:
            df = df[df["muncode"].astype("string").str[:2]
                    .isin(county_prefixes)]
        df["block"] = df["block_raw"].astype("string").str.strip()
        df["lot"] = df["lot_raw"].astype("string").str.strip()
    else:
        # zero rows after a county prefilter is legitimate (out-of-footprint
        # file) — callers enforce non-emptiness on the aggregate instead
        df = parse_fixed(path, MODIV_LAYOUT, MODIV_RECLEN, county_prefixes)
        ok = df["muncode"].str.fullmatch(r"\d{4}").fillna(False)
        if len(df) and ok.mean() < 0.95:
            raise RuntimeError(
                f"{path.name}: only {ok.mean():.0%} of rows have a 4-digit "
                "muncode — layout drift vs the MOD-IV spec. Update "
                "MODIV_LAYOUT in nj_common.py."
            )
        # 9-char block/lot = 5-char prefix + 4-char suffix (implied decimal)
        df["block"] = norm_block_lot(df["block_raw"].str[:5],
                                     df["block_raw"].str[5:9])
        df["lot"] = norm_block_lot(df["lot_raw"].str[:5],
                                   df["lot_raw"].str[5:9])

    out = pd.DataFrame()
    out["muncode"] = df["muncode"].astype("string").str.strip()
    out["block"], out["lot"] = df["block"], df["lot"]
    out["qual"] = df.get("qual", pd.Series(dtype="string"))
    for c in ["property_location", "owner_name", "owner_address",
              "owner_city", "owner_zip", "property_class", "deed_book",
              "deed_page"]:
        if c in df.columns:
            out[c] = df[c].astype("string").str.strip().str.upper()
    out["sale_date"] = yymmdd_to_date(df.get("sale_date",
                                             pd.Series(dtype="string")))
    out["sale_price"] = to_num(df.get("sale_price"))
    for c in ["land_value", "improvement_value", "net_value",
              "year_constructed"]:
        if c in df.columns:
            out[c] = to_num(df[c])
    out["source_file"] = path.name
    out["pin"] = make_pin(out["muncode"], out["block"], out["lot"])
    return out


# ------------------------------------------------------- address matching --
_SUFFIX = {
    "STREET": "ST", "STR": "ST", "AVENUE": "AVE", "AV": "AVE", "ROAD": "RD",
    "DRIVE": "DR", "DRV": "DR", "LANE": "LN", "COURT": "CT", "PLACE": "PL",
    "TERRACE": "TER", "TERR": "TER", "CIRCLE": "CIR", "BOULEVARD": "BLVD",
    "BLV": "BLVD", "HIGHWAY": "HWY", "PARKWAY": "PKWY", "TRAIL": "TRL",
    "SQUARE": "SQ", "EXTENSION": "EXT", "CRESCENT": "CRES", "GARDENS": "GDNS",
    "HEIGHTS": "HTS", "JUNCTION": "JCT", "MOUNTAIN": "MTN", "POINT": "PT",
    "ROUTE": "RT", "RTE": "RT",
}
_DIRECTION = {"NORTH": "N", "SOUTH": "S", "EAST": "E", "WEST": "W",
              "NORTHEAST": "NE", "NORTHWEST": "NW", "SOUTHEAST": "SE",
              "SOUTHWEST": "SW"}
_UNIT_RE = re.compile(
    r"(?:\b(?:APT|APARTMENT|UNIT|STE|SUITE|FL|FLOOR|BLDG|BUILDING|REAR|"
    r"BSMT|TRLR|LOT|RM|ROOM)|#)\s*\.?\s*[\w\-/]*\s*$"
)


def normalize_address(addr) -> str:
    """USPS-flavored normalization for matching (not for mailing labels)."""
    if addr is None or (isinstance(addr, float) and np.isnan(addr)):
        return ""
    s = str(addr).upper().strip()
    s = re.sub(r"[.,]", " ", s)  # keep '#' — the unit-strip regex needs it
    s = re.sub(r"\s+", " ", s).strip()
    prev = None
    while prev != s:  # strip stacked unit designators ("APT 2 FL 1")
        prev = s
        s = _UNIT_RE.sub("", s).strip()
    toks = s.split(" ")
    out = []
    for i, t in enumerate(toks):
        if t in _SUFFIX:
            out.append(_SUFFIX[t])
        elif t in _DIRECTION and (i <= 1 or i >= len(toks) - 2):
            out.append(_DIRECTION[t])
        else:
            out.append(t)
    return " ".join(out).strip()


def house_number(norm_addr: str) -> str:
    m = re.match(r"(\d+)", norm_addr)
    return m.group(1) if m else ""


def street_key(norm_addr: str) -> str:
    """First street-name token after the house number (fuzzy-match anchor)."""
    toks = norm_addr.split(" ")
    for t in toks[1:] if toks and toks[0].isdigit() else toks:
        if t and not t.isdigit() and t not in _DIRECTION.values():
            return t
    return ""


# --------------------------------------------------------- name comparing --
_NAME_NOISE = re.compile(
    r"\b(JR|SR|II|III|IV|MR|MRS|MS|DR|EST|ESTATE|OF|ETAL|ET|AL|ETUX|ETVIR|"
    r"TRUSTEE|TRUSTEES|EXEC|EXECUTOR|EXECUTRIX|ADMIN|C/O)\b"
)


def is_entity(name: str) -> bool:
    return bool(ENTITY_RE.search(str(name).upper()))


def surname_tokens(name: str) -> set[str]:
    """Meaningful surname-ish tokens from a free-form owner name."""
    s = re.sub(r"[^A-Z\s]", " ", str(name).upper())
    s = _NAME_NOISE.sub(" ", s)
    return {t for t in s.split() if len(t) >= 3}


def same_owner(list_last: str, list_owner2: str, current_owner: str):
    """True/False, or None when it can't be judged (blank/redacted)."""
    cur = str(current_owner or "").strip().upper()
    if not cur or "REDACT" in cur:
        return None
    cur_toks = surname_tokens(cur)
    if not cur_toks:
        return None
    want = surname_tokens(list_last) | surname_tokens(list_owner2)
    if not want:
        return None
    return bool(want & cur_toks)


# ------------------------------------------------------------------ NJGIN --
NJGIN_CANDIDATE_SERVICES = [
    # Statewide parcels + MOD-IV composite hosted by NJOGIS. If both 404,
    # find the current item at https://njogis-newjersey.opendata.arcgis.com/
    # (search "parcels composite MOD-IV") and pass --njgin-url.
    "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/"
    "NJ_Parcels_and_MODIV_Composite/FeatureServer/0",
    "https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/ArcGIS/rest/services/"
    "Parcels_Composite_of_NJ/FeatureServer/0",
]


def fetch_arcgis_layer(layer_url: str, where: str, out_fields: str,
                       session=None, page: int = 2000) -> pd.DataFrame:
    """Page through an ArcGIS FeatureServer layer query (attributes only)."""
    s = session or http_session()
    rows, offset = [], 0
    while True:
        r = s.get(
            f"{layer_url}/query",
            params={
                "where": where, "outFields": out_fields, "f": "json",
                "returnGeometry": "false", "resultOffset": offset,
                "resultRecordCount": page, "orderByFields": "OBJECTID",
            },
            timeout=120,
        )
        r.raise_for_status()
        js = r.json()
        if "error" in js:
            raise RuntimeError(f"ArcGIS error: {js['error']}")
        feats = js.get("features", [])
        rows.extend(f["attributes"] for f in feats)
        if not js.get("exceededTransferLimit") and len(feats) < page:
            break
        offset += len(feats)
    return pd.DataFrame(rows)


def load_listing_suppression(path: Path | None = None) -> set:
    """(normalized_address, UPPER city) pairs to exclude from outreach.

    NJ REC prohibits soliciting properties actively listed with another
    broker. Drop an MLS export at data/processed/suppress_active_listings.csv
    (columns containing address + city, any casing) and 05/06 suppress
    matches. Rows without a city match on address alone.
    """
    p = Path(path) if path else PROCESSED / "suppress_active_listings.csv"
    if not p.exists():
        return set()
    df = pd.read_csv(p, dtype=str)
    lower = {c.lower().strip(): c for c in df.columns}
    ac = next((lower[k] for k in
               ("address", "property address", "street address", "street")
               if k in lower), None)
    cc = next((lower[k] for k in ("city", "property city", "town", "municipality")
               if k in lower), None)
    zc = next((lower[k] for k in ("zip", "zip code", "postal code",
                                  "postalcode", "property zip code")
               if k in lower), None)
    if ac is None:
        raise SystemExit(f"{p}: no address-like column found")
    # street part only (MLS exports often carry full-line addresses); keys on
    # zip (immune to MLS municipality-vs-postal-city naming) AND on city.
    addr = df[ac].astype(str).str.split(",").str[0].map(normalize_address)
    city = (df[cc].astype(str).str.upper().str.strip().fillna("")
            if cc else pd.Series("", index=df.index))
    zips = (df[zc].astype(str).str.strip().str[:5].fillna("")
            if zc else pd.Series("", index=df.index))
    keys = set()
    for a, ci, z in zip(addr, city, zips):
        if z:
            keys.add((a, z))
        if ci:
            keys.add((a, ci))
        if not z and not ci:
            keys.add((a, ""))
    return keys


def is_suppressed(addr: str, city: str, zipc, suppress: set) -> bool:
    a = normalize_address(addr)
    return ((a, str(zipc or "")[:5]) in suppress
            or (a, str(city or "").upper().strip()) in suppress
            or (a, "") in suppress)


def load_master() -> pd.DataFrame:
    pq = PROCESSED / "master.parquet"
    pk = PROCESSED / "master.pkl"
    if pq.exists():
        return pd.read_parquet(pq)
    if pk.exists():
        return pd.read_pickle(pk)
    raise SystemExit("Run scripts/01_consolidate_and_score.py first.")
