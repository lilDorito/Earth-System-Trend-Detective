# dataset access and live trend map endpoints, on a tiny local copy of the dataset

from datetime import date

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from app.api import trendmap
from app.api.main import app
from src import dataset
from src.config import settings

YEARS = range(2000, 2012)
CELLS = [(50.5, 30.5), (50.5, 31.5), (46.5, 30.5)]  # land around Kyiv and Odesa; everything else has no data


def monthly(path, trend_per_year: float):
    rows = []
    for lat, lon in CELLS:
        for year in YEARS:
            for month in range(1, 13):
                if year == YEARS[-1] and month > 6:
                    continue  # the record ends mid-year, as IMERG does
                rows.append((date(year, month, 1), lat, lon, 10 + trend_per_year * (year - 2000) + np.sin(month), 1.0))
    frame = pd.DataFrame(rows, columns=["date", "lat", "lon", "value", "valid_frac"]).astype(
        {"lat": "float32", "lon": "float32", "value": "float32", "valid_frac": "float32"}
    )
    pq.write_table(pa.Table.from_pandas(frame, preserve_index=False), path)
    return frame


@pytest.fixture
def local(tmp_path, monkeypatch):
    (tmp_path / "grid").mkdir()
    (tmp_path / "annual").mkdir()
    frame = monthly(tmp_path / "grid" / "fake_t2m.parquet", trend_per_year=0.05)
    frame["year"] = pd.to_datetime(frame["date"]).dt.year.astype("int16")
    annual = frame.groupby(["year", "lat", "lon"], as_index=False).agg(value=("value", "mean"), months=("value", "size"))
    annual["months"] = annual["months"].astype("int8")
    annual.loc[(annual.year == 2003) & (annual.lat == 46.5), "months"] = 5
    pq.write_table(pa.Table.from_pandas(annual, preserve_index=False), tmp_path / "annual" / "fake_t2m.parquet")
    (tmp_path / "regions").mkdir()
    base = dict(country="tst", country_name="Testland", lat=50.5, lon=31.0, south=50.0, north=51.0, west=30.0, east=31.6, cells=3, area_km2=12000)
    pd.DataFrame(
        [
            dict(base, id="tst", name="Testland", kind="country", type="Country"),
            # two regions of the same area: they share the cell at 31.5, half and half
            dict(base, id="tst-a", name="Alpha", kind="admin1", type="Oblast"),
            dict(base, id="tst-b", name="Beta", kind="admin1", type="Oblast"),
            dict(base, id="oth", name="Otherland", country="oth", country_name="Otherland", kind="country", type="Country"),
        ]
    ).to_parquet(tmp_path / "regions" / "index.parquet")
    # the third cell has no data, so a quarter-ish of the region is uncovered
    pd.DataFrame(
        dict(
            id=["tst", "tst", "tst", "tst-a", "tst-a", "tst-b", "tst-b", "oth"],
            lat=[50.5, 50.5, 50.5, 50.5, 50.5, 50.5, 50.5, 46.5],
            lon=[30.5, 31.5, 32.5, 30.5, 31.5, 31.5, 32.5, 30.5],
            frac=[1.0, 0.5, 0.5, 1.0, 0.25, 0.25, 0.5, 1.0],
        )
    ).astype(
        {"lat": "float32", "lon": "float32", "frac": "float32"}
    ).to_parquet(tmp_path / "regions" / "weights.parquet")
    pd.DataFrame(
        [dict(key="fake_t2m", name="Fake temperature", units="degC", group="atmosphere", domain="land", start="2000-01", end="2011-06")]
    ).to_parquet(tmp_path / "catalog.parquet")

    monkeypatch.setattr(dataset, "LOCAL", str(tmp_path))
    monkeypatch.setattr(settings, "data_mode", "live")
    clear_caches()
    yield tmp_path
    clear_caches()


def clear_caches():
    for cached in (dataset.catalog, dataset.annual, dataset.regions, dataset._region_weights,
                   trendmap._ds, trendmap._grid, trendmap._frames, trendmap._pre):
        getattr(cached, "cache_clear", lambda: None)()  # a test may have patched one with a plain function
    trendmap._responses.clear()


def test_annual_keeps_complete_years_and_enough_months(local):
    annual = dataset.annual("fake_t2m")
    assert list(annual.years) == list(range(2000, 2011))  # 2011 has only six months
    i = list(annual.years).index(2003)
    assert np.isnan(annual.values[i, 136, 210]) and np.isfinite(annual.values[i, 140, 210])
    assert np.isnan(annual.values[:, 0, 0]).all()


