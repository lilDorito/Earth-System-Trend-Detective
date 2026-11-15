# stats on series with a known answer

from datetime import date

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from src import stats
from src.processing import process

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


def test_api_event_too_short_side_is_422():
    body = {
        "variable": "air_temperature", "location": {"type": "point", "lat": 50.45, "lon": 30.52},
        "start": "2020-01-01", "end": "2026-09-01", "mode": "event", "event_date": "2020-03-01",
    }
    assert client.post("/api/analyze", json=body).status_code == 422
