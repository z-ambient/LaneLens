"""Tests for the database storage layer (SQLite in a temp dir)."""

import hashlib
import json

from sqlalchemy import select

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


def _stored_session_tokens():
    with storage._session() as session:
        return session.execute(select(storage.SessionRow.token)).scalars().all()


def test_session_token_hashed_at_rest():
    """The sessions table must hold sha256(token), never the raw token."""
    token = "raw-session-token-abc"
    storage.user_upsert("42", "TestSummoner", None)
    storage.session_create(token, "42", 2_000_000_000)

    stored = _stored_session_tokens()
    assert token not in stored
    assert hashlib.sha256(token.encode()).hexdigest() in stored

    # The raw token from the cookie still resolves to its user.
    user = storage.session_get_user(token, now=1_000_000_000)
    assert user["id"] == "42"


def test_legacy_plaintext_sessions_purged(tmp_path):
    """Rows written before hashing (raw 43-char tokens) are deleted on
    startup and can no longer authenticate anyone."""
    raw = "legacy-plaintext-token-00000000000000000000"  # 43 chars, pre-hash row shape
    with storage._session() as session:
        session.add(storage.SessionRow(token=raw, user_id="42", expires_at=2_000_000_000))
        session.commit()

    storage.configure("sqlite:///" + str(tmp_path / "test.db"))  # same DB as fixture

    assert _stored_session_tokens() == []
    assert storage.session_get_user(raw, now=1_000_000_000) is None


def test_expired_sessions_purged_at_startup(tmp_path):
    """Expired rows nobody presents again must not sit in the table forever."""
    storage.user_upsert("42", "TestSummoner", None)
    storage.session_create("long-gone", "42", expires_at=1)          # expired
    storage.session_create("still-good", "42", expires_at=2_000_000_000)

    storage.configure("sqlite:///" + str(tmp_path / "test.db"))  # same DB as fixture

    stored = _stored_session_tokens()
    assert hashlib.sha256(b"long-gone").hexdigest() not in stored
    assert hashlib.sha256(b"still-good").hexdigest() in stored


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
