# settings from .env and YAML configs

import os
from functools import lru_cache
from pathlib import Path

import yaml
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
CONFIGS = ROOT / "configs"

load_dotenv(ROOT / ".env")


class Settings:
    data_mode: str = os.environ.get("DATA_MODE", "mock")  # "mock" or "live"


settings = Settings()


@lru_cache
def load_yaml(name: str) -> dict:
    with open(CONFIGS / name, "r", encoding="utf-8") as file:
        return yaml.safe_load(file) or {}
