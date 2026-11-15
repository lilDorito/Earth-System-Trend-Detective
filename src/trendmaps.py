# trend map products for a variable's whole record: built once with the dataset (trends/<key>.npz),
# so the API reads them instead of computing per request

import io
import warnings

import numpy as np
from scipy import ndimage

from . import dataset, gridtrends
from .insights import JUMP_GAIN

BASELINE_YEARS = 5  # anomalies are relative to the mean of the first years of the period
FRAME_STEP_DEG = 2.0  # year maps are sent coarser; the globe smooths them anyway
VERSION = 2  # bump when the products change, so files from an older build are ignored
CELL_KM2 = 111.195**2  # one square degree at the equator
CLUSTERS_KEPT = 8  # largest areas of each sign
MIN_CLUSTER_KM2 = 150_000  # smaller patches of one sign are noise at this resolution
NINO34 = (-5.0, 5.0, -170.0, -120.0)  # south, north, west, east
# eastward and northward parts of the fields drawn as drifting streaks
FLOWS = {"wind": ("merra2_u10m", "merra2_v10m"), "current": ("u_current", "v_current")}


def nanmean(values: np.ndarray, axis: int) -> np.ndarray:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN slices are expected (no-data cells)
        return np.nanmean(values, axis=axis)


def coarsen(values: np.ndarray, lat: np.ndarray, lon: np.ndarray):
    # block means over k x k cells, skipping NaN; values: (n, lat, lon). A block needs half its cells,
    # so isolated cells (lakes in ocean products) do not grow into 2-degree blobs
    k = int(round(FRAME_STEP_DEG / (lat[1] - lat[0])))
    if k < 2 or len(lat) % k or len(lon) % k:
        return values, lat, lon
    n, nlat, nlon = values.shape
    blocks = values.reshape(n, nlat // k, k, nlon // k, k).transpose(0, 1, 3, 2, 4).reshape(n, nlat // k, nlon // k, k * k)
    coarse = nanmean(blocks, axis=3)
    coarse[np.isfinite(blocks).sum(axis=3) < (k * k) / 2] = np.nan
    return coarse, lat.reshape(-1, k).mean(axis=1), lon.reshape(-1, k).mean(axis=1)


def value_range(values: np.ndarray) -> list[float]:
    # 5th and 95th percentile of the annual maps, for the values view; wider would let capped cells
    # (GLDAS soil moisture sits at 100 kg/m2 over ice) squeeze ordinary values into a few colours
    finite = values[np.isfinite(values)]
    if not finite.size:
        return [0.0, 1.0]
    lo, hi = np.quantile(finite, [0.05, 0.95])
    return [float(f"{lo:.3g}"), float(f"{hi:.3g}")]


def anomalies(values: np.ndarray) -> tuple[np.ndarray, int]:
    n_base = min(BASELINE_YEARS, max(1, values.shape[0] // 2))
    return (values - nanmean(values[:n_base], axis=0)).astype(np.float32), n_base


def cell_stats(values: np.ndarray, years: np.ndarray, slope: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    t = ((years - years[0]) / 10).astype(np.float32)[:, None, None]
    resid = values - slope[None] * t
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # cells without data
        resid = resid - np.nanmedian(resid, axis=0)
        sigma = np.nanstd(resid, axis=0, ddof=2).astype(np.float32)
        x = values - np.nanmean(values, axis=0)
    n = values.shape[0]
    rss_line = np.nansum(resid**2, axis=0)
    total = np.nansum(x**2, axis=0)
    csum = np.nancumsum(x, axis=0)
    best = np.full(x.shape[1:], np.inf, dtype=np.float32)
    for t in range(3, n - 2):
        left, right = csum[t - 1], csum[-1] - csum[t - 1]
        best = np.minimum(best, total - left**2 / t - right**2 / (n - t))
    with np.errstate(divide="ignore", invalid="ignore"):
        gain = n * np.log(rss_line / best) - np.log(n)
    step = (np.isfinite(values).all(axis=0) & (gain > JUMP_GAIN)).astype(np.uint8)
    return sigma, step


def clusters(slope: np.ndarray, sig: np.ndarray) -> dict[str, np.ndarray]:
    area_cell = np.cos(np.deg2rad(dataset.LAT))[:, None] * CELL_KM2 * np.ones_like(slope)
    labels = np.zeros(slope.shape, dtype=np.int16)
    rows = []
    for sign in (1, -1):
        mask = sig.astype(bool) & np.isfinite(slope) & (np.sign(slope) == sign)
        lab, count = ndimage.label(mask, structure=np.ones((3, 3)))
        # an area crossing 180 degrees is two labels touching across the edge columns: merge them
        for a, b in zip(lab[:, 0], lab[:, -1]):
            if a and b and a != b:
                lab[lab == b] = a
        for i in np.unique(lab[lab > 0]):
            cells = lab == i
            area = float(area_cell[cells].sum())
            if area < MIN_CLUSTER_KM2:
                continue
            w = area_cell[cells]
            ii, jj = np.nonzero(cells)
            # centroid as a mean direction, so an area across 180 degrees does not average to 0
            lon_rad = np.deg2rad(dataset.LON[jj])
            clon = float(np.rad2deg(np.arctan2((w * np.sin(lon_rad)).sum(), (w * np.cos(lon_rad)).sum())))
            rows.append((sign, area, float((w * slope[cells]).sum() / w.sum()), float((w * dataset.LAT[ii]).sum() / w.sum()), clon, cells))
    rows = [r for sign in (1, -1) for r in sorted((r for r in rows if r[0] == sign), key=lambda r: -r[1])[:CLUSTERS_KEPT]]
    for k, row in enumerate(rows, start=1):
        labels[row[5]] = k
    return {
        "cluster_labels": labels,
        "cluster_sign": np.array([r[0] for r in rows], dtype=np.int8),
        "cluster_area": np.array([r[1] for r in rows], dtype=np.float32),
        "cluster_slope": np.array([r[2] for r in rows], dtype=np.float32),
        "cluster_lat": np.array([r[3] for r in rows], dtype=np.float32),
        "cluster_lon": np.array([r[4] for r in rows], dtype=np.float32),
    }


def build(key: str) -> dict[str, np.ndarray]:
    annual = dataset.annual(key)
    lat, lon, values = dataset.LAT, dataset.LON, annual.values
    slope, p, _q, sig = gridtrends.compute_grid(values, annual.years)
    sigma, step = cell_stats(values, annual.years, slope)
    anomaly, n_base = anomalies(values)
    anomaly_frames, clat, clon = coarsen(anomaly, lat, lon)
    value_frames, _, _ = coarsen(values, lat, lon)
    return {
        "version": np.array(VERSION),
        "years": annual.years.astype(np.int16),
        "n_base": np.array(n_base),
        "slope": slope.astype(np.float32),
        "sig": sig.astype(np.uint8),
        "anomaly_frames": anomaly_frames.astype(np.float32),
        "anomaly_mean": gridtrends.global_mean_series(anomaly, lat).astype(np.float64),
        "value_frames": value_frames.astype(np.float32),
        "value_mean": gridtrends.global_mean_series(values, lat).astype(np.float64),
        "frame_lat": clat.astype(np.float32),
        "frame_lon": clon.astype(np.float32),
        "trend_scale": np.array(dataset.nice_limit(dataset.quantile_abs(slope, 0.9))),
        "anomaly_scale": np.array(dataset.nice_limit(dataset.quantile_abs(anomaly, 0.97))),
        "value_range": np.array(value_range(values)),
        "p": p.astype(np.float32),
        "sigma": sigma,
        "step": step,
        **clusters(slope, sig),
    }


def build_flow(name: str, years: np.ndarray | None = None) -> dict[str, np.ndarray]:
    u, v = (dataset.annual(key) for key in FLOWS[name])
    common, iu, iv = np.intersect1d(u.years, v.years, return_indices=True)
    if years is not None:
        keep = np.isin(common, years)
        iu, iv, common = iu[keep], iv[keep], common[keep]
    mean = np.stack([nanmean(u.values[iu], axis=0), nanmean(v.values[iv], axis=0)])
    (cu, cv), clat, clon = coarsen(mean, dataset.LAT, dataset.LON)
    return {
        "version": np.array(VERSION),
        "years": common.astype(np.int16),
        "u": cu.astype(np.float32),
        "v": cv.astype(np.float32),
        "frame_lat": clat.astype(np.float32),
        "frame_lon": clon.astype(np.float32),
    }


def to_bytes(products: dict[str, np.ndarray]) -> bytes:
    buffer = io.BytesIO()
    np.savez_compressed(buffer, **products)
    return buffer.getvalue()


def read(name: str, folder: str = "trends") -> dict[str, np.ndarray] | None:
    # <folder>/<name>.npz from the dataset; None when the revision has none (or an older version)
    try:
        with dataset.open_file(f"{folder}/{name}.npz", block_size=1 << 22) as file:
            with np.load(io.BytesIO(file.read())) as data:
                products = {k: data[k] for k in data.files}
    except (FileNotFoundError, OSError, ValueError):
        return None
    except Exception as e:  # the Hub raises its own errors for a missing path
        if "not found" in str(e).lower() or "404" in str(e):
            return None
        raise
    return products if int(products.get("version", 0)) == VERSION else None


# independent products of the same quantity, compared over the cells both cover
PARTNERS = {
    "merra2_t2m": "gldas_tair",
    "gldas_tair": "merra2_t2m",
    "merra2_ts": "gldas_skin_temp",
    "gldas_skin_temp": "merra2_ts",
    "imerg_precip": "gldas_precip",
    "gldas_precip": "imerg_precip",
}


def nino34() -> tuple[np.ndarray, np.ndarray]:
    annual = dataset.annual("sst")
    south, north, west, east = NINO34
    rows = (dataset.LAT >= south) & (dataset.LAT <= north)
    cols = (dataset.LON >= west) & (dataset.LON <= east)
    box = annual.values[:, rows][:, :, cols]
    index = nanmean(box.reshape(box.shape[0], -1), axis=1)
    return annual.years, (index - np.nanmean(index)).astype(np.float32)


def region_matrix():
    from scipy import sparse

    index = dataset.regions()
    weights = dataset._region_weights().reset_index()
    row = index.index.get_indexer(weights["id"])
    cell = np.rint(weights["lat"] + 89.5).astype(int) * len(dataset.LON) + np.rint(weights["lon"] + 179.5).astype(int)
    w = weights["frac"].to_numpy() * np.cos(np.deg2rad(weights["lat"].to_numpy()))
    return list(index.index), sparse.csr_matrix((w, (row, cell)), shape=(len(index), len(dataset.LAT) * len(dataset.LON)))


def region_coverage(matrix, values: np.ndarray) -> np.ndarray:
    any_data = np.isfinite(values).any(axis=0).ravel().astype(np.float64)
    total = np.asarray(matrix.sum(axis=1)).ravel()
    with np.errstate(invalid="ignore", divide="ignore"):
        return (matrix @ any_data / total).astype(np.float32)


def region_series(matrix, values: np.ndarray, land: np.ndarray | None = None) -> np.ndarray:
    flat = values.reshape(values.shape[0], -1).astype(np.float64)
    finite = np.isfinite(flat)
    if land is not None:
        finite &= land.ravel()[None]
    sums = matrix @ np.where(finite, flat, 0.0).T
    counts = matrix @ finite.T.astype(np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        return (sums / counts).astype(np.float32)  # (regions, years), NaN where a region has no data


def build_insights(keys: list[str]) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    cells: dict[str, np.ndarray] = {"version": np.array(VERSION), "keys": np.array(keys)}
    ids, matrix = region_matrix()
    regions: dict[str, np.ndarray] = {"version": np.array(VERSION), "ids": np.array(ids)}
    coverage = {}
    for key in keys:
        products = read_local(key)
        cells[f"{key}:slope"] = products["slope"].astype(np.float32)
        cells[f"{key}:p"] = products["p"].astype(np.float16)
        cells[f"{key}:sig"] = products["sig"]
        cells[f"{key}:sigma"] = products["sigma"].astype(np.float32)
        cells[f"{key}:step"] = products["step"]
        annual = dataset.annual(key)
        coverage[key] = np.isfinite(annual.values).any(axis=0)
        regions[f"{key}:years"] = annual.years.astype(np.int16)
        regions[f"{key}:series"] = region_series(matrix, annual.values)
        regions[f"{key}:coverage"] = region_coverage(matrix, annual.values)
        dataset.annual.cache_clear()
    # global products compared with land-only partners over land cells, for a fair comparison
    for key, partner in PARTNERS.items():
        if key in keys and partner in keys and coverage[key].sum() > coverage[partner].sum():
            annual = dataset.annual(key)
            regions[f"{key}@land:series"] = region_series(matrix, annual.values, coverage[partner])
            dataset.annual.cache_clear()
    if "sst" in keys:
        years, index = nino34()
        cells["nino:years"], cells["nino:index"] = years.astype(np.int16), index
    return cells, regions


def read_local(key: str) -> dict[str, np.ndarray]:
    products = read(key)
    if products is None:
        raise FileNotFoundError(f"trends/{key}.npz is missing or from an older build; run the trends step first")
    return products
