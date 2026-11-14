# fetch -> process -> analyze

from datetime import date

import pandas as pd

from . import stats
from .catalog import get_variable
from .config import settings
from .contracts import AnalysisResult, Location, Mode, Series
from .processing import process
from .sources import get_source


def fetch(variable_key: str, location: Location, start: date, end: date, region_name: str | None = None) -> Series:
    variable = get_variable(variable_key)
    source_name = "mock" if settings.data_mode == "mock" else variable.source
    series = get_source(source_name).fetch(variable, location, start, end)
    if region_name:
        series.meta.region_name = region_name
    return series


def analyze(
    variable_key: str,
    location: Location,
    start: date,
    end: date,
    mode: Mode = "trend",
    event_date: date | None = None,
    deseasonalize: bool = True,
    region_name: str | None = None,
) -> tuple[Series, pd.DataFrame, AnalysisResult]:
    series = fetch(variable_key, location, start, end, region_name)
    processed = process(series.df)
    units = series.meta.units
    if mode == "trend":
        result = stats.analyze_trend(processed, units, deseasonalize)
    else:
        if event_date is None:
            raise ValueError("event mode needs event_date")
        result = stats.analyze_event(processed, units, event_date, deseasonalize)
    return series, processed, result
