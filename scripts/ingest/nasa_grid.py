"""Monthly 1-degree grids from NASA GES DISC products (GLDAS, IMERG, MERRA-2).

Granules are streamed through earthaccess (raw files are never saved), regridded
to a 1x1 degree grid and written as one CSV slice per variable and month
(data/nasa_grid/parts). `assemble` joins the slices into one long-format CSV per
variable (data/nasa_grid/processed). Finished months are skipped, so every
command can be rerun.

    python scripts/ingest/nasa_grid.py list
    python scripts/ingest/nasa_grid.py inspect gldas_evap
    python scripts/ingest/nasa_grid.py run --dry-run
    python scripts/ingest/nasa_grid.py run gldas_evap gldas_precip
    python scripts/ingest/nasa_grid.py assemble
    python scripts/ingest/nasa_grid.py check --lat 50.5 --lon 30.5
"""

import argparse
import calendar
import collections
import os
import time
from pathlib import Path

import numpy as np
import pandas as pd
from common import ROOT, load_env

load_env()
DATA = Path(os.environ.get("NASA_GRID_DIR", ROOT / "data" / "nasa_grid"))
PARTS, PROC = DATA / "parts", DATA / "processed"
Y0, Y1 = 2000, 2025
MIN_VALID_FRAC = 0.5  # cells with a smaller valid area share are dropped
N_LAT, N_LON = 180, 360
LAT = np.arange(-89.5, 90.0, 1.0)
LON = np.arange(-179.5, 180.0, 1.0)
RETRIES = 5

GLDAS = ("GLDAS_NOAH025_M", "2.1")  # 0.25 deg, land only
IMERG = ("GPM_3IMERGM", "07")  # 0.1 deg, land and ocean
MERRA2 = ("M2TMNXSLV", "5.12.4")  # 0.5 x 0.625 deg, land and ocean

# convert: none | rate_s_to_mm_month | rate_h_to_mm_month | k_to_c
_CONVERSIONS = ("none", "rate_s_to_mm_month", "rate_h_to_mm_month", "k_to_c")


def _v(product, var, convert, units, desc):
    return dict(
        short_name=product[0],
        version=product[1],
        var=var,
        convert=convert,
        units=units,
        desc=desc,
    )


VARIABLES = {
    "gldas_evap": _v(GLDAS, "Evap_tavg", "rate_s_to_mm_month", "mm/month", "Evapotranspiration (GLDAS Noah)"),
    "gldas_precip": _v(GLDAS, "Rainf_f_tavg", "rate_s_to_mm_month", "mm/month", "Precipitation (GLDAS Noah)"),
    "gldas_tair": _v(GLDAS, "Tair_f_inst", "k_to_c", "degC", "Near-surface air temperature (GLDAS Noah)"),
    "gldas_soilmoist_0_10": _v(GLDAS, "SoilMoi0_10cm_inst", "none", "kg m-2", "Soil moisture 0-10 cm (GLDAS Noah)"),
    "gldas_swe": _v(GLDAS, "SWE_inst", "none", "kg m-2", "Snow water equivalent (GLDAS Noah)"),
    "imerg_precip": _v(IMERG, "precipitation", "rate_h_to_mm_month", "mm/month", "Precipitation (IMERG Final)"),
    "merra2_t2m": _v(MERRA2, "T2M", "k_to_c", "degC", "2 m air temperature (MERRA-2)"),
    "gldas_rootmoist": _v(GLDAS, "RootMoist_inst", "none", "kg m-2", "Root-zone soil moisture (GLDAS Noah)"),
    "gldas_soilmoist_10_40": _v(GLDAS, "SoilMoi10_40cm_inst", "none", "kg m-2", "Soil moisture 10-40 cm (GLDAS Noah)"),
    "gldas_snowdepth": _v(GLDAS, "SnowDepth_inst", "none", "m", "Snow depth (GLDAS Noah)"),
    "gldas_skin_temp": _v(GLDAS, "AvgSurfT_inst", "k_to_c", "degC", "Skin temperature (GLDAS Noah)"),
    "gldas_potevap": _v(GLDAS, "PotEvap_tavg", "none", "W m-2", "Potential evaporation (GLDAS Noah)"),
    "gldas_swdown": _v(GLDAS, "SWdown_f_tavg", "none", "W m-2", "Downward shortwave radiation (GLDAS)"),
    "gldas_wind": _v(GLDAS, "Wind_f_inst", "none", "m s-1", "Wind speed (GLDAS forcing)"),
    "merra2_ts": _v(MERRA2, "TS", "k_to_c", "degC", "Surface skin temperature (MERRA-2)"),
    "merra2_qv2m": _v(MERRA2, "QV2M", "none", "kg kg-1", "2 m specific humidity (MERRA-2)"),
    "merra2_tqv": _v(MERRA2, "TQV", "none", "kg m-2", "Total column water vapour (MERRA-2)"),
    "merra2_u10m": _v(MERRA2, "U10M", "none", "m s-1", "10 m eastward wind (MERRA-2)"),
    "merra2_v10m": _v(MERRA2, "V10M", "none", "m s-1", "10 m northward wind (MERRA-2)"),
    "merra2_ps": _v(MERRA2, "PS", "none", "Pa", "Surface pressure (MERRA-2)"),
}


