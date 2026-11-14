# local cache for raw provider responses (owner: data)

import hashlib
from datetime import date

import pandas as pd

from .config import settings
from .contracts import Location


def cache_key(variable_id: str, location: Location, start: date, end: date) -> str:
    loc = location.model_dump()
    loc = {k: round(v, 3) if isinstance(v, float) else v for k, v in loc.items()}
    raw = f"{variable_id}|{sorted(loc.items())}|{start}|{end}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def get(key: str) -> tuple[pd.DataFrame, dict] | None:
    # TODO(data): look in settings.cache_dir, then settings.demos_dir (committed demo series)
    #   suggested format: <key>.parquet for the frame + <key>.json for the provider header
    return None


def put(key: str, raw_df: pd.DataFrame, header: dict) -> None:
    # TODO(data): write to settings.cache_dir; raw (unconverted) values only
    _ = settings.cache_dir
