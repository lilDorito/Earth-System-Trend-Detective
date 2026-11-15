# monthly 1x1 degree ocean grids, 2000-2025, from public sources: one year file per variable, then merged
#
#   python scripts/ingest/ocean.py list | run [--part N | --source a,b] [--workers 8] | merge

import argparse
import os
import warnings
import re
import shutil
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd
import requests
import xarray as xr
from common import ROOT, load_env

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", message="Mean of empty slice")

load_env()
DATA = Path(os.environ.get("OCEAN_DIR", ROOT / "data" / "ocean"))
RAW, PROC = DATA / "raw", DATA / "processed"
Y0, Y1 = 2000, 2025
LAT = np.arange(-89.5, 90, 1.0)
LON = np.arange(-179.5, 180, 1.0)
MONTHS = pd.date_range(f"{Y0}-01-01", f"{Y1}-12-01", freq="MS")

VARS = {
    "sst": ("degC", "Sea surface temperature (NOAA OISST v2.1)"),
    "sla": ("m", "Sea level anomaly (CMEMS DUACS)"),
    "sea_ice_conc": ("fraction 0-1", "Sea ice concentration (NOAA/NSIDC CDR)"),
    "sss": ("psu", "Sea surface salinity, ~5 m level (EN4)"),
    "sal_0_700": ("psu", "Mean salinity 0-700 m (EN4)"),
    "ohc_0_700": ("J/m2", "Ocean heat content 0-700 m relative to 0 degC (EN4)"),
    "ohc_0_2000": ("J/m2", "Ocean heat content 0-2000 m relative to 0 degC (EN4)"),
    "ph": ("pH total scale", "Surface ocean pH (OceanSODA-ETHZ)"),
    "pco2": ("uatm", "Surface ocean pCO2 (OceanSODA-ETHZ)"),
    "chlor_a": ("mg/m3", "Chlorophyll-a, geometric mean (NASA MODIS-Aqua)"),
    "u_current": ("m/s", "Surface current, eastward (OSCAR)"),
    "v_current": ("m/s", "Surface current, northward (OSCAR)"),
    "ocean_mass": ("cm LWE", "Ocean mass, liquid water equivalent (GRACE/GRACE-FO JPL)"),
}
SOURCE_VARS = {
    "oisst": ["sst"],
    "sealevel": ["sla"],
    "grace": ["ocean_mass"],
    "en4": ["sss", "sal_0_700", "ohc_0_700", "ohc_0_2000"],
    "chl": ["chlor_a"],
    "seaice": ["sea_ice_conc"],
    "oceansoda": ["ph", "pco2"],
    "oscar": ["u_current", "v_current"],
}
PARTS = {0: ["oisst", "sealevel", "grace"], 1: ["en4"], 2: ["chl", "seaice", "oceansoda"], 3: ["oscar"]}


LOGFILE = None


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


# libraries report rejected credentials in different ways; those failures must not be retried
def is_auth_error(e):
    t = f"{type(e).__name__} {e}".lower()
    return any(
        k in t
        for k in (
            "401",
            "403",
            "unauthorized",
            "forbidden",
            "invalid token",
            "authentication",
            "login failed",
            "credentials",
        )
    )


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


UA = {"User-Agent": "Mozilla/5.0 (ocean_download; student project)"}


# resumable download (HTTP Range on the .part file): True when saved, False on failure, None on 404
def fetch(url, dest, headers=None, retries=4, timeout=120, quiet404=False):
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size > 0:
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            h = {**UA, **(headers or {})}
            have = part.stat().st_size if part.exists() else 0
            if have:
                h["Range"] = f"bytes={have}-"
            with requests.get(url, headers=h, stream=True, timeout=timeout, allow_redirects=True) as r:
                if r.status_code == 416:
                    part.rename(dest)
                    return True
                if r.status_code in (401, 403):
                    if headers and "Authorization" in headers:
                        raise AuthError(f"{r.status_code} for {url}: token rejected or expired")
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
                            eta = (
                                f", ~{(total - done) / 1e6 / max(speed, 1e-6) / 60:.0f} min left"
                                if total and speed > 0
                                else ""
                            )
                            print(
                                f"\r  {dest.name}: {done / 1e6:.0f}"
                                + (f" of {total / 1e6:.0f}" if total else "")
                                + f" MB{pct}, {speed:.1f} MB/s{eta}   ",
                                end="",
                                flush=True,
                            )
                            last = now
                            shown = True
                if shown:
                    print()
            part.rename(dest)
            return True
        except AuthError:
            raise
        except Exception as e:
            log(f"  ! attempt {attempt}/{retries}: {e}")
            time.sleep(min(5 * attempt, 30))
    return False


