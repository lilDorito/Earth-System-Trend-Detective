# shared data contract

from dataclasses import dataclass
from datetime import date, datetime
from typing import Annotated, Literal

import pandas as pd
from pydantic import BaseModel, Field

Resolution = Literal["hourly", "3-hourly", "daily", "monthly"]
SourceName = Literal["giovanni_point", "harmony_area", "firms", "appeears", "mock"]
Mode = Literal["trend", "event"]

SERIES_COLUMNS = ("time", "value")
PROCESSED_COLUMNS = ("time", "value", "climatology", "anomaly")


# where

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


Location = Annotated[Point | BBox, Field(discriminator="type")]


# what (catalog, owner: content + data)

class VariableInfo(BaseModel):
    key: str # stable app-level slug used by the frontend, e.g. "air_temperature"
    variable_id: str # provider ID, e.g. a Giovanni configured-variable ID
    source: SourceName # which adapter fetches it
    name: str
    short_definition: str # one plain sentence for students
    units_raw: str # what the provider returns, e.g. "K"
    units: str # what we display, e.g. "°C"
    conversion: str = "identity" # key in src/units.py CONVERSIONS
    resolution: Resolution
    coverage_start: date
    coverage_end: date | None = None  # None = ongoing
    land_only: bool = False # GLDAS etc: sea points come back empty
    region_tags: list[str] = [] # e.g. ["city", "farmland"]


# data layer output (owner: data)

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


# analysis layer output (owner: stats)

class TrendResult(BaseModel):
    mode: Literal["trend"] = "trend"
    n: int
    start: date
    end: date
    units: str
    alpha: float = 0.05
    # linear regression on deseasonalized values
    slope_per_decade: float
    ci_low: float
    ci_high: float
    p_value: float
    significant: bool
    # Mann-Kendall + Sen's slope
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
