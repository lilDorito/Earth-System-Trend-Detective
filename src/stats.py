# trend and event analysis (owner: stats)

from datetime import date

import numpy as np
import pandas as pd

from .contracts import EventResult, TrendResult


def analyze_trend(
    processed: pd.DataFrame,
    units: str,
    deseasonalize: bool = True,
    alpha: float = 0.05,
) -> TrendResult:
    """processed has columns time, value, climatology, anomaly (monthly)."""
    # TODO(stats): scipy.stats.linregress on anomalies (or values) vs decimal years
    #   slope, stderr -> 95% CI with t-distribution, p_value
    # TODO(stats): pymannkendall: original_test, seasonal_test, hamed_rao_modification_test
    #   (autocorrelation-corrected) -> mk_trend, mk_tau, mk_p, sen_slope_per_decade
    # TODO(stats): verdict sentence, e.g.
    #   "Rising by 0.31 °C per decade since 1980 (95% CI 0.24-0.38). Significant at 95%."
    df = processed.dropna(subset=["value"])
    y = df["anomaly"] if deseasonalize else df["value"]
    years = (df["time"] - df["time"].iloc[0]).dt.days / 365.25
    slope, intercept = np.polyfit(years, y, 1)
    fit = intercept + slope * years
    if deseasonalize:
        fit = fit + df["climatology"].mean()
    span_years = float(years.iloc[-1])

    return TrendResult(
        n=len(df),
        start=df["time"].iloc[0].date(),
        end=df["time"].iloc[-1].date(),
        units=units,
        alpha=alpha,
        slope_per_decade=float(slope * 10),
        ci_low=float(slope * 10) - 0.1,
        ci_high=float(slope * 10) + 0.1,
        p_value=0.01,
        significant=True,
        mk_trend="increasing" if slope > 0 else "decreasing",
        mk_tau=0.0,
        mk_p=0.01,
        sen_slope_per_decade=float(slope * 10),
        total_change=float(slope * span_years),
        deseasonalized=deseasonalize,
        autocorr_corrected=False,
        fit_line=[(df["time"].iloc[0].to_pydatetime(), float(fit.iloc[0])), (df["time"].iloc[-1].to_pydatetime(), float(fit.iloc[-1]))],
        verdict=f"[MOCK] Changing by {slope * 10:+.2f} {units} per decade.",
    )


def analyze_event(
    processed: pd.DataFrame,
    units: str,
    event_date: date,
    deseasonalize: bool = True,
    alpha: float = 0.05,
) -> EventResult:
    # TODO(stats): scipy.stats.ttest_ind(after, before, equal_var=False)  (Welch)
    # TODO(stats): CI of the difference of means, pct_change, verdict
    # TODO(stats): optional change-point check (Pettitt / ruptures) to show the break is real
    df = processed.dropna(subset=["value"])
    col = "anomaly" if deseasonalize else "value"
    cut = pd.Timestamp(event_date, tz=df["time"].dt.tz)
    before = df.loc[df["time"] < cut, col]
    after = df.loc[df["time"] >= cut, col]
    b, a = float(before.mean()), float(after.mean())
    diff = a - b

    return EventResult(
        event_date=event_date,
        n_before=len(before),
        n_after=len(after),
        units=units,
        alpha=alpha,
        before_mean=b,
        after_mean=a,
        diff=diff,
        pct_change=None,
        diff_ci_low=diff - 0.1,
        diff_ci_high=diff + 0.1,
        t_stat=0.0,
        p_value=0.01,
        significant=True,
        deseasonalized=deseasonalize,
        verdict=f"[MOCK] Mean changed by {diff:+.2f} {units} after {event_date}.",
    )
