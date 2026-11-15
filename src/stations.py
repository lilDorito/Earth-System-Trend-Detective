# NCEI GSOM weather stations from the Hugging Face dataset: annual anomalies and trends per element

import threading
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from scipy.stats import norm

from . import dataset, gridtrends

MIN_YEARS = 20
MIN_MONTHS = 9
MIN_CLIM = 3
MIN_SHOWN = 5

ELEMENTS = {
    "TAVG": dict(name="Mean air temperature", units="°C", grid=("merra2_t2m", "gldas_tair")),
    "PRCP": dict(name="Precipitation", units="mm/month", grid=("imerg_precip", "gldas_precip")),
    "AWND": dict(name="Mean wind speed", units="m/s", grid=("merra2_wind10m", "gldas_wind")),
}

_lock = threading.Lock()


@dataclass
class Element:
    key: str
    ids: np.ndarray
    years: np.ndarray
    anomalies: np.ndarray
    n_years: np.ndarray
    slope: np.ndarray
    intercept: np.ndarray
    p: np.ndarray
    significant: np.ndarray
    scale: float


def element_for(variable: str) -> str | None:
    return next((key for key, spec in ELEMENTS.items() if variable in spec["grid"]), None)


def pretty_name(name: str) -> str:
    head, sep, tail = str(name).rpartition(", ")
    if not sep:
        return str(name).title()
    return f"{head.title()}, {tail.upper()}"


def mann_kendall(years: np.ndarray, values: np.ndarray) -> tuple[float, float, float]:
    n = len(values)
    i, j = np.triu_indices(n, 1)
    diff = values[j] - values[i]
    slope = float(np.median(diff / (years[j] - years[i])))
    t = years - years[0]
    intercept = float(np.median(values - slope * t))
    s = float(np.sign(diff).sum())
    resid = values - slope * t
    resid = resid - np.median(resid)
    denom = float(np.sum(resid * resid))
    rho = float(np.sum(resid[:-1] * resid[1:])) / denom if denom > 0 else 0.0
    rho = min(max(rho, 0.0), 0.9)
    var_s = n * (n - 1) * (2 * n + 5) / 18.0 * (1 + rho) / (1 - rho)
    z = (s - np.sign(s)) / np.sqrt(var_s)
    return slope, intercept, float(2 * norm.sf(abs(z)))


@lru_cache
def metadata() -> pd.DataFrame:
    try:
        with dataset.open_file("stations/stations.parquet") as file:
            frame = pd.read_parquet(file)
    except Exception as e:
        raise dataset.DatasetError(f"Could not read the station list ({dataset.REPO}): {e}") from e
    if "has_data" in frame:
        frame = frame[frame["has_data"].astype(bool)]
    frame = frame.assign(
        station_id=frame["station_id"].astype(str),
        name=frame["name"].map(pretty_name),
        country=frame.get("country", pd.Series("", index=frame.index)).fillna("").astype(str),
        elevation=pd.to_numeric(frame.get("elevation"), errors="coerce"),
    )
    return frame.set_index("station_id", drop=False)[["station_id", "name", "latitude", "longitude", "elevation", "country"]]


def _monthly(key: str) -> pd.DataFrame:
    try:
        with dataset.open_file("stations/monthly.parquet", block_size=1 << 22) as file:
            table = pq.read_table(file, columns=["station_id", "date", key])
    except Exception as e:
        raise dataset.DatasetError(f"Could not read the station series ({dataset.REPO}): {e}") from e
    frame = table.to_pandas().dropna(subset=[key])
    del table
    dataset._release()
    date = pd.to_datetime(frame["date"])
    return pd.DataFrame(
        {"station_id": frame["station_id"].astype(str), "year": date.dt.year, "month": date.dt.month, "value": frame[key].astype("float64")}
    )


def _complete_years(frame: pd.DataFrame) -> np.ndarray:
    months = frame.groupby("year")["month"].agg(["min", "max"])
    return np.array(sorted(months.index[(months["min"] == 1) & (months["max"] == 12)]), dtype=int)


def _build(key: str) -> Element:
    if key not in ELEMENTS:
        raise KeyError(f"Unknown station element '{key}'")
    frame = _monthly(key)
    known = metadata().index
    frame = frame[frame["station_id"].isin(known)]
    years = _complete_years(frame)
    frame = frame[frame["year"].isin(years)]
    group = frame.groupby(["station_id", "month"])["value"]
    clim = group.transform("mean")
    count = group.transform("size")
    frame = frame.assign(anomaly=frame["value"] - clim)[count >= MIN_CLIM]
    annual = frame.groupby(["station_id", "year"])["anomaly"].agg(["mean", "size"]).reset_index()
    annual = annual[annual["size"] >= MIN_MONTHS]
    shown = annual.groupby("station_id").size()
    ids = np.array(sorted(shown.index[shown >= MIN_SHOWN]), dtype=object)
    annual = annual[annual["station_id"].isin(ids)]
    row = np.searchsorted(ids, annual["station_id"].to_numpy())
    col = np.searchsorted(years, annual["year"].to_numpy())
    values = np.full((len(ids), len(years)), np.nan, dtype=np.float32)
    values[row, col] = annual["mean"].to_numpy()

    n_years = np.isfinite(values).sum(axis=1)
    slope = np.full(len(ids), np.nan)
    intercept = np.full(len(ids), np.nan)
    p = np.full(len(ids), np.nan)
    t = years.astype(np.float64)
    for k in np.flatnonzero(n_years >= MIN_YEARS):
        ok = np.isfinite(values[k])
        slope[k], intercept[k], p[k] = mann_kendall(t[ok], values[k, ok].astype(np.float64))
    q = gridtrends.fdr_bh(p) if np.isfinite(p).any() else p
    significant = np.isfinite(q) & (q < gridtrends.ALPHA)
    scale = dataset.nice_limit(dataset.quantile_abs(slope * 10, 0.9))
    return Element(key, ids, years, values, n_years, slope, intercept, p, significant, scale)


@lru_cache(maxsize=3)
def _cached(key: str) -> Element:
    return _build(key)


def element(key: str) -> Element:
    with _lock:
        return _cached(key)


def clear_caches() -> None:
    metadata.cache_clear()
    _cached.cache_clear()
