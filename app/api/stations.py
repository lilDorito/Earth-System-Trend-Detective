# weather station endpoints: station points per element and a station against the nearest grid cell

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from src import dataset, stations
from src.config import settings

from . import trendmap

router = APIRouter(prefix="/api/stations", tags=["stations"])
MIN_COMMON = 5


def _live() -> None:
    if settings.data_mode != "live":
        raise HTTPException(503, "Weather stations need DATA_MODE=live")


def _element(key: str) -> stations.Element:
    _live()
    try:
        return stations.element(key)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'\""))
    except dataset.DatasetError as e:
        raise HTTPException(503, str(e))


def _num(value, digits: int):
    value = float(value)
    return round(value, digits) if np.isfinite(value) else None


def _series(values, digits: int = 3) -> list[float | None]:
    return [_num(v, digits) for v in np.asarray(values, dtype=np.float64)]


def _km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = np.pi / 180
    h = np.sin((lat2 - lat1) * p / 2) ** 2 + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2
    return float(12742 * np.arcsin(np.sqrt(h)))


def _trend(years: np.ndarray, values: np.ndarray) -> dict | None:
    ok = np.isfinite(values)
    if ok.sum() < stations.MIN_YEARS:
        return None
    slope, intercept, p = stations.mann_kendall(years[ok], values[ok])
    fitted = np.where(ok, intercept + slope * (years - years[ok][0]), np.nan)
    return dict(slope_decade=slope * 10, p=p, significant=p < 0.05, n_years=int(ok.sum()), fitted=_series(fitted))


@router.get("/elements")
def elements():
    return [dict(key=key, name=spec["name"], units=spec["units"], grid=list(spec["grid"])) for key, spec in stations.ELEMENTS.items()]


@router.get("")
def station_list(element: str = Query("TAVG", description="TAVG, PRCP or AWND")):
    el = _element(element)
    meta = stations.metadata().loc[el.ids]
    spec = stations.ELEMENTS[element]
    return {
        "element": element,
        "name": spec["name"],
        "units": spec["units"],
        "years": [int(el.years[0]), int(el.years[-1])] if len(el.years) else [],
        "min_years": stations.MIN_YEARS,
        "scale": el.scale,
        "ids": el.ids.tolist(),
        "names": meta["name"].tolist(),
        "lat": _series(meta["latitude"], 3),
        "lon": _series(meta["longitude"], 3),
        "slope": _series(el.slope * 10, 4),
        "p": _series(el.p, 4),
        "significant": el.significant.tolist(),
        "n_years": el.n_years.astype(int).tolist(),
    }


@router.get("/compare")
def compare(
    id: str = Query(..., description="station id, e.g. GHCND:UPM00033345"),
    variable: str | None = Query(None, description="grid variable to compare with"),
    element: str | None = Query(None, description="station element when no variable is given"),
):
    key = (stations.element_for(variable) if variable else None) or element or "TAVG"
    el = _element(key)
    k = int(np.searchsorted(el.ids, id))
    if k >= len(el.ids) or el.ids[k] != id:
        raise HTTPException(404, f"Station {id} has no {stations.ELEMENTS[key]['name'].lower()} record")
    info = stations.metadata().loc[id]
    lat, lon = float(info["latitude"]), float(info["longitude"])
    years = el.years.astype(np.float64)
    station = el.anomalies[k].astype(np.float64)
    out = {
        "id": id,
        "name": info["name"],
        "country": info["country"],
        "lat": lat,
        "lon": lon,
        "elevation": _num(info["elevation"], 0),
        "element": key,
        "element_name": stations.ELEMENTS[key]["name"],
        "units": stations.ELEMENTS[key]["units"],
        "years": [int(y) for y in years],
        "station": None,
        "station_trend": None,
        "min_years": stations.MIN_YEARS,
        "grid": None,
    }

    cell = None
    if variable and stations.element_for(variable) == key:
        ds = trendmap._ds(variable)
        common = np.isin(ds.years, el.years)
        data = ds.values[common]
        enough = np.isfinite(data).sum(axis=0) >= trendmap.MIN_YEARS
        try:
            i, j = trendmap._nearest(ds, enough, lat, lon)
        except HTTPException:
            i = j = None
        if i is not None:
            series = np.full(len(years), np.nan)
            series[np.searchsorted(el.years, ds.years[common])] = data[:, i, j]
            cell = (float(ds.lat[i]), float(ds.lon[j]), series, ds)

    if cell is not None:
        both = np.isfinite(station) & np.isfinite(cell[2])
        if both.sum() >= MIN_COMMON:
            station = station - station[both].mean()
        grid = cell[2] - (cell[2][both].mean() if both.sum() >= MIN_COMMON else np.nanmean(cell[2]))
        fair = np.where(np.isfinite(station), grid, np.nan)
        r = float(np.corrcoef(station[both], grid[both])[0, 1]) if both.sum() >= MIN_COMMON else None
        grid_trend = _trend(years, fair)
        out["grid"] = {
            "variable": variable,
            "name": cell[3].label.split(",")[0],
            "lat": cell[0],
            "lon": cell[1],
            "distance_km": round(_km(lat, lon, cell[0], cell[1])),
            "values": _series(grid),
            "trend": grid_trend,
            "r": _num(r, 3) if r is not None else None,
            "common_years": int(both.sum()),
        }
    else:
        station = station - np.nanmean(station)

    out["station"] = _series(station)
    out["station_trend"] = _trend(years, station)
    if out["station_trend"]:
        out["station_trend"]["significant_fdr"] = bool(el.significant[k])
    if out["station_trend"] and out["grid"] and out["grid"]["trend"]:
        out["grid"]["difference_decade"] = out["station_trend"]["slope_decade"] - out["grid"]["trend"]["slope_decade"]
    return out
