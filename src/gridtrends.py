# global grid trends for the globe layer: Mann-Kendall + Sen's slope per cell, FDR across cells

from dataclasses import dataclass

import numpy as np
from scipy.stats import norm

from . import dataset
from .config import settings

ALPHA = 0.05
CHUNK_CELLS = 5_000  # cells per block: the pairwise-slope stack is about 25 MB at 26 years
DEMO_KEY = "merra2_t2m"


@dataclass
class GridDataset:
    years: np.ndarray  # (n,)
    lat: np.ndarray  # (nlat,) ascending
    lon: np.ndarray  # (nlon,) -180..180 ascending
    values: np.ndarray  # (n, nlat, nlon) annual means, NaN where a cell has no data
    demo: bool
    key: str = DEMO_KEY
    label: str = "T2M, annual mean"  # shown in the UI: what the numbers are and where they come from
    units: str = "°C"


def make_demo() -> GridDataset:
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


def load_grid(key: str = DEMO_KEY) -> GridDataset:
    if settings.data_mode == "live":
        meta = dataset.variable(key)
        annual = dataset.annual(key)
        label = f"{meta['name']}, annual mean"
        return GridDataset(annual.years, dataset.LAT, dataset.LON, annual.values, False, key, label, meta["units"])
    if key != DEMO_KEY:
        raise KeyError(f"Only {DEMO_KEY} is available with DATA_MODE=mock")
    return make_demo()


def _mann_kendall_block(x: np.ndarray, t: np.ndarray):
    n = x.shape[0]
    s = np.zeros(x.shape[1:], dtype=np.float32)
    slopes = []
    for i in range(n - 1):
        for j in range(i + 1, n):
            diff = x[j] - x[i]
            s += np.sign(diff)
            slopes.append(diff / (t[j] - t[i]))
    sen = np.median(np.stack(slopes), axis=0)

    t = (t - t[0]).astype(np.float32).reshape(n, 1)
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
# (simplified Hamed-Rao variance factor; single cells use pymannkendall in app/api/trendmap.py).
# Only cells with every year present are tested, the rest stay NaN; years may have gaps.
def mann_kendall_grid(x: np.ndarray, years: np.ndarray | None = None):
    shape = x.shape[1:]
    t = np.arange(x.shape[0], dtype=np.float64) if years is None else np.asarray(years, dtype=np.float64)
    flat = x.reshape(x.shape[0], -1).astype(np.float32)
    cells = np.flatnonzero(np.isfinite(flat).all(axis=0))
    sen = np.full(flat.shape[1], np.nan, dtype=np.float32)
    p = np.full(flat.shape[1], np.nan, dtype=np.float64)
    for a in range(0, len(cells), CHUNK_CELLS):
        block = cells[a:a + CHUNK_CELLS]
        sen[block], p[block] = _mann_kendall_block(flat[:, block], t)
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


def compute_grid(annual: np.ndarray, years: np.ndarray | None = None):
    sen, p = mann_kendall_grid(annual, years)
    # a cell that never changes (open sea in an ice product, desert in a fire one) is not a test:
    # counting it would dilute the correction for the cells that do vary
    varies = np.ptp(annual, axis=0) > 0
    q = fdr_bh(np.where(varies, p, np.nan))
    return sen * 10, p, q, np.isfinite(q) & (q < ALPHA)


def selection_mean(values: np.ndarray, lat: np.ndarray, mask: np.ndarray | None = None) -> np.ndarray:
    w = np.cos(np.deg2rad(lat))[:, None] * (np.ones(values.shape[1:]) if mask is None else mask)
    finite = np.isfinite(values) & (w > 0)
    weights = np.where(finite, w, 0.0)
    total = weights.sum(axis=(1, 2))
    with np.errstate(invalid="ignore"):
        return (np.where(finite, values, 0.0) * weights).sum(axis=(1, 2)) / total


def global_mean_series(values: np.ndarray, lat: np.ndarray) -> np.ndarray:
    return selection_mean(values, lat)
