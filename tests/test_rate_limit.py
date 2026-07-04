"""Tests for the spoof-resistant rate-limit key (app.rate_limit.client_ip)
and for the per-route limits on the auth/account endpoints.

A client can prepend fake entries to X-Forwarded-For; each trusted proxy in
front of us appends the address it actually saw. The key must come from the
right (trusted) end so a forged left-hand entry can't mint unlimited keys.
"""

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

import app.rate_limit as rate_limit_module
from app.config import _trusted_proxy_hops
from app.main import app
from app.rate_limit import client_ip, limiter


class _FakeClient:
    def __init__(self, host):
        self.host = host


class _FakeRequest:
    """Minimal stand-in with a real Starlette Headers object.

    ``xff`` may be a string (one X-Forwarded-For header) or a list of strings
    (several separate headers, as a client could send on the wire).
    """

    def __init__(self, xff=None, host="203.0.113.7"):
        raw = []
        if xff is not None:
            values = [xff] if isinstance(xff, str) else xff
            raw = [(b"x-forwarded-for", value.encode()) for value in values]
        self.headers = Headers(raw=raw)
        self.client = _FakeClient(host)


def test_single_proxy_uses_rightmost_entry(monkeypatch):
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 1)
    # Railway appended the real client (1.1.1.1) after the client's own header.
    request = _FakeRequest(xff="9.9.9.9, 1.1.1.1")
    assert client_ip(request) == "1.1.1.1"


def test_spoofed_left_entry_is_ignored(monkeypatch):
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 1)
    # Attacker rotates the leftmost value every request; the key must not move.
    a = client_ip(_FakeRequest(xff="1.2.3.4, 1.1.1.1"))
    b = client_ip(_FakeRequest(xff="5.6.7.8, 1.1.1.1"))
    assert a == b == "1.1.1.1"


def test_no_forwarded_header_falls_back_to_socket(monkeypatch):
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 1)
    assert client_ip(_FakeRequest(xff=None, host="198.51.100.5")) == "198.51.100.5"


def test_header_shorter_than_hops_falls_back_to_socket(monkeypatch):
    # Misconfigured/absent proxy: too few entries to trust -> fail safe to the
    # socket IP (over-limits) rather than trusting a client-controlled value.
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 2)
    assert client_ip(_FakeRequest(xff="1.1.1.1", host="198.51.100.5")) == "198.51.100.5"


def test_two_hops_uses_second_from_right(monkeypatch):
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 2)
    # client, realclient(appended by edge), edgeIP(appended by inner proxy)
    request = _FakeRequest(xff="9.9.9.9, 1.1.1.1, 10.0.0.1")
    assert client_ip(request) == "1.1.1.1"


def test_zero_hops_ignores_forwarded_header(monkeypatch):
    # Direct exposure: never trust X-Forwarded-For at all.
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 0)
    assert client_ip(_FakeRequest(xff="1.2.3.4", host="198.51.100.5")) == "198.51.100.5"


def test_whitespace_and_empty_entries_tolerated(monkeypatch):
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 1)
    assert client_ip(_FakeRequest(xff=" 9.9.9.9 ,  1.1.1.1 ,")) == "1.1.1.1"


def test_multiple_forwarded_headers_flattened_in_order(monkeypatch):
    # A client can split spoofed entries across SEPARATE X-Forwarded-For
    # headers; the proxy's appended real IP is still last overall. .get() would
    # read only the first header and be fooled - we must flatten all of them.
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 1)
    request = _FakeRequest(xff=["1.2.3.4", "6.6.6.6, 9.9.9.9"])
    assert client_ip(request) == "9.9.9.9"


def test_multiple_forwarded_headers_spoof_ignored(monkeypatch):
    # Even rotating BOTH the extra header and the first entry must not move the
    # key, because the trusted rightmost entry is fixed.
    monkeypatch.setattr(rate_limit_module, "TRUSTED_PROXY_HOPS", 1)
    a = client_ip(_FakeRequest(xff=["1.1.1.1", "2.2.2.2", "7.7.7.7"]))
    b = client_ip(_FakeRequest(xff=["8.8.8.8, 9.9.9.9", "7.7.7.7"]))
    assert a == b == "7.7.7.7"


# ---------- TRUSTED_PROXY_HOPS config parsing ----------

def test_hops_defaults_to_one(monkeypatch):
    monkeypatch.delenv("TRUSTED_PROXY_HOPS", raising=False)
    assert _trusted_proxy_hops() == 1


def test_hops_parses_explicit_value(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "2")
    assert _trusted_proxy_hops() == 2
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "0")
    assert _trusted_proxy_hops() == 0


def test_hops_bad_value_defaults_to_one(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "not-a-number")
    assert _trusted_proxy_hops() == 1


def test_hops_negative_clamped_to_zero(monkeypatch):
    monkeypatch.setenv("TRUSTED_PROXY_HOPS", "-3")
    assert _trusted_proxy_hops() == 0


# ---------- Per-route limits on the auth/account endpoints ----------

client = TestClient(app, follow_redirects=False)


@pytest.fixture
def rate_limits_on():
    """The autouse conftest fixture disables limits; these tests need them."""
    limiter.reset()
    limiter.enabled = True
    yield
    limiter.enabled = False


@pytest.mark.parametrize("method, path, per_minute, body", [
    ("GET", "/auth/login", 10, None),
    ("GET", "/auth/callback", 10, None),
    ("POST", "/auth/logout", 10, None),
    ("GET", "/api/me", 30, None),
    # A valid body: requests failing Pydantic validation are rejected before
    # the route (and its limiter) ever runs, so they would never count.
    ("POST", "/api/me/profile", 10, {"gameName": "Me", "tagLine": "NA1"}),
])
def test_auth_routes_rate_limited(rate_limits_on, method, path, per_minute, body):
    """Every auth/account route must 429 once its per-IP budget is spent.
    Status codes within the budget vary (302 redirect, 401, 503...) - the
    only requirement is that none of them is a 429 until the budget runs out."""
    for i in range(per_minute):
        response = client.request(method, path, json=body)
        assert response.status_code != 429, f"limited too early, request {i + 1}"
    assert client.request(method, path, json=body).status_code == 429
