# trend map endpoints; the whole record is read from trends/<key>.npz, other year ranges are computed here

import gzip
import json
import threading
from functools import lru_cache, wraps
from pathlib import Path

import numpy as np
import pandas as pd
import pymannkendall as mk
from fastapi import APIRouter, HTTPException, Query, Request, Response

from src import dataset, gridtrends, trendmaps
from src.config import settings
from src.trendmaps import coarsen as _coarsen
from src.trendmaps import nanmean as _nanmean
from src.trendmaps import value_range as _value_range

router = APIRouter(prefix="/api/trendmap", tags=["trendmap"])
MIN_YEARS = 8  # Mann-Kendall on fewer annual points is meaningless
MAX_SNAP_DEG = 3.0  # a click may snap this far to the nearest cell with data
DEFAULT = gridtrends.DEMO_KEY
Variable = Query(DEFAULT, description="dataset variable key, see /api/trendmap/variables")

# preset regions: box (south, north, west, east) and the Natural Earth boundary used instead on live data
REGIONS = {
    "ukraine": ("Ukraine", (44.0, 53.0, 22.0, 41.0), "ukr"),
    "europe": ("Europe", (35.0, 72.0, -10.0, 40.0), None),
    "arctic": ("Arctic (north of 66.5°N)", (66.5, 90.0, -180.0, 180.0), None),
    "tropics": ("Tropics (23.5°S to 23.5°N)", (-23.5, 23.5, -180.0, 180.0), None),
    "usa": ("Contiguous USA", (25.0, 49.5, -125.0, -66.5), None),
}


def _what(ds: gridtrends.GridDataset) -> str:
    # "Soil moisture 0-10 cm (GLDAS Noah), annual mean" -> "soil moisture 0-10 cm"
    name = ds.label.split(",")[0].split(" (")[0]
    return name[:1].lower() + name[1:]


def _clean(values, decimals: int) -> list[float | None]:
    arr = np.round(np.asarray(values, dtype=np.float64), decimals).ravel()
    return [None if v != v else float(v) for v in arr.tolist()]


def _sen(years: np.ndarray, values: np.ndarray) -> tuple[float, float]:
    # Sen slope per year on the real years, so gaps in the record do not distort it
    i, j = np.triu_indices(len(years), 1)
    slope = float(np.median((values[j] - values[i]) / (years[j] - years[i])))
    return slope, float(np.median(values - slope * (years - years[0])))


def _summary(years: np.ndarray, values: np.ndarray) -> dict:
    # Hamed-Rao Mann-Kendall; falls back to the plain test when Hamed-Rao gives p = NaN
    with np.errstate(invalid="ignore"):
        res = mk.hamed_rao_modification_test(values)
    corrected = bool(np.isfinite(res.p))
    if not corrected:
        res = mk.original_test(values)
    slope, intercept = _sen(years.astype(np.float64), values)
    fitted = intercept + slope * (years - years[0])
    return dict(trend=res.trend, p=float(res.p), h=bool(res.h), slope=slope, fitted=fitted, corrected=corrected)


_heavy = threading.RLock()


# loads and grid statistics run one at a time: the free Render instance has 512 MB, and the four
# requests the map sends for a new variable would otherwise each compute it at once
def _one_at_a_time(fn):
    @wraps(fn)
    def wrapper(*args):
        with _heavy:
            return fn(*args)

    wrapper.cache_clear = fn.cache_clear
    return wrapper


@_one_at_a_time
@lru_cache(maxsize=3)
def _ds(variable: str) -> gridtrends.GridDataset:
    try:
        return gridtrends.load_grid(variable)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'\""))
    except dataset.DatasetError as e:
        raise HTTPException(503, str(e))


@_one_at_a_time
@lru_cache(maxsize=8)
def _pre(name: str) -> dict | None:
    if settings.data_mode != "live":
        return None
    try:
        return trendmaps.read(name)
    except dataset.DatasetError:
        return None


_responses: dict[str, tuple[bytes, bytes]] = {}
RESPONSES_KEPT = 12  # about 1 MB each, compressed and not


