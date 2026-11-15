# gridded variables from the Hugging Face dataset (scripts/ingest/hf_dataset.py builds it)

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from .config import ROOT

REPO = os.environ.get("HF_DATASET", "lilDorito/earth-trend-data")
REVISION = os.environ.get("HF_DATASET_REVISION", "65c3103213ebd3c73f75c297e2d973340e70f739")
LOCAL = os.environ.get("HF_DATASET_PATH")  # a local copy (e.g. data/hf) instead of the Hub

LAT = np.arange(-89.5, 90, 1.0)
LON = np.arange(-179.5, 180, 1.0)
MIN_MONTHS = 9  # a cell-year with fewer months is too seasonal to average

DISPLAY_UNITS = {
    "degC": (1, "°C"),
    "J/m2": (1e-9, "GJ/m²"),
    "Pa": (0.01, "hPa"),
    "kg kg-1": (1000, "g/kg"),
    "kg m-2": (1, "kg/m²"),
    "W m-2": (1, "W/m²"),
    "m s-1": (1, "m/s"),
    "fraction 0-1": (100, "%"),
    "cm LWE": (1, "cm"),
    "km2/month": (1, "km²/month"),
}
KEY_UNITS = {"sla": (1000, "mm"), "aod": (1, "AOD"), "ndvi": (1, "NDVI")} | {key: (100, "cm/s") for key in ("u_current", "v_current", "current_speed")}

# variables built from others: speed of the annual mean wind vector (smaller than the mean speed where winds turn)
VIRTUAL = {
    "merra2_wind10m": dict(
        parts=("merra2_u10m", "merra2_v10m"),
        name="10 m wind, mean vector speed (MERRA-2)",
        group="atmosphere",
        domain="global",
    ),
}


class DatasetError(Exception):
    pass


def where_measured(key: str) -> str:
    # appended to "no data" errors, so a click on land for a sea variable says why
    try:
        domain = variable(key)["domain"]
    except (KeyError, DatasetError):
        return ""
    return {"ocean": " It is measured only over the ocean: pick a place at sea.",
            "land": " It is measured only over land: pick a place on land."}.get(domain, "")


def open_file(path: str, block_size: int = 1 << 18):
    if LOCAL:
        return open(Path(LOCAL if Path(LOCAL).is_absolute() else ROOT / LOCAL) / path, "rb")
    from huggingface_hub import HfFileSystem

    fs = HfFileSystem(token=os.environ.get("HF_TOKEN") or False)
    return fs.open(f"datasets/{REPO}@{REVISION}/{path}", block_size=block_size)


def display_units(key: str, units: str) -> tuple[float, str]:
    return KEY_UNITS.get(key) or DISPLAY_UNITS.get(units, (1, units))


@lru_cache
def catalog() -> dict[str, dict]:
    try:
        with open_file("catalog.parquet") as file:
            frame = pd.read_parquet(file)
    except Exception as e:
        raise DatasetError(f"Could not read the dataset catalog ({REPO}): {e}") from e
    out = {}
    for row in frame.to_dict("records"):
        factor, units = display_units(row["key"], row["units"])
        out[row["key"]] = row | {"units": units, "factor": factor}
        for key, spec in VIRTUAL.items():
            # listed right after its last part
            if row["key"] == spec["parts"][-1] and all(p in out for p in spec["parts"]):
                out[key] = out[row["key"]] | {k: v for k, v in spec.items() if k != "parts"} | {"key": key}
    return out


def variable(key: str) -> dict:
    try:
        return catalog()[key]
    except KeyError:
        raise KeyError(f"Unknown dataset variable '{key}'") from None


@dataclass
class Annual:
    years: np.ndarray  # (n,) only years the dataset covers in all 12 months
    values: np.ndarray  # (n, 180, 360) float32, NaN where a cell has no data or too few months


@lru_cache(maxsize=3)
def annual(key: str) -> Annual:
    meta = variable(key)
    if key in VIRTUAL:
        u, v = (annual(part) for part in VIRTUAL[key]["parts"])
        years, iu, iv = np.intersect1d(u.years, v.years, return_indices=True)
        return Annual(years, np.hypot(u.values[iu], v.values[iv]))
    with open_file(f"annual/{key}.parquet", block_size=1 << 22) as file:
        table = pq.read_table(file)
    year = table["year"].to_numpy()
    months = table["months"].to_numpy()
    # a year where no cell reaches 12 months is cut by the record's start, end or a gap
    complete = np.array(sorted(y for y in np.unique(year) if months[year == y].max() == 12))
    keep = np.isin(year, complete) & (months >= MIN_MONTHS)
    i = np.searchsorted(complete, year[keep])
    lat = np.rint(table["lat"].to_numpy()[keep] + 89.5).astype(int)
    lon = np.rint(table["lon"].to_numpy()[keep] + 179.5).astype(int)
    values = np.full((len(complete), len(LAT), len(LON)), np.nan, dtype=np.float32)
    values[i, lat, lon] = table["value"].to_numpy()[keep] * meta["factor"]
    del table
    _release()
    return Annual(complete, values)


def _release() -> None:
    # Arrow keeps freed buffers in its pool; on a 512 MB instance they are worth handing back
    pa.default_memory_pool().release_unused()


# share of each grid cell inside a box; west > east means the box crosses 180 degrees
def box_fractions(lat: np.ndarray, lon: np.ndarray, south: float, north: float, west: float, east: float) -> np.ndarray:
    dlat, dlon = abs(lat[1] - lat[0]), abs(lon[1] - lon[0])

    def overlap(centers, step, lo, hi):
        return np.clip(np.minimum(hi, centers + step / 2) - np.maximum(lo, centers - step / 2), 0, None) / step

    spans = [(west, east)] if west <= east else [(west, 180.0), (-180.0, east)]
    lon_frac = sum(overlap(lon, dlon, w, e) for w, e in spans)
    return overlap(lat, dlat, south, north)[:, None] * lon_frac[None, :]


@lru_cache
def regions() -> pd.DataFrame:
    try:
        with open_file("regions/index.parquet") as file:
            return pd.read_parquet(file).set_index("id", drop=False)
    except Exception as e:
        raise DatasetError(f"Could not read the region index ({REPO}): {e}") from e


@lru_cache
def _region_weights() -> pd.DataFrame:
    with open_file("regions/weights.parquet", block_size=1 << 22) as file:
        return pd.read_parquet(file).astype({"lat": "float64", "lon": "float64", "frac": "float64"}).set_index("id").sort_index()


def region(rid: str) -> dict:
    try:
        return regions().loc[rid].to_dict()
    except KeyError:
        raise KeyError(f"Unknown region '{rid}'") from None


def region_cells(rid: str) -> pd.DataFrame:
    region(rid)
    return _region_weights().loc[[rid]].reset_index(drop=True)


def quantile_abs(values: np.ndarray, q: float) -> float:
    finite = values[np.isfinite(values)]
    return float(np.quantile(np.abs(finite), q)) if finite.size else 0.0


def nice_limit(value: float) -> float:
    if not np.isfinite(value) or value <= 0:
        return 1.0
    power = 10 ** np.floor(np.log10(value))
    for step in (1, 2, 2.5, 5, 10):
        if value <= step * power:
            return float(step * power)
    return float(10 * power)


@lru_cache(maxsize=1)
def co2() -> pd.DataFrame:
    try:
        with open_file("series/co2.parquet") as file:
            return pd.read_parquet(file)
    except Exception as e:
        raise DatasetError(f"This dataset revision has no CO2 series: {e}") from e
