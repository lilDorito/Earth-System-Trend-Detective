# global trend map endpoints for the globe layer: /api/trendmap/*
# every endpoint takes an optional year range (start, end); default = the whole record

from functools import lru_cache

import numpy as np
import pandas as pd
import pymannkendall as mk
from fastapi import APIRouter, HTTPException, Query

from src import gridtrends

router = APIRouter(prefix="/api/trendmap", tags=["trendmap"])
MIN_YEARS = 8  # Mann-Kendall on fewer annual points is meaningless


def _clean(values, decimals: int) -> list[float | None]:
    arr = np.round(np.asarray(values, dtype=np.float64), decimals).ravel()
    return [None if v != v else float(v) for v in arr.tolist()]


def _nearest(axis: np.ndarray, value: float, circular: bool) -> int:
    diff = np.abs((axis - value + 180.0) % 360.0 - 180.0) if circular else np.abs(axis - value)
    return int(diff.argmin())


def _summary(values: np.ndarray):
    """Hamed-Rao modified Mann-Kendall (autocorrelation-corrected) + Sen line.

    On strongly autocorrelated series Hamed-Rao can produce a negative variance (p = NaN);
    then fall back to the plain Mann-Kendall test (res.corrected is False).
    """
    with np.errstate(invalid="ignore"):
        res = mk.hamed_rao_modification_test(values)
    corrected = bool(np.isfinite(res.p))
    if not corrected:
        res = mk.original_test(values)
    return res, res.intercept + res.slope * np.arange(len(values)), corrected


@lru_cache
def _ds() -> gridtrends.GridDataset:
    return gridtrends.load_grid()


def _range(start: int | None, end: int | None) -> tuple[int, int]:
    ds = _ds()
    y0, y1 = int(ds.years[0]), int(ds.years[-1])
    start = y0 if start is None else start
    end = y1 if end is None else end
    if start < y0 or end > y1:
        raise HTTPException(422, f"Data covers {y0}-{y1}")
    if end - start + 1 < MIN_YEARS:
        raise HTTPException(422, f"Pick at least {MIN_YEARS} years (got {end - start + 1})")
    return start, end


def _slice(start: int, end: int) -> np.ndarray:
    ds = _ds()
    return (ds.years >= start) & (ds.years <= end)


@lru_cache(maxsize=32)
def _grid(start: int, end: int):
    """(slope per decade, significant mask at FDR 5%) for the year range."""
    slope, _p, _q, significant = gridtrends.compute_grid(_ds().t2m[_slice(start, end)])
    return slope, significant


BASELINE_YEARS = 5  # anomalies are measured against the mean of the first years of the period


