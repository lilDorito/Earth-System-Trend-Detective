# tests run on mock data whatever .env says; tests that need live mode switch it themselves

import pytest

from src.config import settings


@pytest.fixture(autouse=True)
def mock_mode(monkeypatch):
    monkeypatch.setattr(settings, "data_mode", "mock")
