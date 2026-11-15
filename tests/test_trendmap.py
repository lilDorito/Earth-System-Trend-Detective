# grid trend stats and /api/trendmap

import json

import numpy as np
from fastapi.testclient import TestClient

from app.api import trendmap
from app.api.main import app
from src import gridtrends

client = TestClient(app)


def test_sen_slope_recovers_known_trend():
    rng = np.random.default_rng(0)
    n = 30
    x = 0.05 * np.arange(n)[:, None, None] + rng.normal(0, 0.1, (n, 3, 4))
    slope, p, q, sig = gridtrends.compute_grid(x)
    assert slope.shape == (3, 4)
    assert np.allclose(slope, 0.5, atol=0.1)
    assert sig.all()


def test_no_trend_is_not_significant():
    rng = np.random.default_rng(1)
    x = rng.normal(0, 1, (30, 10, 10))
    *_, sig = gridtrends.compute_grid(x)
    assert sig.mean() < 0.2


def test_fdr_monotone_and_nan_safe():
    p = np.array([[0.001, 0.04], [0.5, np.nan]])
    q = gridtrends.fdr_bh(p)
    assert np.isnan(q[1, 1]) and (q[~np.isnan(q)] >= p[~np.isnan(p)]).all()


def test_api_trendmap():
    meta = client.get("/api/trendmap/meta").json()
    assert meta["demo"] is True and meta["n_lat"] > 0
    g = client.get("/api/trendmap/grid").json()
    assert len(g["slope"]) == len(g["sig"]) == g["n_lat"] * g["n_lon"]
    sm = client.get("/api/trendmap/summary").json()
    assert len(sm["years"]) == len(sm["mean"]) == len(sm["fitted"])
    pt = client.get("/api/trendmap/point", params={"lat": 50.45, "lon": 30.52}).json()
    assert pt["trend"] in {"increasing", "decreasing", "no trend"} and len(pt["values"]) == len(pt["years"])
    assert client.get("/api/trendmap/point", params={"lat": 99, "lon": 0}).status_code == 422


def test_api_period_params():
    g = client.get("/api/trendmap/grid", params={"start": 2005, "end": 2020}).json()
    assert g["start"] == 2005 and g["span_years"] == 15
    s = client.get("/api/trendmap/summary", params={"start": 2005, "end": 2020}).json()
    assert s["years"][0] == 2005 and s["years"][-1] == 2020 and len(s["mean"]) == 16
    assert abs(s["total_change"] - s["slope_decade"] * 1.5) < 1e-6
    assert len(s["zonal_slope"]) == len(s["lat"])
    assert s["share_warming"] + s["share_cooling"] <= 1.0001
    assert s["share_warming_significant"] <= s["share_warming"]
    p = client.get("/api/trendmap/point", params={"lat": 0, "lon": 0, "start": 2005, "end": 2020}).json()
    assert len(p["years"]) == 16


def test_api_period_validation():
    assert client.get("/api/trendmap/summary", params={"start": 2010, "end": 2012}).status_code == 422
    assert client.get("/api/trendmap/grid", params={"start": 1900, "end": 2020}).status_code == 422


# Hamed-Rao gives NaN p on some smooth series, the API must fall back
def test_every_demo_cell_has_finite_stats():
    ds = trendmap._ds(trendmap.DEFAULT)
    for i in range(0, len(ds.lat), 4):
        for j in range(0, len(ds.lon), 9):
            r = client.get("/api/trendmap/point", params={"lat": float(ds.lat[i]), "lon": float(ds.lon[j])})
            assert r.status_code == 200
            assert np.isfinite(r.json()["p"]), (ds.lat[i], ds.lon[j])
    json.dumps(client.get("/api/trendmap/summary").json(), allow_nan=False)


def test_frames_endpoint():
    r = client.get("/api/trendmap/frames?start=2005&end=2020")
    assert r.status_code == 200
    d = r.json()
    assert d["years"] == list(range(2005, 2021))
    assert len(d["frames"]) == 16 and len(d["frames"][0]) == d["n_lat"] * d["n_lon"]
    assert d["baseline"] == [2005, 2009]
    assert abs(d["global_mean"][0]) < 0.3  # first years are the baseline
    assert client.get("/api/trendmap/frames?start=2010&end=2012").status_code == 422


def test_region_endpoint():
    r = client.get("/api/trendmap/region?name=ukraine&start=2000&end=2024")
    assert r.status_code == 200
    d = r.json()
    assert d["n_cells"] > 4 and len(d["years"]) == len(d["stripes"]) == 25
    assert abs(sum(d["stripes"])) < 0.05  # stripes are deviations from the period mean
    assert d["trend"] in ("increasing", "decreasing", "no trend")
    arctic = client.get("/api/trendmap/region?name=arctic&start=2000&end=2024").json()
    tropics = client.get("/api/trendmap/region?name=tropics&start=2000&end=2024").json()
    assert arctic["slope_decade"] > tropics["slope_decade"]  # Arctic amplification in the demo field
    assert client.get("/api/trendmap/region?name=mars").status_code == 404