# --------------------------------------------------------------------------
# Earthdata access
# --------------------------------------------------------------------------
def retry(fn, *args, what="request", **kwargs):
    """Call fn, retrying network failures with a growing pause."""
    for attempt in range(1, RETRIES + 1):
        try:
            return fn(*args, **kwargs)
        except (ImportError, KeyError, ValueError, TypeError, AttributeError):
            raise  # a bug or bad config, retrying will not help
        except Exception as err:
            if attempt == RETRIES:
                raise
            wait = 5 * attempt
            print(f"  {what}: {type(err).__name__}, retry in {wait}s ({attempt}/{RETRIES})")
            time.sleep(wait)


def login():
    """Log in with EARTHDATA_TOKEN if set, otherwise interactively (saved to ~/.netrc)."""
    import earthaccess

    if os.environ.get("EARTHDATA_TOKEN"):
        auth = earthaccess.login(strategy="environment")
    else:
        auth = earthaccess.login(strategy="all", persist=True)
    if not getattr(auth, "authenticated", True):
        raise SystemExit("Earthdata login failed. Check EARTHDATA_TOKEN or your credentials.")


def search_granules(short_name, version, start, end):
    import earthaccess

    return retry(
        earthaccess.search_data,
        short_name=short_name,
        version=version,
        temporal=(start, end),
        count=-1,
        what="granule search",
    )


def open_granule(granule):
    """Open a granule as a file-like object for streaming."""
    import earthaccess

    files = earthaccess.open([granule])
    if not files:
        raise RuntimeError("earthaccess could not open the granule")
    return files[0]


def open_dataset(fobj):
    """Open a NASA NetCDF file; variables may sit in the /Grid group (IMERG)."""
    import xarray as xr

    ds = xr.open_dataset(fobj, engine="h5netcdf")
    if len(ds.data_vars) > 0:
        return ds
    ds.close()
    for group in ("Grid", "/Grid"):
        try:
            fobj.seek(0)
        except Exception:
            pass
        try:
            ds = xr.open_dataset(fobj, engine="h5netcdf", group=group)
            if len(ds.data_vars) > 0:
                return ds
            ds.close()
        except Exception:
            continue
    raise RuntimeError("No variables in the file root or in the Grid group")


# --------------------------------------------------------------------------
# Regridding to 1 degree
# --------------------------------------------------------------------------
def to_1deg(data, lats, lons, min_valid_frac=MIN_VALID_FRAC):
    """Area-weighted (cos latitude) mean of source cells into 1-degree cells.

    A source cell belongs to the 1-degree cell that contains its center.
    Returns (values, valid_frac), both (180, 360) float32. values is NaN where
    the valid area share is below min_valid_frac.
    """
    data = np.asarray(data, dtype=float)
    lats = np.asarray(lats, dtype=float)
    lons = ((np.asarray(lons, dtype=float) + 180.0) % 360.0) - 180.0
    if data.shape != (lats.size, lons.size):
        raise ValueError(f"data shape {data.shape} does not match (lat, lon) = ({lats.size}, {lons.size})")

    lat_bin = np.clip(np.floor(lats).astype(int) + 90, 0, N_LAT - 1)
    lon_bin = np.clip(np.floor(lons).astype(int) + 180, 0, N_LON - 1)
    idx = lat_bin[:, None] * N_LON + lon_bin[None, :]
    weights = np.cos(np.deg2rad(lats))[:, None] * np.ones_like(data)
    valid = np.isfinite(data)

    size = N_LAT * N_LON
    num = np.bincount(idx[valid], weights=(data * weights)[valid], minlength=size)
    den = np.bincount(idx[valid], weights=weights[valid], minlength=size)
    tot = np.bincount(idx.ravel(), weights=weights.ravel(), minlength=size)
    with np.errstate(invalid="ignore", divide="ignore"):
        values = np.where(den > 0, num / den, np.nan)
        frac = np.where(tot > 0, den / tot, 0.0)
    values[frac < min_valid_frac] = np.nan
    return (
        values.reshape(N_LAT, N_LON).astype(np.float32),
        frac.reshape(N_LAT, N_LON).astype(np.float32),
    )


