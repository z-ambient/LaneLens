"""Discord OAuth tests - all Discord HTTP calls mocked (offline)."""

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_module
from app.main import app

client = TestClient(app, follow_redirects=False)


@pytest.fixture(autouse=True)
def discord_credentials(monkeypatch):
    monkeypatch.setattr(auth_module, "DISCORD_CLIENT_ID", "client-id-123")
    monkeypatch.setattr(auth_module, "DISCORD_CLIENT_SECRET", "secret-xyz")


@pytest.fixture
def mock_discord(monkeypatch):
    monkeypatch.setattr(auth_module, "_exchange_code", lambda code, uri: "access-token")
    monkeypatch.setattr(auth_module, "_fetch_user", lambda token: {
        "id": "42", "username": "TestSummoner", "avatar": "abc123",
    })


def _login_session(state="teststate"):
    """Run the full mocked login and return the session cookie value."""
    response = client.get(
        f"/auth/callback?code=thecode&state={state}",
        headers={"Cookie": f"{auth_module.STATE_COOKIE}=teststate"},
    )
    assert response.status_code in (302, 307)
    return response.cookies.get(auth_module.SESSION_COOKIE)


def test_login_redirects_to_discord():
    response = client.get("/auth/login")
    assert response.status_code in (302, 307)
    location = response.headers["location"]
    assert location.startswith("https://discord.com/oauth2/authorize?")
    assert "client_id=client-id-123" in location
    assert "scope=identify" in location
    assert "state=" in location
    assert auth_module.STATE_COOKIE in response.cookies


def test_login_unconfigured(monkeypatch):
    monkeypatch.setattr(auth_module, "DISCORD_CLIENT_ID", None)
    response = client.get("/auth/login")
    assert response.status_code == 503


def test_callback_creates_account_and_session(mock_discord):
    token = _login_session()
    assert token

    me = client.get("/api/me", headers={"Cookie": f"{auth_module.SESSION_COOKIE}={token}"}).json()
    assert me["authenticated"] is True
    assert me["user"]["username"] == "TestSummoner"
    assert me["user"]["riotProfile"] is None


def test_callback_rejects_state_mismatch(mock_discord):
    response = client.get(
        "/auth/callback?code=thecode&state=WRONG",
        headers={"Cookie": f"{auth_module.STATE_COOKIE}=teststate"},
    )
    assert response.status_code in (302, 307)
    assert "login=failed" in response.headers["location"]
    assert not response.cookies.get(auth_module.SESSION_COOKIE)


def test_me_unauthenticated():
    me = client.get("/api/me").json()
    assert me["authenticated"] is False
    assert me["configured"] is True


def test_profile_requires_auth():
    response = client.post("/api/me/profile", json={"gameName": "Me", "tagLine": "NA1"})
    assert response.status_code == 401


def test_profile_roundtrip(mock_discord):
    token = _login_session()
    saved = client.post(
        "/api/me/profile",
        json={"gameName": "Me", "tagLine": "#NA1", "platform": "NA1"},
        headers={"Cookie": f"{auth_module.SESSION_COOKIE}={token}"},
    ).json()
    assert saved["ok"] is True

    me = client.get("/api/me", headers={"Cookie": f"{auth_module.SESSION_COOKIE}={token}"}).json()
    assert me["user"]["riotProfile"] == {
        "gameName": "Me", "tagLine": "NA1", "platform": "na1",
    }


def test_logout_ends_session(mock_discord):
    token = _login_session()
    client.post("/auth/logout", headers={"Cookie": f"{auth_module.SESSION_COOKIE}={token}"})
    me = client.get("/api/me", headers={"Cookie": f"{auth_module.SESSION_COOKIE}={token}"}).json()
    assert me["authenticated"] is False


def test_expired_session_rejected(mock_discord, monkeypatch):
    token = _login_session()
    import time as time_module
    future = time_module.time() + auth_module.SESSION_TTL_SECONDS + 60
    monkeypatch.setattr(auth_module.time, "time", lambda: future)
    me = client.get("/api/me", headers={"Cookie": f"{auth_module.SESSION_COOKIE}={token}"}).json()
    assert me["authenticated"] is False