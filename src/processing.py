# series -> monthly frame with climatology and anomalies (owner: stats)

import pandas as pd

from .contracts import PROCESSED_COLUMNS, validate_series


def to_monthly(df: pd.DataFrame) -> pd.DataFrame:
    """Resample any resolution to month-start means."""
    # TODO(stats): drop months with too little data (e.g. < 70% of expected samples)
    # TODO(stats): accumulated variables (precip in mm) may need sum, not mean, if converted before resampling
    out = (
        df.set_index("time")["value"]
        .resample("MS")
        .mean()
        .reset_index()
    )
    out["value"] = out["value"].astype("float64")
    return out


def add_anomalies(monthly: pd.DataFrame) -> pd.DataFrame:
    """climatology = mean of each calendar month, anomaly = value - climatology."""
    # TODO(stats): optional fixed baseline period (e.g. 1991-2020) instead of the full record
    out = monthly.copy()
    month = out["time"].dt.month
    out["climatology"] = out.groupby(month)["value"].transform("mean")
    out["anomaly"] = out["value"] - out["climatology"]
    return out


def process(df: pd.DataFrame) -> pd.DataFrame:
    validate_series(df)
    out = add_anomalies(to_monthly(df))
    validate_series(out, PROCESSED_COLUMNS)
    return out
