# gridded variables from the Hugging Face dataset (scripts/ingest/hf_dataset.py builds it)

import os
from concurrent.futures import ThreadPoolExecutor
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
SEARCH_CELLS = 2  # how far (in cells) a point may snap to the nearest cell with data
MIN_FRAC = 1e-4  # box slivers below this share of a cell are left out
READERS = 8  # latitude bands fetched at once for an area

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


@lru_cache(maxsize=32)
def _grid_file(key: str) -> pq.ParquetFile:
    if key in VIRTUAL:
        raise DatasetError(f"{variable(key)['name']} has annual maps only")
    return pq.ParquetFile(open_file(f"grid/{key}.parquet"))


def _band(key: str, lat: float, own_handle: bool = False) -> pd.DataFrame:
    # only row groups whose latitude range holds this band are fetched (one per band in the built files)
    file = _grid_file(key)
    groups = []
    for i in range(file.metadata.num_row_groups):
        stats = file.metadata.row_group(i).column(1).statistics
        if stats is None or stats.min <= lat <= stats.max:
            groups.append(i)
    if not groups:
        return pd.DataFrame(columns=["date", "lon", "value", "valid_frac"])
    columns = ["date", "lat", "lon", "value", "valid_frac"]
    if own_handle:
        # a file handle is not thread-safe; the cached footer saves re-reading it
        with open_file(f"grid/{key}.parquet") as handle:
            rows = pq.ParquetFile(handle, metadata=file.metadata).read_row_groups(groups, columns=columns).to_pandas()
    else:
        rows = file.read_row_groups(groups, columns=columns).to_pandas()
    return rows[rows["lat"] == lat].drop(columns="lat")


def cell_center(value: float) -> float:
    return min(89.5, max(-89.5, np.floor(value) + 0.5))


def point_series(key: str, lat: float, lon: float) -> tuple[pd.DataFrame, float, float]:
    lat0, lon0 = cell_center(lat), ((np.floor(lon) + 180) % 360) - 179.5
    best = None
    for dlat in sorted(range(-SEARCH_CELLS, SEARCH_CELLS + 1), key=abs):
        band_lat = lat0 + dlat
        if best is not None and abs(dlat) >= best[0]:
            break
        if abs(band_lat) > 89.5:
            continue
        band = _band(key, band_lat)
        for cell_lon, rows in band.groupby("lon"):
            dlon = abs((cell_lon - lon0 + 180) % 360 - 180)
            if dlon > SEARCH_CELLS:
                continue
            distance = np.hypot(dlat, dlon * np.cos(np.deg2rad(band_lat)))
            if best is None or distance < best[0]:
                best = (distance, band_lat, float(cell_lon), rows)
    if best is None:
        raise DatasetError(f"No {variable(key)['name']} data within about {SEARCH_CELLS * 100} km of this point")
    _, cell_lat, cell_lon, rows = best
    return _monthly(key, rows), cell_lat, cell_lon


@dataclass
class Area:
    df: pd.DataFrame  # monthly weighted mean
    cells: int  # cells with data
    coverage: float  # share of the area (frac * cos lat) that has data


# share of each grid cell inside a box; west > east means the box crosses 180 degrees
def box_fractions(lat: np.ndarray, lon: np.ndarray, south: float, north: float, west: float, east: float) -> np.ndarray:
    dlat, dlon = abs(lat[1] - lat[0]), abs(lon[1] - lon[0])

    def overlap(centers, step, lo, hi):
        return np.clip(np.minimum(hi, centers + step / 2) - np.maximum(lo, centers - step / 2), 0, None) / step

    spans = [(west, east)] if west <= east else [(west, 180.0), (-180.0, east)]
    lon_frac = sum(overlap(lon, dlon, w, e) for w, e in spans)
    return overlap(lat, dlat, south, north)[:, None] * lon_frac[None, :]


def _cells(frac: np.ndarray) -> pd.DataFrame:
    i, j = np.nonzero(frac >= MIN_FRAC)
    return pd.DataFrame({"lat": LAT[i], "lon": LON[j], "frac": frac[i, j]})


def _area(key: str, cells: pd.DataFrame, where: str) -> Area:
    # mean over cells weighted by frac * cos(lat) * valid_frac; only the latitude bands involved are read
    cells = cells.assign(area=cells["frac"] * np.cos(np.deg2rad(cells["lat"])))
    bands = list(cells.groupby("lat"))
    _grid_file(key)  # footer first, so the threads share it

    def read(item):
        band_lat, wanted = item
        band = _band(key, float(band_lat), own_handle=len(bands) > 1)
        return band.astype({"lon": "float64"}).merge(wanted[["lon", "area"]], on="lon").assign(lat=band_lat)

    with ThreadPoolExecutor(READERS) as pool:
        frames = [f for f in pool.map(read, bands) if not f.empty]
    rows = pd.concat(frames) if frames else pd.DataFrame()
    if rows.empty:
        raise DatasetError(f"No {variable(key)['name']} data {where}")
    # ocean grids leave valid_frac empty: their cells count in full
    weight = rows["area"] * rows["valid_frac"].astype("float64").fillna(1.0)
    sums = pd.DataFrame({"date": rows["date"], "value": rows["value"] * weight, "weight": weight}).groupby("date").sum()
    mean = (sums["value"] / sums["weight"]).rename("value").reset_index()
    covered = rows.drop_duplicates(["lat", "lon"])
    _release()
    return Area(_monthly(key, mean), len(covered), float(covered["area"].sum() / cells["area"].sum()))


def area_series(key: str, south: float, north: float, west: float, east: float) -> Area:
    cells = _cells(box_fractions(LAT, LON, south, north, west, east))
    if cells.empty:
        raise DatasetError("The area is empty")
    return _area(key, cells, "inside this area")


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


def region_series(key: str, rid: str) -> Area:
    return _area(key, region_cells(rid), f"in {region(rid)['name']}")


def regions_cells(ids: list[str]) -> pd.DataFrame:
    ids = list(dict.fromkeys(ids))
    chosen = pd.DataFrame([region(rid) for rid in ids])
    countries = set(chosen.loc[chosen["kind"] == "country", "id"])
    nested = chosen[(chosen["kind"] == "admin1") & chosen["country"].isin(countries)]
    if not nested.empty:
        raise ValueError(f"{nested.iloc[0]['name']} lies inside a selected country; pick the country or its regions, not both")
    cells = _region_weights().loc[ids].reset_index(drop=True).groupby(["lat", "lon"], as_index=False)["frac"].sum()
    # neighbours share cells along their borders, and their shares add up to at most the whole cell
    cells["frac"] = cells["frac"].clip(upper=1.0)
    return cells


def regions_label(ids: list[str], shown: int = 3) -> str:
    names = [region(rid)["name"] for rid in dict.fromkeys(ids)]
    return ", ".join(names) if len(names) <= shown else f"{', '.join(names[:shown])} and {len(names) - shown} more"


def regions_series(key: str, ids: list[str]) -> Area:
    return _area(key, regions_cells(ids), "in the selected regions")


def _monthly(key: str, rows: pd.DataFrame) -> pd.DataFrame:
    factor = variable(key)["factor"]
    df = pd.DataFrame(
        {"time": pd.to_datetime(rows["date"]).dt.tz_localize("UTC"), "value": rows["value"].astype("float64") * factor}
    )
    return df.sort_values("time").reset_index(drop=True)


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
