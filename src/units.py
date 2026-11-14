# raw provider units -> display units

import pandas as pd


def _identity(df: pd.DataFrame) -> pd.Series:
    return df["value"]


def _kelvin_to_celsius(df: pd.DataFrame) -> pd.Series:
    return df["value"] - 273.15


def _rate_to_mm_per_month(df: pd.DataFrame) -> pd.Series:
    # kg m-2 s-1 == mm/s
    seconds = df["time"].dt.days_in_month * 86_400
    return df["value"] * seconds


def _rate_to_mm_per_day(df: pd.DataFrame) -> pd.Series:
    return df["value"] * 86_400


CONVERSIONS = {
    "identity": _identity,
    "K_to_C": _kelvin_to_celsius,
    "kg_m2_s_to_mm_month": _rate_to_mm_per_month,
    "kg_m2_s_to_mm_day": _rate_to_mm_per_day,
}


def convert(df: pd.DataFrame, conversion: str) -> pd.DataFrame:
    if conversion not in CONVERSIONS:
        raise KeyError(f"Unknown conversion '{conversion}', add it to src/units.py")
    out = df.copy()
    out["value"] = CONVERSIONS[conversion](out).astype("float64")
    return out