@lru_cache(maxsize=8)
def _frames(start: int, end: int):
    """Annual anomaly maps (year minus baseline mean) + global mean anomaly per year."""
    ds = _ds()
    data = ds.t2m[_slice(start, end)].astype(np.float64)
    n_base = min(BASELINE_YEARS, max(1, data.shape[0] // 2))
    anomaly = data - data[:n_base].mean(axis=0)
    return anomaly, gridtrends.global_mean_series(anomaly, ds.lat), n_base


@router.get("/frames")
def frames(start: int | None = None, end: int | None = None):
    """One anomaly map per year of the period (for the timeline slider). Cached on the server and in the browser."""
    start, end = _range(start, end)
    anomaly, mean, n_base = _frames(start, end)
    return {
        "start": start,
        "end": end,
        "years": list(range(start, end + 1)),
        "baseline": [start, start + n_base - 1],
        "n_lat": int(anomaly.shape[1]),
        "n_lon": int(anomaly.shape[2]),
        "frames": [_clean(a, 2) for a in anomaly],
        "global_mean": _clean(mean, 3),
    }


# preset regions: (south, north, west, east)
REGIONS = {
    "ukraine": ("Ukraine", (44.0, 53.0, 22.0, 41.0)),
    "europe": ("Europe", (35.0, 72.0, -10.0, 40.0)),
    "arctic": ("Arctic (north of 66.5°N)", (66.5, 90.0, -180.0, 180.0)),
    "tropics": ("Tropics (23.5°S to 23.5°N)", (-23.5, 23.5, -180.0, 180.0)),
    "usa": ("Contiguous USA", (25.0, 49.5, -125.0, -66.5)),
}


@router.get("/region")
def region(name: str, start: int | None = None, end: int | None = None):
    """Area-weighted regional mean vs the global mean: trend tests, ratio, warming stripes."""
    if name not in REGIONS:
        raise HTTPException(404, f"Unknown region. Choose one of: {', '.join(REGIONS)}")
    start, end = _range(start, end)
    ds = _ds()
    label, (south, north, west, east) = REGIONS[name]
    mask = _slice(start, end)
    cell = (ds.lat[:, None] >= south) & (ds.lat[:, None] <= north) & (ds.lon[None, :] >= west) & (ds.lon[None, :] <= east)
    if not cell.any():
        raise HTTPException(422, "The grid has no cells inside this region")
    w = np.cos(np.deg2rad(ds.lat))[:, None] * cell
    data = ds.t2m[mask].astype(np.float64)
    mean = (data * w[None]).sum(axis=(1, 2)) / w.sum() / 1.0
    glob = gridtrends.global_mean_series(ds.t2m[mask], ds.lat).astype(np.float64)

    res, fitted, corrected = _summary(mean)
    gres, _gfit, _gcorr = _summary(glob)
    slope_decade, global_decade = float(res.slope * 10), float(gres.slope * 10)
    slope_cells, _sig = _grid(start, end)
    warming_share = float((np.cos(np.deg2rad(ds.lat))[:, None] * cell * (slope_cells > 0)).sum() / w.sum())
    return {
        "name": name,
        "label": label,
        "bbox": [south, north, west, east],
        "n_cells": int(cell.sum()),
        "start": start,
        "end": end,
        "years": [int(y) for y in ds.years[mask]],
        "mean": _clean(mean, 3),
        "fitted": _clean(fitted, 3),
        "global_mean": _clean(glob, 3),
        "stripes": _clean(mean - mean.mean(), 3),
        "trend": res.trend,
        "p": float(res.p),
        "autocorr_corrected": corrected,
        "slope_decade": slope_decade,
        "total_change": float(res.slope * (end - start)),
        "global_slope_decade": global_decade,
        "ratio": None if abs(global_decade) < 0.02 else slope_decade / global_decade,
        "share_warming": warming_share,
    }


@router.get("/meta")
def meta():
    ds = _ds()
    return {
        "demo": ds.demo,
        "label": ds.label,
        "variable": "T2M",
        "units": "°C",
        "years": [int(ds.years[0]), int(ds.years[-1])],
        "min_years": MIN_YEARS,
        "n_lat": int(len(ds.lat)),
        "n_lon": int(len(ds.lon)),
    }


@router.get("/grid")
def grid(start: int | None = None, end: int | None = None):
    """Trend per cell in °C/decade and FDR-significance flag. Order: latitude ascending, then longitude."""
    start, end = _range(start, end)
    slope, sig = _grid(start, end)
    return {
        "start": start,
        "end": end,
        "span_years": end - start,
        "n_lat": int(slope.shape[0]),
        "n_lon": int(slope.shape[1]),
        "slope": _clean(slope, 3),
        "sig": sig.astype(int).ravel().tolist(),
    }


@router.get("/summary")
def summary(start: int | None = None, end: int | None = None):
    """Global analytics for the period: mean series + trend test, area shares, trend by latitude."""
    start, end = _range(start, end)
    ds = _ds()
    mask = _slice(start, end)
    slope, sig = _grid(start, end)

    mean = gridtrends.global_mean_series(ds.t2m[mask], ds.lat).astype(np.float64)
    res, fitted, corrected = _summary(mean)

    w = np.cos(np.deg2rad(ds.lat))[:, None] * np.ones((1, len(ds.lon)))  # cell area ~ cos(lat)
    w = w / w.sum()
    warming, cooling = slope > 0, slope < 0

    def share(m):
        return float((w * m).sum())

    zonal = slope.mean(axis=1)  # trend averaged along each parallel
    return {
        "start": start,
        "end": end,
        "years": [int(y) for y in ds.years[mask]],
        "mean": _clean(mean, 3),
        "fitted": _clean(fitted, 3),
        "trend": res.trend,
        "p": float(res.p),
        "autocorr_corrected": corrected,
        "slope_decade": float(res.slope * 10),
        "total_change": float(res.slope * (end - start)),
        "share_warming": share(warming),
        "share_warming_significant": share(warming & sig),
        "share_cooling": share(cooling),
        "share_cooling_significant": share(cooling & sig),
        "lat": [float(v) for v in ds.lat],
        "zonal_slope": _clean(zonal, 3),
        "fastest_lat": float(ds.lat[int(np.nanargmax(zonal))]),
    }


@router.get("/global-mean")
def global_mean(start: int | None = None, end: int | None = None):
    """Global mean series + trend test (the shape the web client expects)."""
    s = summary(start, end)
    return {k: s[k] for k in ("years", "slope_decade", "trend", "p", "fitted")} | {"values": s["mean"]}


@router.get("/point")
def point(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    start: int | None = None,
    end: int | None = None,
):
    """Annual series and trend tests for the grid cell nearest to the point, over the year range."""
    start, end = _range(start, end)
    ds = _ds()
    i, j = _nearest(ds.lat, lat, False), _nearest(ds.lon, lon, True)
    mask = _slice(start, end)
    values = ds.t2m[mask][:, i, j].astype(np.float64)
    res, fitted, corrected = _summary(values)
    _, sig = _grid(start, end)
    return {
        "lat": float(ds.lat[i]),
        "lon": float(ds.lon[j]),
        "years": [int(y) for y in ds.years[mask]],
        "values": _clean(values, 3),
        "fitted": _clean(fitted, 3),
        "rolling": _clean(pd.Series(values).rolling(5, center=True).mean().to_numpy(), 3),
        "trend": res.trend,
        "p": float(res.p),
        "autocorr_corrected": corrected,
        "slope_decade": float(res.slope * 10),
        "total_change": float(res.slope * (end - start)),
        "significant_hr": bool(res.h),
        "significant_fdr": bool(sig[i, j]),
    }