def pick_var(ds, names):
    for n in names:
        if n in ds.variables:
            return n
    raise KeyError(f"None of the variables {names} found; the file has: {list(ds.variables)}")


def regrid(vals, lat, lon):
    lat = np.asarray(lat)
    lon = np.asarray(lon)
    if lat.ndim == 1:
        lat, lon = np.meshgrid(lat, lon, indexing="ij")
    ilat = np.clip(np.floor(lat + 90).astype(int), 0, 179)
    ilon = np.floor((lon + 180) % 360).astype(int) % 360
    idx = (ilat * 360 + ilon).ravel()
    v = np.asarray(vals, dtype="float64")
    lead = v.shape[:-2]
    v = v.reshape(-1, idx.size)
    out = np.full((v.shape[0], 64800), np.nan, dtype="float32")
    for k in range(v.shape[0]):
        x = v[k]
        ok = np.isfinite(x)
        s = np.bincount(idx[ok], weights=x[ok], minlength=64800)
        c = np.bincount(idx[ok], minlength=64800)
        with np.errstate(invalid="ignore", divide="ignore"):
            m = s / c
        m[c == 0] = np.nan
        out[k] = m
    return out.reshape(*lead, 180, 360)


def year_path(var, year):
    return PROC / var / f"{var}_{year}.nc"


def year_done(vars_, year):
    return all(year_path(v, year).exists() for v in vars_)


def save_year(var, year, month_arrays):
    arr = np.full((12, 180, 360), np.nan, dtype="float32")
    for m, a in month_arrays.items():
        arr[m - 1] = a
    units, desc = VARS[var]
    ds = xr.Dataset(
        {var: (("time", "lat", "lon"), arr, {"units": units, "long_name": desc})},
        coords={"time": pd.date_range(f"{year}-01-01", periods=12, freq="MS"), "lat": LAT, "lon": LON},
    )
    p = year_path(var, year)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    ds.to_netcdf(tmp, encoding={var: {"zlib": True, "complevel": 4, "shuffle": True}})
    tmp.replace(p)


def save_series(var, series):
    by_year = {}
    for (y, m), a in series.items():
        if Y0 <= y <= Y1:
            by_year.setdefault(y, {})[m] = a
    for y, d in by_year.items():
        save_year(var, y, d)
    log(f"  saved {var}: years {min(by_year) if by_year else '-'}..{max(by_year) if by_year else '-'}")


OISST_URLS = [
    "https://psl.noaa.gov/thredds/fileServer/Datasets/noaa.oisst.v2.highres/sst.mon.mean.nc",
    "https://downloads.psl.noaa.gov/Datasets/noaa.oisst.v2.highres/sst.mon.mean.nc",
]


def proc_oisst(path):
    ds = xr.open_dataset(path)
    var = pick_var(ds, ["sst"])
    series = {}
    t = pd.DatetimeIndex(ds["time"].values)
    for i, ts in enumerate(t):
        if Y0 <= ts.year <= Y1:
            series[(ts.year, ts.month)] = regrid(
                ds[var].isel(time=i).values, ds["lat"].values, ds["lon"].values
            )
    save_series("sst", series)


def run_oisst(a):
    if year_done(["sst"], Y1):
        log("oisst: done")
        return True
    dest = RAW / "oisst" / "sst.mon.mean.nc"
    ok = any(fetch(u, dest) for u in OISST_URLS)
    if not ok:
        log(
            "oisst: download failed. Fetch sst.mon.mean.nc manually (psl.noaa.gov, NOAA OISST V2 High Res) into data/ocean/raw/oisst/"
        )
        return False
    proc_oisst(dest)
    return True


SL_DATASET = "cmems_obs-sl_glo_phy-ssh_my_allsat-l4-duacs-0.125deg_P1M-m"


def proc_sealevel(path):
    ds = xr.open_dataset(path)
    var = pick_var(ds, ["sla", "adt"])
    series = {}
    for i, ts in enumerate(pd.DatetimeIndex(ds["time"].values)):
        series[(ts.year, ts.month)] = regrid(
            ds[var].isel(time=i).values,
            ds["latitude"].values if "latitude" in ds else ds["lat"].values,
            ds["longitude"].values if "longitude" in ds else ds["lon"].values,
        )
    return series


