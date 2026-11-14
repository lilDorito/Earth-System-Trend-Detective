import pandas as pd
import pytest

from src.units import convert


def frame(values, start="2020-01-01"):
    time = pd.date_range(start, periods=len(values), freq="MS", tz="UTC")
    return pd.DataFrame({"time": time, "value": pd.Series(values, dtype="float64")})


def test_kelvin_to_celsius():
    assert convert(frame([273.15, 300.0]), "K_to_C")["value"].round(2).tolist() == [0.0, 26.85]


def test_rate_to_mm_month_uses_days_in_month():
    out = convert(frame([1 / 86_400, 1 / 86_400], start="2021-02-01"), "kg_m2_s_to_mm_month")
    assert out["value"].round(6).tolist() == [28.0, 31.0]


def test_unknown_conversion():
    with pytest.raises(KeyError):
        convert(frame([1.0]), "nope")