def convert_units(data, kind, year, month):
    days = calendar.monthrange(year, month)[1]
    if kind == "none":
        return data
    if kind == "rate_s_to_mm_month":
        return data * days * 86400.0
    if kind == "rate_h_to_mm_month":
        return data * days * 24.0
    if kind == "k_to_c":
        return data - 273.15
    raise ValueError(f"Unknown conversion {kind!r}, expected one of {_CONVERSIONS}")


def regrid_variable(ds, var, convert):
    """Return (year, month, values_1deg, valid_frac) for one variable of an open file."""
    if var not in ds.variables:
        raise KeyError(f"{var!r} not in file. Available: {sorted(ds.data_vars)}")
    lat_name = next(n for n in ("lat", "latitude") if n in ds.variables or n in ds.coords)
    lon_name = next(n for n in ("lon", "longitude") if n in ds.variables or n in ds.coords)

    da = ds[var]
    if "time" in da.dims:
        da = da.isel(time=0, drop=True)
    data = np.asarray(da.transpose(lat_name, lon_name).values, dtype=float)
    data[np.abs(data) > 1e20] = np.nan  # unmasked fill values

    t = ds["time"]
    year = int(t.dt.year.values.ravel()[0])
    month = int(t.dt.month.values.ravel()[0])
    data = convert_units(data, convert, year, month)
    values, frac = to_1deg(data, ds[lat_name].values, ds[lon_name].values)
    return year, month, values, frac


def write_slice(values, path, column="value"):
    """Write finite cells as lat,lon,<column> (cells without data are omitted)."""
    iy, ix = np.nonzero(np.isfinite(values))
    df = pd.DataFrame({"lat": LAT[iy], "lon": LON[ix], column: values[iy, ix]})
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    df.to_csv(tmp, index=False, float_format="%.5g")
    os.replace(tmp, path)


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------
def part_path(key, year, month):
    return PARTS / key / f"{year:04d}-{month:02d}.csv"


def granule_month(granule):
    """(year, month) from granule metadata, or None."""
    try:
        begin = granule["umm"]["TemporalExtent"]["RangeDateTime"]["BeginningDateTime"]
        return int(begin[:4]), int(begin[5:7])
    except Exception:
        return None


def pick_keys(keys):
    keys = keys or list(VARIABLES)
    unknown = [k for k in keys if k not in VARIABLES]
    if unknown:
        raise SystemExit(f"Unknown variables: {unknown}. Available: {list(VARIABLES)}")
    return keys


def cmd_list(args):
    for key, s in VARIABLES.items():
        print(f"{key:24s} {s['short_name']:16s} v{s['version']:8s} {s['var']:20s} {s['units']:9s} {s['desc']}")


def cmd_inspect(args):
    """Print variables, units and dimensions of one granule."""
    spec = VARIABLES[args.key]
    start = f"{args.year}-{args.month:02d}-01"
    end = f"{args.year}-{args.month:02d}-28"
    login()
    granules = search_granules(spec["short_name"], spec["version"], start, end)
    print(f"{spec['short_name']} v{spec['version']}: {len(granules)} granules for {start}..{end}")
    if not granules:
        raise SystemExit("Nothing found. Check short_name and version.")

    ds = open_dataset(open_granule(granules[0]))
    print("\nDimensions:", dict(ds.sizes))
    print("\nVariables:")
    for name, v in ds.data_vars.items():
        print(f"  {name:28s} dims={v.dims} units={v.attrs.get('units', '?')}  {v.attrs.get('long_name', '')}")
    if spec["var"] in ds.data_vars:
        units = ds[spec["var"]].attrs.get("units", "?")
        print(f"\n{spec['var']}: units={units}, configured conversion={spec['convert']}")
    else:
        print(f"\nWARNING: {spec['var']!r} not found in the file")
    ds.close()


def cmd_run(args):
    """Stream granules and write 1-degree monthly slices."""
    keys = pick_keys(args.keys)
    groups = collections.OrderedDict()
    for key in keys:
        s = VARIABLES[key]
        groups.setdefault((s["short_name"], s["version"]), []).append(key)

    login()
    failures = []
    for (short_name, version), group_keys in groups.items():
        print(f"\n=== {short_name} v{version}: {', '.join(group_keys)} ===")
        granules = search_granules(short_name, version, f"{args.start_year}-01-01", f"{args.end_year}-12-31")

        # one pass per granule fills every requested variable of the collection
        pending = []
        for g in granules:
            ym = granule_month(g)
            missing = [k for k in group_keys if not (ym and part_path(k, *ym).exists())]
            if missing:
                pending.append((ym, g, missing))
        print(f"Granules found: {len(granules)}, to process: {len(pending)}")
        if args.dry_run or not pending:
            continue

        def process(granule, need):
            ds = open_dataset(open_granule(granule))
            try:
                return {k: regrid_variable(ds, VARIABLES[k]["var"], VARIABLES[k]["convert"]) for k in need}
            finally:
                ds.close()

        done = 0
        for ym, granule, need in pending:
            try:
                results = retry(process, granule, need, what=f"granule {ym}")
                for k, (year, month, values, frac) in results.items():
                    write_slice(values, part_path(k, year, month))
                    frac_path = PARTS / k / "valid_frac.csv"
                    if not frac_path.exists():
                        write_slice(frac, frac_path, column="valid_frac")
                done += 1
                year, month = next(iter(results.values()))[:2]
                print(f"  {year}-{month:02d} ok, variables: {len(results)} ({done}/{len(pending)})")
            except Exception as err:
                print(f"  ERROR {ym}: {type(err).__name__}: {err}")
                failures.extend((k, ym) for k in need)

    if failures:
        print(f"\n{len(failures)} slices failed: {failures}")
        raise SystemExit(1)
    print("\nDone. Next: python scripts/ingest/nasa_grid.py assemble")


