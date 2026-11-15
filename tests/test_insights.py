# series diagnostics and the insight endpoints on the tiny local dataset

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api import insights as insights_api
from app.api.main import app
from src import insights, trendmaps

from test_dataset import clear_caches, local  # noqa: F401  (fixture)

YEARS = np.arange(2000, 2026, dtype=float)


def test_steady_trend_is_robust_and_not_a_jump():
    rng = np.random.default_rng(1)
    values = 0.05 * (YEARS - 2000) + rng.normal(0, 0.1, len(YEARS))
    d = insights.diagnose(YEARS, values)
    assert d["significant"] and d["slope"] == pytest.approx(0.05, abs=0.01)
    assert d["robust"]["stable"] and not d["jump"]["likely"] and d["years_needed"] is None
    assert len(d["growth"]) == len(YEARS) - insights.MIN_YEARS + 1
    p = np.asarray(d["windows"]["p"], dtype=float)
    assert np.isnan(p[0, 3]) and np.isfinite(p[0, -1])  # windows shorter than MIN_YEARS are left out


def test_a_jump_beats_the_line():
    rng = np.random.default_rng(2)
    values = np.where(YEARS >= 2011, 1.0, 0.0) + rng.normal(0, 0.05, len(YEARS))
    jump = insights.diagnose(YEARS, values)["jump"]
    assert jump["likely"] and jump["year"] == 2011 and jump["shift"] == pytest.approx(1.0, abs=0.1)


def test_years_needed_for_a_weak_trend():
    rng = np.random.default_rng(4)  # a draw where the weak trend is not significant
    values = 0.01 * (YEARS - 2000) + rng.normal(0, 0.3, len(YEARS))
    d = insights.diagnose(YEARS, values)
    assert not d["significant"] and d["years_needed"] > len(YEARS)


def test_enso_part_of_a_trend():
    rng = np.random.default_rng(4)
    nino = rng.normal(0, 1, len(YEARS))
    values = 0.02 * (YEARS - 2000) + 0.5 * nino + rng.normal(0, 0.05, len(YEARS))
    e = insights.enso(YEARS, values, YEARS, nino)
    assert e["trend_without_enso"] == pytest.approx(0.02, abs=0.005) and e["per_degree"] == pytest.approx(0.5, abs=0.05)
    assert e["explained"] > 0.5


@pytest.fixture
def built(local):  # noqa: F811
    (local / "trends").mkdir()
    (local / "insights").mkdir()
    (local / "trends" / "fake_t2m.npz").write_bytes(trendmaps.to_bytes(trendmaps.build("fake_t2m")))
    clear_caches()
    cells, regions = trendmaps.build_insights(["fake_t2m"])
    for name, products in (("cells", cells), ("regions", regions)):
        (local / "insights" / f"{name}.npz").write_bytes(trendmaps.to_bytes(products))
    clear_caches()
    insights_api._cells.cache_clear()
    insights_api._regions.cache_clear()
    yield local
    insights_api._cells.cache_clear()
    insights_api._regions.cache_clear()


def test_scan_and_diagnose_endpoints(built):
    client = TestClient(app)
    point = client.get("/api/insights/scan", params={"lat": 50.7, "lon": 30.2}).json()
    assert point["kind"] == "point" and point["variables"][0]["key"] == "fake_t2m"
    assert point["variables"][0]["slope_decade"] == pytest.approx(0.5, abs=0.02)
    region = client.get("/api/insights/scan", params={"region": "tst"}).json()
    assert region["variables"][0]["significant"] and region["variables"][0]["q"] < 0.05
    box = client.get("/api/insights/scan", params={"south": 50, "north": 51, "west": 30, "east": 32}).json()
    assert box["approximate"] and box["variables"][0]["p"] is None
    assert client.get("/api/insights/scan", params={"lat": -40, "lon": 100}).status_code == 422
    d = client.get("/api/insights/diagnose", params={"variable": "fake_t2m", "region": "tst"}).json()
    assert d["slope_decade"] == pytest.approx(0.5, abs=0.02) and d["robust"]["stable"]
    assert client.get("/api/insights/diagnose", params={"variable": "fake_t2m", "region": "nope"}).status_code == 404
    areas = client.get("/api/insights/divergence", params={"variable": "fake_t2m"}).json()
    assert len(areas["labels"]) == 180 * 360
