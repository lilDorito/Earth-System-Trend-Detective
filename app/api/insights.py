# insight endpoints on the precomputed products: scanner, trust checks, fingerprints, opposite trends

from functools import lru_cache
from types import SimpleNamespace

import numpy as np
from fastapi import APIRouter, HTTPException, Query

from src import dataset, gridtrends, insights, trendmaps
from src.config import load_yaml, settings

from . import trendmap

router = APIRouter(prefix="/api/insights", tags=["insights"])
MIN_COVERAGE = 0.5  # share of a region a variable must cover to be scanned there


def _live() -> None:
    if settings.data_mode != "live":
        raise HTTPException(404, "Insights need the real dataset (DATA_MODE=live)")


@lru_cache(maxsize=1)
def _cells() -> dict:
    _live()
    products = trendmaps.read("cells", "insights")
    if products is None:
        raise HTTPException(503, "This dataset revision has no insight products; rebuild with hf_dataset.py trends")
    return products


@lru_cache(maxsize=1)
def _regions() -> tuple[dict, dict[str, int]]:
    _live()
    products = trendmaps.read("regions", "insights")
    if products is None:
        raise HTTPException(503, "This dataset revision has no region series; rebuild with hf_dataset.py trends")
    return products, {rid: i for i, rid in enumerate(products["ids"].tolist())}


def _clean(value):
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_clean(v) for v in value]
    if isinstance(value, np.ndarray):
        return _clean(value.tolist())
    if isinstance(value, (np.floating, float)):
        return None if not np.isfinite(value) else round(float(value), 6)
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def _info(key: str) -> dict:
    meta = dataset.variable(key)
    return {"key": key, "name": meta["name"], "units": meta["units"], "group": meta["group"]}


def _place(lat, lon, region, south, north, west, east) -> tuple[str, object]:
    if region and region.startswith("sea-"):
        grid = SimpleNamespace(lat=dataset.LAT, lon=dataset.LON)
        return "box", trendmap._sea_fractions(region, grid)[1]
    if region:
        _, index = _regions()
        if region not in index:
            raise HTTPException(404, f"Unknown region '{region}'")
        return "region", region
    if lat is not None and lon is not None:
        return "point", (lat, lon)
    box = (south, north, west, east)
    if None not in box and south < north and west != east:
        return "box", dataset.box_fractions(dataset.LAT, dataset.LON, *box)
    raise HTTPException(422, "Give lat and lon, a region id, or a box (south, north, west, east)")


def _cell(lat: float, lon: float) -> tuple[int, int]:
    return int(np.clip(np.floor(lat + 90), 0, 179)), int(np.floor(lon + 180) % 360)


def _area_weights(frac: np.ndarray) -> np.ndarray:
    return frac * np.cos(np.deg2rad(dataset.LAT))[:, None]


PlaceQuery = dict(
    lat=Query(None, ge=-90, le=90),
    lon=Query(None, ge=-180, le=180),
    region=Query(None, description="Natural Earth id from /api/boundaries"),
    south=Query(None, ge=-90, le=90),
    north=Query(None, ge=-90, le=90),
    west=Query(None, ge=-180, le=180),
    east=Query(None, ge=-180, le=180),
)


