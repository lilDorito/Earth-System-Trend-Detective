# data contract shared by sources, stats and the API

from dataclasses import dataclass
from datetime import date, datetime
from typing import Annotated, Literal

import pandas as pd
from pydantic import BaseModel, Field, model_validator

Resolution = Literal["hourly", "3-hourly", "daily", "monthly"]
SourceName = Literal["giovanni_point", "harmony_area", "nasa_power", "hf_grid", "firms", "appeears", "mock"]
Mode = Literal["trend", "event"]

SERIES_COLUMNS = ("time", "value")
PROCESSED_COLUMNS = ("time", "value", "climatology", "anomaly")


class Point(BaseModel):
    type: Literal["point"] = "point"
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class BBox(BaseModel):
    type: Literal["bbox"] = "bbox"
    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-90, le=90)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-90, le=90)

    # west > east is a box across 180 degrees
    @model_validator(mode="after")
    def check(self):
        if self.south >= self.north:
            raise ValueError("bbox south must be below north")
        if self.west == self.east:
            raise ValueError("bbox west and east must differ")
        return self

    @property
    def center(self) -> tuple[float, float]:
        width = (self.east - self.west) % 360
        return (self.south + self.north) / 2, (self.west + width / 2 + 180) % 360 - 180


class Region(BaseModel):
    type: Literal["region"] = "region"
    id: str = Field(min_length=1, description="Natural Earth region id, see /api/boundaries")


Location = Annotated[Point | BBox | Region, Field(discriminator="type")]


class VariableInfo(BaseModel):
    key: str
    variable_id: str
    source: SourceName
    name: str
    short_definition: str
    units_raw: str
    units: str
    conversion: str = "identity"
    resolution: Resolution
    group: Literal["atmosphere", "land", "ocean"] = "atmosphere"  # heading in the explorer's list
    typical_range: tuple[float, float] | None = None  # 2nd-98th percentile in display units; shapes mock data
    coverage_start: date
    coverage_end: date | None = None
    land_only: bool = False
    region_tags: list[str] = []


class SeriesMeta(BaseModel):
    variable_key: str
    variable_id: str
    variable_name: str
    units_raw: str
    units: str
    resolution: Resolution
    location: Location
    grid_lat: float | None = None
    grid_lon: float | None = None
    cells: int | None = None  # grid cells averaged, for areas
    coverage: float | None = None  # share of the area with data
    region_name: str | None = None
    source: SourceName
    from_cache: bool = False
    fetched_at: datetime


@dataclass
class Series:
    df: pd.DataFrame
    meta: SeriesMeta


def validate_series(df: pd.DataFrame, columns: tuple[str, ...] = SERIES_COLUMNS) -> None:
    missing = [c for c in columns if c not in df.columns]
    if missing:
        raise ValueError(f"Series is missing columns: {missing}")
    if not pd.api.types.is_datetime64_any_dtype(df["time"]):
        raise ValueError("Series.time must be datetime64")
    if not df["time"].is_monotonic_increasing:
        raise ValueError("Series.time must be sorted ascending")
    if not pd.api.types.is_float_dtype(df["value"]):
        raise ValueError("Series.value must be float")


class TrendResult(BaseModel):
    mode: Literal["trend"] = "trend"
    n: int
    start: date
    end: date
    units: str
    alpha: float = 0.05
    slope_per_decade: float
    ci_low: float
    ci_high: float
    p_value: float
    significant: bool
    mk_trend: Literal["increasing", "decreasing", "no trend"]
    mk_tau: float
    mk_p: float
    sen_slope_per_decade: float
    total_change: float
    deseasonalized: bool
    autocorr_corrected: bool
    fit_line: list[tuple[datetime, float]]
    verdict: str


class EventResult(BaseModel):
    mode: Literal["event"] = "event"
    event_date: date
    n_before: int
    n_after: int
    units: str
    alpha: float = 0.05
    before_mean: float
    after_mean: float
    diff: float
    pct_change: float | None
    diff_ci_low: float
    diff_ci_high: float
    t_stat: float
    p_value: float
    significant: bool
    deseasonalized: bool
    verdict: str


AnalysisResult = Annotated[TrendResult | EventResult, Field(discriminator="mode")]
