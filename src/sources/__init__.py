# source registry: one adapter per provider, all return the same contracts.Series

from .base import Source
from .hf_grid import HfGridSource
from .mock import MockSource

SOURCES: dict[str, Source] = {
    "mock": MockSource(),
    "hf_grid": HfGridSource(),
}


def get_source(name: str) -> Source:
    try:
        return SOURCES[name]
    except KeyError:
        raise KeyError(f"No adapter registered for source '{name}'") from None
