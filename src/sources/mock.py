# synthetic monthly series

import hashlib
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

from ..contracts import Location, Point, Series, SeriesMeta, VariableInfo

# per variable key: (baseline, seasonal amplitude, trend per decade, noise sd) in display units
PROFILES = {
    "air_temperature": (8.0, 12.0, 0.4, 1.2),
    "soil_moisture": (25.0, 5.0, -0.8, 1.5),
    "precipitation": (50.0, 20.0, 1.0, 15.0),
    "no2_column": (3.0e15, 1.0e15, -2.0e14, 4.0e14),
}
DEFAULT_PROFILE = (10.0, 3.0, 0.2, 1.0)


class MockSource:
    name = "mock"

    def fetch(self, variable: VariableInfo, location: Location, start: date, end: date) -> Series:
        lat, lon = _center(location)
        seed = int(hashlib.sha1(f"{variable.key}|{lat:.2f}|{lon:.2f}".encode()).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        base, amp, trend, noise = PROFILES.get(variable.key, DEFAULT_PROFILE)

        start = max(start, variable.coverage_start)
        time = pd.date_range(start, end, freq="MS", tz="UTC")
        years = (time - time[0]).days / 365.25
        value = (
            base
            + amp * np.sin(2 * np.pi * (time.month - 4) / 12)
            + trend * years / 10
            + rng.normal(0, noise, len(time))
        )
        df = pd.DataFrame({"time": time, "value": value.astype("float64")})

        meta = SeriesMeta(
            variable_key=variable.key,
            variable_id=variable.variable_id,
            variable_name=variable.name,
            units_raw=variable.units_raw,
            units=variable.units,
            resolution="monthly",
            location=location,
            grid_lat=round(lat * 2) / 2,
            grid_lon=round(lon * 2) / 2,
            source="mock",
            fetched_at=datetime.now(timezone.utc),
        )
        return Series(df=df, meta=meta)


def _center(location: Location) -> tuple[float, float]:
    if isinstance(location, Point):
        return location.lat, location.lon
    return (location.south + location.north) / 2, (location.west + location.east) / 2
