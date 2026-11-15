# dataset access, the hf_grid source and live trend map endpoints, on a tiny local copy of the dataset

from datetime import date

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient

from app.api import trendmap
from app.api.main import app
from src import dataset, pipeline
from src.config import settings
from src.contracts import BBox, Point, Region

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
    # one cell-year with too few months is dropped, not averaged
    annual.loc[(annual.year == 2003) & (annual.lat == 46.5), "months"] = 5
    pq.write_table(pa.Table.from_pandas(annual, preserve_index=False), tmp_path / "annual" / "fake_t2m.parquet")
    (tmp_path / "regions").mkdir()
    pd.DataFrame(
        [dict(id="tst", name="Testland", kind="country", country="tst", country_name="Testland", type="Country",
              lat=50.5, lon=31.0, south=50.0, north=51.0, west=30.0, east=31.6, cells=3, area_km2=12000)]
    ).to_parquet(tmp_path / "regions" / "index.parquet")
    # the third cell has no data, so a quarter-ish of the region is uncovered
    pd.DataFrame(dict(id="tst", lat=[50.5, 50.5, 50.5], lon=[30.5, 31.5, 32.5], frac=[1.0, 0.5, 0.5])).astype(
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
    for cached in (dataset.catalog, dataset.annual, dataset._grid_file, dataset.regions, dataset._region_weights,
                   trendmap._ds, trendmap._grid, trendmap._frames):
        cached.cache_clear()


def test_annual_keeps_complete_years_and_enough_months(local):
    annual = dataset.annual("fake_t2m")
    assert list(annual.years) == list(range(2000, 2011))  # 2011 has only six months
    i = list(annual.years).index(2003)
    assert np.isnan(annual.values[i, 136, 210]) and np.isfinite(annual.values[i, 140, 210])
    assert np.isnan(annual.values[:, 0, 0]).all()


def test_point_snaps_to_nearest_cell_with_data(local):
    df, lat, lon = dataset.point_series("fake_t2m", 50.2, 32.0)
    assert (lat, lon) == (50.5, 31.5) and len(df) == 138 and str(df["time"].dt.tz) == "UTC"
    with pytest.raises(dataset.DatasetError):
        dataset.point_series("fake_t2m", -30.0, 100.0)


def test_area_mean_and_source(local, monkeypatch):
    area = dataset.area_series("fake_t2m", 45, 52, 29, 33)
    assert len(area.df) == 138 and area.cells == 3 and 0 < area.coverage < 0.2
    from src import catalog

    variable = catalog.get_variable("air_temperature").model_copy(update={"variable_id": "fake_t2m"})
    monkeypatch.setitem(catalog.variables(), "air_temperature", variable)
    series, _, result = pipeline.analyze("air_temperature", Point(lat=50.4, lon=30.6), date(2000, 1, 1), date(2011, 6, 1))
    assert series.meta.source == "hf_grid" and series.meta.grid_lat == 50.5
    assert result.slope_per_decade == pytest.approx(0.5, abs=0.05)
    box, _, _ = pipeline.analyze("air_temperature", BBox(west=29, south=45, east=33, north=52), date(2000, 1, 1), date(2011, 6, 1))
    assert box.meta.grid_lat is None and box.meta.cells == 3
    region, _, _ = pipeline.analyze("air_temperature", Region(id="tst"), date(2000, 1, 1), date(2011, 6, 1))
    assert region.meta.region_name == "Testland" and region.meta.cells == 2
    assert region.meta.coverage == pytest.approx(0.75, abs=0.01)
    with pytest.raises(Exception, match="Unknown region"):
        pipeline.analyze("air_temperature", Region(id="nope"), date(2000, 1, 1), date(2011, 6, 1))


def test_box_fractions():
    frac = dataset.box_fractions(dataset.LAT, dataset.LON, 50.25, 51.0, 30.0, 31.5)
    assert frac[140, 210] == pytest.approx(0.75) and frac[140, 211] == pytest.approx(0.375)
    assert frac.sum() == pytest.approx(0.75 * 1.5)
    # across 180 degrees: 179.5 to -179.5 is one degree wide
    across = dataset.box_fractions(dataset.LAT, dataset.LON, 0, 1, 179.5, -179.5)
    assert across.sum() == pytest.approx(1.0) and across[90, 359] == pytest.approx(0.5) and across[90, 0] == pytest.approx(0.5)
    assert BBox(west=170, south=0, east=-170, north=1).center == (0.5, -180.0)
    with pytest.raises(ValueError):
        BBox(west=0, south=5, east=1, north=5)


def test_area_weights_by_share_latitude_and_valid_frac(monkeypatch):
    # two cells: one fully inside with value 0, one half inside, half valid, at 60N, with value 1
    rows = {
        10.5: pd.DataFrame(dict(date=[date(2000, 1, 1)], lon=[0.5], value=[0.0], valid_frac=[1.0])),
        60.5: pd.DataFrame(dict(date=[date(2000, 1, 1)], lon=[0.5], value=[1.0], valid_frac=[0.5])),
    }
    monkeypatch.setattr(dataset, "_band", lambda key, lat, own_handle=False: rows[lat])
    monkeypatch.setattr(dataset, "_grid_file", lambda key: None)
    monkeypatch.setattr(dataset, "variable", lambda key: {"name": "x", "factor": 1})
    cells = pd.DataFrame(dict(lat=[10.5, 60.5], lon=[0.5, 0.5], frac=[1.0, 0.5]))
    area = dataset._area("x", cells, "here")
    w0, w1 = np.cos(np.deg2rad(10.5)), 0.5 * np.cos(np.deg2rad(60.5)) * 0.5
    assert area.df["value"].iloc[0] == pytest.approx(w1 / (w0 + w1))
    assert area.coverage == 1.0 and area.cells == 2


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
    # the two Kyiv cells fill half a 2-degree block and stay; the lone Odesa cell does not
    assert sum(v is not None for v in frames["frames"][0]) == 1
    values = client.get("/api/trendmap/frames", params={"variable": "fake_t2m", "kind": "values"}).json()
    assert values["kind"] == "values" and len(values["frames"]) == 11
    lo, hi = meta["value_range"]
    assert 9 < lo < hi < 12
    assert client.get("/api/trendmap/frames", params={"variable": "fake_t2m", "kind": "nope"}).status_code == 422
    assert client.get("/api/trendmap/wind").status_code in (200, 503, 404)
    assert client.get("/api/trendmap/meta", params={"variable": "nope"}).status_code == 404
    region = client.get("/api/trendmap/region", params={"variable": "fake_t2m", "name": "tst"}).json()
    assert region["label"] == "Testland" and region["n_cells"] == 2 and region["slope_decade"] == pytest.approx(0.5, abs=0.01)
    assert client.get("/api/trendmap/region", params={"variable": "fake_t2m", "name": "nope"}).status_code == 404
    found = client.get("/api/boundaries", params={"q": "testl"}).json()
    assert [r["id"] for r in found] == ["tst"]


def test_sen_slope_uses_real_years():
    years = np.array([2000, 2001, 2002, 2006, 2007, 2008], dtype=float)
    slope, _ = trendmap._sen(years, 0.1 * (years - 2000))
    assert slope == pytest.approx(0.1)