def run_sealevel(a):
    try:
        import copernicusmarine as cm
    except ImportError:
        log("sealevel: the copernicusmarine package is required (pip install copernicusmarine)")
        return False
    import inspect

    user, pw = os.environ.get("CMEMS_USERNAME"), os.environ.get("CMEMS_PASSWORD")
    if not user or not pw:
        log(
            "sealevel: set CMEMS_USERNAME and CMEMS_PASSWORD in .env (free account at data.marine.copernicus.eu)"
        )
        return False
    params = inspect.signature(cm.subset).parameters
    allok = True
    for y in range(Y0, Y1 + 1):
        if year_done(["sla"], y):
            continue
        f = RAW / "sealevel" / f"sla_{y}.nc"
        if not f.exists():
            kw = dict(
                dataset_id=SL_DATASET,
                variables=["sla"],
                minimum_longitude=-180,
                maximum_longitude=180,
                minimum_latitude=-90,
                maximum_latitude=90,
                start_datetime=f"{y}-01-01T00:00:00",
                end_datetime=f"{y}-12-31T23:59:59",
                output_directory=str(f.parent),
                output_filename=f.name,
                username=user,
                password=pw,
            )
            if "overwrite" in params:
                kw["overwrite"] = True
            if "force_download" in params:
                kw["force_download"] = True
            try:
                cm.subset(**kw)
            except Exception as e:
                if is_auth_error(e):
                    raise AuthError(f"sealevel: CMEMS login/password rejected ({e})")
                log(f"  ! sealevel {y}: {e}")
                allok = False
                continue
        if f.exists():
            try:
                s = proc_sealevel(f)
                save_series("sla", s)
                if not a.keep_raw:
                    f.unlink()
            except Exception as e:
                log(f"  ! sealevel {y}: {e}")
                allok = False
    return allok


def proc_grace(path):
    ds = xr.open_dataset(path)
    var = pick_var(ds, ["lwe_thickness"])
    lat, lon = ds["lat"].values, ds["lon"].values
    land = ds["land_mask"].values if "land_mask" in ds else None
    if land is not None and land.ndim == 3:
        land = land[0]
    series, acc = {}, {}
    for i, ts in enumerate(pd.DatetimeIndex(ds["time"].values)):
        v = ds[var].isel(time=i).values.astype("float64")
        v[v < -9000] = np.nan
        if land is not None:
            v = np.where(land == 0, v, np.nan)
        acc.setdefault((ts.year, ts.month), []).append(v)
    for k, lst in acc.items():
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            series[k] = regrid(np.nanmean(lst, axis=0), lat, lon)
    save_series("ocean_mass", series)


def run_grace(a):
    if year_done(["ocean_mass"], Y1):
        log("grace: done")
        return True
    f = list((RAW / "grace").glob("*.nc"))
    if not f:
        earthaccess = ea_login()
        res = earthaccess.search_data(short_name="TELLUS_GRAC-GRFO_MASCON_CRI_GRID_RL06.3_V4")
        if not res:
            log("grace: dataset not found in Earthdata (check EARTHDATA_TOKEN)")
            return False
        (RAW / "grace").mkdir(parents=True, exist_ok=True)
        earthaccess.download(res, str(RAW / "grace"))
        f = list((RAW / "grace").glob("*.nc"))
    if not f:
        log("grace: file download failed")
        return False
    proc_grace(f[0])
    return True


EN4_LIST = "https://hadleyserver.metoffice.gov.uk/en4/EN.4.2.2.analyses.g10.download-list.txt"
RHO, CP = 1025.0, 3985.0  # seawater density (kg/m3) and specific heat (J/kg/K) for heat content


def layer_weights(depth, h):
    d = np.asarray(depth, dtype="float64")
    edges = np.concatenate([[0.0], (d[:-1] + d[1:]) / 2, [d[-1] + (d[-1] - d[-2]) / 2]])
    return np.clip(np.minimum(edges[1:], h) - np.maximum(edges[:-1], 0), 0, None)


