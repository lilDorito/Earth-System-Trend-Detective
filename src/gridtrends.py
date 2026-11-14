# global grid trends for the globe layer: Mann-Kendall + Sen's slope per cell, FDR across cells

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.stats import norm

from .config import ROOT

ALPHA = 0.05
GRID_FILE = ROOT / "data" / "grid" / "annual.npz"
CHUNK_CELLS = 20_000  # cells per block, keeps the pairwise-slope stack small


@dataclass
class GridDataset:
    years: np.ndarray  # (n,)
    lat: np.ndarray  # (nlat,) ascending
    lon: np.ndarray  # (nlon,) -180..180 ascending
    t2m: np.ndarray  # (n, nlat, nlon) annual mean (or anomaly), degC
    demo: bool
    label: str = "T2M, annual mean"  # shown in the UI: what the numbers are and where they come from


def normalize(years, lat, lon, t2m):
    # latitude ascending, longitude wrapped to -180..180 and ascending
    lat_order = np.argsort(lat)
    lon_wrapped = ((lon + 180.0) % 360.0) - 180.0
    lon_order = np.argsort(lon_wrapped)
    return years, lat[lat_order], lon_wrapped[lon_order], t2m[:, lat_order][:, :, lon_order]


def make_demo() -> GridDataset:
    # synthetic 2.5 degree field: regional trend patterns plus spatially correlated AR(1) noise
    from scipy.ndimage import gaussian_filter

    rng = np.random.default_rng(42)
    years = np.arange(2000, 2025)
    lat = np.arange(-90, 90.1, 2.5)
    lon = np.arange(-180, 180, 2.5)
    lat_grid = lat[:, None] * np.ones((1, len(lon)))
    lon_grid = np.ones((len(lat), 1)) * lon[None, :]

    def blob(lat0, lon0, size_lat, size_lon, amp):
        dlon = (lon_grid - lon0 + 180) % 360 - 180
        return amp * np.exp(-(((lat_grid - lat0) / size_lat) ** 2 + (dlon / size_lon) ** 2))

    base = 30.0 * np.cos(np.deg2rad(lat_grid)) - 15.0
    trend = 0.012 + 0.045 * np.clip((lat_grid - 40.0) / 50.0, 0, None) ** 1.5  # Arctic amplification
    trend += blob(50, 60, 18, 40, 0.025) + blob(-25, 135, 15, 25, 0.018) + blob(10, 20, 15, 25, 0.015)
    trend += blob(55, -35, 10, 25, -0.035)  # "warming hole" in the North Atlantic
    trend += blob(25, 90, 12, 25, -0.03) + blob(-55, -120, 12, 40, -0.015)
    trend = gaussian_filter(trend, sigma=1.0, mode=("nearest", "wrap"))

    shocks = gaussian_filter(rng.normal(0, 1, (len(years),) + base.shape), sigma=(0, 2.2, 2.2), mode=("nearest", "nearest", "wrap"))
    shocks *= 0.45 / shocks.std()
    noise = np.zeros_like(shocks)
    noise[0] = shocks[0]
    for k in range(1, len(years)):
        noise[k] = 0.4 * noise[k - 1] + shocks[k]

    t2m = base[None] + trend[None] * np.arange(len(years))[:, None, None] + noise
    return GridDataset(years, lat, lon, t2m.astype(np.float32), demo=True)


def load_grid(path: Path = GRID_FILE) -> GridDataset:
    if path.exists():
        with np.load(path) as f:
            years, lat, lon, t2m = normalize(f["years"], f["lat"], f["lon"], f["t2m"])
            label = str(f["label"]) if "label" in f.files else "T2M, annual mean"
        return GridDataset(years, lat, lon, t2m.astype(np.float32), demo=False, label=label)
    return make_demo()


def _mann_kendall_block(x: np.ndarray):
    n = x.shape[0]
    s = np.zeros(x.shape[1:], dtype=np.float32)
    slopes = []
    for i in range(n - 1):
        for j in range(i + 1, n):
            diff = x[j] - x[i]
            s += np.sign(diff)
            slopes.append(diff / (j - i))
    sen = np.median(np.stack(slopes), axis=0)

    # lag-1 autocorrelation of residuals around the Sen line (positive part only)
    t = np.arange(n, dtype=np.float32).reshape(n, 1)
    resid = x - sen * t
    resid = resid - np.median(resid, axis=0)
    denom = np.sum(resid * resid, axis=0)
    numer = np.sum(resid[:-1] * resid[1:], axis=0)
    rho = np.where(denom > 0, numer / np.where(denom > 0, denom, 1), 0.0)
    rho = np.clip(rho, 0.0, 0.9)
    factor = (1 + rho) / (1 - rho)

    var_s = n * (n - 1) * (2 * n + 5) / 18.0
    z = (s - np.sign(s)) / np.sqrt(var_s * factor)
    return sen, 2 * norm.sf(np.abs(z))


# x: (years, lat, lon) -> Sen slope per year and an approximate autocorrelation-adjusted p
# (simplified Hamed-Rao variance factor; single cells use pymannkendall in app/api/trendmap.py)
def mann_kendall_grid(x: np.ndarray):
    shape = x.shape[1:]
    flat = x.reshape(x.shape[0], -1).astype(np.float32)
    sen = np.empty(flat.shape[1], dtype=np.float32)
    p = np.empty(flat.shape[1], dtype=np.float64)
    for a in range(0, flat.shape[1], CHUNK_CELLS):
        sen[a:a + CHUNK_CELLS], p[a:a + CHUNK_CELLS] = _mann_kendall_block(flat[:, a:a + CHUNK_CELLS])
    return sen.reshape(shape), p.reshape(shape)


def fdr_bh(p: np.ndarray) -> np.ndarray:
    # Benjamini-Hochberg q-values, NaN stays NaN
    flat = p.ravel()
    valid = np.isfinite(flat)
    q = np.full(flat.shape, np.nan)
    pv = flat[valid]
    m = len(pv)
    order = np.argsort(pv)
    ranked = pv[order] * m / np.arange(1, m + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    qv = np.empty(m)
    qv[order] = np.minimum(ranked, 1.0)
    q[valid] = qv
    return q.reshape(p.shape)


def compute_grid(annual: np.ndarray):
    sen, p = mann_kendall_grid(annual)
    q = fdr_bh(p)
    return sen * 10, p, q, np.isfinite(q) & (q < ALPHA)


def global_mean_series(t2m: np.ndarray, lat: np.ndarray) -> np.ndarray:
    w = np.cos(np.deg2rad(lat))
    return (t2m * w[None, :, None]).sum(axis=(1, 2)) / (w.sum() * t2m.shape[2])


def global_mean(ds: GridDataset) -> np.ndarray:
    return global_mean_series(ds.t2m, ds.lat)
