"""Tests for the database storage layer (SQLite in a temp dir)."""

import json

from app import storage


def test_advice_cache_roundtrip_and_upsert():
    assert storage.cache_get("malphite|sett|top") is None

    storage.cache_set("malphite|sett|top", "16.13.1", {"lanePlan": "v1"})
    patch, advice = storage.cache_get("malphite|sett|top")
    assert patch == "16.13.1"
    assert advice == {"lanePlan": "v1"}

    # Upsert: same key overwrites.
    storage.cache_set("malphite|sett|top", "16.14.1", {"lanePlan": "v2"})
    patch, advice = storage.cache_get("malphite|sett|top")
    assert patch == "16.14.1"
    assert advice["lanePlan"] == "v2"


def test_history_roundtrip():
    assert storage.history_get("puuid-1") is None
    entry = {"processed": ["m1"], "games": [{"myChampion": "Malphite", "win": True}]}
    storage.history_set("puuid-1", entry)
    assert storage.history_get("puuid-1") == entry


def test_legacy_json_import(tmp_path, monkeypatch):
    """First run against an empty DB imports the old JSON stores."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    (data_dir / "advice_cache.json").write_text(json.dumps({
        "garen|darius|top": {"patch": "16.13.1", "advice": {"lanePlan": "legacy"}},
    }))
    (data_dir / "matchup_history.json").write_text(json.dumps({
        "old-puuid": {"processed": ["m9"], "games": []},
    }))
    monkeypatch.setattr(storage, "_DATA_DIR", str(data_dir))

    storage.configure("sqlite:///" + str(tmp_path / "fresh.db"))
    storage._import_legacy_json()

    assert storage.cache_get("garen|darius|top") == ("16.13.1", {"lanePlan": "legacy"})
    assert storage.history_get("old-puuid") == {"processed": ["m9"], "games": []}