def _send(request: Request, key: str, build) -> Response:
    # whole-record responses are serialised and gzipped once, then served from memory; an already compressed
    # response passes the gzip middleware untouched
    hit = _responses.pop(key, None)
    if hit is None:
        raw = json.dumps(build(), separators=(",", ":")).encode()
        hit = (raw, gzip.compress(raw, 6))
    _responses[key] = hit  # most recently used last
    while len(_responses) > RESPONSES_KEPT:
        _responses.pop(next(iter(_responses)))
    raw, packed = hit
    if "gzip" in request.headers.get("accept-encoding", ""):
        return Response(packed, media_type="application/json", headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"})
    return Response(raw, media_type="application/json")


def _years_of(variable: str) -> np.ndarray:
    pre = _pre(variable)
    return pre["years"] if pre is not None else _ds(variable).years


def _full(variable: str, start: int, end: int) -> dict | None:
    pre = _pre(variable)
    if pre is not None and start == int(pre["years"][0]) and end == int(pre["years"][-1]):
        return pre
    return None


def _range(variable: str, start: int | None, end: int | None) -> tuple[int, int]:
    years = _years_of(variable)
    y0, y1 = int(years[0]), int(years[-1])
    start = y0 if start is None else start
    end = y1 if end is None else end
    if start < y0 or end > y1:
        raise HTTPException(422, f"Data covers {y0}-{y1}")
    count = int(((years >= start) & (years <= end)).sum())
    if count < MIN_YEARS:
        raise HTTPException(422, f"Pick at least {MIN_YEARS} years with data (got {count})")
    return start, end


def _slice(variable: str, start: int, end: int) -> np.ndarray:
    years = _ds(variable).years
    return (years >= start) & (years <= end)


@_one_at_a_time
@lru_cache(maxsize=16)
def _grid(variable: str, start: int, end: int):
    full = _full(variable, start, end)
    if full is not None:
        return full["slope"], full["sig"].astype(bool)
    ds = _ds(variable)
    mask = _slice(variable, start, end)
    slope, _p, _q, significant = gridtrends.compute_grid(ds.values[mask], ds.years[mask])
    return slope, significant


@_one_at_a_time
@lru_cache(maxsize=2)
def _frames(variable: str, start: int, end: int):
    ds = _ds(variable)
    data = ds.values[_slice(variable, start, end)]
    anomaly, n_base = trendmaps.anomalies(data)
    return anomaly, gridtrends.global_mean_series(anomaly, ds.lat), n_base


def _geometry(lat: np.ndarray, lon: np.ndarray) -> dict:
    # first cell centre and spacing, so the client places cells exactly (pole-to-pole or cell-centred grids)
    return {"lat0": float(lat[0]), "lon0": float(lon[0]), "dlat": float(lat[1] - lat[0]), "dlon": float(lon[1] - lon[0])}


def _years(variable: str, start: int, end: int) -> list[int]:
    ds = _ds(variable)
    return [int(y) for y in ds.years[_slice(variable, start, end)]]


@router.get("/variables")
def variables():
    if settings.data_mode != "live":
        ds = _ds(DEFAULT)
        return [dict(key=DEFAULT, name=ds.label.split(",")[0], units=ds.units, group="atmosphere", domain="global")]
    try:
        catalog = dataset.catalog()
    except dataset.DatasetError as e:
        raise HTTPException(503, str(e))
    fields = ("key", "name", "units", "group", "domain", "start", "end")
    return [{k: row[k] for k in fields} for row in catalog.values()]


@router.get("/meta")
def meta(variable: str = Variable):
    pre = _pre(variable)
    if pre is not None:
        try:
            info = dataset.variable(variable)
        except KeyError as e:
            raise HTTPException(404, str(e).strip("'\""))
        return {
            "demo": False,
            "key": variable,
            "label": f"{info['name']}, annual mean",
            "name": info["name"],
            "group": info["group"],
            "domain": info["domain"],
            "variable": variable,
            "units": info["units"],
            "years": [int(pre["years"][0]), int(pre["years"][-1])],
            "min_years": MIN_YEARS,
            "n_lat": len(dataset.LAT),
            "n_lon": len(dataset.LON),
            "trend_scale": float(pre["trend_scale"]),
            "anomaly_scale": float(pre["anomaly_scale"]),
            "value_range": [float(v) for v in pre["value_range"]],
        }
    ds = _ds(variable)
    start, end = int(ds.years[0]), int(ds.years[-1])
    slope, _ = _grid(variable, start, end)
    anomaly, _, _ = _frames(variable, start, end)
    info = dataset.catalog().get(variable, {}) if settings.data_mode == "live" else {}
    return {
        "demo": ds.demo,
        "key": variable,
        "label": ds.label,
        "name": info.get("name", ds.label.split(",")[0]),
        "group": info.get("group", "atmosphere"),
        "domain": info.get("domain", "global"),
        "variable": variable,
        "units": ds.units,
        "years": [start, end],
        "min_years": MIN_YEARS,
        "n_lat": int(len(ds.lat)),
        "n_lon": int(len(ds.lon)),
        "trend_scale": dataset.nice_limit(dataset.quantile_abs(slope, 0.9)),
        "anomaly_scale": dataset.nice_limit(dataset.quantile_abs(anomaly, 0.97)),
        "value_range": _value_range(ds.values),
    }


@router.get("/frames")
def frames(
    request: Request,
    variable: str = Variable,
    start: int | None = None,
    end: int | None = None,
    kind: str = Query("anomaly", pattern="^(anomaly|values)$"),
):
    # anomaly: vs the mean of the first years; values: the annual means themselves
    start, end = _range(variable, start, end)
    if _full(variable, start, end) is not None:
        return _send(request, f"frames:{variable}:{kind}", lambda: _frames_body(variable, start, end, kind))
    return _frames_body(variable, start, end, kind)


def _frames_body(variable: str, start: int, end: int, kind: str) -> dict:
    full = _full(variable, start, end)
    if full is not None:
        coarse, mean = full[f"{'value' if kind == 'values' else 'anomaly'}_frames"], full[f"{'value' if kind == 'values' else 'anomaly'}_mean"]
        lat, lon, n_base = full["frame_lat"], full["frame_lon"], int(full["n_base"])
        years = [int(y) for y in full["years"]]
    else:
        anomaly, mean, n_base = _frames(variable, start, end)
        ds = _ds(variable)
        if kind == "values":
            data = ds.values[_slice(variable, start, end)]
            mean = gridtrends.global_mean_series(data, ds.lat)
        else:
            data = anomaly
        coarse, lat, lon = _coarsen(data, ds.lat, ds.lon)
        years = _years(variable, start, end)
    # enough decimals for smooth contours over the data's own spread (pH spans about 0.1)
    spread = np.nanquantile(np.abs(coarse - np.nanmedian(coarse)), 0.98) if np.isfinite(coarse).any() else 1.0
    decimals = int(np.clip(3 - np.floor(np.log10(max(spread, 1e-9))), 1, 6))
    return {
        "kind": kind,
        "start": start,
        "end": end,
        "years": years,
        "baseline": [years[0], years[n_base - 1]],
        "n_lat": int(coarse.shape[1]),
        "n_lon": int(coarse.shape[2]),
        **_geometry(lat, lon),
        "frames": [_clean(a, decimals) for a in coarse],
        "global_mean": _clean(mean, 3),
    }


@_one_at_a_time
@lru_cache(maxsize=2)
def _flow(field: str, start: int, end: int):
    years = _years_of(trendmaps.FLOWS[field][0])
    w = trendmaps.build_flow(field, years[(years >= start) & (years <= end)])
    return (w["u"], w["v"]), w["frame_lat"], w["frame_lon"]


@router.get("/flow")
def flow(field: str = Query("wind", pattern="^(wind|current)$"), start: int | None = None, end: int | None = None):
    if settings.data_mode != "live":
        raise HTTPException(404, "Flow vectors need DATA_MODE=live")
    part = trendmaps.FLOWS[field][0]
    if part not in dataset.catalog():
        raise HTTPException(404, f"This dataset revision has no {field} field")
    start, end = _range(part, start, end)
    pre = _pre(f"_{field}")
    if pre is not None and (start, end) == (int(pre["years"][0]), int(pre["years"][-1])):
        u, v, lat, lon = pre["u"], pre["v"], pre["frame_lat"], pre["frame_lon"]
    else:
        (u, v), lat, lon = _flow(field, start, end)
    return {
        "field": field,
        "start": start,
        "end": end,
        "n_lat": int(len(lat)),
        "n_lon": int(len(lon)),
        **_geometry(lat, lon),
        "u": _clean(u, 3),
        "v": _clean(v, 3),
    }


@router.get("/co2")
def co2(request: Request):
    if settings.data_mode != "live":
        raise HTTPException(404, "The CO2 series needs DATA_MODE=live")
    try:
        frame = dataset.co2()
    except dataset.DatasetError as e:
        raise HTTPException(503, str(e))
    return _send(request, f"co2|{dataset.REVISION}", lambda: _co2(frame))


def _co2(frame: pd.DataFrame) -> dict:
    frame = frame.sort_values("time")
    annual = frame.assign(year=frame["time"].dt.year).groupby("year").agg(ppm=("co2_global_ppm", "mean"), months=("co2_global_ppm", "count"))
    annual = annual[annual["months"] == 12]
    years = annual.index.to_numpy(dtype=np.float64)
    ppm = annual["ppm"].to_numpy(dtype=np.float64)
    slope, intercept = _sen(years, ppm)
    mlo = frame["co2_mauna_loa_ppm"] if "co2_mauna_loa_ppm" in frame else pd.Series(np.nan, index=frame.index)
    return {
        "source": "NOAA GML global marine surface mean",
        "years": [int(y) for y in years],
        "ppm": _clean(ppm, 2),
        "fitted": _clean(intercept + slope * (years - years[0]), 2) if len(years) else [],
        "growth": [None, *_clean(np.diff(ppm), 2)] if len(years) else [],
        "slope_decade": slope * 10,
        "months": frame["time"].dt.strftime("%Y-%m").tolist(),
        "monthly": _clean(frame["co2_global_ppm"], 2),
        "mauna_loa": _clean(mlo, 2),
    }


def _has_regions() -> bool:
    # a dataset revision built before regions.py keeps the preset boxes working
    try:
        dataset.regions()
        return True
    except dataset.DatasetError:
        return False


# seas and oceans (Natural Earth marine areas): the web app's files, so the map outline and the mean agree
SEAS_DIR = Path(__file__).resolve().parents[1] / "web" / "public" / "regions"
_sea_masks: dict[tuple, np.ndarray] = {}


@lru_cache(maxsize=1)
def _seas() -> tuple[dict, dict]:
    rows = json.loads((SEAS_DIR / "seas.json").read_text(encoding="utf-8"))["rows"]
    outlines = json.loads((SEAS_DIR / "outlines" / "sea.json").read_text(encoding="utf-8"))
    return {r["id"]: r for r in rows}, outlines


def _sea_fractions(name: str, ds: gridtrends.GridDataset) -> tuple[str, np.ndarray, list[float]]:
    rows, outlines = _seas()
    if name not in rows:
        raise HTTPException(404, f"Unknown sea: {name}")
    meta = rows[name]
    key = (name, ds.lat.tobytes(), ds.lon.tobytes())
    if key not in _sea_masks:
        lat, lon = np.asarray(ds.lat, float), np.asarray(ds.lon, float)
        order = np.argsort(lat)
        inside = np.zeros((len(lat), len(lon)), dtype=bool)
        for ring in outlines[name]:
            xs, ys = np.asarray(ring[0::2], float), np.asarray(ring[1::2], float)
            for x1, y1, x0, y0 in zip(xs, ys, np.roll(xs, 1), np.roll(ys, 1)):
                if y1 == y0:
                    continue
                lo, hi = np.searchsorted(lat[order], [min(y0, y1), max(y0, y1)])
                for i in order[lo:hi]:
                    x = x1 + (lat[i] - y1) * (x0 - x1) / (y0 - y1)
                    inside[i] ^= lon < x
        _sea_masks[key] = inside.astype(float)
    return meta["name"], _sea_masks[key], [meta["south"], meta["north"], meta["west"], meta["east"]]


def _fractions(name: str, ds: gridtrends.GridDataset) -> tuple[str, np.ndarray, list[float]]:
    if name.startswith("sea-"):
        return _sea_fractions(name, ds)
    live = settings.data_mode == "live" and ds.values.shape[1:] == (len(dataset.LAT), len(dataset.LON))
    label = None
    if name in REGIONS:
        label, box, boundary = REGIONS[name]
        if not (live and boundary and _has_regions()):
            return label, dataset.box_fractions(ds.lat, ds.lon, *box), list(box)
        name = boundary
    if not live:
        raise HTTPException(404, f"Unknown region. Choose one of: {', '.join(REGIONS)}")
    try:
        meta = dataset.region(name)
        cells = dataset.region_cells(name)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'\""))
    except dataset.DatasetError as e:
        raise HTTPException(503, str(e))
    frac = np.zeros(ds.values.shape[1:])
    frac[np.rint(cells["lat"] + 89.5).astype(int), np.rint(cells["lon"] + 179.5).astype(int)] = cells["frac"]
    return label or meta["name"], frac, [meta["south"], meta["north"], meta["west"], meta["east"]]


@router.get("/region")
def region(
    name: str | None = None,
    south: float | None = Query(None, ge=-90, le=90),
    north: float | None = Query(None, ge=-90, le=90),
    west: float | None = Query(None, ge=-180, le=180),
    east: float | None = Query(None, ge=-180, le=180),
    variable: str = Variable,
    start: int | None = None,
    end: int | None = None,
    label: str | None = Query(None, max_length=60, description="name shown for a box"),
):
    # name: a preset (REGIONS) or, on live data, a Natural Earth id from /api/boundaries; or a box (west > east crosses 180)
    start, end = _range(variable, start, end)
    ds = _ds(variable)
    box = (south, north, west, east)
    if name:
        label, frac, bbox = _fractions(name, ds)
    elif None not in box and south < north and west != east:
        label, frac, bbox = label or "Custom area", dataset.box_fractions(ds.lat, ds.lon, *box), list(box)
        name = "box"
    else:
        raise HTTPException(422, "Give a region name or a box with south < north and west != east")
    mask = _slice(variable, start, end)
    data = ds.values[mask].astype(np.float64)
    cells = (frac > 0) & np.isfinite(data).any(axis=0)
    if not cells.any():
        raise HTTPException(422, f"No {_what(ds)} data inside {label}")
    area = np.cos(np.deg2rad(ds.lat))[:, None] * frac
    weights = np.where(cells, frac, 0.0)
    years = ds.years[mask].astype(np.float64)
    mean = gridtrends.selection_mean(data, ds.lat, weights)
    glob = gridtrends.global_mean_series(data, ds.lat)
    valid = np.isfinite(mean) & np.isfinite(glob)
    res = _summary(years[valid], mean[valid])
    world = _summary(years[valid], glob[valid])
    slope_decade, global_decade = res["slope"] * 10, world["slope"] * 10
    slope_cells, _ = _grid(variable, start, end)
    w = area * (cells & np.isfinite(slope_cells))
    return {
        "name": name,
        "label": label,
        "bbox": bbox,
        "n_cells": int(cells.sum()),
        "coverage": round(float(area[cells].sum() / area.sum()), 3),
        "start": start,
        "end": end,
        "years": [int(y) for y in years],
        "mean": _clean(mean, 3),
        "fitted": _clean(np.interp(years, years[valid], res["fitted"]), 3),
        "global_mean": _clean(glob, 3),
        "stripes": _clean(mean - np.nanmean(mean), 3),
        "trend": res["trend"],
        "p": res["p"],
        "autocorr_corrected": res["corrected"],
        "slope_decade": slope_decade,
        "total_change": res["slope"] * (end - start),
        "global_slope_decade": global_decade,
        "ratio": _ratio(slope_decade, global_decade),
        "share_warming": float((w * (slope_cells > 0)).sum() / w.sum()) if w.sum() else 0.0,
    }


def _ratio(region: float, world: float) -> float | None:
    # a near-zero world trend makes the ratio meaningless
    ratio = region / world if world else None
    return ratio if ratio is not None and abs(ratio) <= 50 else None


@router.get("/grid")
def grid(request: Request, variable: str = Variable, start: int | None = None, end: int | None = None):
    start, end = _range(variable, start, end)
    if _full(variable, start, end) is not None:
        return _send(request, f"grid:{variable}", lambda: _grid_body(variable, start, end))
    return _grid_body(variable, start, end)


def _grid_body(variable: str, start: int, end: int) -> dict:
    slope, sig = _grid(variable, start, end)
    lat, lon = (dataset.LAT, dataset.LON) if _full(variable, start, end) is not None else (_ds(variable).lat, _ds(variable).lon)
    return {
        "start": start,
        "end": end,
        "span_years": end - start,
        "n_lat": int(slope.shape[0]),
        "n_lon": int(slope.shape[1]),
        **_geometry(lat, lon),
        "slope": _clean(slope, 4),
        "sig": sig.astype(int).ravel().tolist(),
    }


@router.get("/summary")
def summary(variable: str = Variable, start: int | None = None, end: int | None = None):
    start, end = _range(variable, start, end)
    slope, sig = _grid(variable, start, end)
    full = _full(variable, start, end)
    if full is not None:
        years, mean, lat = full["years"].astype(np.float64), full["value_mean"].astype(np.float64), dataset.LAT
    else:
        ds = _ds(variable)
        mask = _slice(variable, start, end)
        years, lat = ds.years[mask].astype(np.float64), ds.lat
        mean = gridtrends.global_mean_series(ds.values[mask], ds.lat).astype(np.float64)
    res = _summary(years, mean)

    tested = np.isfinite(slope)
    w = np.cos(np.deg2rad(lat))[:, None] * tested  # cell area ~ cos(lat)
    w = w / w.sum() if w.sum() else w
    warming, cooling = slope > 0, slope < 0

    def share(m):
        return float((w * m).sum())

    zonal = _nanmean(slope, axis=1)  # trend averaged along each parallel
    return {
        "start": start,
        "end": end,
        "years": [int(y) for y in years],
        "mean": _clean(mean, 3),
        "fitted": _clean(res["fitted"], 3),
        "trend": res["trend"],
        "p": res["p"],
        "autocorr_corrected": res["corrected"],
        "slope_decade": res["slope"] * 10,
        "total_change": res["slope"] * (end - start),
        "share_warming": share(warming),
        "share_warming_significant": share(warming & sig),
        "share_cooling": share(cooling),
        "share_cooling_significant": share(cooling & sig),
        "lat": [float(v) for v in lat],
        "zonal_slope": _clean(zonal, 4),
        "fastest_lat": float(lat[int(np.nanargmax(zonal))]) if np.isfinite(zonal).any() else None,
    }


@router.get("/global-mean")
def global_mean(variable: str = Variable, start: int | None = None, end: int | None = None):
    s = summary(variable, start, end)
    return {k: s[k] for k in ("years", "slope_decade", "trend", "p", "fitted")} | {"values": s["mean"]}


def _nearest(ds: gridtrends.GridDataset, mask: np.ndarray, lat: float, lon: float) -> tuple[int, int]:
    lat_grid, lon_grid = np.meshgrid(ds.lat, ds.lon, indexing="ij")
    dlon = np.abs((lon_grid - lon + 180) % 360 - 180) * np.cos(np.deg2rad(lat))
    distance = np.where(mask, np.hypot(lat_grid - lat, dlon), np.inf)
    i, j = np.unravel_index(int(np.argmin(distance)), distance.shape)
    if distance[i, j] > MAX_SNAP_DEG:
        raise HTTPException(422, f"No {_what(ds)} data near this point")
    return int(i), int(j)


@router.get("/point")
def point(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    variable: str = Variable,
    start: int | None = None,
    end: int | None = None,
):
    start, end = _range(variable, start, end)
    ds = _ds(variable)
    mask = _slice(variable, start, end)
    data = ds.values[mask]
    i, j = _nearest(ds, np.isfinite(data).all(axis=0), lat, lon)
    years = ds.years[mask].astype(np.float64)
    values = data[:, i, j].astype(np.float64)
    res = _summary(years, values)
    _, sig = _grid(variable, start, end)
    return {
        "lat": float(ds.lat[i]),
        "lon": float(ds.lon[j]),
        "years": [int(y) for y in years],
        "values": _clean(values, 3),
        "fitted": _clean(res["fitted"], 3),
        "rolling": _clean(pd.Series(values).rolling(5, center=True).mean().to_numpy(), 3),
        "trend": res["trend"],
        "p": res["p"],
        "autocorr_corrected": res["corrected"],
        "slope_decade": res["slope"] * 10,
        "total_change": res["slope"] * (end - start),
        "significant_hr": res["h"],
        "significant_fdr": bool(sig[i, j]),
    }