def proc_en4_month(path):
    ds = xr.open_dataset(path)
    T = ds["temperature"].isel(time=0).values.astype("float64")
    S = ds["salinity"].isel(time=0).values.astype("float64")
    if np.nanmean(T) > 100:
        T = T - 273.15
    depth = ds["depth"].values
    out = {}
    out["sss"] = regrid(S[0], ds["lat"].values, ds["lon"].values)
    for name, h in (("0_700", 700.0), ("0_2000", 2000.0)):
        w = layer_weights(depth, h)
        use = w > 0
        wv = w[use][:, None, None]
        # only full water columns: a shelf sea shallower than h has no heat content for that layer
        ok = np.all(np.isfinite(T[use]), axis=0)
        heat = RHO * CP * np.nansum(T[use] * wv, axis=0)
        heat = np.where(ok, heat, np.nan)
        out[f"ohc_{name}"] = regrid(heat, ds["lat"].values, ds["lon"].values)
        if h == 700.0:
            oks = np.all(np.isfinite(S[use]), axis=0)
            sal = np.nansum(S[use] * wv, axis=0) / w[use].sum()
            out["sal_0_700"] = regrid(np.where(oks, sal, np.nan), ds["lat"].values, ds["lon"].values)
    return out


def proc_en4_zip(zpath, year, tmpdir):
    acc = {v: {} for v in SOURCE_VARS["en4"]}
    with zipfile.ZipFile(zpath) as z:
        for name in sorted(z.namelist()):
            m = re.search(r"(\d{4})(\d{2})\.nc$", name)
            if not m or int(m.group(1)) != year:
                continue
            tmpdir.mkdir(parents=True, exist_ok=True)
            p = Path(z.extract(name, tmpdir))
            res = proc_en4_month(p)
            for v, arr in res.items():
                acc[v][int(m.group(2))] = arr
            p.unlink()
    for v, d in acc.items():
        if d:
            save_year(v, year, d)


def run_en4(a):
    vars_ = SOURCE_VARS["en4"]
    todo = [y for y in range(Y0, Y1 + 1) if not year_done(vars_, y)]
    if not todo:
        log("en4: done")
        return True
    try:
        txt = requests.get(EN4_LIST, timeout=60).text
    except Exception as e:
        log(f"en4: could not get the file list: {e}")
        return False
    urls = {}
    for line in txt.split():
        m = re.search(r"analyses\.g10\.(\d{4})\.zip", line)
        if m and line.startswith("http"):
            urls[int(m.group(1))] = line
    allok = True
    for y in todo:
        if y not in urls:
            log(f"  en4 {y}: not in the list")
            allok = False
            continue
        z = RAW / "en4" / f"EN.4.2.2.analyses.g10.{y}.zip"
        log(f"en4 {y}: downloading")
        if not fetch(urls[y], z):
            allok = False
            continue
        try:
            proc_en4_zip(z, y, RAW / "en4" / "tmp")
            if not a.keep_raw:
                z.unlink()
        except Exception as e:
            log(f"  ! en4 {y}: {e}")
            allok = False
    return allok


def chl_name(y, m):
    last = pd.Timestamp(year=y, month=m, day=1).days_in_month
    return f"AQUA_MODIS.{y}{m:02d}01_{y}{m:02d}{last:02d}.L3m.MO.CHL.chlor_a.9km.nc"


# geometric mean: chlorophyll is log-normally distributed
def proc_chl(path):
    ds = xr.open_dataset(path)
    v = ds[pick_var(ds, ["chlor_a"])].values.astype("float64")
    v = np.where(v > 0, np.log10(np.where(v > 0, v, 1.0)), np.nan)
    m = regrid(v, ds["lat"].values, ds["lon"].values)
    return (10.0**m).astype("float32")


def run_chl(a):
    tok = os.environ.get("EARTHDATA_TOKEN")
    if not tok:
        log("chl: set EARTHDATA_TOKEN in .env")
        return False
    hdr = {"Authorization": f"Bearer {tok}"}
    allok = True
    for y in range(2002, Y1 + 1):
        if year_done(["chlor_a"], y):
            continue
        d = {}
        year_ok = True
        for m in range(1, 13):
            if (y, m) < (2002, 7):
                continue
            n = chl_name(y, m)
            f = RAW / "chl" / n
            r = fetch(f"https://oceandata.sci.gsfc.nasa.gov/ob/getfile/{n}", f, headers=hdr, quiet404=True)
            if r is None:
                log(f"  chl {y}-{m:02d}: this month is not on the server yet")
                continue
            if not r:
                allok = False
                year_ok = False
                continue
            try:
                d[m] = proc_chl(f)
                if not a.keep_raw:
                    f.unlink()
            except Exception as e:
                log(f"  ! chl {y}-{m:02d}: {e}")
                allok = False
                year_ok = False
        if d and year_ok:
            save_year("chlor_a", y, d)
            log(f"chl {y}: months {len(d)}")
    return allok


SI_CRS = {"nh": "EPSG:3411", "sh": "EPSG:3412"}


