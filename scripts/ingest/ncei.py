import argparse
import hashlib
import json
import os
import shutil
import sys
import time
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from common import ROOT, load_env

load_env()

BASE = os.environ.get("NCEI_BASE", "https://www.ncei.noaa.gov/cdo-web/api/v2")
DATASET = "GSOM"
START_YEAR = 2000
DEFAULT_END = "2026-09-30"

FEATURES = [
    "TAVG",
    "TMAX",
    "TMIN",
    "PRCP",
    "SNOW",
    "EMXT",
    "EMNT",
    "EMXP",
    "DX90",
    "DX32",
    "DT32",
    "DP01",
    "DP10",
    "AWND",
    "WSFG",
    "WSF2",
    "DSND",
    "EMSD",
]

DATA = Path(os.environ.get("NCEI_DIR", ROOT / "data" / "ncei"))
CACHE = DATA / "cache"
RAW = DATA / "raw"
STATE = DATA / "state"
PROC = DATA / "processed"

MIN_INTERVAL = 0.25
DAILY_LIMIT = 9500


class DailyLimit(Exception):
    pass


class ApiError(Exception):
    pass


class Budget:
    def __init__(self, token: str):
        self.path = STATE / f"requests_{hashlib.md5(token.encode()).hexdigest()[:8]}.json"

    def _today(self):
        return datetime.now(timezone.utc).date().isoformat()

    def count(self) -> int:
        try:
            d = json.loads(self.path.read_text())
            return d["count"] if d.get("date") == self._today() else 0
        except Exception:
            return 0

    def bump(self):
        STATE.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({"date": self._today(), "count": self.count() + 1}))


class Client:
    def __init__(self):
        token = os.environ.get("NCEI_TOKEN")
        if not token:
            sys.exit("NCEI_TOKEN not found. Set it in .env or as an environment variable.")
        self.session = requests.Session()
        self.session.headers.update({"token": token})
        self.budget = Budget(token)
        self.net_requests = 0
        self.cache_hits = 0
        CACHE.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def key(url, params):
        raw = url + json.dumps(sorted((str(k), str(v)) for k, v in params))
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, endpoint, params):
        url = f"{BASE}/{endpoint}"
        path = CACHE / f"{self.key(url, params)}.json"
        if path.exists():
            self.cache_hits += 1
            return json.loads(path.read_text())

        for attempt in range(6):
            if self.budget.count() >= DAILY_LIMIT:
                raise DailyLimit()
            time.sleep(MIN_INTERVAL)
            self.budget.bump()
            self.net_requests += 1
            try:
                r = self.session.get(url, params=params, timeout=90)
            except requests.RequestException as e:
                print(f"  network error ({e}); retry {attempt + 1}/6")
                time.sleep(2**attempt)
                continue
            if r.status_code == 200:
                text = r.text.strip() or "{}"
                data = json.loads(text)
                path.write_text(text)
                return data
            if r.status_code in (429, 500, 502, 503, 504):
                wait = min(60, 2**attempt * 2)
                print(f"  HTTP {r.status_code}; waiting {wait} s (attempt {attempt + 1}/6)")
                time.sleep(wait)
                continue
            if r.status_code in (401, 403):
                raise ApiError(f"HTTP {r.status_code}: token is invalid or rejected: {r.text[:200]}")
            raise ApiError(f"HTTP {r.status_code} for {endpoint} {params[:6]}: {r.text[:300]}")
        raise ApiError(f"Could not fetch {endpoint} after 6 attempts")


def fetch_all_stations(cl: Client, end: str) -> pd.DataFrame:
    rows, offset = [], 1
    while True:
        params = [
            ("datasetid", DATASET),
            ("startdate", f"{START_YEAR}-01-01"),
            ("enddate", end),
            ("limit", 1000),
            ("offset", offset),
        ]
        j = cl.get("stations", params)
        res = j.get("results", [])
        rows += res
        total = j.get("metadata", {}).get("resultset", {}).get("count", 0)
        print(f"  stations: {len(rows)}/{total}")
        offset += 1000
        if not res or offset > total:
            break
    return pd.DataFrame(rows)


def add_merra_cols(sel: pd.DataFrame) -> pd.DataFrame:
    sel = sel.copy()
    sel["merra_lat"] = ((sel["latitude"] + 90) / 0.5).round() * 0.5 - 90
    sel["merra_lon"] = ((sel["longitude"] + 180) / 0.625).round() * 0.625 - 180
    sel.loc[sel["merra_lon"] > 179.375, "merra_lon"] -= 360
    sel["merra_lat"] = sel["merra_lat"].clip(-90, 90).round(3)
    sel["merra_lon"] = sel["merra_lon"].round(3)
    return sel


