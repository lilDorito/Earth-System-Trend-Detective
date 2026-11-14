# source registry: one adapter per provider, all return the same contracts.Series

from .base import Source
from .giovanni import GiovanniPointSource
from .harmony import HarmonyAreaSource
from .mock import MockSource

SOURCES: dict[str, Source] = {
    "mock": MockSource(),
    "giovanni_point": GiovanniPointSource(),
    "harmony_area": HarmonyAreaSource(),
    # "firms": FirmsSource(),        # optional, war-impact demo
    # "appeears": AppeearsSource(),  # optional, NDVI / night lights
}


def get_source(name: str) -> Source:
    try:
        return SOURCES[name]
    except KeyError:
        raise KeyError(f"No adapter registered for source '{name}'") from None