def proc_seaice_file(path, hemi):
    from pyproj import Transformer

    ds = xr.open_dataset(path)
    var = pick_var(ds, ["cdr_seaice_conc_monthly", "seaice_conc_monthly_cdr", "cdr_seaice_conc"])
    v = ds[var].squeeze().values.astype("float64")
    v = np.where((v >= 0) & (v <= 1.0), v, np.nan)
    xn = "xgrid" if "xgrid" in ds.variables else "x"
    yn = "ygrid" if "ygrid" in ds.variables else "y"
    xs, ys = ds[xn].values, ds[yn].values
    X, Y = np.meshgrid(xs, ys)
    lon, lat = Transformer.from_crs(SI_CRS[hemi], "EPSG:4326", always_xy=True).transform(X, Y)
    return regrid(v, lat, lon)


SI_HOSTS = [
    "https://coastwatch.pfeg.noaa.gov/erddap/files/nsidcG02202v4{h}mday/",
    "https://polarwatch.noaa.gov/erddap/files/nsidcG02202v4{h}mday/",
]


# the satellite in the file name changes over the years; without a directory listing, try the likely ones
def seaice_names(y, m, h, listing):
    if (y, m, h) in listing:
        return [listing[(y, m, h)]]
    sats = ["f13", "f17"] if y <= 2007 else ["f17", "f13", "f18"]
    return [f"seaice_conc_monthly_{h}_{y}{m:02d}_{sat}_v04r00.nc" for sat in sats]


def run_seaice(a):
    allok = True
    listing = {}
    fails = {b: 0 for b in SI_HOSTS}
    for h in ("nh", "sh"):
        for base in SI_HOSTS:
            try:
                r = requests.get(base.format(h=h), headers=UA, timeout=60)
                r.raise_for_status()
                n0 = len(listing)
                for mm in re.finditer(r"(seaice_conc_monthly_%s_(\d{6})_\w+?_v04r00\.nc)" % h, r.text):
                    ym = mm.group(2)
                    listing[(int(ym[:4]), int(ym[4:]), h)] = mm.group(1)
                if len(listing) > n0:
                    break
            except Exception as e:
                log(f"  seaice {h}: directory {base.split('/')[2]} unavailable ({e})")
    log(
        f"  seaice: files found in the directory: {len(listing)}"
        + ("" if listing else " (guessing file names)")
    )
    found_any = False
    for y in range(Y0, Y1 + 1):
        if year_done(["sea_ice_conc"], y):
            found_any = True
            continue
        d = {}
        year_ok = True
        for m in range(1, 13):
            parts = []
            for h in ("nh", "sh"):
                got = False
                net_fail = False
                for name in seaice_names(y, m, h, listing):
                    f = RAW / "seaice" / name
                    ok = None
                    for base in SI_HOSTS:
                        if fails[base] >= 3:
                            continue
                        r = fetch(base.format(h=h) + name, f, quiet404=True, retries=2)
                        if r:
                            fails[base] = 0
                            ok = True
                            break
                        if r is None:
                            break
                        fails[base] += 1
                        net_fail = True
                        if fails[base] == 3:
                            log(
                                f"  ! seaice: {base.split('/')[2]} is not responding, switching to another mirror"
                            )
                    if ok:
                        got = True
                        try:
                            parts.append(proc_seaice_file(f, h))
                            if not a.keep_raw:
                                f.unlink()
                        except Exception as e:
                            log(f"  ! seaice {y}-{m:02d} {h}: {e}")
                            allok = False
                            year_ok = False
                        break
                if not got and net_fail:
                    allok = False
                    year_ok = False
            if parts:
                d[m] = np.nanmean(np.stack(parts), axis=0) if len(parts) > 1 else parts[0]
        if d and year_ok:
            found_any = True
            save_year("sea_ice_conc", y, d)
            log(f"seaice {y}: months {len(d)}")
        if all(v >= 3 for v in fails.values()):
            log("  ! seaice: all mirrors are unavailable right now. Try later: finished years are saved.")
            return False
    if not found_any:
        log("  ! seaice: no files found (servers are down or the address changed). Try later.")
        return False
    return allok


OSODA_FILE = "OceanSODA_ETHZ-v2023.OCADS.01_1982-2022.nc"
OSODA_URLS = [
    "https://www.ncei.noaa.gov/data/oceans/ncei/ocads/data/0220059/" + OSODA_FILE,
    "https://data.cioospacific.ca/ocads/gov.noaa.nodc_0220059/ftp_files/5.5/data/0-data/" + OSODA_FILE,
]


