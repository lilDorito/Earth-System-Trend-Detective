# Giovanni point time series

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
        # TODO(data): cache -> request -> parse -> convert
        raise NotImplementedError("Giovanni adapter not implemented yet, run with DATA_MODE=mock")


def parse_response(text: str):
    # TODO(data): header lines, then read_csv
    raise NotImplementedError
