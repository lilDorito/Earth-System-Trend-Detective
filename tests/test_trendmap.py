# grid trend stats + /api/trendmap on the synthetic demo field

import numpy as np
from fastapi.testclient import TestClient

from app.api.main import app
from src import gridtrends

client = TestClient(app)


def test_sen_slope_recovers_known_trend():
    rng = np.random.default_rng(0)
    n = 30
    x = 0.05 * np.arange(n)[:, None, None] + rng.normal(0, 0.1, (n, 3, 4))
    slope, p, q, sig = gridtrends.compute_grid(x)
    assert slope.shape == (3, 4)
    assert np.allclose(slope, 0.5, atol=0.1)  # 0.05/yr -> 0.5/decade
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
    gm = client.get("/api/trendmap/global-mean").json()
    assert len(gm["years"]) == len(gm["values"])
    pt = client.get("/api/trendmap/point", params={"lat": 50.45, "lon": 30.52}).json()
    assert pt["trend"] in {"increasing", "decreasing", "no trend"} and len(pt["values"]) == len(pt["years"])
    assert client.get("/api/trendmap/point", params={"lat": 99, "lon": 0}).status_code == 422
