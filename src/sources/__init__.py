# source registry

from .base import Source
from .giovanni import GiovanniPointSource
from .harmony import HarmonyAreaSource
from .mock import MockSource

SOURCES: dict[str, Source] = {
    "mock": MockSource(),
    "giovanni_point": GiovanniPointSource(),
    "harmony_area": HarmonyAreaSource(),
}


def get_source(name: str) -> Source:
    try:
        return SOURCES[name]
    except KeyError:
        raise KeyError(f"No adapter registered for source '{name}'") from None