def proc_oceansoda(path):
    ds = xr.open_dataset(path, decode_times=False)
    tvals = ds["time"]
    try:
        t = pd.DatetimeIndex(xr.decode_cf(ds)["time"].values)
    except Exception:
        t = pd.date_range("1982-01-01", periods=tvals.size, freq="MS")
    if len(t) != tvals.size or t[0].year < 1900:
        t = pd.date_range("1982-01-01", periods=tvals.size, freq="MS")
    lat = ds["lat"].values if "lat" in ds else ds["latitude"].values
    lon = ds["lon"].values if "lon" in ds else ds["longitude"].values
    for var, names in (("ph", ["ph_total", "pH", "ph"]), ("pco2", ["spco2", "pCO2", "pco2", "sfco2"])):
        name = pick_var(ds, names)
        series = {}
        for i, ts in enumerate(t):
            if Y0 <= ts.year <= Y1:
                series[(ts.year, ts.month)] = regrid(ds[name].isel(time=i).values, lat, lon)
        save_series(var, series)


OSODA_DIR = "https://www.ncei.noaa.gov/data/oceans/ncei/ocads/data/0220059/"


def oceansoda_urls():
    try:
        r = requests.get(OSODA_DIR, headers=UA, timeout=60)
        r.raise_for_status()
        names = sorted(set(re.findall(r"(OceanSODA_ETHZ[\w.\-]*\.nc)", r.text)), reverse=True)
        if names:
            log(f"  oceansoda: files in the NCEI directory: {', '.join(names)}")
            return [OSODA_DIR + n for n in names]
        log("  oceansoda: no .nc files in the NCEI directory")
    except Exception as e:
        log(
            f"  oceansoda: NCEI directory unavailable ({e}); NCEI is sometimes down for maintenance, try later"
        )
    return [OSODA_DIR + OSODA_FILE] + OSODA_URLS[1:]


def run_oceansoda(a):
    # 2022 is the last year every OceanSODA release covers
    if year_done(["ph", "pco2"], 2022):
        log("oceansoda: done")
        return True
    d = RAW / "oceansoda"
    have = sorted(d.glob("*.nc")) if d.exists() else []
    if not have:
        for u in oceansoda_urls():
            dest = d / u.rsplit("/", 1)[1]
            if fetch(u, dest, quiet404=True):
                have = [dest]
                break
    if not have:
        log(
            "oceansoda: automatic download failed (NCEI is unavailable or the file was renamed).\n"
            "  Download the .nc file manually from https://www.ncei.noaa.gov/data/oceans/ncei/ocads/data/0220059/ "
            "(or via https://doi.org/10.25921/m5wx-ja34) and put it into data/ocean/raw/oceansoda/ (any file name works)."
        )
        return False
    proc_oceansoda(have[-1])
    return True


def oscar_field(da, lat_da, lon_da):
    da = da.squeeze(drop=True)
    return da.transpose(lat_da.dims[0], lon_da.dims[0]).values.astype("float64")


def proc_oscar_month(files):
    s_u = s_v = n_u = n_v = None
    lat = lon = None
    for f in files:
        ds = xr.open_dataset(f)
        lat_da = ds["lat"] if "lat" in ds.variables else ds["latitude"]
        lon_da = ds["lon"] if "lon" in ds.variables else ds["longitude"]
        u = oscar_field(ds[pick_var(ds, ["u"])], lat_da, lon_da)
        v = oscar_field(ds[pick_var(ds, ["v"])], lat_da, lon_da)
        lat = lat_da.values
        lon = lon_da.values
        ds.close()
        if s_u is None:
            s_u, s_v = np.zeros_like(u), np.zeros_like(v)
            n_u, n_v = np.zeros(u.shape), np.zeros(v.shape)
        ou, ov = np.isfinite(u), np.isfinite(v)
        s_u[ou] += u[ou]
        n_u += ou
        s_v[ov] += v[ov]
        n_v += ov
    with np.errstate(invalid="ignore", divide="ignore"):
        mu = np.where(n_u > 0, s_u / n_u, np.nan)
        mv = np.where(n_v > 0, s_v / n_v, np.nan)
    return regrid(mu, lat, lon), regrid(mv, lat, lon)


OSCAR_LOCK = threading.Lock()