@router.get("/scan")
def scan(
    lat: float | None = PlaceQuery["lat"],
    lon: float | None = PlaceQuery["lon"],
    region: str | None = PlaceQuery["region"],
    south: float | None = PlaceQuery["south"],
    north: float | None = PlaceQuery["north"],
    west: float | None = PlaceQuery["west"],
    east: float | None = PlaceQuery["east"],
):
    # every variable at a place, ranked by effect size (change per decade over the year-to-year scatter), so a
    # tiny but significant trend does not top the list; significance is FDR-corrected across the variables
    kind, place = _place(lat, lon, region, south, north, west, east)
    cells = _cells()
    rows = []
    for key in cells["keys"].tolist():
        slope, p, sig, sigma, step = (cells[f"{key}:{f}"] for f in ("slope", "p", "sig", "sigma", "step"))
        if kind == "point":
            i, j = _cell(*place)
            if not np.isfinite(slope[i, j]):
                continue
            row = {"slope_decade": float(slope[i, j]), "p": float(p[i, j]), "sigma": float(sigma[i, j]),
                   "jump": bool(step[i, j]), "cell_fdr": bool(sig[i, j])}
        elif kind == "region":
            series, index = _regions()
            # a variable covering under half the region (sea salinity in a coastal country) says little about it
            if series[f"{key}:coverage"][index[place]] < MIN_COVERAGE:
                continue
            stats = insights.quick(series[f"{key}:years"], series[f"{key}:series"][index[place]])
            if stats is None:
                continue
            row = {k: stats[k] for k in ("slope_decade", "p", "sigma", "jump")}
        else:
            # a box has no precomputed series: the area-weighted mean slope and scatter of its cells. The scatter of
            # a regional mean is smaller than its cells', so this effect size errs low
            area = _area_weights(place)
            w = area * np.isfinite(slope)
            if w.sum() < MIN_COVERAGE * area.sum():
                continue
            mean = lambda a: float(np.nansum(a * w) / w.sum())  # noqa: E731
            share_sig = mean(sig.astype(float))
            row = {"slope_decade": mean(slope), "p": None, "sigma": mean(sigma), "jump": mean(step.astype(float)) > 0.5,
                   "share_significant": share_sig}
        row["effect"] = row["slope_decade"] / row["sigma"] if row["sigma"] else None
        rows.append(_info(key) | row)
    if not rows:
        raise HTTPException(422, "No variable has data here")
    ps = np.array([r["p"] if r["p"] is not None else np.nan for r in rows], dtype=float)
    q = gridtrends.fdr_bh(ps)
    for r, qv in zip(rows, q):
        r["q"] = None if not np.isfinite(qv) else float(qv)
        r["significant"] = r["q"] < 0.05 if r["q"] is not None else r.get("share_significant", 0) >= 0.5
    rows.sort(key=lambda r: (not r["significant"], -abs(r["effect"] or 0)))
    return _clean({"kind": kind, "approximate": kind == "box", "variables": rows})


def _series(variable: str, kind: str, place) -> tuple[np.ndarray, np.ndarray, dict]:
    if kind == "region":
        series, index = _regions()
        if f"{variable}:series" not in series:
            raise HTTPException(404, f"Unknown variable '{variable}'")
        return series[f"{variable}:years"], series[f"{variable}:series"][index[place]], {}
    ds = trendmap._ds(variable)
    if kind == "point":
        i, j = trendmap._nearest(ds, np.isfinite(ds.values).all(axis=0), *place)
        return ds.years, ds.values[:, i, j], {"lat": float(ds.lat[i]), "lon": float(ds.lon[j])}
    return ds.years, gridtrends.selection_mean(ds.values.astype(np.float64), ds.lat, place), {}


def _agreement(variable: str, kind: str, place, own: dict) -> dict | None:
    partner = trendmaps.PARTNERS.get(variable)
    if not partner:
        return None
    cells = _cells()
    if partner not in cells["keys"].tolist():
        return None
    if kind == "point":
        i, j = _cell(*place)
        other = cells[f"{partner}:slope"][i, j]
        if not np.isfinite(other):
            return None
        theirs = {"slope_decade": float(other), "p": float(cells[f"{partner}:p"][i, j])}
        mine = own
    elif kind == "region":
        series, index = _regions()
        r = index[place]
        # the global product restricted to the land-only partner's cells, when that series exists
        mine_series = series.get(f"{variable}@land:series")
        mine = insights.quick(series[f"{variable}:years"], mine_series[r]) if mine_series is not None else own
        theirs = insights.quick(series[f"{partner}:years"], series[f"{partner}:series"][r])
        if theirs is None or mine is None:
            return None
    else:
        both = np.isfinite(cells[f"{partner}:slope"]) & np.isfinite(cells[f"{variable}:slope"])
        w = _area_weights(place) * both
        if w.sum() == 0:
            return None
        mean = lambda a: float(np.nansum(a * w) / w.sum())  # noqa: E731
        mine = {"slope_decade": mean(cells[f"{variable}:slope"]), "p": own["p"]}
        theirs = {"slope_decade": mean(cells[f"{partner}:slope"]), "p": None}
    a, b = mine["slope_decade"], theirs["slope_decade"]
    same_sign = np.sign(a) == np.sign(b)
    ratio = a / b if b else None
    return {
        **_info(partner),
        "slope_decade": b,
        "p": theirs.get("p"),
        "own_slope_decade": a,
        "ratio": ratio,
        # agree: same direction and within a factor of 1.5 of each other
        "agree": bool(same_sign and ratio is not None and 1 / 1.5 <= abs(ratio) <= 1.5),
    }


