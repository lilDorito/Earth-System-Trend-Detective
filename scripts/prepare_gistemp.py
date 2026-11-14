"""Real global grid for the globe: NASA GISTEMP v4 (land + ocean, 2x2 degrees, monthly anomalies
vs 1951-1980) -> annual means -> data/grid/annual.npz.

    pip install netCDF4
    python scripts/prepare_gistemp.py                 # downloads ~23 MB, then builds the grid
    python scripts/prepare_gistemp.py --file D:\\Downloads\\gistemp1200_GHCNv4_ERSSTv5.nc.gz   (.nc or .nc.gz)
    python scripts/prepare_gistemp.py --from-year 1950

Values are temperature ANOMALIES in degC (not absolute temperature): trends are identical,
the UI says so through the `label` stored in the npz.
"""

import argparse
import gzip
import shutil
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
# the same GISTEMP v4 grid from three hosts: NASA GISS, then the NOAA PSL and UCAR mirrors
URLS = [
    "https://data.giss.nasa.gov/pub/gistemp/gistemp1200_GHCNv4_ERSSTv5.nc.gz",
    "https://psl.noaa.gov/thredds/fileServer/Datasets/gistemp/combined/1200km/air.2x2.1200.mon.anom.comb.nc",
    # UCAR copy of the same analysis on a 2.5 degree grid, 1880-2024-02 (variable "tas")
    "https://thredds.rda.ucar.edu/thredds/fileServer/files/d651039/observations/tas_gistemp_g025_188001-202402.nc",
]
OUT = ROOT / "data" / "grid" / "annual.npz"
LABEL = "Surface temperature anomaly vs 1951-1980, NASA GISTEMP v4 (land + ocean, 2 degree grid)"
LAT_NEW = np.arange(-90.0, 90.1, 2.0)  # the globe renderer expects rows from pole to pole
MIN_VALID_YEARS = 0.6  # a cell needs this share of valid years, otherwise it is filled from neighbours


def download(dest: Path, url: str, retries: int = 4) -> bool:
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, retries + 1):
        have = dest.stat().st_size if dest.exists() else 0
        try:
            headers = {"Range": f"bytes={have}-"} if have else {}
            with requests.get(url, stream=True, headers=headers, timeout=(15, 60)) as r:
                if r.status_code == 416:  # already complete
                    return True
                r.raise_for_status()
                resumed = r.status_code == 206
                total = int(r.headers.get("content-length", 0)) + (have if resumed else 0)
                done = have if resumed else 0
                with open(dest, "ab" if resumed else "wb") as f:
                    for chunk in r.iter_content(1 << 16):
                        f.write(chunk)
                        done += len(chunk)
                        print(f"\r  {done / 1e6:6.1f} / {total / 1e6:.1f} MB", end="", flush=True)
            print()
            return True
        except Exception as e:  # network resets: wait and resume from the partial file
            print(f"\n  attempt {attempt}/{retries} failed: {type(e).__name__}")
            time.sleep(2 * attempt)
    return False


def fetch_any(raw_dir: Path) -> Path:
    for url in URLS:
        dest = raw_dir / url.rsplit("/", 1)[-1]
        if dest.exists() and dest.stat().st_size > 5_000_000:
            return dest
        print("Downloading", url)
        if download(dest, url):
            return dest
        dest.unlink(missing_ok=True)
        print("  this host does not answer, trying the next one")
    sys.exit("Could not download from any host. Open this in a browser and pass the file with --file:\n  " + "\n  ".join(URLS))


def read_monthly(path: Path):
    from netCDF4 import Dataset, num2date

    src = path
    if path.suffix == ".gz":
        src = path.with_suffix("")
        if not src.exists():
            with gzip.open(path, "rb") as fin, open(src, "wb") as fout:
                shutil.copyfileobj(fin, fout)
    with Dataset(src) as nc:
        var = next(v for v in ("tempanomaly", "air", "tas") if v in nc.variables)
        data = np.ma.filled(nc.variables[var][:].astype("float64"), np.nan)
        data[np.abs(data) > 100] = np.nan  # fill values (32767, 9.96e36)
        lat = np.asarray(nc.variables["lat"][:], dtype="float64")
        lon = np.asarray(nc.variables["lon"][:], dtype="float64")
        tv = nc.variables["time"]
        dates = num2date(tv[:], tv.units, only_use_cftime_datetimes=False, only_use_python_datetimes=True)
    return np.array([d.year for d in dates]), np.array([d.month for d in dates]), lat, lon, data


def annual_means(years, months, data, from_year):
    out_years, out = [], []
    for y in np.unique(years):
        sel = years == y
        if y < from_year or sel.sum() < 12:  # skip the current, incomplete year
            continue
        valid = np.isfinite(data[sel]).sum(axis=0)
        with np.errstate(all="ignore"), __import__("warnings").catch_warnings():
            __import__("warnings").simplefilter("ignore")
            mean = np.where(valid >= 9, np.nanmean(data[sel], axis=0), np.nan)  # at least 9 of 12 months
        out_years.append(y)
        out.append(mean)
    return np.array(out_years), np.array(out)


def fill_gaps(annual):
    """Interpolate missing years per cell; cells with too little data take the nearest valid cell."""
    from scipy.ndimage import distance_transform_edt

    n = annual.shape[0]
    ok = np.isfinite(annual)
    good = ok.mean(axis=0) >= MIN_VALID_YEARS
    filled = annual.copy()
    t = np.arange(n)
    for i, j in zip(*np.where(good & ~ok.all(axis=0))):
        m = ok[:, i, j]
        filled[:, i, j] = np.interp(t, t[m], annual[m, i, j])
    if not good.all():
        idx = distance_transform_edt(~good, return_distances=False, return_indices=True)
        filled = filled[:, idx[0], idx[1]]
    return filled, float((~good).mean())


def to_pole_to_pole(annual, lat):
    """GISTEMP rows are -89..89: resample to -90..90 (edge rows are repeated)."""
    from scipy.interpolate import interp1d

    f = interp1d(lat, annual, axis=1, bounds_error=False, fill_value=(annual[:, 0], annual[:, -1]))
    return f(LAT_NEW)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", type=Path, help="already downloaded .nc or .nc.gz")
    ap.add_argument("--from-year", type=int, default=1980)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()

    path = args.file or fetch_any(ROOT / "data" / "raw")
    print("Reading", path)
    years, months, lat, lon, data = read_monthly(path)
    ys, annual = annual_means(years, months, data, args.from_year)
    annual, share_filled = fill_gaps(annual)
    annual = to_pole_to_pole(annual, lat)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(args.out, years=ys, lat=LAT_NEW, lon=lon, t2m=annual.astype("float32"), label=LABEL)
    print(f"OK {args.out}: {ys[0]}-{ys[-1]}, grid {annual.shape[1]}x{annual.shape[2]}, "
          f"{share_filled:.1%} of cells filled from neighbours")


if __name__ == "__main__":
    main()
