# interface every data adapter implements

from datetime import date
from typing import Protocol

from ..contracts import Location, Series, VariableInfo


class SourceError(Exception):
    """Provider failed or returned nothing usable (mapped to HTTP 502 by the API)."""


class Source(Protocol):
    name: str

    def fetch(self, variable: VariableInfo, location: Location, start: date, end: date) -> Series: ...
