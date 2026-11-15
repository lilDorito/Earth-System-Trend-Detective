# settings from .env

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent

load_dotenv(ROOT / ".env")


class Settings:
    data_mode: str = os.environ.get("DATA_MODE", "mock")  # "mock" or "live"


settings = Settings()
