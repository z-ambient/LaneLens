"""Unit tests for rune extraction, including partial Spectator data (offline)."""

import pytest

import app.runes as runes_module
from app.runes import extract_runes


@pytest.fixture(autouse=True)
def seeded_rune_cache(monkeypatch):
    """Seed the Data Dragon cache so tests never touch the network."""
    monkeypatch.setitem(runes_module._cache, "styles", {
        8400: {"name": "Resolve", "icon": "styles/resolve.png"},
        8300: {"name": "Inspiration", "icon": "styles/inspiration.png"},
    })
    monkeypatch.setitem(runes_module._cache, "runes", {
        8437: {"name": "Grasp of the Undying", "icon": "r/grasp.png", "desc": "Grasp."},
        8446: {"name": "Demolish", "icon": "r/demolish.png", "desc": "Towers."},
        8444: {"name": "Second Wind", "icon": "r/wind.png", "desc": "Heal."},
        8451: {"name": "Overgrowth", "icon": "r/growth.png", "desc": "Health."},
        8345: {"name": "Biscuit Delivery", "icon": "r/biscuit.png", "desc": "Biscuits."},
        8347: {"name": "Cosmic Insight", "icon": "r/cosmic.png", "desc": "Haste."},
    })


FULL_PERKS = {
    "perkIds": [8437, 8446, 8444, 8451, 8345, 8347, 5008, 5002, 5001],
    "perkStyle": 8400,
    "perkSubStyle": 8300,
}


def test_full_rune_page():
    result = extract_runes(FULL_PERKS)
    assert result["keystone"]["name"] == "Grasp of the Undying"
    assert [r["name"] for r in result["runes"]] == [
        "Demolish", "Second Wind", "Overgrowth", "Biscuit Delivery", "Cosmic Insight",
    ]
    assert len(result["shards"]) == 3
    assert result["shards"][0]["desc"] == "+9 Adaptive Force"
    assert result["primaryStyle"]["name"] == "Resolve"
    assert result["partial"] is False


def test_partial_keystone_only():
    """Spectator-v5 sometimes shares only part of the rune page."""
    result = extract_runes({"perkIds": [8437], "perkStyle": 8400, "perkSubStyle": 8300})
    assert result["keystone"]["name"] == "Grasp of the Undying"
    assert result["runes"] == []
    assert result["partial"] is True
    assert result["subStyle"]["name"] == "Inspiration"


def test_unknown_perk_ids_are_skipped():
    result = extract_runes({"perkIds": [8437, 99999, 5008], "perkStyle": 8400, "perkSubStyle": 8300})
    assert result["keystone"]["name"] == "Grasp of the Undying"
    assert result["runes"] == []
    assert [s["name"] for s in result["shards"]] == ["Adaptive Force"]
    assert result["partial"] is True


def test_no_perks_returns_none():
    assert extract_runes(None) is None
    assert extract_runes({"perkIds": []}) is None
