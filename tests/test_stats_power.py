# stats on series with a known answer, POWER parsing, and the live path with a fake HTTP layer

from datetime import date

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from src import stats
from src.contracts import Point
from src.processing import process
from src.sources import power

client = TestClient(app)


def _frame(values, start="2000-01-01"):
    time = pd.date_range(start, periods=len(values), freq="MS", tz="UTC")
    return process(pd.DataFrame({"time": time, "value": np.asarray(values, dtype="float64")}))


def test_event_detects_a_step():
    rng = np.random.default_rng(0)
    step = np.r_[np.zeros(120), np.full(60, 2.0)] + rng.normal(0, 0.5, 180)
    r = stats.analyze_event(_frame(step), "u", date(2010, 1, 1), deseasonalize=False)
    assert r.significant and 1.7 < r.diff < 2.3 and r.diff_ci_low < r.diff < r.diff_ci_high
    assert r.n_before == 120 and r.n_after == 60
    assert r.pct_change is None or r.pct_change > 0


def test_event_no_change_is_not_significant():
    rng = np.random.default_rng(1)
    r = stats.analyze_event(_frame(rng.normal(10, 1, 180)), "u", date(2010, 1, 1), deseasonalize=False)
    assert not r.significant


def test_event_needs_data_on_both_sides():
    with pytest.raises(ValueError):
        stats.analyze_event(_frame(np.arange(100.0)), "u", date(2000, 3, 1))


def test_trend_known_slope():
    rng = np.random.default_rng(2)
    y = 0.03 * np.arange(300) / 12 + rng.normal(0, 0.3, 300)  # 0.3 per decade
    r = stats.analyze_trend(_frame(y), "°C")
    assert 0.2 < r.slope_per_decade < 0.4 and r.significant and r.mk_trend == "increasing"
    assert r.ci_low < r.slope_per_decade < r.ci_high


def test_trend_flat_series():
    rng = np.random.default_rng(3)
    r = stats.analyze_trend(_frame(rng.normal(0, 1, 300)), "°C")
    assert r.mk_trend == "no trend" and not r.significant


POWER_JSON = {
    "geometry": {"type": "Point", "coordinates": [30.5, 50.5, 180.0]},
    "properties": {"parameter": {"T2M": {"202001": -1.5, "202002": -999.0, "202003": 4.2, "202013": 9.9}}},
}


def test_parse_monthly_drops_annual_and_fill():
    df = power.parse_monthly(POWER_JSON, "T2M")
    assert list(df["value"]) == [-1.5, 4.2] and df["time"].dt.month.tolist() == [1, 3]


def test_parse_monthly_missing_parameter():
    with pytest.raises(power.SourceError):
        power.parse_monthly(POWER_JSON, "NOPE")


def test_live_path_with_fake_http(monkeypatch, tmp_path):
    from src.config import settings

    monkeypatch.setattr(settings, "data_mode", "live")
    monkeypatch.setattr(settings, "cache_dir", tmp_path)
    rng = np.random.default_rng(4)
    keys = [f"{y}{m:02d}" for y in range(2015, 2025) for m in range(1, 13)]
    payload = {
        "geometry": {"type": "Point", "coordinates": [30.52, 50.45, 180.0]},
        "properties": {"parameter": {"T2M": {k: float(rng.normal(8, 1)) for k in keys}}},
    }
    calls = []

    class Resp:
        status_code = 200
        text = ""

        def json(self):
            return payload

    monkeypatch.setattr(power.requests, "get", lambda *a, **k: calls.append(1) or Resp())
    body = {
        "variable": "air_temperature", "location": {"type": "point", "lat": 50.45, "lon": 30.52},
        "start": "2015-01-01", "end": "2024-12-01", "mode": "event", "event_date": "2020-01-01",
    }
    r = client.post("/api/analyze", json=body)
    assert r.status_code == 200, r.text
    assert r.json()["meta"]["source"] == "nasa_power" and r.json()["result"]["mode"] == "event"
    client.post("/api/analyze", json=body)
    assert len(calls) == 1  # second call served from the file cache


def test_api_event_too_short_side_is_422():
    body = {
        "variable": "air_temperature", "location": {"type": "point", "lat": 50.45, "lon": 30.52},
        "start": "2020-01-01", "end": "2026-09-01", "mode": "event", "event_date": "2020-03-01",
    }
    assert client.post("/api/analyze", json=body).status_code == 422
