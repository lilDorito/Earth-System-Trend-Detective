# per-cell Mann-Kendall + Sen trends with FDR for the trend map

from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy.stats import norm

from .config import ROOT

ALPHA = 0.05
GRID_FILE = ROOT / "data" / "grid" / "annual.npz"
CHUNK_CELLS = 20_000


@dataclass
class GridDataset:
    years: np.ndarray
    lat: np.ndarray
    lon: np.ndarray
    t2m: np.ndarray  # (years, lat, lon), degC
    demo: bool


def normalize(years, lat, lon, t2m):
    lat_order = np.argsort(lat)
    lon_wrapped = ((lon + 180.0) % 360.0) - 180.0
    lon_order = np.argsort(lon_wrapped)
    return years, lat[lat_order], lon_wrapped[lon_order], t2m[:, lat_order][:, :, lon_order]


def make_demo() -> GridDataset:
    rng = np.random.default_rng(42)
    years = np.arange(2000, 2025)
    lat = np.arange(-90, 90.1, 2.5)
    lon = np.arange(-180, 180, 2.5)
    lat_grid = lat[:, None] * np.ones((1, len(lon)))
    lon_grid = np.ones((len(lat), 1)) * lon[None, :]

    base = 30.0 * np.cos(np.deg2rad(lat_grid)) - 15.0
    trend = 0.015 + 0.04 * np.clip((lat_grid - 45.0) / 45.0, 0, None)
    cooling = (lon_grid > 60) & (lon_grid < 110) & (lat_grid > 10) & (lat_grid < 40)
    trend = np.where(cooling, trend - 0.035, trend)

    shocks = rng.normal(0, 0.4, (len(years),) + base.shape)
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
        return GridDataset(years, lat, lon, t2m.astype(np.float32), demo=False)
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

    # lag-1 autocorrelation of residuals
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


# p only approximates Hamed-Rao; single cells use pymannkendall
def mann_kendall_grid(x: np.ndarray):
    shape = x.shape[1:]
    flat = x.reshape(x.shape[0], -1).astype(np.float32)
    sen = np.empty(flat.shape[1], dtype=np.float32)
    p = np.empty(flat.shape[1], dtype=np.float64)
    for a in range(0, flat.shape[1], CHUNK_CELLS):
        sen[a:a + CHUNK_CELLS], p[a:a + CHUNK_CELLS] = _mann_kendall_block(flat[:, a:a + CHUNK_CELLS])
    return sen.reshape(shape), p.reshape(shape)


def fdr_bh(p: np.ndarray) -> np.ndarray:
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


def global_mean(ds: GridDataset) -> np.ndarray:
    w = np.cos(np.deg2rad(ds.lat))
    return (ds.t2m * w[None, :, None]).sum(axis=(1, 2)) / (w.sum() * ds.t2m.shape[2])