def test_box_fractions():
    frac = dataset.box_fractions(dataset.LAT, dataset.LON, 50.25, 51.0, 30.0, 31.5)
    assert frac[140, 210] == pytest.approx(0.75) and frac[140, 211] == pytest.approx(0.375)
    assert frac.sum() == pytest.approx(0.75 * 1.5)
    across = dataset.box_fractions(dataset.LAT, dataset.LON, 0, 1, 179.5, -179.5)
    assert across.sum() == pytest.approx(1.0) and across[90, 359] == pytest.approx(0.5) and across[90, 0] == pytest.approx(0.5)


def test_live_trendmap_endpoints(local):
    client = TestClient(app)
    assert [v["key"] for v in client.get("/api/trendmap/variables").json()] == ["fake_t2m"]
    meta = client.get("/api/trendmap/meta", params={"variable": "fake_t2m"}).json()
    assert meta["units"] == "°C" and meta["years"] == [2000, 2010] and meta["demo"] is False
    grid = client.get("/api/trendmap/grid", params={"variable": "fake_t2m"}).json()
    assert (grid["lat0"], grid["dlat"], grid["n_lat"]) == (-89.5, 1.0, 180)
    tested = [s for s in grid["slope"] if s is not None]
    assert len(tested) == 2 and all(s == pytest.approx(0.5, abs=0.01) for s in tested)  # 46.5N misses 2003
    point = client.get("/api/trendmap/point", params={"variable": "fake_t2m", "lat": 51, "lon": 30}).json()
    assert (point["lat"], point["lon"]) == (50.5, 30.5) and point["slope_decade"] == pytest.approx(0.5, abs=0.01)
    assert client.get("/api/trendmap/point", params={"variable": "fake_t2m", "lat": 0, "lon": 0}).status_code == 422
    frames = client.get("/api/trendmap/frames", params={"variable": "fake_t2m"}).json()
    assert (frames["n_lat"], frames["dlat"]) == (90, 2.0) and len(frames["frames"]) == 11
    assert sum(v is not None for v in frames["frames"][0]) == 1
    values = client.get("/api/trendmap/frames", params={"variable": "fake_t2m", "kind": "values"}).json()
    assert values["kind"] == "values" and len(values["frames"]) == 11
    lo, hi = meta["value_range"]
    assert 9 < lo < hi < 12
    assert client.get("/api/trendmap/frames", params={"variable": "fake_t2m", "kind": "nope"}).status_code == 422
    assert client.get("/api/trendmap/flow").status_code in (200, 503, 404)
    assert client.get("/api/trendmap/meta", params={"variable": "nope"}).status_code == 404
    region = client.get("/api/trendmap/region", params={"variable": "fake_t2m", "name": "tst"}).json()
    assert region["label"] == "Testland" and region["n_cells"] == 2 and region["slope_decade"] == pytest.approx(0.5, abs=0.01)
    assert client.get("/api/trendmap/region", params={"variable": "fake_t2m", "name": "nope"}).status_code == 404
    # two neighbours as one area: the cell they share counts once in full, and the label names both
    both = client.get("/api/trendmap/region", params={"variable": "fake_t2m", "names": "tst-a,tst-b"}).json()
    assert both["label"] == "Alpha, Beta" and both["n_cells"] == 2 and both["slope_decade"] == pytest.approx(0.5, abs=0.01)
    assert client.get("/api/trendmap/region", params={"variable": "fake_t2m", "names": "tst,tst-a"}).status_code == 422
    scan = client.get("/api/insights/scan", params={"regions": "tst-a,oth"})
    assert scan.status_code in (200, 503)
    found = client.get("/api/boundaries", params={"q": "testl"}).json()
    assert [r["id"] for r in found] == ["tst"]


def test_sen_slope_uses_real_years():
    years = np.array([2000, 2001, 2002, 2006, 2007, 2008], dtype=float)
    slope, _ = trendmap._sen(years, 0.1 * (years - 2000))
    assert slope == pytest.approx(0.1)


def test_precomputed_trend_products_match_live(local, monkeypatch):
    from src import trendmaps

    client = TestClient(app)
    paths = ["meta", "grid", "global-mean", "summary", "frames", "frames?kind=values"]
    url = lambda p: f"/api/trendmap/{p}{'&' if '?' in p else '?'}variable=fake_t2m"  # noqa: E731
    live = {p: client.get(url(p)).json() for p in paths}
    (local / "trends").mkdir()
    (local / "trends" / "fake_t2m.npz").write_bytes(trendmaps.to_bytes(trendmaps.build("fake_t2m")))
    clear_caches()
    assert trendmaps.read("fake_t2m") is not None
    loads = []
    real = dataset.annual
    monkeypatch.setattr(dataset, "annual", lambda key: loads.append(key) or real(key))
    pre = {p: client.get(url(p)).json() for p in paths}
    assert loads == []  # served from the file alone
    assert pre == live
