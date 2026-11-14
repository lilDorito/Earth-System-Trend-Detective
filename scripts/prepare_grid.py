# build data/grid/annual.npz (annual mean T2M, degC) from downloaded MERRA-2 files in merra2/
# usage: python scripts/prepare_grid.py [folder_with_nc4]   (needs: pip install xarray netcdf4 dask)
# without the output file the API serves a synthetic demo field (/api/trendmap/meta -> demo: true)

import glob
import sys
from pathlib import Path

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "grid" / "annual.npz"


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "merra2"
    files = sorted(glob.glob(str(source / "*.nc4")) + glob.glob(str(source / "*.nc")))
    if not files:
        raise SystemExit(f"No .nc/.nc4 files in {source}")
    print("files:", len(files))

    t2m = xr.open_mfdataset(files, combine="by_coords")["T2M"] - 273.15
    counts = t2m["time"].groupby("time.year").count()
    full = counts["year"].values[counts.values == 12]  # full years only
    annual = t2m.groupby("time.year").mean().sel(year=full).load()
    print("years:", int(full[0]), "-", int(full[-1]), f"({len(full)})")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        OUT, years=full.astype(int), lat=annual["lat"].values, lon=annual["lon"].values,
        t2m=annual.values.astype(np.float32),
    )
    print("wrote", OUT)


if __name__ == "__main__":
    main()
