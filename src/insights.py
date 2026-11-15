# diagnostics of an annual series: effect size, step changes, start-year robustness, how long until a
# trend is significant, every start/end window, and how much of a trend ENSO explains

import warnings

import numpy as np
import pymannkendall as mk
from scipy import stats

MIN_YEARS = 8
ALPHA = 0.05
ROBUST_SHIFTS = 5  # start the record up to this many years later
# BIC gain a jump needs over a line: the break year is searched for, which plain BIC under-penalises; 10 gives
# about 1% false alarms on a trend plus white noise (more on strongly persistent series)
JUMP_GAIN = 10


def sen(years: np.ndarray, values: np.ndarray) -> tuple[float, float]:
    i, j = np.triu_indices(len(years), 1)
    slope = float(np.median((values[j] - values[i]) / (years[j] - years[i])))
    return slope, float(np.median(values - slope * (years - years[0])))


def mk_p(values: np.ndarray) -> float:
    # Hamed-Rao, falling back to the plain test where it gives NaN (very short or flat series)
    with warnings.catch_warnings(), np.errstate(invalid="ignore", divide="ignore"):
        warnings.simplefilter("ignore")
        p = mk.hamed_rao_modification_test(values).p
        if not np.isfinite(p):
            p = mk.original_test(values).p
    return float(p)


def residual_stats(years: np.ndarray, values: np.ndarray) -> tuple[float, float]:
    # year-to-year scatter around the Sen line and its lag-1 autocorrelation
    slope, intercept = sen(years, values)
    resid = values - (intercept + slope * (years - years[0]))
    sigma = float(np.std(resid, ddof=2)) if len(resid) > 2 else float("nan")
    r1 = float(np.corrcoef(resid[:-1], resid[1:])[0, 1]) if len(resid) > 3 and np.std(resid) > 0 else 0.0
    return sigma, (r1 if np.isfinite(r1) else 0.0)


def pettitt(values: np.ndarray) -> dict:
    # Pettitt (1979): the most likely single shift in the median, with an approximate p; shift in the series' units
    n = len(values)
    signs = np.sign(values[:, None] - values[None, :])
    u = np.array([signs[: t + 1, t + 1 :].sum() for t in range(n - 1)])
    t = int(np.argmax(np.abs(u)))
    k = float(np.abs(u[t]))
    p = float(min(1.0, 2 * np.exp(-6 * k**2 / (n**3 + n**2))))
    return {"index": t + 1, "p": p, "shift": float(np.median(values[t + 1 :]) - np.median(values[: t + 1]))}


def step_or_trend(years: np.ndarray, values: np.ndarray, slope: float, intercept: float) -> dict:
    # does one jump between two flat levels fit better than a straight line? BIC, with the break year as an
    # extra parameter; a jump that wins means the "trend" may be a shift (a new sensor, model or forcing)
    n = len(values)
    rss_line = float(np.sum((values - (intercept + slope * (years - years[0]))) ** 2))
    best = min(
        (float(np.sum((values[:t] - values[:t].mean()) ** 2) + np.sum((values[t:] - values[t:].mean()) ** 2)), t)
        for t in range(3, n - 2)
    )
    bic = lambda rss, k: n * np.log(max(rss, 1e-12) / n) + k * np.log(n)  # noqa: E731
    gain = float(bic(rss_line, 2) - bic(best[0], 3))
    t = best[1]
    return {
        "year": int(years[t]),
        "shift": float(values[t:].mean() - values[:t].mean()),
        "bic_gain": gain,
        "likely": gain > JUMP_GAIN,
    }


def years_needed(slope: float, sigma: float, r1: float, n: int) -> int | None:
    # record length at which this slope would reach p < 0.05 (OLS standard error, inflated for autocorrelation);
    # None when the slope is zero or the scatter unknown
    if not slope or not np.isfinite(sigma) or sigma <= 0:
        return None
    inflate = np.sqrt((1 + max(r1, 0)) / (1 - min(max(r1, 0), 0.9)))
    # se(slope) = sigma * sqrt(12 / (m^3 - m)) for m evenly spaced years
    for m in range(max(n, 3), 400):
        if abs(slope) / (sigma * inflate * np.sqrt(12 / (m**3 - m))) >= 1.96:
            return m
    return None


