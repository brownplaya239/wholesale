"""Minimal Spark (FBS / flexmls) RESO Web API client — MOMLS member access.

Setup (one-time):
  1. Get an API token: Spark developer portal (sparkplatform.com) with your
     MOMLS/flexmls credentials, or ask MOMLS member services for RESO Web
     API access. Personal member tokens are read-only over your own MLS.
  2. Set the environment variable before running:
       cmd:  set SPARK_ACCESS_TOKEN=your_token_here
  3. Smoke-test:  python scripts/07_comps.py ping

The default endpoint is Spark's RESO OData service; override with
SPARK_RESO_BASE if MOMLS points you at a different base URL (their member
docs will say — e.g. the replication host requires that tier of access).

MLS data-use note: member API data is for your own brokerage activity
(CMAs, suppression, analysis). Pull and use; don't archive or republish.
"""
from __future__ import annotations

import os
from urllib.parse import urlencode

DEFAULT_BASE = "https://replication.sparkapi.com/Reso/OData"


class SparkError(RuntimeError):
    pass


class SparkClient:
    def __init__(self, token: str | None = None, base: str | None = None,
                 get_json=None):
        self.token = token or os.environ.get("SPARK_ACCESS_TOKEN", "")
        self.base = (base or os.environ.get("SPARK_RESO_BASE")
                     or DEFAULT_BASE).rstrip("/")
        self._get_json = get_json or self._http_get_json
        if get_json is None and not self.token:
            raise SparkError(
                "SPARK_ACCESS_TOKEN is not set. See scripts/spark_client.py "
                "docstring for setup."
            )

    def _http_get_json(self, url: str) -> dict:
        import requests

        r = requests.get(
            url,
            headers={"Authorization": f"Bearer {self.token}",
                     "Accept": "application/json"},
            timeout=90,
        )
        if r.status_code == 401:
            raise SparkError("401 from Spark — token invalid or expired.")
        if r.status_code == 403:
            raise SparkError(
                "403 from Spark — token lacks access to this endpoint. If "
                "using the replication host, your tier may not include it; "
                "set SPARK_RESO_BASE to the base URL in your MOMLS API docs."
            )
        r.raise_for_status()
        return r.json()

    def query(self, resource: str = "Property", flt: str | None = None,
              select: str | None = None, top: int = 1000,
              max_records: int = 200_000) -> list[dict]:
        """Run an OData query, following @odata.nextLink pagination."""
        params = {"$top": str(top)}
        if flt:
            params["$filter"] = flt
        if select:
            params["$select"] = select
        url = f"{self.base}/{resource}?{urlencode(params)}"
        rows: list[dict] = []
        while url and len(rows) < max_records:
            js = self._get_json(url)
            if "error" in js:
                raise SparkError(f"Spark error: {js['error']}")
            rows.extend(js.get("value", []))
            url = js.get("@odata.nextLink")
        return rows

    def ping(self) -> dict:
        rows = self.query(top=1, max_records=1)
        return rows[0] if rows else {}


def pick(row: dict, *names, default=None):
    """First present, non-empty field among RESO name variants."""
    for n in names:
        v = row.get(n)
        if v not in (None, ""):
            return v
    return default
