# Giovanni area-averaged time series via harmony-py (owner: data, after giovanni.py works)

from datetime import date

from ..contracts import Location, Series, VariableInfo


class HarmonyAreaSource:
    name = "harmony_area"

    def fetch(self, variable: VariableInfo, location: Location, start: date, end: date) -> Series:
        # TODO(data): same flow as giovanni.py (cache -> request -> parse -> cache -> convert)
        raise NotImplementedError("Harmony area-average adapter not implemented yet")
