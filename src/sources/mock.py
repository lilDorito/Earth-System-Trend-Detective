# synthetic monthly series for DATA_MODE=mock

import hashlib
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

from ..contracts import BBox, Location, Point, Region, Regions, Series, SeriesMeta, VariableInfo

# (base, seasonal amplitude, trend per decade, noise sd)
PROFILES = {
    "air_temperature": (8.0, 12.0, 0.4, 1.2),
    "soil_moisture": (25.0, 5.0, -0.8, 1.5),
    "precipitation": (50.0, 20.0, 1.0, 15.0),
    "no2_column": (3.0e15, 1.0e15, -2.0e14, 4.0e14),
    "sea_surface_temperature": (18.0, 4.0, 0.2, 0.4),
    "sea_level": (0.0, 40.0, 35.0, 25.0),
}
DEFAULT_PROFILE = (10.0, 3.0, 0.2, 1.0)


class MockSource:
    name = "mock"

    def fetch(self, variable: VariableInfo, location: Location, start: date, end: date) -> Series:
        lat, lon = _center(location)
        if isinstance(location, Region):
            place = location.id
        elif isinstance(location, Regions):
            place = "+".join(sorted(location.ids))
        else:
            place = f"{lat:.2f}|{lon:.2f}"
        seed = int(hashlib.sha1(f"{variable.key}|{place}".encode()).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        base, amp, trend, noise = PROFILES.get(variable.key) or _from_range(variable.typical_range)

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


def _from_range(typical: tuple[float, float] | None) -> tuple[float, float, float, float]:
    # a plausible profile inside the variable's usual 2nd-98th percentile range
    if typical is None:
        return DEFAULT_PROFILE
    lo, hi = typical
    span = (hi - lo) or abs(hi) or 1.0
    return (lo + hi) / 2, 0.12 * span, 0.04 * span, 0.04 * span


def _center(location: Location) -> tuple[float, float]:
    if isinstance(location, Point):
        return location.lat, location.lon
    if isinstance(location, BBox):
        return location.center
    # a region has no geometry offline; any mid-latitude place gives a plausible series
    return 45.0, 0.0
