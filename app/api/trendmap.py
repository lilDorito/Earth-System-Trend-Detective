# /api/trendmap endpoints for the global trend map

from functools import lru_cache

import numpy as np
import pandas as pd
import pymannkendall as mk
from fastapi import APIRouter, Query

from src import gridtrends

router = APIRouter(prefix="/api/trendmap", tags=["trendmap"])


def _clean(values, decimals: int) -> list[float | None]:
    arr = np.round(np.asarray(values, dtype=np.float64), decimals).ravel()
    return [None if v != v else float(v) for v in arr.tolist()]


def _nearest(axis: np.ndarray, value: float, circular: bool) -> int:
    diff = np.abs((axis - value + 180.0) % 360.0 - 180.0) if circular else np.abs(axis - value)
    return int(diff.argmin())


def _summary(values: np.ndarray):
    res = mk.hamed_rao_modification_test(values)
    return res, res.intercept + res.slope * np.arange(len(values))


@lru_cache
def _state():
    ds = gridtrends.load_grid()
    slope, _p, _q, significant = gridtrends.compute_grid(ds.t2m)
    mean = gridtrends.global_mean(ds).astype(np.float64)
    res, fitted = _summary(mean)
    return {
        "ds": ds,
        "slope": slope,
        "sig": significant,
        "global": {
            "years": [int(y) for y in ds.years],
            "values": _clean(mean, 3),
            "fitted": _clean(fitted, 3),
            "trend": res.trend,
            "p": float(res.p),
            "slope_decade": float(res.slope * 10),
        },
    }


@router.get("/meta")
def meta():
    ds = _state()["ds"]
    return {
        "demo": ds.demo,
        "variable": "T2M",
        "units": "°C",
        "years": [int(ds.years[0]), int(ds.years[-1])],
        "n_lat": int(len(ds.lat)),
        "n_lon": int(len(ds.lon)),
    }


@router.get("/grid")
def grid():
    s = _state()
    return {
        "n_lat": int(s["slope"].shape[0]),
        "n_lon": int(s["slope"].shape[1]),
        "slope": _clean(s["slope"], 3),
        "sig": s["sig"].astype(int).ravel().tolist(),
    }


@router.get("/global-mean")
def global_mean():
    return _state()["global"]


@router.get("/point")
def point(lat: float = Query(..., ge=-90, le=90), lon: float = Query(..., ge=-180, le=180)):
    s = _state()
    ds = s["ds"]
    i, j = _nearest(ds.lat, lat, False), _nearest(ds.lon, lon, True)
    values = ds.t2m[:, i, j].astype(np.float64)
    res, fitted = _summary(values)
    return {
        "lat": float(ds.lat[i]),
        "lon": float(ds.lon[j]),
        "years": [int(y) for y in ds.years],
        "values": _clean(values, 3),
        "fitted": _clean(fitted, 3),
        "rolling": _clean(pd.Series(values).rolling(5, center=True).mean().to_numpy(), 3),
        "trend": res.trend,
        "p": float(res.p),
        "slope_decade": float(res.slope * 10),
        "significant_hr": bool(res.h),
        "significant_fdr": bool(s["sig"][i, j]),
    }
