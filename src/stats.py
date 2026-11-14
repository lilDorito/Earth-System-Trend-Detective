# trend and event analysis (owner: stats)

from datetime import date

import numpy as np
import pandas as pd
import pymannkendall as mk
from scipy import stats as sps

from .contracts import EventResult, TrendResult

MIN_POINTS = 24  # months needed for a trend
MIN_GROUP = 6  # months needed on each side of the event


def _lag1(x: np.ndarray) -> float:
    """Lag-1 autocorrelation, positive part only (negative would inflate the sample size)."""
    if len(x) < 4 or np.std(x) == 0:
        return 0.0
    r = float(np.corrcoef(x[:-1], x[1:])[0, 1])
    return min(max(r, 0.0), 0.9)


def _units(units: str) -> str:
    return units if units.startswith(("°", "%")) else f" {units}"


def analyze_trend(
    processed: pd.DataFrame,
    units: str,
    deseasonalize: bool = True,
    alpha: float = 0.05,
) -> TrendResult:
    """processed has columns time, value, climatology, anomaly (monthly).

    Slope + CI: ordinary least squares (CI is optimistic because monthly data is autocorrelated).
    Significance: Mann-Kendall with the Hamed-Rao autocorrelation correction on anomalies, or the
    seasonal Mann-Kendall (period 12) when the seasonal cycle is kept. Sen's slope comes from the same test.
    """
    df = processed.dropna(subset=["value"]).reset_index(drop=True)
    if len(df) < MIN_POINTS:
        raise ValueError(f"Need at least {MIN_POINTS} months of data, got {len(df)}")

    y = (df["anomaly"] if deseasonalize else df["value"]).to_numpy(dtype=float)
    years = ((df["time"] - df["time"].iloc[0]).dt.days / 365.25).to_numpy()

    lin = sps.linregress(years, y)
    t_crit = sps.t.ppf(1 - alpha / 2, len(y) - 2)
    slope_dec = float(lin.slope * 10)
    half = float(t_crit * lin.stderr * 10)

    corrected = deseasonalize
    if deseasonalize:
        with np.errstate(invalid="ignore"):
            test = mk.hamed_rao_modification_test(y, alpha=alpha)
        if not np.isfinite(test.p):  # negative variance on strongly autocorrelated data: plain test
            test = mk.original_test(y, alpha=alpha)
            corrected = False
        sen_per_month = float(test.slope)
    else:
        test = mk.seasonal_test(y, period=12, alpha=alpha)
        sen_per_month = float(test.slope)
    sen_dec = sen_per_month * 120  # monthly steps -> per decade
    significant = bool(test.h)

    fit = lin.intercept + lin.slope * years
    if deseasonalize:
        fit = fit + df["climatology"].mean()
    span_years = float(years[-1])
    direction = {"increasing": "Rising", "decreasing": "Falling", "no trend": "No clear trend"}[test.trend]
    u = _units(units)
    if test.trend == "no trend":
        verdict = (
            f"No statistically significant trend since {df['time'].iloc[0].year} "
            f"({slope_dec:+.2f}{u} per decade, 95% CI {slope_dec - half:+.2f} to {slope_dec + half:+.2f})."
        )
    else:
        verdict = (
            f"{direction} by {abs(sen_dec):.2f}{u} per decade since {df['time'].iloc[0].year} "
            f"(95% CI {slope_dec - half:+.2f} to {slope_dec + half:+.2f}). Significant at {int((1 - alpha) * 100)}%."
        )

    return TrendResult(
        n=len(df),
        start=df["time"].iloc[0].date(),
        end=df["time"].iloc[-1].date(),
        units=units,
        alpha=alpha,
        slope_per_decade=slope_dec,
        ci_low=slope_dec - half,
        ci_high=slope_dec + half,
        p_value=float(lin.pvalue),
        significant=significant,
        mk_trend=test.trend,
        mk_tau=float(test.Tau),
        mk_p=float(test.p),
        sen_slope_per_decade=sen_dec,
        total_change=float(lin.slope * span_years),
        deseasonalized=deseasonalize,
        autocorr_corrected=corrected,
        fit_line=[
            (df["time"].iloc[0].to_pydatetime(), float(fit[0])),
            (df["time"].iloc[-1].to_pydatetime(), float(fit[-1])),
        ],
        verdict=verdict,
    )


def analyze_event(
    processed: pd.DataFrame,
    units: str,
    event_date: date,
    deseasonalize: bool = True,
    alpha: float = 0.05,
) -> EventResult:
    """Before vs after the event date: Welch t-test on monthly values (or anomalies).

    Monthly data is autocorrelated, so each group's sample size is shrunk to an effective one,
    n_eff = n * (1 - r1) / (1 + r1), before the test. Without that the p-value is far too optimistic.
    With deseasonalize=True the values are anomalies, so the means are anomaly means and pct_change is None.
    """
    df = processed.dropna(subset=["value"])
    col = "anomaly" if deseasonalize else "value"
    cut = pd.Timestamp(event_date, tz=df["time"].dt.tz)
    before = df.loc[df["time"] < cut, col].to_numpy(dtype=float)
    after = df.loc[df["time"] >= cut, col].to_numpy(dtype=float)
    if len(before) < MIN_GROUP or len(after) < MIN_GROUP:
        raise ValueError(
            f"Need at least {MIN_GROUP} months on each side of {event_date} (have {len(before)} before, {len(after)} after)"
        )

    b, a = float(before.mean()), float(after.mean())
    diff = a - b
    n_eff_b = max(2.0, len(before) * (1 - _lag1(before)) / (1 + _lag1(before)))
    n_eff_a = max(2.0, len(after) * (1 - _lag1(after)) / (1 + _lag1(after)))
    vb, va = before.var(ddof=1) / n_eff_b, after.var(ddof=1) / n_eff_a
    se = float(np.sqrt(vb + va))
    if se == 0:
        raise ValueError("No variation in the data, cannot test the difference")
    t_stat = diff / se
    df_w = (vb + va) ** 2 / (vb**2 / (n_eff_b - 1) + va**2 / (n_eff_a - 1))
    p = float(2 * sps.t.sf(abs(t_stat), df_w))
    t_crit = sps.t.ppf(1 - alpha / 2, df_w)
    lo, hi = diff - t_crit * se, diff + t_crit * se
    pct = None if deseasonalize or abs(b) < 1e-12 else diff / abs(b) * 100
    significant = p < alpha

    u = _units(units)
    word = "increased" if diff > 0 else "decreased"
    pct_txt = f" ({pct:+.0f}%)" if pct is not None else ""
    verdict = (
        f"The mean {word} by {abs(diff):.3g}{u}{pct_txt} after {event_date} (95% CI {lo:.3g} to {hi:.3g}). "
        + (f"Significant at {int((1 - alpha) * 100)}%." if significant else "Not significant: could be natural variation.")
    )

    return EventResult(
        event_date=event_date,
        n_before=len(before),
        n_after=len(after),
        units=units,
        alpha=alpha,
        before_mean=b,
        after_mean=a,
        diff=diff,
        pct_change=pct,
        diff_ci_low=float(lo),
        diff_ci_high=float(hi),
        t_stat=float(t_stat),
        p_value=p,
        significant=significant,
        deseasonalized=deseasonalize,
        verdict=verdict,
    )
