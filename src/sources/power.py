# NASA POWER monthly point series, no token: https://power.larc.nasa.gov/docs/services/api/temporal/monthly/

import json
from datetime import date, datetime, timezone

import pandas as pd
import requests

from ..cache import cache_key
from ..config import settings
from ..contracts import BBox, Location, Point, Series, SeriesMeta, VariableInfo
from ..units import convert
from .base import SourceError

URL = "https://power.larc.nasa.gov/api/temporal/monthly/point"
FILL = -999.0


class PowerPointSource:
    name = "nasa_power"

    def fetch(self, variable: VariableInfo, location: Location, start: date, end: date) -> Series:
        lat, lon = _center(location)
        start = max(start, variable.coverage_start)
        payload, from_cache = _get(variable.variable_id, lat, lon, start.year, end.year)
        df = parse_monthly(payload, variable.variable_id)
        df = df[(df["time"] >= pd.Timestamp(start.year, start.month, 1, tz="UTC")) & (df["time"] <= pd.Timestamp(end, tz="UTC"))]
        if df.empty:
            raise SourceError("POWER returned no data for this place and period")
        df = convert(df.reset_index(drop=True), variable.conversion)
        coords = payload.get("geometry", {}).get("coordinates", [lon, lat])
        meta = SeriesMeta(
            variable_key=variable.key,
            variable_id=variable.variable_id,
            variable_name=variable.name,
            units_raw=variable.units_raw,
            units=variable.units,
            resolution="monthly",
            location=location,
            grid_lat=coords[1],
            grid_lon=coords[0],
            source="nasa_power",
            from_cache=from_cache,
            fetched_at=datetime.now(timezone.utc),
        )
        return Series(df=df, meta=meta)


def parse_monthly(payload: dict, parameter: str) -> pd.DataFrame:
    # keys are YYYYMM; month 13 is the annual mean
    try:
        raw = payload["properties"]["parameter"][parameter]
    except KeyError:
        raise SourceError(f"POWER response has no parameter {parameter}") from None
    rows = []
    for key, value in raw.items():
        year, month = int(key[:4]), int(key[4:])
        if month == 13 or value is None or float(value) == FILL:
            continue
        rows.append((pd.Timestamp(year, month, 1, tz="UTC"), float(value)))
    if not rows:
        raise SourceError("POWER returned no valid values (all missing)")
    df = pd.DataFrame(rows, columns=["time", "value"]).sort_values("time").reset_index(drop=True)
    df["value"] = df["value"].astype("float64")
    return df


def _center(location: Location) -> tuple[float, float]:
    if isinstance(location, BBox):  # a box is served by its center point
        return (location.south + location.north) / 2, (location.west + location.east) / 2
    assert isinstance(location, Point)
    return location.lat, location.lon


def _get(parameter: str, lat: float, lon: float, y0: int, y1: int) -> tuple[dict, bool]:
    key = cache_key(f"power:{parameter}", Point(lat=lat, lon=lon), date(y0, 1, 1), date(y1, 12, 31))
    path = settings.cache_dir / f"power_{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8")), True

    params = {
        "parameters": parameter, "community": "RE", "latitude": round(lat, 3), "longitude": round(lon, 3),
        "start": y0, "end": y1, "format": "JSON",
    }
    try:
        resp = requests.get(URL, params=params, timeout=settings.request_timeout_s)
    except requests.RequestException as e:
        raise SourceError(f"Could not reach NASA POWER: {e}") from e
    if resp.status_code != 200:
        raise SourceError(f"NASA POWER answered {resp.status_code}: {resp.text[:200]}")
    payload = resp.json()
    settings.cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
    return payload, False
