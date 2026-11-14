# Giovanni in the Cloud: point time series (owner: data)

from datetime import date

from ..contracts import BBox, Location, Series, VariableInfo
from .base import SourceError

TIMESERIES_URL = "https://api.giovanni.earthdata.nasa.gov/timeseries"
HEADER_LINES = 13


class GiovanniPointSource:
    name = "giovanni_point"

    def fetch(self, variable: VariableInfo, location: Location, start: date, end: date) -> Series:
        if isinstance(location, BBox):
            raise SourceError("Giovanni time series takes a single point; use harmony_area for regions")
        # TODO(data):
        #   1. key = cache.cache_key(...); hit = cache.get(key) -> skip the request if present
        #   2. requests.get(TIMESERIES_URL, params=..., headers=Bearer, timeout=settings.request_timeout_s)
        #      401/403 -> SourceError("Earthdata token missing or expired")
        #   3. parse_response(text) -> (header dict, raw df with time/value)
        #      empty body -> SourceError("No data here (sea point for a land-only variable?)")
        #   4. cache.put(key, raw_df, header)
        #   5. units.convert(raw_df, variable.conversion); build SeriesMeta (grid_lat/lon from header)
        raise NotImplementedError("Giovanni adapter not implemented yet, run with DATA_MODE=mock")


def parse_response(text: str):
    """CSV text -> (header: dict[str, str], df: DataFrame[time, value])."""
    # TODO(data): read HEADER_LINES "key,value" lines, then pandas.read_csv the rest
    #   time -> pd.to_datetime(utc=True), value -> float64, sort by time
    raise NotImplementedError