def oscar_month(earthaccess, y, m, keep_raw, step=1):
    last = pd.Timestamp(year=y, month=m, day=1).days_in_month
    res = earthaccess.search_data(
        short_name="OSCAR_L4_OC_FINAL_V2.0", temporal=(f"{y}-{m:02d}-01", f"{y}-{m:02d}-{last:02d}")
    )
    if not res:
        log(f"  oscar {y}-{m:02d}: no granules")
        return True, True, None, None
    res = res[:: max(1, step)]
    tmp = RAW / "oscar" / f"{y}{m:02d}"
    tmp.mkdir(parents=True, exist_ok=True)
    out = (False, False, None, None)
    for attempt in range(1, 4):
        try:
            paths = earthaccess.download(res, str(tmp), threads=2)
            files = [str(p) for p in paths if p]
            if len(files) < len(res):
                raise ConnectionError(f"downloaded {len(files)} of {len(res)} files")
            with OSCAR_LOCK:
                u, v = proc_oscar_month(files)
            log(f"oscar {y}-{m:02d}: files {len(files)}")
            out = (True, False, u, v)
            break
        except Exception as e:
            if is_auth_error(e):
                raise AuthError(f"oscar: {e}")
            log(f"  ! oscar {y}-{m:02d}, attempt {attempt}/3: {type(e).__name__}: {e}")
            time.sleep(20 * attempt)
    if not keep_raw:
        for p in tmp.glob("*"):
            try:
                p.unlink()
            except OSError:
                pass
        try:
            tmp.rmdir()
        except OSError:
            pass
    return out


def run_oscar(a):
    vars_ = SOURCE_VARS["oscar"]
    earthaccess = ea_login()
    workers = max(1, int(getattr(a, "workers", 6)))
    years = [y for y in range(Y0, Y1 + 1) if not year_done(vars_, y)]
    if not years:
        return True
    log(f"oscar: {len(years)} years to download, months in parallel: {workers}")
    tasks = [(y, m) for y in years for m in range(1, 13)]
    du = {y: {} for y in years}
    dv = {y: {} for y in years}
    left = {y: 12 for y in years}
    bad = {y: False for y in years}
    allok = True
    ex = ThreadPoolExecutor(max_workers=workers)
    try:
        futs = {ex.submit(oscar_month, earthaccess, y, m, a.keep_raw, max(1, int(getattr(a, "oscar_step", 1)))): (y, m) for y, m in tasks}
        for f in as_completed(futs):
            y, m = futs[f]
            ok, empty, u, v = f.result()
            if not ok:
                bad[y] = True
                allok = False
            elif not empty:
                du[y][m], dv[y][m] = u, v
            left[y] -= 1
            if left[y] == 0 and du[y] and not bad[y]:
                save_year("u_current", y, du[y])
                save_year("v_current", y, dv[y])
                du[y] = dv[y] = {}
    except BaseException:
        ex.shutdown(wait=False, cancel_futures=True)
        raise
    ex.shutdown(wait=True)
    return allok


RUNNERS = {
    "oisst": run_oisst,
    "sealevel": run_sealevel,
    "grace": run_grace,
    "en4": run_en4,
    "chl": run_chl,
    "seaice": run_seaice,
    "oceansoda": run_oceansoda,
    "oscar": run_oscar,
}


def cmd_merge(a):
    rows = []
    for var in VARS:
        files = sorted((PROC / var).glob(f"{var}_*.nc")) if (PROC / var).exists() else []
        if not files:
            rows.append((var, 0, "-", "-", "no data"))
            continue
        parts = []
        for f in files:
            with xr.open_dataset(f) as d:
                parts.append(d[var].load())
        da = xr.concat(parts, dim="time").sortby("time")
        da = da.groupby("time").first() if da["time"].to_index().has_duplicates else da
        da = da.reindex(time=MONTHS)
        out = xr.Dataset({var: da}, attrs={"title": VARS[var][1]})
        da.attrs.update({"units": VARS[var][0], "long_name": VARS[var][1]})
        tmp = PROC / f"{var}.nc.tmp"
        out.to_netcdf(tmp, encoding={var: {"zlib": True, "complevel": 4, "shuffle": True}})
        tmp.replace(PROC / f"{var}.nc")
        valid = da.notnull().any(dim=("lat", "lon"))
        yrs = pd.DatetimeIndex(da["time"].values[valid.values])
        rows.append(
            (
                var,
                int(valid.sum()),
                yrs.min().strftime("%Y-%m"),
                yrs.max().strftime("%Y-%m"),
                f"{100 * float(da.notnull().mean()):.1f}% of cells filled",
            )
        )
    df = pd.DataFrame(rows, columns=["variable", "months", "from", "to", "coverage"])
    df.to_csv(PROC / "catalog.csv", index=False, encoding="utf-8")
    log(df.to_string(index=False))
    log(f"\nFiles: {PROC}/<variable>.nc, catalog: {PROC / 'catalog.csv'}")