def windows(years: np.ndarray, values: np.ndarray) -> dict:
    # MK p and Sen slope for every start/end pair at least MIN_YEARS long: how much the choice of window matters
    n = len(years)
    p = np.full((n, n), np.nan)
    slope = np.full((n, n), np.nan)
    for a in range(n):
        for b in range(a + MIN_YEARS - 1, n):
            p[a, b] = mk_p(values[a : b + 1])
            slope[a, b] = sen(years[a : b + 1], values[a : b + 1])[0]
    return {"p": p, "slope": slope}


def quick(years: np.ndarray, values: np.ndarray) -> dict | None:
    # the scanner's per-variable numbers: Sen slope per decade, MK p, scatter, effect size, jump; None if too short
    keep = np.isfinite(values)
    years, values = years[keep].astype(np.float64), values[keep].astype(np.float64)
    if len(years) < MIN_YEARS:
        return None
    slope, intercept = sen(years, values)
    sigma, _ = residual_stats(years, values)
    return {
        "slope_decade": slope * 10,
        "p": mk_p(values),
        "sigma": sigma,
        "effect": slope * 10 / sigma if sigma > 0 else None,
        "jump": step_or_trend(years, values, slope, intercept)["likely"],
        "years": [int(years[0]), int(years[-1])],
    }


def diagnose(years: np.ndarray, values: np.ndarray, nino: tuple[np.ndarray, np.ndarray] | None = None) -> dict:
    keep = np.isfinite(values)
    years, values = years[keep].astype(np.float64), values[keep].astype(np.float64)
    n = len(years)
    if n < MIN_YEARS:
        raise ValueError(f"Needs at least {MIN_YEARS} years with data (got {n})")
    slope, intercept = sen(years, values)
    p = mk_p(values)
    sigma, r1 = residual_stats(years, values)
    # a steady trend moves the median too, so Pettitt looks for a step in what the trend leaves
    step = pettitt(values - (intercept + slope * (years - years[0])))
    jump = step_or_trend(years, values, slope, intercept)

    # start-year robustness: Sen slope and p when the record starts 1..5 years later
    shifted = []
    for k in range(1, min(ROBUST_SHIFTS, n - MIN_YEARS) + 1):
        shifted.append({"start": int(years[k]), "slope": sen(years[k:], values[k:])[0], "p": mk_p(values[k:])})
    same_sign = all(np.sign(s["slope"]) == np.sign(slope) for s in shifted)
    spread = max((abs(s["slope"] - slope) for s in shifted), default=0.0)
    robust = same_sign and (not shifted or spread <= 0.5 * abs(slope))

    # p against record length, ending each year from the MIN_YEARS-th on
    growth = [{"end": int(years[b]), "p": mk_p(values[: b + 1])} for b in range(MIN_YEARS - 1, n)]

    win = windows(years, values)
    out = {
        "years": [int(y) for y in years],
        "values": values.tolist(),
        "slope": slope,
        "intercept": intercept,
        "p": p,
        "significant": p < ALPHA,
        "sigma": sigma,
        "effect": slope * 10 / sigma if sigma and np.isfinite(sigma) else None,  # change per decade in units of the scatter
        "lag1": r1,
        "step": {
            "year": int(years[step["index"]]),
            "p": step["p"],
            "shift": step["shift"],
            "detected": step["p"] < ALPHA,
        },
        "jump": jump,
        "robust": {"stable": bool(robust), "shifted": shifted},
        "growth": growth,
        "years_needed": None if p < ALPHA else years_needed(slope, sigma, r1, n),
        "windows": {"p": win["p"], "slope": win["slope"]},
    }
    if nino is not None:
        out["enso"] = enso(years, values, *nino)
    return out


def enso(years: np.ndarray, values: np.ndarray, nino_years: np.ndarray, nino: np.ndarray) -> dict | None:
    # least squares on year and the annual Nino 3.4 index together: the trend left once ENSO is accounted for
    common, iy, ino = np.intersect1d(years, nino_years, return_indices=True)
    if len(common) < MIN_YEARS:
        return None
    y, t, x = values[iy], common - common[0], nino[ino]
    plain = stats.linregress(t, y)
    design = np.column_stack([np.ones_like(t), t, x])
    coef, *_ = np.linalg.lstsq(design, y, rcond=None)
    fitted = design @ coef
    r2_full = 1 - np.sum((y - fitted) ** 2) / np.sum((y - y.mean()) ** 2)
    r2_trend = plain.rvalue**2
    return {
        "trend": float(plain.slope),
        "trend_without_enso": float(coef[1]),
        "per_degree": float(coef[2]),  # change per 1 degC of the Nino 3.4 anomaly
        "explained": float(max(0.0, r2_full - r2_trend)),  # extra share of the variance ENSO explains
    }
