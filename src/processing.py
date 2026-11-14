# monthly resample, climatology and anomalies

import pandas as pd

from .contracts import PROCESSED_COLUMNS, validate_series


def to_monthly(df: pd.DataFrame) -> pd.DataFrame:
    # TODO(stats): drop sparse months
    out = (
        df.set_index("time")["value"]
        .resample("MS")
        .mean()
        .reset_index()
    )
    out["value"] = out["value"].astype("float64")
    return out


def add_anomalies(monthly: pd.DataFrame) -> pd.DataFrame:
    # TODO(stats): optional fixed baseline period
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