def cmd_list(a):
    log("Variables (13 files = 12 features; currents give u and v):")
    for var, (u, d) in VARS.items():
        log(f"  {var:14s} {u:16s} {d}")
    log("\nWho downloads what (--part N):")
    for p, srcs in PARTS.items():
        log(f"  part {p}: {', '.join(srcs)}")


NEEDS = {
    "oisst": ([], []),
    "en4": ([], []),
    "oceansoda": ([], []),
    "seaice": ([], ["pyproj"]),
    "chl": (["EARTHDATA_TOKEN"], []),
    "grace": (["EARTHDATA_TOKEN"], ["earthaccess"]),
    "oscar": (["EARTHDATA_TOKEN"], ["earthaccess"]),
    "sealevel": (["CMEMS_USERNAME", "CMEMS_PASSWORD"], ["copernicusmarine"]),
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


def check_disk():
    DATA.mkdir(parents=True, exist_ok=True)
    free = shutil.disk_usage(DATA).free / 1e9
    if free < 3:
        sys.exit(
            f"Not enough disk space: {free:.1f} GB free, at least 3 GB needed. Free some space and run again."
        )
    if free < 10:
        log(f"Warning: only {free:.1f} GB free. It may not be enough for the largest EN4 archives.")


def run_source(s, a):
    try:
        return "ok" if RUNNERS[s](a) else "fail"
    except AuthError as e:
        log(f"  ! {s}: CREDENTIALS PROBLEM: {e}")
        log(
            "    Update the key/token in .env (see scripts/ingest/README.md) and run the command again: finished work is skipped."
        )
        return "auth"
    except KeyboardInterrupt:
        raise
    except MemoryError:
        log(f"  ! {s}: out of memory (close other programs and run again)")
        return "fail"
    except requests.exceptions.RequestException as e:
        log(f"  ! {s}: network or server failure: {e} (temporary; the script will retry)")
        return "fail"
    except OSError as e:
        log(f"  ! {s}: file/disk error: {e} (check free space and permissions)")
        return "fail"
    except Exception as e:
        log(f"  ! {s}: {type(e).__name__}: {e}")
        return "fail"


def cmd_run(a):
    global LOGFILE
    DATA.mkdir(parents=True, exist_ok=True)
    LOGFILE = DATA / "run.log"
    if a.source:
        srcs = a.source.split(",")
    elif a.part is not None:
        srcs = PARTS[a.part]
    else:
        srcs = list(RUNNERS)
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
        log("\nStopped manually. Run the same command again: finished work is skipped.")
        sys.exit(130)
    if not a.no_merge:
        log("\n=== merge ===")
        try:
            cmd_merge(None)
        except Exception as e:
            log(f"  ! merge: {type(e).__name__}: {e}")
    log("\nSUMMARY:")
    for s in srcs:
        log(f"  {s:10s} {status.get(s, '?')}")
    log(f"Log: {LOGFILE}")
    bad = [s for s, v in status.items() if v != "done"]
    if bad:
        log(
            "To fetch what is left, run the same command again (after fixing the credentials, if they were mentioned)."
        )
    sys.exit(1 if bad else 0)


def main():
    ap = argparse.ArgumentParser(
        description="Download monthly 1x1 degree ocean grids (2000-2025) from public sources"
    )
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("list").set_defaults(f=cmd_list)
    r = sp.add_parser("run")
    r.add_argument("--part", type=int, choices=[0, 1, 2, 3])
    r.add_argument("--source", help="comma-separated: " + ",".join(RUNNERS))
    r.add_argument(
        "--workers", type=int, default=6, help="how many OSCAR months to download in parallel (default 6)"
    )
    r.add_argument(
        "--oscar-step", type=int, default=1, help="use every Nth daily OSCAR file (5 = about 6 files per month, 5x faster)"
    )
    r.add_argument("--keep-raw", action="store_true", help="keep raw files after processing")
    r.add_argument("--passes", type=int, default=3, help="how many times to retry failed sources (default 3)")
    r.add_argument("--no-merge", action="store_true", help="skip the merge step at the end")
    r.set_defaults(f=cmd_run)
    sp.add_parser("merge").set_defaults(f=cmd_merge)
    a = ap.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
