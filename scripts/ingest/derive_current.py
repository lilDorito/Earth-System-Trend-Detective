import os
from pathlib import Path

import numpy as np
import xarray as xr
from common import ROOT, load_env

load_env()
PROC = Path(os.environ.get("OCEAN_DIR", ROOT / "data" / "ocean")) / "processed"


def main():
    u = xr.open_dataset(PROC / "u_current.nc")["u_current"].load()
    v = xr.open_dataset(PROC / "v_current.nc")["v_current"].load()
    speed = np.sqrt(u**2 + v**2).astype("float32")
    speed.name = "current_speed"
    speed.attrs = {
        "units": "m/s",
        "long_name": "Surface current speed, sqrt(u^2 + v^2) of the monthly mean vector (OSCAR)",
    }
    direction = (np.degrees(np.arctan2(u, v)) % 360).where(speed > 0).astype("float32")
    direction.name = "current_direction"
    direction.attrs = {
        "units": "degrees",
        "long_name": "Direction the surface current flows towards, clockwise from north (OSCAR)",
    }
    for da in (speed, direction):
        out = PROC / f"{da.name}.nc"
        tmp = PROC / f"{da.name}.nc.tmp"
        da.to_dataset().to_netcdf(tmp, encoding={da.name: {"zlib": True, "complevel": 4, "shuffle": True}})
        tmp.replace(out)
        print(f"saved {out}: min {float(da.min()):.3f}, max {float(da.max()):.3f}, filled {100 * float(da.notnull().mean()):.1f}%")


if __name__ == "__main__":
    main()
