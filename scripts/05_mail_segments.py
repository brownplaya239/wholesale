"""Build mail segments + compliance artifacts for the outreach cycle.

Segments (priority order, first match wins):
  S1 multi-list overlap survivors (SourceCount >= 2)
  S2 inheritance cohort (OWNER_CHANGED_NO_SALE + estate/family NU sales)
  S3 verified-vacant (fresh DPV vacancy flag — NOT the 2019 vendor flag;
     supply data/processed/vacancy_flags.csv: ref_id,vacant from the
     Smarty/Melissa batch, ~$0.01-0.03/record on the 546 Vacancy records)
  S4 remaining Tier A survivors

Mail spec: First-Class letter, windowed envelope, plain typed, "Return Service
Requested" endorsement (free vacancy/move detection via returned mail).
3 touches, 3-4 weeks apart. ~$0.75-0.95/piece all-in via Click2Mail/Lob/
PostGrid. Copy rule (NJ): offering to BUY as principal; never language
implying brokering (N.J.S.A. 45:15).

Dial plan: manual/click-to-dial by a human, 8am-9pm recipient local time,
calls land ~5 days after each mail drop. Before ANY dial:
  - Federal DNC scrub (first 5 area codes free at telemarketing.donotcall.gov;
    NJ list piggybacks federal). Re-scrub every <=31 days.
  - Litigator scrub (Blacklist Alliance / DNC.com).
Log every dial append-only to compliance/dial_log.csv; log returned mail to
compliance/mail_returns.csv (reason code = the vacancy signal).

Outputs: data/processed/mail_s1..s4.csv (+ mail_touch1_all.csv combined),
         compliance/ CSV templates (headers only, created if absent).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from nj_common import COMPLIANCE, PROCESSED  # noqa: E402

SURVIVOR_STATUSES = {"SAME_OWNER", "OWNER_CHANGED_NO_SALE", "UNRESOLVED"}
# UNRESOLVED stays mailable: worst case the letter returns, which is data.
# SOLD_ARMS_LENGTH / non-family SOLD_NON_USABLE are suppressed as seller leads.

COMPLIANCE_TEMPLATES = {
    "dial_log.csv": "ts,ref_id,number,disposition,scrub_batch_date,agent\n",
    "scrub_log.csv": "date,source,n_records,n_suppressed,file_hash\n",
    "mail_returns.csv": "date,ref_id,usps_reason_code\n",
    "optouts.csv": "date,ref_id,channel,request_verbatim\n",
}


def recipient_name(row) -> str:
    cur = str(row.get("current_owner") or "").strip()
    if cur and "REDACT" not in cur:
        return cur.title()
    first = str(row.get("First Name") or "").strip()
    last = str(row.get("Last Name") or "").strip()
    return f"{first} {last}".strip().title() or "Property Owner"


def build_segments(m: pd.DataFrame,
                   vacancy: pd.DataFrame | None) -> dict[str, pd.DataFrame]:
    keep = m[
        m["status"].isin(SURVIVOR_STATUSES)
        | ((m["status"] == "SOLD_NON_USABLE") & (m["cohort"] == "INHERITANCE"))
    ].copy()

    if vacancy is not None:
        v = vacancy.rename(columns=str.lower)
        flag = v[v["vacant"].astype(str).str.upper()
                 .isin(["1", "TRUE", "Y", "YES"])]["ref_id"]
        keep["dpv_vacant"] = keep["pkey"].isin(set(flag))
    else:
        keep["dpv_vacant"] = False

    # assigned lowest-priority first so later assignments win (S1 > S2 > S3 > S4)
    seg = pd.Series("", index=keep.index)
    seg[keep["Tier"].astype(str) == "A"] = "S4"
    seg[keep["dpv_vacant"]] = "S3"
    seg[(keep["cohort"] == "INHERITANCE")] = "S2"
    seg[keep["SourceCount"] >= 2] = "S1"
    keep["segment"] = seg
    keep = keep[keep["segment"] != ""]

    mv_ok = keep["mv_owner_address"].fillna("").str.strip().ne("")
    keep["mail_name"] = keep.apply(recipient_name, axis=1)
    keep["mail_address"] = keep["mv_owner_address"].where(
        mv_ok, keep["Owner Address"].fillna(keep["Property Address"]))
    keep["mail_city"] = keep["mv_owner_city"].where(
        mv_ok, keep["Owner City"].fillna(keep["Property City"]))
    keep["mail_zip"] = (keep["mv_owner_zip"].where(
        mv_ok, keep["Owner Zip Code"].fillna(keep["Property Zip Code"]))
        .astype("string").str[:5])

    cols = {
        "pkey": "ref_id", "segment": "segment", "mail_name": "mail_name",
        "mail_address": "mail_address", "mail_city": "mail_city",
        "mail_zip": "mail_zip", "Property Address": "property_address",
        "Property City": "property_city",
        "Property Zip Code": "property_zip", "status": "status",
        "cohort": "cohort", "Tier": "tier", "PriorityScore": "priority",
    }
    out = keep[list(cols)].rename(columns=cols)
    out["tier"] = out["tier"].astype(str)
    out["endorsement"] = "Return Service Requested"
    return {s: out[out["segment"] == s].sort_values("priority",
                                                    ascending=False)
            for s in ["S1", "S2", "S3", "S4"]} | {"all": out}


def write_compliance_templates() -> None:
    COMPLIANCE.mkdir(exist_ok=True)
    (COMPLIANCE / "skiptrace_raw").mkdir(exist_ok=True)
    for name, header in COMPLIANCE_TEMPLATES.items():
        p = COMPLIANCE / name
        if not p.exists():  # append-only files are never overwritten
            p.write_text(header)
            print(f"  created {p}")


def main() -> None:
    src = PROCESSED / "master_status.parquet"
    if not src.exists():
        raise SystemExit("Run 02_status_resolution.py first.")
    m = pd.read_parquet(src)
    vac_csv = PROCESSED / "vacancy_flags.csv"
    vacancy = pd.read_csv(vac_csv, dtype=str) if vac_csv.exists() else None
    if vacancy is None:
        print("No vacancy_flags.csv — S3 will be empty until the DPV batch "
              "runs (Smarty/Melissa on the 546 Vacancy-source records).")

    segs = build_segments(m, vacancy)
    for name, df in segs.items():
        dest = PROCESSED / (
            "mail_touch1_all.csv" if name == "all" else f"mail_{name.lower()}.csv")
        df.to_csv(dest, index=False)
    n = len(segs["all"])
    print(segs["all"]["segment"].value_counts().reindex(
        ["S1", "S2", "S3", "S4"]).to_string())
    print(f"{n:,} pieces, touch 1 at $0.75-0.95/pc: "
          f"${n * 0.75:,.0f}-{n * 0.95:,.0f}")
    write_compliance_templates()


if __name__ == "__main__":
    main()