@router.get("/diagnose")
def diagnose(
    variable: str,
    lat: float | None = PlaceQuery["lat"],
    lon: float | None = PlaceQuery["lon"],
    region: str | None = PlaceQuery["region"],
    south: float | None = PlaceQuery["south"],
    north: float | None = PlaceQuery["north"],
    west: float | None = PlaceQuery["west"],
    east: float | None = PlaceQuery["east"],
):
    kind, place = _place(lat, lon, region, south, north, west, east)
    try:
        info = _info(variable)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'\""))
    cells = _cells()
    years, values, where = _series(variable, kind, place)
    nino = (cells["nino:years"], cells["nino:index"]) if "nino:index" in cells and variable != "sst" else None
    try:
        out = insights.diagnose(np.asarray(years), np.asarray(values, dtype=np.float64), nino)
    except ValueError as e:
        raise HTTPException(422, str(e))
    out["slope_decade"] = out["slope"] * 10
    if out.get("enso"):
        out["enso"] |= {"trend": out["enso"]["trend"] * 10, "trend_without_enso": out["enso"]["trend_without_enso"] * 10}
    out["agreement"] = _agreement(variable, kind, place, {"slope_decade": out["slope_decade"], "p": out["p"]})
    return _clean(info | {"kind": kind, **where, **out})


@lru_cache(maxsize=1)
def _scenarios() -> dict:
    return load_yaml("scenarios.yaml").get("scenarios", {})


@router.get("/scenarios")
def scenarios():
    known = set(dataset.catalog()) if settings.data_mode == "live" else set()
    return [
        {"id": sid, "name": s["name"], "story": s["story"],
         "variables": [_info(k) | {"sign": v} for k, v in s["variables"].items() if k in known]}
        for sid, s in _scenarios().items()
        if all(k in known for k in s["variables"])
    ]


@router.get("/hotspots")
def hotspots(scenario: str):
    # per cell: the share of the scenario's variables with a significant trend in the expected direction;
    # null where any variable has no data. Cells where a jump explains a variable better than a trend are flagged
    spec = _scenarios().get(scenario)
    if spec is None:
        raise HTTPException(404, f"Unknown scenario. Choose one of: {', '.join(_scenarios())}")
    cells = _cells()
    keys = list(spec["variables"])
    missing = [k for k in keys if f"{k}:slope" not in cells]
    if missing:
        raise HTTPException(404, f"Not in the dataset: {', '.join(missing)}")
    covered = np.ones((len(dataset.LAT), len(dataset.LON)), dtype=bool)
    hits = np.zeros(covered.shape, dtype=np.int8)
    jumps = np.zeros(covered.shape, dtype=bool)
    for key, sign in spec["variables"].items():
        slope = cells[f"{key}:slope"]
        covered &= np.isfinite(slope)
        match = cells[f"{key}:sig"].astype(bool) & (np.sign(slope) == sign)
        hits += match
        jumps |= match & cells[f"{key}:step"].astype(bool)
    score = np.where(covered, hits / len(keys), np.nan)
    full = covered & (hits == len(keys))
    area = np.broadcast_to(np.cos(np.deg2rad(dataset.LAT))[:, None] * trendmaps.CELL_KM2, covered.shape)
    domains = {dataset.variable(k)["domain"] for k in keys}
    return _clean({
        "id": scenario,
        "name": spec["name"],
        "n_vars": len(keys),
        "n_lat": len(dataset.LAT), "n_lon": len(dataset.LON),
        "lat0": float(dataset.LAT[0]), "lon0": float(dataset.LON[0]), "dlat": 1.0, "dlon": 1.0,
        "domain": "land" if domains == {"land"} or "land" in domains else ("ocean" if domains == {"ocean"} else "global"),
        "score": np.round(score, 3).ravel(),
        "full": full.astype(np.uint8).ravel(),
        "full_area_km2": float(area[full].sum()),
        "full_with_jump_km2": float(area[full & jumps].sum()),
    })


@router.get("/divergence")
def divergence(variable: str):
    trendmap._range(variable, None, None)
    pre = trendmap._pre(variable)
    if pre is None or "cluster_labels" not in pre:
        raise HTTPException(503, "This dataset revision has no trend areas; rebuild with hf_dataset.py trends")
    areas = [
        {"id": k + 1, "sign": int(pre["cluster_sign"][k]), "area_km2": float(pre["cluster_area"][k]),
         "slope_decade": float(pre["cluster_slope"][k]), "lat": float(pre["cluster_lat"][k]), "lon": float(pre["cluster_lon"][k])}
        for k in range(len(pre["cluster_sign"]))
    ]
    return _clean(_info(variable) | {
        "n_lat": len(dataset.LAT), "n_lon": len(dataset.LON),
        "lat0": float(dataset.LAT[0]), "lon0": float(dataset.LON[0]), "dlat": 1.0, "dlon": 1.0,
        "areas": areas,
        "labels": pre["cluster_labels"].ravel(),
    })
