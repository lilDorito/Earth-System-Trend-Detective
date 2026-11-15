# weather station endpoints on a tiny local copy of the dataset

from datetime import date

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from app.api import trendmap
from app.api.main import app
from src import dataset, stations
from src.config import settings

YEARS = range(2000, 2026)
STATIONS = [
    ("GHCND:AAA", "KYIV CENTRAL, UP", 50.4, 30.5, 0.03, YEARS),
    ("GHCND:BBB", "ODESA PORT, UP", 46.4, 30.7, 0.0, YEARS),
    ("GHCND:CCC", "SHORT RECORD, UP", 50.2, 31.4, 0.05, range(2012, 2025)),
]
CELLS = [(50.5, 30.5), (46.5, 30.5), (50.5, 31.5)]


def clear_caches():
    stations.clear_caches()
    for cached in (dataset.catalog, dataset.annual, trendmap._ds, trendmap._grid, trendmap._frames):
        cached.cache_clear()


@pytest.fixture
def local(tmp_path, monkeypatch):
    rng = np.random.default_rng(1)
    (tmp_path / "stations").mkdir()
    rows = []
    for sid, _, _, _, trend, years in STATIONS:
        for year in years:
            for month in range(1, 13):
                if sid == "GHCND:BBB" and year == 2005 and month > 4:
                    continue
                value = 10 + 8 * np.sin(month) + trend * (year - 2000) + rng.normal(0, 0.1)
                rows.append((sid, date(year, month, 1), value, 50.0 + month))
    rows += [("GHCND:AAA", date(2026, m, 1), 30.0, 60.0) for m in range(1, 10)]
    monthly = pd.DataFrame(rows, columns=["station_id", "date", "TAVG", "PRCP"]).astype({"TAVG": "float32", "PRCP": "float32"})
    pq.write_table(pa.Table.from_pandas(monthly, preserve_index=False), tmp_path / "stations" / "monthly.parquet")
    meta = pd.DataFrame(
        [dict(station_id=s, name=n, latitude=la, longitude=lo, elevation=100.0, country="UP", has_data=True) for s, n, la, lo, _, _ in STATIONS]
        + [dict(station_id="GHCND:ZZZ", name="NO DATA, UP", latitude=0.0, longitude=0.0, elevation=1.0, country="UP", has_data=False)]
    )
    meta.to_parquet(tmp_path / "stations" / "stations.parquet")

    (tmp_path / "annual").mkdir()
    annual = pd.DataFrame(
        [dict(year=y, lat=la, lon=lo, value=9.0 + 0.025 * (y - 2000) + 0.1 * np.sin(y), months=12) for y in YEARS for la, lo in CELLS]
    ).astype({"year": "int16", "lat": "float32", "lon": "float32", "value": "float32", "months": "int8"})
    pq.write_table(pa.Table.from_pandas(annual, preserve_index=False), tmp_path / "annual" / "merra2_t2m.parquet")
    pd.DataFrame(
        [dict(key="merra2_t2m", name="2 m air temperature (MERRA-2)", units="degC", group="atmosphere", domain="global", start="2000-01", end="2025-12")]
    ).to_parquet(tmp_path / "catalog.parquet")

    monkeypatch.setattr(dataset, "LOCAL", str(tmp_path))
    monkeypatch.setattr(settings, "data_mode", "live")
    clear_caches()
    yield tmp_path
    clear_caches()


def test_element_trends_need_twenty_years(local):
    el = stations.element("TAVG")
    assert list(el.ids) == ["GHCND:AAA", "GHCND:BBB", "GHCND:CCC"]
    assert el.years[0] == 2000 and el.years[-1] == 2025
    assert el.n_years.tolist() == [26, 25, 13]
    assert el.slope[0] * 10 == pytest.approx(0.3, abs=0.02)
    assert abs(el.slope[1] * 10) < 0.05
    assert np.isnan(el.slope[2])
    assert el.significant[0] and not el.significant[2]


def test_mann_kendall_matches_pymannkendall_slope():
    import pymannkendall as mk

    years = np.arange(2000, 2026, dtype=float)
    values = 0.02 * (years - 2000) + np.random.default_rng(3).normal(0, 0.2, len(years))
    slope, _, p = stations.mann_kendall(years, values)
    assert slope == pytest.approx(mk.sens_slope(values).slope)
    assert 0 <= p <= 1


def test_list_endpoint(local):
    client = TestClient(app)
    body = client.get("/api/stations", params={"element": "TAVG"}).json()
    assert body["ids"] == ["GHCND:AAA", "GHCND:BBB", "GHCND:CCC"]
    assert body["names"][0] == "Kyiv Central, UP"
    assert body["slope"][2] is None and body["n_years"][2] == 13
    assert len(body["lat"]) == len(body["lon"]) == len(body["significant"]) == 3
    assert client.get("/api/stations", params={"element": "XXXX"}).status_code == 404
    assert client.get("/api/stations/elements").json()[0]["grid"] == ["merra2_t2m", "gldas_tair"]


def test_compare_with_grid(local):
    client = TestClient(app)
    body = client.get("/api/stations/compare", params={"id": "GHCND:AAA", "variable": "merra2_t2m"}).json()
    assert body["element"] == "TAVG" and body["name"] == "Kyiv Central, UP"
    grid = body["grid"]
    assert (grid["lat"], grid["lon"]) == (50.5, 30.5) and grid["distance_km"] < 20
    assert grid["common_years"] == 26
    assert body["station_trend"]["slope_decade"] == pytest.approx(0.3, abs=0.02)
    assert grid["trend"]["slope_decade"] == pytest.approx(0.25, abs=0.03)
    assert grid["difference_decade"] == pytest.approx(0.05, abs=0.04)
    station = np.array(body["station"], dtype=float)
    assert abs(np.nanmean(station)) < 1e-6


def test_compare_short_record_and_missing(local):
    client = TestClient(app)
    body = client.get("/api/stations/compare", params={"id": "GHCND:CCC", "variable": "merra2_t2m"}).json()
    assert body["station_trend"] is None and body["grid"]["trend"] is None
    plain = client.get("/api/stations/compare", params={"id": "GHCND:AAA", "element": "PRCP"}).json()
    assert plain["element"] == "PRCP" and plain["grid"] is None
    assert client.get("/api/stations/compare", params={"id": "GHCND:ZZZ"}).status_code == 404


def test_stations_need_live_mode():
    assert TestClient(app).get("/api/stations").status_code == 503
