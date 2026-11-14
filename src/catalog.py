# variable catalog, regions, demos and region-type suggestions, all from configs/

from functools import lru_cache

from .config import load_yaml
from .contracts import VariableInfo


@lru_cache
def variables() -> dict[str, VariableInfo]:
    raw = load_yaml("variables.yaml").get("variables", [])
    items = [VariableInfo(**v) for v in raw]
    keys = [v.key for v in items]
    dupes = {k for k in keys if keys.count(k) > 1}
    if dupes:
        raise ValueError(f"Duplicate variable keys in variables.yaml: {sorted(dupes)}")
    return {v.key: v for v in items}


def get_variable(key: str) -> VariableInfo:
    try:
        return variables()[key]
    except KeyError:
        raise KeyError(f"Unknown variable '{key}'") from None


def regions() -> dict:
    return load_yaml("regions.yaml").get("regions", {})


def demos() -> list[dict]:
    return load_yaml("demos.yaml").get("demos", [])


def region_types() -> dict:
    return load_yaml("region_types.yaml").get("region_types", {})