def cmd_assemble(args):
    """Join monthly slices into data/nasa_grid/processed/<variable>.csv (date,lat,lon,value,valid_frac)."""
    for key in pick_keys(args.keys):
        parts_dir = PARTS / key
        if not parts_dir.exists():
            print(f"{key}: no slices in {parts_dir}, skipped")
            continue
        frac_path = parts_dir / "valid_frac.csv"
        frac = pd.read_csv(frac_path) if frac_path.exists() else None

        frames, total = [], 0
        for t in pd.date_range(f"{args.start_year}-01-01", f"{args.end_year}-12-01", freq="MS"):
            total += 1
            path = parts_dir / f"{t.year:04d}-{t.month:02d}.csv"
            if path.exists():
                df = pd.read_csv(path)
                df.insert(0, "date", t.strftime("%Y-%m-%d"))
                frames.append(df)
        if not frames:
            print(f"{key}: no months found")
            continue

        out_df = pd.concat(frames, ignore_index=True)
        if frac is not None:
            out_df = out_df.merge(frac, on=["lat", "lon"], how="left")
        PROC.mkdir(parents=True, exist_ok=True)
        out = PROC / f"{key}.csv"
        out_df.to_csv(out, index=False, float_format="%.5g")
        print(f"{key}: {len(frames)}/{total} months, {len(out_df)} rows [{VARIABLES[key]['units']}] -> {out}")


def cmd_check(args):
    """Report completeness of the assembled files and the series of one cell."""
    files = sorted(PROC.glob("*.csv"))
    if not files:
        raise SystemExit(f"No CSV files in {PROC}. Run `assemble` first.")
    for path in files:
        df = pd.read_csv(path, usecols=["date", "lat", "lon", "value"])
        print(f"\n{path.stem} [{VARIABLES.get(path.stem, {}).get('units', '?')}]")
        print(f"  rows: {len(df)}, months: {df['date'].nunique()} ({df['date'].min()} .. {df['date'].max()})")
        print(f"  cells with data: {df[['lat', 'lon']].drop_duplicates().shape[0]}")
        cell = df[(df["lat"] == args.lat) & (df["lon"] == args.lon)]["value"]
        if cell.empty:
            print(f"  no data in cell lat={args.lat}, lon={args.lon} (cell centers are integer + 0.5)")
        else:
            print(f"  cell lat={args.lat}, lon={args.lon}: n={len(cell)}, min={cell.min():.2f}, max={cell.max():.2f}, mean={cell.mean():.2f}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    def years(sp):
        sp.add_argument("--start-year", type=int, default=Y0)
        sp.add_argument("--end-year", type=int, default=Y1)

    sub.add_parser("list", help="show variables and sources").set_defaults(fn=cmd_list)

    sp = sub.add_parser("inspect", help="show variables and units of one granule")
    sp.add_argument("key", choices=list(VARIABLES))
    sp.add_argument("--year", type=int, default=2010)
    sp.add_argument("--month", type=int, default=6)
    sp.set_defaults(fn=cmd_inspect)

    sp = sub.add_parser("run", help="download granules and write 1-degree monthly slices")
    sp.add_argument("keys", nargs="*", help="variables (default: all)")
    years(sp)
    sp.add_argument("--dry-run", action="store_true", help="only count granules to process")
    sp.set_defaults(fn=cmd_run)

    sp = sub.add_parser("assemble", help="join monthly slices into one CSV per variable")
    sp.add_argument("keys", nargs="*", help="variables (default: all)")
    years(sp)
    sp.set_defaults(fn=cmd_assemble)

    sp = sub.add_parser("check", help="completeness report and the series of one cell")
    sp.add_argument("--lat", type=float, default=50.5)
    sp.add_argument("--lon", type=float, default=30.5)
    sp.set_defaults(fn=cmd_check)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