def haversine_km(lat1, lon1, lat2, lon2):
    p = np.pi / 180
    h = (
        np.sin((lat2 - lat1) * p / 2) ** 2
        + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2
    )
    return 12742 * np.arcsin(np.sqrt(h))


def cmd_stations(a):
    PROC.mkdir(parents=True, exist_ok=True)
    cl = Client()
    all_path = PROC / "stations_all.csv"
    if all_path.exists() and not a.refresh:
        df = pd.read_csv(all_path)
        print(f"Using existing {all_path.name}: {len(df)} stations (use --refresh to update)")
    else:
        try:
            df = fetch_all_stations(cl, a.end)
        except DailyLimit:
            sys.exit("Daily request limit reached. Try again tomorrow.")
        df.to_csv(all_path, index=False)
        print(f"All GSOM stations: {len(df)} (network requests: {cl.net_requests})")

    df = df.dropna(subset=["latitude", "longitude"]).copy()
    df["country"] = df["id"].str[6:8]
    ok = df[
        (df["mindate"] <= a.max_start) & (df["maxdate"] >= a.min_end) & (df["datacoverage"] >= a.min_coverage)
    ].copy()
    print(
        f"After the filter (start <= {a.max_start}, end >= {a.min_end}, "
        f"coverage >= {a.min_coverage}): {len(ok)}"
    )

    deg = a.cell_deg
    ok["cell_i"] = ((ok["latitude"] + 90) // deg).astype(int)
    ok["cell_j"] = ((ok["longitude"] + 180) // deg).astype(int)
    ok = ok.sort_values(
        ["cell_i", "cell_j", "datacoverage", "maxdate", "mindate", "id"],
        ascending=[True, True, False, False, True, True],
    )
    sel = ok.groupby(["cell_i", "cell_j"]).head(a.per_cell).reset_index(drop=True)
    sel.insert(0, "idx", range(len(sel)))

    sel = add_merra_cols(sel)
    sel["batch"] = "base"
    sel["tier"] = 0

    out = PROC / "stations_selected.csv"
    sel.drop(columns=["cell_i", "cell_j"]).to_csv(out, index=False)
    (PROC / "stations_selected_base.csv").unlink(missing_ok=True)
    n = len(sel)
    print(f"Selected stations: {n} -> {out}")
    print(
        f"Estimated requests for the full download: {n * 3}..{n * 9} "
        f"(per part of 4: ~{n * 3 // 4}..{n * 9 // 4}; token limit 9500/day)"
    )


EXTRA_TIERS = [
    ("2005-01-01", "2025-06-01", 0.8),
    ("2010-01-01", "2024-01-01", 0.5),
    ("2016-01-01", "2022-01-01", 0.2),
    ("2026-12-31", "2000-01-01", 0.0),
]


def cmd_extra_stations(a):
    sel_path = PROC / "stations_selected.csv"
    base_path = PROC / "stations_selected_base.csv"
    all_path = PROC / "stations_all.csv"
    if not all_path.exists():
        sys.exit(
            f"Missing {all_path}: it is created by the `stations` command (run it where `stations` was executed)."
        )
    if not base_path.exists():
        if not sel_path.exists():
            sys.exit(f"Missing {sel_path}: run `stations` first.")
        shutil.copy(sel_path, base_path)
    base = pd.read_csv(base_path)
    if "batch" not in base.columns:
        base["batch"] = "base"
    if "tier" not in base.columns:
        base["tier"] = 0

    allst = pd.read_csv(all_path).dropna(subset=["latitude", "longitude"]).copy()
    allst["country"] = allst["id"].str[6:8]
    taken = set(base["id"])
    base_cnt = base["country"].value_counts()

    new_rows, short = [], []
    for cc in sorted(allst["country"].unique()):
        need = a.per_country - int(base_cnt.get(cc, 0))
        if need <= 0:
            continue
        placed = []
        for tier_no, (ms, me, mc) in enumerate(EXTRA_TIERS, 1):
            if len(placed) >= need:
                break
            c = allst[
                (allst["country"] == cc)
                & ~allst["id"].isin(taken)
                & (allst["mindate"] <= ms)
                & (allst["maxdate"] >= me)
                & (allst["datacoverage"] >= mc)
            ]
            if c.empty:
                continue
            pool = c.sort_values(
                ["datacoverage", "maxdate", "mindate", "id"], ascending=[False, False, True, True]
            ).head(a.pool)
            while len(placed) < need and not pool.empty:
                ref = [(r.latitude, r.longitude) for r in base[base["country"] == cc].itertuples()]
                ref += [(r["latitude"], r["longitude"]) for r in placed]
                if not ref:
                    row = pool.iloc[0]
                else:
                    d = np.min(
                        [
                            haversine_km(pool["latitude"].values, pool["longitude"].values, la, lo)
                            for la, lo in ref
                        ],
                        axis=0,
                    )
                    row = pool.iloc[int(np.argmax(d))]
                r = row.to_dict()
                r["tier"] = tier_no
                placed.append(r)
                taken.add(r["id"])
                pool = pool[pool["id"] != r["id"]]
        new_rows += placed
        if len(placed) < need:
            short.append((cc, len(placed), need))

    if new_rows:
        ex = pd.DataFrame(new_rows)
        ex["batch"] = "extra"
        ex = add_merra_cols(ex)
        start = int(base["idx"].max()) + 1
        ex.insert(0, "idx", range(start, start + len(ex)))
        out = pd.concat([base, ex.reindex(columns=base.columns)], ignore_index=True)
    else:
        out = base
    assert out["id"].is_unique and out["idx"].is_unique, "duplicate stations or idx"
    out.to_csv(sel_path, index=False)

    n_new = len(new_rows)
    print(f"Stations before: {len(base)} in {base['country'].nunique()} countries")
    print(f"Added: {n_new} stations; now {len(out)} in {out['country'].nunique()} countries")
    if n_new:
        print(
            "Added by quality tier (1 = best):",
            out[out.batch == "extra"]["tier"].value_counts().sort_index().to_dict(),
        )
    print(
        f"Countries where {a.per_country} stations could not be found: {len(short)}"
        + (f" (code: found/needed) {short[:25]}" if short else "")
    )
    print(
        f"Estimated requests for the top-up: {n_new * 3}..{n_new * 9} "
        f"(per part of 4: ~{n_new * 3 // 4}..{n_new * 9 // 4})"
    )
    print(
        f"Updated {sel_path}. Share it with everyone; each person reruns download and build with their own --part."
    )


def make_chunks(end: str, years: int):
    end_d = date.fromisoformat(end)
    chunks, y = [], START_YEAR
    while True:
        s = date(y, 1, 1)
        e = min(date(y + years - 1, 12, 31), end_d)
        chunks.append((s.isoformat(), e.isoformat()))
        if e >= end_d:
            return chunks
        y += years


def fetch_station(cl: Client, sid: str, types, chunks):
    rows = []
    for s, e in chunks:
        offset = 1
        while True:
            params = [
                ("datasetid", DATASET),
                ("stationid", sid),
                ("startdate", s),
                ("enddate", e),
                ("units", "metric"),
                ("limit", 1000),
                ("offset", offset),
            ]
            params += [("datatypeid", t) for t in types]
            j = cl.get("data", params)
            res = j.get("results", [])
            rows += res
            total = j.get("metadata", {}).get("resultset", {}).get("count", 0)
            offset += 1000
            if not res or offset > total:
                break
    return rows


def safe_name(sid: str) -> str:
    return sid.replace(":", "_").replace("/", "_")


def load_selected():
    path = PROC / "stations_selected.csv"
    if not path.exists():
        sys.exit(f"Missing {path}. Get it from whoever ran `stations`.")
    return pd.read_csv(path)


def my_part(df, a):
    if not (0 <= a.part < a.of):
        sys.exit("--part must be between 0 and of-1")
    return df[df["idx"] % a.of == a.part]


def cmd_download(a):
    RAW.mkdir(parents=True, exist_ok=True)
    mine = my_part(load_selected(), a)
    types = FEATURES
    chunks = make_chunks(a.end, a.chunk_years)
    cl = Client()
    todo = [r for r in mine.itertuples() if not (RAW / f"{safe_name(r.id)}.csv").exists()]
    print(
        f"Part {a.part}/{a.of}: stations {len(mine)}, remaining {len(todo)}, "
        f"variables {len(types)}, date chunks {len(chunks)}: {chunks}"
    )
    t0 = time.time()
    try:
        for n, r in enumerate(todo, 1):
            rows = fetch_station(cl, r.id, types, chunks)
            df = pd.DataFrame(rows, columns=["station", "date", "datatype", "value", "attributes"])
            tmp = RAW / f"{safe_name(r.id)}.csv.tmp"
            df.to_csv(tmp, index=False)
            tmp.replace(RAW / f"{safe_name(r.id)}.csv")
            if n % 10 == 0 or n == len(todo):
                el = time.time() - t0
                eta = el / n * (len(todo) - n)
                print(
                    f"  {n}/{len(todo)} stations | network requests {cl.net_requests}, "
                    f"from cache {cl.cache_hits}, today {cl.budget.count()} | ~{eta / 60:.0f} min left"
                )
    except DailyLimit:
        print(
            "\nDaily limit reached (9500). Finished stations are saved. "
            "Run the same command tomorrow: it resumes where it stopped."
        )
        return
    except ApiError as e:
        sys.exit(f"\nAPI error: {e}\nIf it is about the date range, try --chunk-years 5 or 1.")
    print("Part download finished. Next: build.")


def cmd_build(a):
    mine = my_part(load_selected(), a)
    frames, missing = [], []
    for r in mine.itertuples():
        p = RAW / f"{safe_name(r.id)}.csv"
        if not p.exists():
            missing.append(r.id)
            continue
        d = pd.read_csv(p)
        if len(d):
            frames.append(d)
    if missing:
        print(f"Warning: no files for {len(missing)} stations (not fully downloaded). Run download again.")
    long = (
        pd.concat(frames, ignore_index=True)
        if frames
        else pd.DataFrame(columns=["station", "date", "datatype", "value", "attributes"])
    )
    long["date"] = pd.to_datetime(long["date"]).dt.normalize()
    long = long.rename(columns={"station": "station_id"})
    PROC.mkdir(parents=True, exist_ok=True)
    out = PROC / f"part{a.part}of{a.of}_monthly_long.parquet"
    long.to_parquet(out, index=False)
    print(f"{out}: {len(long)} rows, stations {long['station_id'].nunique()}")


def cmd_merge(a):
    files = sorted(PROC.glob("part*of*_monthly_long.parquet"))
    if not files:
        sys.exit(f"No part*_monthly_long.parquet found in {PROC}")
    print("Files:", [f.name for f in files])
    long = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    dup = long.duplicated(["station_id", "date", "datatype"])
    if dup.any():
        print(f"Duplicates (station, date, datatype): {int(dup.sum())}, dropping")
        long = long[~dup]
    long = long.sort_values(["station_id", "date", "datatype"]).reset_index(drop=True)
    wide = long.pivot_table(
        index=["station_id", "date"], columns="datatype", values="value", aggfunc="first"
    ).reset_index()
    wide.columns.name = None

    sel = load_selected().rename(columns={"id": "station_id"})
    months = (pd.Timestamp(a.end).year - START_YEAR) * 12 + pd.Timestamp(a.end).month
    for col in ("TAVG", "PRCP"):
        if col in wide:
            cnt = wide.dropna(subset=[col]).groupby("station_id").size()
            sel[f"n_{col}"] = sel["station_id"].map(cnt).fillna(0).astype(int)
            sel[f"cov_{col}"] = (sel[f"n_{col}"] / months).round(3)
    sel["has_data"] = sel["station_id"].isin(wide["station_id"].unique())

    long.to_parquet(PROC / "monthly_long.parquet", index=False)
    wide.to_parquet(PROC / "monthly_wide.parquet", index=False)
    sel.to_csv(PROC / "stations.csv", index=False)
    print(f"monthly_long.parquet: {len(long)} rows")
    print(f"monthly_wide.parquet: {len(wide)} rows (station x month), columns: {list(wide.columns)}")
    print(
        f"stations.csv: {len(sel)} stations in {sel['country'].nunique()} countries, with data: {int(sel['has_data'].sum())}"
    )
    if (~sel["has_data"]).any():
        print(
            f"Warning: {int((~sel['has_data']).sum())} stations without data: someone has not run download/build for their part."
        )
    print(f"Expected months per station: {months}. The cov_* columns show the share of filled months.")


def main():
    p = argparse.ArgumentParser(description="NCEI GSOM monthly station data downloader (CDO v2)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("stations", help="find and select stations (once)")
    s.add_argument("--end", default=DEFAULT_END)
    s.add_argument("--min-coverage", type=float, default=0.9)
    s.add_argument("--max-start", default="2002-01-01", help="station must start no later than this date")
    s.add_argument("--min-end", default="2026-01-01", help="station must end no earlier than this date")
    s.add_argument("--per-cell", type=int, default=2, help="stations per grid cell")
    s.add_argument("--cell-deg", type=float, default=2.0)
    s.add_argument("--refresh", action="store_true")
    s.set_defaults(func=cmd_stations)

    e = sub.add_parser("extra-stations", help="add 1-2 stations from every country (once)")
    e.add_argument("--per-country", type=int, default=2, help="minimum stations per country in the end")
    e.add_argument(
        "--pool", type=int, default=10, help="how many best candidates to consider for spatial spread"
    )
    e.set_defaults(func=cmd_extra_stations)

    for name, fn in (("download", cmd_download), ("build", cmd_build)):
        d = sub.add_parser(name)
        d.add_argument("--part", type=int, required=True)
        d.add_argument("--of", type=int, default=4)
        d.add_argument("--end", default=DEFAULT_END)
        d.add_argument("--chunk-years", type=int, default=10)
        d.set_defaults(func=fn)

    m = sub.add_parser("merge")
    m.add_argument("--end", default=DEFAULT_END)
    m.set_defaults(func=cmd_merge)

    a = p.parse_args()
    a.func(a)


if __name__ == "__main__":
    main()
