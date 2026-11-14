# settings from env + YAML configs

import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
CONFIGS = ROOT / "configs"

load_dotenv(ROOT / ".env")


class Settings:
    # "mock" = every variable comes from the synthetic source (no network, no token)
    # "live" = each variable uses the source set in configs/variables.yaml
    data_mode: str = os.environ.get("DATA_MODE", "mock")
    earthdata_token: str | None = os.environ.get("EARTHDATA_TOKEN") or None
    cache_dir: Path = ROOT / os.environ.get("CACHE_DIR", "data/cache")
    demos_dir: Path = ROOT / "data" / "demos"
    request_timeout_s: float = float(os.environ.get("REQUEST_TIMEOUT_S", "60"))


settings = Settings()


@lru_cache
def load_yaml(name: str) -> dict:
    with open(CONFIGS / name, "r", encoding="utf-8") as file:
        return yaml.safe_load(file) or {}
