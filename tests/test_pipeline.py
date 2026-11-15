# pipeline and API on the mock source

from datetime import date

from fastapi.testclient import TestClient

from app.api.main import app
from src import pipeline
from src.contracts import PROCESSED_COLUMNS, Point, validate_series

client = TestClient(app)
KYIV = Point(lat=50.45, lon=30.52)


def test_pipeline_trend_shape():
    series, processed, result = pipeline.analyze("air_temperature", KYIV, date(1980, 1, 1), date(2026, 9, 1))
    validate_series(series.df)
    validate_series(processed, PROCESSED_COLUMNS)
    assert result.mode == "trend" and result.n > 300  # monthly since 2000


def test_pipeline_event_shape():
    _, _, result = pipeline.analyze(
        "no2_column", KYIV, date(2015, 1, 1), date(2026, 9, 1), mode="event", event_date=date(2022, 2, 24)
    )
    assert result.mode == "event" and result.n_before > 0 and result.n_after > 0


def test_api_health_and_catalog():
    assert client.get("/api/health").json()["status"] == "ok"
    assert len(client.get("/api/variables").json()) >= 1
    assert len(client.get("/api/demos").json()) >= 1


def test_api_analyze():
    body = {
        "variable": "air_temperature",
        "location": {"type": "point", "lat": 50.45, "lon": 30.52},
        "start": "1980-01-01", "end": "2026-09-01",
    }
    r = client.post("/api/analyze", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["result"]["mode"] == "trend"
    assert set(data["series"][0]) == set(PROCESSED_COLUMNS)


def test_api_rejects_bad_event():
    body = {
        "variable": "no2_column",
        "location": {"type": "point", "lat": 50.45, "lon": 30.52},
        "start": "2015-01-01", "end": "2026-09-01", "mode": "event",
    }
    assert client.post("/api/analyze", json=body).status_code == 422


def test_api_unknown_variable():
    body = {
        "variable": "nope",
        "location": {"type": "point", "lat": 0, "lon": 0},
        "start": "2015-01-01", "end": "2026-09-01",
    }
    assert client.post("/api/analyze", json=body).status_code == 404
