# interface every data source implements

from datetime import date
from typing import Protocol

from ..contracts import Location, Series, VariableInfo


class SourceError(Exception):
    pass


class Source(Protocol):
    name: str

    def fetch(self, variable: VariableInfo, location: Location, start: date, end: date) -> Series: ...
