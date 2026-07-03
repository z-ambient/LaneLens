"""Tests for progressive AI enhancement and the persistent matchup cache."""

import pytest
from fastapi.testclient import TestClient

import app.advice_cache as advice_cache
import app.main as main_module
from app.main import app

client = TestClient(app)

BASE_ADVICE = {
    "startingItem": "Doran's Shield",
    "boots": "Plated Steelcaps",
    "firstItem": "Sunfire Aegis",
    "fullBuild": [{"label": "Starting", "item": "Doran's Shield", "options": []}],
    "buildDirection": "Armor first.",
    "lanePlan": "Play safe.",
    "tradingPattern": "Short trades.",
    "dangerWindows": "Level 6.",
    "howToWinLane": "Farm.",
    "commonMistakes": "Overextending.",
    "gameDirection": "Group.",
    "teamfightPlan": "Engage.",
    "extraTips": ["Ward river."],
    "extras": {"winCondition": "Engage well.", "resistPriority": "Armor"},
}

REQUEST = {
    "myChampion": "Malphite",
    "enemyChampion": "Sett",
    "lane": "Top",
    "myTeam": ["Malphite", "Vi"],
    "enemyTeam": ["Sett", "Lee Sin"],
    "queue": "Ranked Solo/Duo",
    "advice": BASE_ADVICE,
}


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(advice_cache, "_CACHE_PATH", str(tmp_path / "cache.json"))
    monkeypatch.setattr(main_module.champions, "get_ddragon_version", lambda: "99.1.1")


def _fake_ai(calls):
    def fake(context, base):
        calls.append(context)
        improved = dict(base)
        improved["lanePlan"] = "AI-improved lane plan."
        improved["gameDirection"] = "AI game direction for THIS comp."
        return improved
    return fake


def test_enhance_calls_ai_then_serves_from_cache(monkeypatch):
    calls = []
    monkeypatch.setattr(main_module, "refine_advice_with_ai", _fake_ai(calls))

    first = client.post("/api/enhance-advice", json=REQUEST).json()
    assert first["ok"] and first["aiEnhanced"] and first["cached"] is False
    assert first["advice"]["lanePlan"] == "AI-improved lane plan."
    assert len(calls) == 1

    # Same matchup again: served from cache, no second AI call.
    second = client.post("/api/enhance-advice", json=REQUEST).json()
    assert second["aiEnhanced"] and second["cached"] is True
    assert second["advice"]["lanePlan"] == "AI-improved lane plan."
    assert len(calls) == 1

    # Team-dependent fields come from the FRESH request, not the cache.
    assert second["advice"]["gameDirection"] == "Group."
    assert second["advice"]["extras"] == BASE_ADVICE["extras"]


def test_cache_invalidated_on_new_patch(monkeypatch):
    calls = []
    monkeypatch.setattr(main_module, "refine_advice_with_ai", _fake_ai(calls))

    client.post("/api/enhance-advice", json=REQUEST)
    monkeypatch.setattr(main_module.champions, "get_ddragon_version", lambda: "99.2.1")
    result = client.post("/api/enhance-advice", json=REQUEST).json()
    assert result["cached"] is False
    assert len(calls) == 2


def test_ai_failure_returns_deterministic_advice(monkeypatch):
    monkeypatch.setattr(main_module, "refine_advice_with_ai", lambda c, b: None)
    result = client.post("/api/enhance-advice", json=REQUEST).json()
    assert result["ok"] is True
    assert result["aiEnhanced"] is False
    assert result["advice"] == BASE_ADVICE


def test_no_enemy_skips_ai(monkeypatch):
    called = []
    monkeypatch.setattr(main_module, "refine_advice_with_ai", _fake_ai(called))
    body = dict(REQUEST, enemyChampion=None)
    result = client.post("/api/enhance-advice", json=body).json()
    assert result["aiEnhanced"] is False
    assert called == []
