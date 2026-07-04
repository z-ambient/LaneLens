"""Request-model validation and body-size limits (H3).

Oversized or malformed requests must be rejected cheaply - before any handler
parses them or forwards them to a paid LLM call - and in the app's {ok, error}
shape rather than Pydantic's default 422 body (which echoes the input back).
"""

import app.main as main_module
from fastapi.testclient import TestClient

from app.main import MAX_BODY_BYTES, app

client = TestClient(app)

VALID_ENHANCE = {
    "myChampion": "Malphite",
    "enemyChampion": "Sett",
    "lane": "Top",
    "advice": {"lanePlan": "Play safe."},
}


def _fail_if_ai_called(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("AI was called on a request that should be rejected")

    monkeypatch.setattr(main_module, "refine_section", boom)
    monkeypatch.setattr(main_module, "refine_advice_with_ai", boom)


def test_valid_enhance_still_accepted(monkeypatch):
    monkeypatch.setattr(main_module, "refine_section", lambda c, b, s: {"lanePlan": "ok"})
    monkeypatch.setattr(main_module.champions, "get_ddragon_version", lambda: "99.9.9")
    result = client.post("/api/enhance-advice", json=dict(VALID_ENHANCE, section="lane"))
    assert result.status_code == 200


def test_overlong_champion_rejected(monkeypatch):
    _fail_if_ai_called(monkeypatch)
    body = dict(VALID_ENHANCE, myChampion="X" * 41, section="lane")
    response = client.post("/api/enhance-advice", json=body)
    assert response.status_code == 400
    assert response.json() == {"ok": False, "error": "Invalid request."}


def test_oversized_team_list_rejected(monkeypatch):
    _fail_if_ai_called(monkeypatch)
    body = dict(VALID_ENHANCE, myTeam=["Malphite"] * 11, section="gameplan")
    assert client.post("/api/enhance-advice", json=body).status_code == 400


def test_overlong_team_member_rejected(monkeypatch):
    _fail_if_ai_called(monkeypatch)
    body = dict(VALID_ENHANCE, enemyTeam=["Y" * 41], section="gameplan")
    assert client.post("/api/enhance-advice", json=body).status_code == 400


def test_missing_required_advice_rejected():
    body = {"myChampion": "Malphite", "enemyChampion": "Sett", "section": "lane"}
    assert client.post("/api/enhance-advice", json=body).status_code == 400


def test_overlong_puuid_rejected():
    body = {"puuid": "p" * 129, "myChampion": "Malphite", "enemyChampion": "Sett"}
    assert client.post("/api/matchup-history", json=body).status_code == 400


def test_overlong_profile_fields_rejected():
    body = {"gameName": "g" * 41, "tagLine": "NA1"}
    assert client.post("/api/me/profile", json=body).status_code == 400


def test_body_over_limit_rejected_with_413(monkeypatch):
    _fail_if_ai_called(monkeypatch)
    # A valid-shaped request whose advice blob pushes the body past the cap.
    body = dict(VALID_ENHANCE, advice={"blob": "z" * (MAX_BODY_BYTES + 100)}, section="lane")
    response = client.post("/api/enhance-advice", json=body)
    assert response.status_code == 413
    assert response.json()["ok"] is False


def test_bad_content_length_rejected(monkeypatch):
    # An OTHERWISE-valid body: a 400 here can only come from the body-size
    # middleware's unparseable-Content-Length branch, not from field validation.
    _fail_if_ai_called(monkeypatch)
    import json

    response = client.post(
        "/api/enhance-advice",
        content=json.dumps(VALID_ENHANCE).encode(),
        headers={"Content-Type": "application/json", "Content-Length": "not-a-number"},
    )
    assert response.status_code == 400
    assert response.json() == {"ok": False, "error": "Invalid request."}
