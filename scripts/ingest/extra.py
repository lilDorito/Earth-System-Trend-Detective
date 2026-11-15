import argparse
import json
import os
import re
import shutil
import sys
import threading
import time
import warnings
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import xarray as xr
from common import ROOT, load_env

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

load_env()
DATA = Path(os.environ.get("EXTRA_DIR", ROOT / "data" / "extra"))
RAW, PROC = DATA / "raw", DATA / "processed"
CACHE = PROC / "months"
Y0, Y1 = 2000, 2025
RANGE = [Y0, Y1]
LAT = np.arange(-89.5, 90, 1.0)
LON = np.arange(-179.5, 180, 1.0)
MONTHS = pd.date_range(f"{Y0}-01-01", f"{Y1}-12-01", freq="MS")

VARS = {
    "aod": ("1", "Total aerosol optical thickness at 550 nm", "MERRA-2 M2TMNXAER v5.12.4, variable TOTEXTTAU (NASA GES DISC)"),
    "to3": ("DU", "Total column ozone", "MERRA-2 M2TMNXCHM v5.12.4, variable TO3 (NASA GES DISC)"),
    "ndvi": ("1", "NDVI, monthly", "MODIS Terra MOD13C2 v061 NetCDF mirror (Univ. Hamburg ICDC)"),
    "burned_area": ("km2/month", "Burned area per 1x1 degree cell", "GFED5 burned area, Chen et al. 2023 (Zenodo 7668424)"),
}
SOURCE_VARS = {"aod": ["aod"], "ozone": ["to3"], "ndvi": ["ndvi"], "fires": ["burned_area"], "co2": []}

MERRA = {
    "aod": ("M2TMNXAER", ["TOTEXTTAU"], "aod"),
    "ozone": ("M2TMNXCHM", ["TO3"], "to3"),
}
ICDC = "https://icdc.cen.uni-hamburg.de/thredds"
ICDC_PATH = "ftpthredds/modis_terra_vegetationindex/DATA"
NDVI_NAMES = ["NDVI", "ndvi", "CMG_0.05_Deg_Monthly_NDVI", "_CMG_0_05_Deg_Monthly_NDVI"]
FIRE_URLS = [
    "https://zenodo.org/records/7668424/files/BA.zip?download=1",
    "https://zenodo.org/records/7668423/files/BA.zip?download=1",
]
CO2_URLS = {
    "co2_global_ppm": [
        "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.csv",
        "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.txt",
    ],
    "co2_mauna_loa_ppm": [
        "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv",
        "https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.txt",
    ],
}

LOGFILE = None
NC_LOCK = threading.Lock()
UA = {"User-Agent": "Mozilla/5.0 (extra_download; student project)"}


def log(*a):
    msg = " ".join(str(x) for x in a)
    print(msg, flush=True)
    if LOGFILE:
        try:
            with open(LOGFILE, "a", encoding="utf-8") as f:
                f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}\n")
        except OSError:
            pass


class AuthError(Exception):
    pass


def is_auth_error(e):
    t = f"{type(e).__name__} {e}".lower()
    return any(k in t for k in ("401", "403", "unauthorized", "forbidden", "invalid token", "authentication", "login failed", "credentials", "eula"))


def ea_login():
    import earthaccess

    if not os.environ.get("EARTHDATA_TOKEN"):
        raise AuthError("EARTHDATA_TOKEN is missing from .env")
    try:
        auth = earthaccess.login(strategy="environment")
    except Exception as e:
        raise AuthError(f"Earthdata login failed: {e}")
    if auth is not None and getattr(auth, "authenticated", True) is False:
        raise AuthError("Earthdata token was rejected (expired?)")
    return earthaccess


def fmt_time(sec):
    sec = int(max(sec, 0))
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"


