"""Shared test fixtures: isolated database per test, rate limiting off."""

import pytest

from app import storage
from app.rate_limit import limiter


@pytest.fixture(autouse=True)
def isolated_database(tmp_path):
    """Each test gets a fresh SQLite database (no legacy-JSON import)."""
    storage.configure("sqlite:///" + str(tmp_path / "test.db"))
    yield


@pytest.fixture(autouse=True)
def no_rate_limits():
    limiter.enabled = False
    yield
    limiter.enabled = True
