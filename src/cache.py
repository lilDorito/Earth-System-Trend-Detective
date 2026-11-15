# cache keys for provider responses

import hashlib
from datetime import date

from .contracts import Location


def cache_key(variable_id: str, location: Location, start: date, end: date) -> str:
    loc = location.model_dump()
    loc = {k: round(v, 3) if isinstance(v, float) else v for k, v in loc.items()}
    raw = f"{variable_id}|{sorted(loc.items())}|{start}|{end}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]