def fetch(url, dest, retries=4, timeout=120, quiet404=False):
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            h = dict(UA)
            have = part.stat().st_size if part.exists() else 0
            if have:
                h["Range"] = f"bytes={have}-"
            with requests.get(url, headers=h, stream=True, timeout=timeout, allow_redirects=True) as r:
                if r.status_code == 416:
                    part.rename(dest)
                    return True
                if r.status_code in (401, 403):
                    log(f"  ! {r.status_code} for {url}")
                    return False
                if r.status_code == 404:
                    if not quiet404:
                        log(f"  ! 404 (file not found): {url}")
                    return None
                r.raise_for_status()
                mode = "ab" if (have and r.status_code == 206) else "wb"
                done = have if mode == "ab" else 0
                clen = int(r.headers.get("Content-Length", 0) or 0)
                total = done + clen if clen else 0
                t0 = last = time.time()
                start = done
                shown = False
                with open(part, mode) as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
                        done += len(chunk)
                        now = time.time()
                        if now - last >= 5 and (total >= 20e6 or not total):
                            speed = (done - start) / max(now - t0, 1e-6) / 1e6
                            pct = f" ({100 * done / total:.0f}%)" if total else ""
                            eta = f", ~{(total - done) / 1e6 / max(speed, 1e-6) / 60:.0f} min left" if total and speed > 0 else ""
                            print(
                                f"\r  {dest.name}: {done / 1e6:.0f}" + (f" of {total / 1e6:.0f}" if total else "") + f" MB{pct}, {speed:.1f} MB/s{eta}   ",
                                end="",
                                flush=True,
                            )
                            last = now
                            shown = True
                if shown:
                    print()
            part.rename(dest)
            return True
        except Exception as e:
            log(f"  ! attempt {attempt}/{retries}: {e}")
            time.sleep(min(5 * attempt, 30))
    return False


def pick_var(ds, names):
    for n in names:
        if n in ds.variables:
            return n
    raise KeyError(f"None of the variables {names} found; the file has: {list(ds.variables)}")


def find_dim(ds, names):
    for n in names:
        if n in ds.variables or n in ds.dims:
            return n
    raise KeyError(f"None of {names} found; the file has: {list(ds.variables)}")


def regrid(vals, lat, lon, mode="mean"):
    lat = np.asarray(lat)
    lon = np.asarray(lon)
    if lat.ndim == 1:
        lat, lon = np.meshgrid(lat, lon, indexing="ij")
    ilat = np.clip(np.floor(lat + 90).astype(int), 0, 179)
    ilon = np.floor((lon + 180) % 360).astype(int) % 360
    idx = (ilat * 360 + ilon).ravel()
    x = np.asarray(vals, dtype="float64").ravel()
    ok = np.isfinite(x)
    s = np.bincount(idx[ok], weights=x[ok], minlength=64800)
    c = np.bincount(idx[ok], minlength=64800)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = s if mode == "sum" else s / c
    out = np.where(c == 0, np.nan, out)
    return out.reshape(180, 360).astype("float32")


def cache_path(var, y, m):
    return CACHE / var / f"{var}_{y}{m:02d}.npy"


def none_path(var, y, m):
    return CACHE / var / f"{var}_{y}{m:02d}.none"


def month_done(var, y, m):
    return cache_path(var, y, m).exists() or none_path(var, y, m).exists()


def save_month(var, y, m, arr):
    p = cache_path(var, y, m)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    with open(tmp, "wb") as f:
        np.save(f, np.asarray(arr, dtype="float32"))
    tmp.replace(p)


def mark_none(var, y, m):
    p = none_path(var, y, m)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("no data at the source\n")


def ym_iter():
    for y in range(RANGE[0], RANGE[1] + 1):
        for m in range(1, 13):
            yield y, m


