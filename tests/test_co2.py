# atmospheric CO2 endpoint on a tiny local copy of the dataset

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api import trendmap
from app.api.main import app
from src import dataset
from src.config import settings


@pytest.fixture
def local(tmp_path, monkeypatch):
    (tmp_path / "series").mkdir()
    time = pd.date_range("2000-01-01", "2003-06-01", freq="MS")
    t = np.arange(len(time))
    seasonal = 3 * np.sin(2 * np.pi * t / 12)
    pd.DataFrame(
        {"time": time, "co2_global_ppm": 370 + 0.2 * t + seasonal, "co2_mauna_loa_ppm": 371 + 0.2 * t + 1.5 * seasonal}
    ).astype({"co2_global_ppm": "float32", "co2_mauna_loa_ppm": "float32"}).to_parquet(tmp_path / "series" / "co2.parquet")
    monkeypatch.setattr(dataset, "LOCAL", str(tmp_path))
    monkeypatch.setattr(settings, "data_mode", "live")
    dataset.co2.cache_clear()
    trendmap._responses.clear()
    yield tmp_path
    dataset.co2.cache_clear()
    trendmap._responses.clear()


def test_co2_annual_and_monthly(local):
    body = TestClient(app).get("/api/trendmap/co2").json()
    assert body["years"] == [2000, 2001, 2002]
    assert body["slope_decade"] == pytest.approx(24, abs=0.1)
    assert body["growth"][0] is None and body["growth"][1] == pytest.approx(2.4, abs=0.05)
    assert len(body["fitted"]) == 3
    assert body["months"][0] == "2000-01" and body["months"][-1] == "2003-06"
    assert len(body["monthly"]) == len(body["mauna_loa"]) == 42


def test_co2_needs_live_mode():
    assert TestClient(app).get("/api/trendmap/co2").status_code == 404