def write_status():
    info = {}
    for var in VARS:
        d = CACHE / var
        got = len(list(d.glob("*.npy"))) if d.exists() else 0
        none = len(list(d.glob("*.none"))) if d.exists() else 0
        info[var] = {"months_saved": got, "months_no_data": none, "expected": len(MONTHS)}
    info["co2_csv"] = (PROC / "co2_monthly.csv").exists()
    info["updated"] = time.strftime("%Y-%m-%d %H:%M:%S")
    try:
        PROC.mkdir(parents=True, exist_ok=True)
        (PROC / "status.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    except OSError:
        pass


class Progress:
    def __init__(self, name, total):
        self.name = name
        self.total = total
        self.done = 0
        self.failed = 0
        self.t0 = time.time()
        self.lock = threading.Lock()

    def step(self, label, status):
        with self.lock:
            self.done += 1
            if status == "FAILED":
                self.failed += 1
            el = time.time() - self.t0
            eta = el / self.done * (self.total - self.done)
            log(f"[{self.name}] {self.done}/{self.total} {label} {status} | elapsed {fmt_time(el)} | ETA {fmt_time(eta)}")
            write_status()


def run_months(name, var, fn, workers):
    todo = [(y, m) for y, m in ym_iter() if not month_done(var, y, m)]
    total = sum(1 for _ in ym_iter())
    if not todo:
        log(f"{name}: all {total} months already done")
        return True
    log(f"{name}: {len(todo)} months to do, {total - len(todo)} already done, parallel: {workers}")
    prog = Progress(name, len(todo))
    ex = ThreadPoolExecutor(max_workers=max(1, workers))
    try:
        futs = {ex.submit(fn, y, m): (y, m) for y, m in todo}
        for f in as_completed(futs):
            y, m = futs[f]
            label = f"{var} {y}-{m:02d}"
            try:
                arr = f.result()
            except AuthError:
                raise
            except Exception as e:
                if is_auth_error(e):
                    raise AuthError(f"{name}: {e}")
                log(f"  ! {label}: {type(e).__name__}: {e}")
                prog.step(label, "FAILED")
                continue
            if arr is None:
                mark_none(var, y, m)
                prog.step(label, "no data at source")
            else:
                save_month(var, y, m, arr)
                prog.step(label, "ok")
    except BaseException:
        ex.shutdown(wait=False, cancel_futures=True)
        raise
    ex.shutdown(wait=True)
    return prog.failed == 0


def merra_month(earthaccess, short_name, names, y, m, keep_raw):
    last = pd.Timestamp(year=y, month=m, day=1).days_in_month
    res = earthaccess.search_data(short_name=short_name, temporal=(f"{y}-{m:02d}-01", f"{y}-{m:02d}-{last:02d}"))
    if not res:
        return None
    tmp = RAW / short_name / f"{y}{m:02d}"
    tmp.mkdir(parents=True, exist_ok=True)
    err = None
    for attempt in range(1, 4):
        try:
            paths = [str(p) for p in earthaccess.download(res, str(tmp), threads=2) if p]
            if not paths:
                raise ConnectionError("nothing downloaded")
            files = [p for p in paths if f"{y}{m:02d}" in Path(p).name] or paths[:1]
            with NC_LOCK:
                with xr.open_dataset(files[0]) as ds:
                    v = ds[pick_var(ds, names)]
                    vals = np.squeeze(v.values).astype("float64")
                    lat, lon = ds["lat"].values, ds["lon"].values
            vals[np.abs(vals) > 1e10] = np.nan
            out = regrid(vals, lat, lon)
            if not keep_raw:
                shutil.rmtree(tmp, ignore_errors=True)
            return out
        except Exception as e:
            if is_auth_error(e):
                raise AuthError(f"{short_name}: {e}")
            err = e
            log(f"  ! {short_name} {y}-{m:02d}, attempt {attempt}/3: {type(e).__name__}: {e}")
            time.sleep(15 * attempt)
    raise err


def make_merra_runner(key):
    short_name, names, var = MERRA[key]

    def run(a):
        earthaccess = ea_login()
        return run_months(key, var, lambda y, m: merra_month(earthaccess, short_name, names, y, m, a.keep_raw), a.workers)

    return run


def ndvi_urls(y, m):
    name = f"MODIS-C061_MOD13C2_NDVI__LPDAAC__0.05deg__MONTHLY__UHAM-ICDC__{y}{m:02d}__fv0.01.nc"
    return f"{ICDC}/dodsC/{ICDC_PATH}/{y}/{name}", f"{ICDC}/fileServer/{ICDC_PATH}/{y}/{name}", name


def ndvi_from_dataset(ds, stride):
    name = None
    for n in NDVI_NAMES:
        if n in ds.variables:
            name = n
            break
    if name is None:
        for n in ds.variables:
            if "ndvi" in str(n).lower():
                name = n
                break
    if name is None:
        raise KeyError(f"NDVI variable not found; the file has: {list(ds.variables)}")
    latd = find_dim(ds, ["lat", "latitude", "y"])
    lond = find_dim(ds, ["lon", "longitude", "x"])
    da = ds[name]
    for d in da.dims:
        if d not in (latd, lond):
            da = da.isel({d: 0})
    sub = da.isel({latd: slice(None, None, stride), lond: slice(None, None, stride)})
    vals = sub.values.astype("float64")
    lat = sub[latd].values
    lon = sub[lond].values
    if np.isfinite(vals).any() and np.nanmax(vals) > 2:
        vals = vals / 10000.0
    vals[(vals < -0.3) | (vals > 1.0)] = np.nan
    return regrid(vals, lat, lon)


def ndvi_month(y, m, stride, mode, keep_raw):
    dap, http, name = ndvi_urls(y, m)
    err = None
    if mode in ("auto", "opendap"):
        try:
            with NC_LOCK:
                with xr.open_dataset(dap, engine="netcdf4") as ds:
                    return ndvi_from_dataset(ds, stride)
        except Exception as e:
            err = e
            if mode == "opendap":
                raise
            log(f"  . opendap failed for {y}-{m:02d} ({type(e).__name__}); falling back to full download")
    dest = RAW / "ndvi" / name
    r = fetch(http, dest, quiet404=True)
    if r is None:
        return None
    if not r:
        raise ConnectionError(f"download failed for {name}" + (f" (opendap error: {err})" if err else ""))
    try:
        with NC_LOCK:
            with xr.open_dataset(dest) as ds:
                out = ndvi_from_dataset(ds, stride)
    finally:
        if not keep_raw:
            try:
                dest.unlink()
            except OSError:
                pass
    return out


def run_ndvi(a):
    workers = 1 if a.ndvi_mode == "opendap" else a.workers
    return run_months("ndvi", "ndvi", lambda y, m: ndvi_month(y, m, a.stride, a.ndvi_mode, a.keep_raw), workers)


def run_fires(a):
    zp = RAW / "fires" / "BA.zip"
    got = False
    for url in FIRE_URLS:
        if fetch(url, zp, quiet404=True):
            got = True
            break
    if not got:
        log("  ! could not download BA.zip from Zenodo (check https://zenodo.org/records/7668424 and the file name)")
        return False
    with zipfile.ZipFile(zp) as z:
        members = {}
        for n in z.namelist():
            mt = re.search(r"BA(\d{4})(\d{2})\.nc$", n)
            if mt:
                members[(int(mt.group(1)), int(mt.group(2)))] = n
        if not members:
            log(f"  ! no BAYYYYMM.nc files inside the archive: {z.namelist()[:10]}")
            return False
        todo = [(y, m) for y, m in ym_iter() if not month_done("burned_area", y, m)]
        if not todo:
            log("fires: all months already done")
            return True
        log(f"fires: {len(todo)} months to do, {len(members)} months in the archive")
        prog = Progress("fires", len(todo))
        tmpdir = RAW / "fires" / "tmp"
        tmpdir.mkdir(parents=True, exist_ok=True)
        for y, m in todo:
            label = f"burned_area {y}-{m:02d}"
            if (y, m) not in members:
                mark_none("burned_area", y, m)
                prog.step(label, "no data at source")
                continue
            try:
                p = Path(z.extract(members[(y, m)], tmpdir))
                with xr.open_dataset(p) as ds:
                    v = ds["Total"] if "Total" in ds.variables else ds[pick_var(ds, ["total", "BA", "burned_area"])]
                    vals = np.squeeze(v.values).astype("float64")
                    lat, lon = ds["lat"].values, ds["lon"].values
                save_month("burned_area", y, m, regrid(vals, lat, lon, mode="sum"))
                prog.step(label, "ok")
                p.unlink()
            except Exception as e:
                log(f"  ! {label}: {type(e).__name__}: {e}")
                prog.step(label, "FAILED")
        shutil.rmtree(tmpdir, ignore_errors=True)
    return prog.failed == 0


def read_co2(path):
    try:
        df = pd.read_csv(path, comment="#")
        df.columns = [str(c).strip().lower() for c in df.columns]
        if not {"year", "month", "average"} <= set(df.columns):
            raise ValueError("unexpected columns")
        return df[["year", "month", "average"]]
    except Exception:
        df = pd.read_csv(path, sep=r"\s+", comment="#", header=None)
        df = df.iloc[:, [0, 1, 3]]
        df.columns = ["year", "month", "average"]
        return df


def run_co2(a):
    PROC.mkdir(parents=True, exist_ok=True)
    series = {}
    for col, urls in CO2_URLS.items():
        for url in urls:
            p = RAW / "co2" / (col + Path(url).suffix)
            if p.exists():
                p.unlink()
            if not fetch(url, p):
                continue
            try:
                df = read_co2(p)
            except Exception as e:
                log(f"  ! {col}: cannot parse {url}: {e}")
                continue
            df = df.astype(float)
            df = df[(df["average"] > 0)]
            t = pd.to_datetime(dict(year=df["year"].astype(int), month=df["month"].astype(int), day=1))
            series[col] = pd.Series(df["average"].values, index=t)
            log(f"  {col}: {len(df)} months from {url}")
            break
    if not series:
        return False
    out = pd.DataFrame(series).reindex(MONTHS)
    out.index.name = "time"
    out.to_csv(PROC / "co2_monthly.csv", encoding="utf-8")
    write_status()
    log(f"  saved {PROC / 'co2_monthly.csv'}")
    return len(series) == len(CO2_URLS)


RUNNERS = {"aod": make_merra_runner("aod"), "ozone": make_merra_runner("ozone"), "ndvi": run_ndvi, "fires": run_fires, "co2": run_co2}

NEEDS = {
    "aod": (["EARTHDATA_TOKEN"], ["earthaccess"]),
    "ozone": (["EARTHDATA_TOKEN"], ["earthaccess"]),
    "ndvi": ([], ["netCDF4"]),
    "fires": ([], []),
    "co2": ([], []),
}


def preflight(src):
    keys, pkgs = NEEDS[src]
    miss = [k for k in keys if not os.environ.get(k)]
    if miss:
        return "missing from .env: " + ", ".join(miss)
    for p in pkgs:
        try:
            __import__(p)
        except ImportError:
            return f"package {p} is not installed (pip install -r requirements-ingest.txt)"
    return None


def cmd_merge(a):
    rows = []
    PROC.mkdir(parents=True, exist_ok=True)
    for var, (units, desc, src) in VARS.items():
        arr = np.full((len(MONTHS), 180, 360), np.nan, dtype="float32")
        n = 0
        for i, t in enumerate(MONTHS):
            p = cache_path(var, t.year, t.month)
            if p.exists():
                arr[i] = np.load(p)
                n += 1
        if n == 0:
            rows.append((var, 0, "-", "-", "no data", src))
            continue
        da = xr.DataArray(
            arr,
            dims=("time", "lat", "lon"),
            coords={"time": MONTHS, "lat": LAT, "lon": LON},
            attrs={"units": units, "long_name": desc, "source": src},
        )
        out = xr.Dataset({var: da}, attrs={"title": desc, "source": src})
        tmp = PROC / f"{var}.nc.tmp"
        out.to_netcdf(tmp, encoding={var: {"zlib": True, "complevel": 4, "shuffle": True}})
        tmp.replace(PROC / f"{var}.nc")
        valid = da.notnull().any(dim=("lat", "lon")).values
        yrs = pd.DatetimeIndex(MONTHS[valid])
        rows.append((var, int(valid.sum()), yrs.min().strftime("%Y-%m"), yrs.max().strftime("%Y-%m"), f"{100 * float(np.isfinite(arr).mean()):.1f}% of cells filled", src))
    cp = PROC / "co2_monthly.csv"
    if cp.exists():
        d = pd.read_csv(cp, parse_dates=["time"])
        v = d.dropna(subset=[c for c in d.columns if c != "time"], how="all")
        rows.append(("co2_monthly.csv", len(v), v["time"].min().strftime("%Y-%m"), v["time"].max().strftime("%Y-%m"), "global series (CSV)", "NOAA GML, co2_mm_gl and co2_mm_mlo"))
    df = pd.DataFrame(rows, columns=["variable", "months", "from", "to", "coverage", "source"])
    df.to_csv(PROC / "catalog.csv", index=False, encoding="utf-8")
    log(df.to_string(index=False))
    log(f"\nFiles: {PROC}/<variable>.nc, catalog: {PROC / 'catalog.csv'}")
    write_status()


def cmd_status(a):
    write_status()
    total = len(MONTHS)
    log(f"Progress (expected {total} months per variable):")
    for var in VARS:
        d = CACHE / var
        got = len(list(d.glob("*.npy"))) if d.exists() else 0
        none = len(list(d.glob("*.none"))) if d.exists() else 0
        left = total - got - none
        bar = "#" * int(20 * (got + none) / total)
        log(f"  {var:12s} [{bar:<20s}] saved {got:3d}, no data {none:3d}, left {left:3d}")
    cp = PROC / "co2_monthly.csv"
    log(f"  {'co2':12s} {'saved' if cp.exists() else 'not downloaded yet'}")
    lf = DATA / "run.log"
    if lf.exists():
        log("\nLast log lines:")
        for line in lf.read_text(encoding="utf-8").splitlines()[-8:]:
            log("  " + line)


def cmd_list(a):
    log("Variables:")
    for var, (u, d, s) in VARS.items():
        log(f"  {var:12s} {u:10s} {d}\n               source: {s}")
    log("  co2_monthly.csv  ppm  NOAA GML global and Mauna Loa monthly mean CO2")
    log("\nSources for --source:")
    for s, v in SOURCE_VARS.items():
        log(f"  {s:8s} -> {', '.join(v) if v else 'co2_monthly.csv'}")


def check_disk():
    DATA.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(DATA).free / 1e9
    if free < 3:
        sys.exit(f"Not enough disk space: {free:.1f} GB free, at least 3 GB needed.")


def run_source(s, a):
    try:
        return "ok" if RUNNERS[s](a) else "fail"
    except AuthError as e:
        log(f"  ! {s}: CREDENTIALS PROBLEM: {e}")
        log("    Check EARTHDATA_TOKEN in .env. For MERRA-2 also authorize the GES DISC application under Applications > Authorized Apps at https://urs.earthdata.nasa.gov (or open a MERRA-2 file once in the browser and accept the EULA), then run the command again: finished months are skipped.")
        return "auth"
    except KeyboardInterrupt:
        raise
    except MemoryError:
        log(f"  ! {s}: out of memory (close other programs and run again)")
        return "fail"
    except requests.exceptions.RequestException as e:
        log(f"  ! {s}: network or server failure: {e}")
        return "fail"
    except OSError as e:
        log(f"  ! {s}: file/disk error: {e}")
        return "fail"
    except Exception as e:
        log(f"  ! {s}: {type(e).__name__}: {e}")
        return "fail"


def cmd_run(a):
    global LOGFILE
    DATA.mkdir(parents=True, exist_ok=True)
    LOGFILE = DATA / "run.log"
    if a.years:
        y0, y1 = (int(x) for x in a.years.split("-"))
        RANGE[0], RANGE[1] = max(y0, Y0), min(y1, Y1)
    srcs = a.source.split(",") if a.source else list(RUNNERS)
    bad = [s for s in srcs if s not in RUNNERS]
    if bad:
        sys.exit(f"Unknown source: {bad}. Available: {list(RUNNERS)}")
    check_disk()
    status = {}
    todo = []
    for s in srcs:
        problem = preflight(s)
        if problem:
            status[s] = f"skipped ({problem})"
            log(f"{s}: skipped, {problem}")
        else:
            todo.append(s)
    try:
        for attempt in range(1, a.passes + 1):
            if not todo:
                break
            if attempt > 1:
                log(f"\n--- retry {attempt}/{a.passes} for: {', '.join(todo)} (30 s pause) ---")
                time.sleep(30)
            still = []
            for s in todo:
                log(f"\n=== {s} ===")
                r = run_source(s, a)
                if r == "ok":
                    status[s] = "done"
                elif r == "auth":
                    status[s] = "CREDENTIALS PROBLEM (not retrying)"
                else:
                    status[s] = "incomplete"
                    still.append(s)
            todo = still
    except KeyboardInterrupt:
        log("\nStopped manually. Run the same command again: finished months are skipped.")
        sys.exit(130)
    if not a.no_merge:
        log("\n=== merge ===")
        try:
            cmd_merge(None)
        except Exception as e:
            log(f"  ! merge: {type(e).__name__}: {e}")
    log("\nSUMMARY:")
    for s in srcs:
        log(f"  {s:8s} {status.get(s, '?')}")
    log(f"Log: {LOGFILE}")
    bad = [s for s, v in status.items() if v != "done"]
    sys.exit(1 if bad else 0)


def main():
    ap = argparse.ArgumentParser(description="Download monthly 1x1 degree extra grids (aerosols, ozone, NDVI, burned area) and CO2 for 2000-2025")
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("list").set_defaults(f=cmd_list)
    sp.add_parser("status").set_defaults(f=cmd_status)
    sp.add_parser("merge").set_defaults(f=cmd_merge)
    r = sp.add_parser("run")
    r.add_argument("--source", help="comma-separated: " + ",".join(RUNNERS))
    r.add_argument("--workers", type=int, default=4, help="parallel months for MERRA-2 and NDVI downloads (default 4)")
    r.add_argument("--stride", type=int, default=5, help="NDVI: read every Nth 0.05 degree cell (default 5 = 0.25 degree)")
    r.add_argument("--ndvi-mode", choices=["auto", "opendap", "download"], default="auto")
    r.add_argument("--years", help="limit to a year range, e.g. 2000-2012 (lets you run several windows in parallel)")
    r.add_argument("--keep-raw", action="store_true")
    r.add_argument("--passes", type=int, default=3)
    r.add_argument("--no-merge", action="store_true")
    r.set_defaults(f=cmd_run)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
