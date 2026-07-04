"""Tests for personal matchup history (Match-v5 mocked, offline)."""

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app import storage
from app.main import app
from app.matchup_history import get_matchup_record, update_history

client = TestClient(app)

# The endpoint only accepts real-shaped PUUIDs: exactly 78 URL-safe chars.
VALID_PUUID = "x" * 78


def _match(match_id, my_champ, enemy_champ, win, queue=420, duration=1800, position="TOP"):
    return {
        "metadata": {"matchId": match_id},
        "info": {
            "queueId": queue,
            "gameDuration": duration,
            "gameEndTimestamp": 1700000000000,
            "participants": [
                {"puuid": "me", "teamId": 100, "teamPosition": position,
                 "championName": my_champ, "win": win},
                {"puuid": "e1", "teamId": 200, "teamPosition": position,
                 "championName": enemy_champ, "win": not win},
                {"puuid": "e2", "teamId": 200, "teamPosition": "JUNGLE",
                 "championName": "LeeSin", "win": not win},
            ],
        },
    }


class FakeClient:
    def __init__(self, matches):
        self.matches = matches
        self.detail_calls = 0

    def get_match_ids(self, puuid, region, count=30):
        return list(self.matches.keys())

    def get_match(self, match_id, region):
        self.detail_calls += 1
        return self.matches[match_id]


def test_record_counts_same_position_enemy_only():
    fake = FakeClient({
        "m1": _match("m1", "Malphite", "Sett", True),
        "m2": _match("m2", "Malphite", "Sett", False),
        "m3": _match("m3", "Malphite", "Darius", True),
        "m4": _match("m4", "Garen", "Sett", True),          # different champ
        "m5": _match("m5", "Malphite", "Sett", True, queue=450),  # ARAM - skipped
        "m6": _match("m6", "Malphite", "Sett", True, duration=200),  # remake
    })
    record = get_matchup_record(fake, "me", "americas", "Malphite", "Sett")
    assert record == {"games": 2, "wins": 1, "losses": 1, "recent": ["loss", "win"]}


def test_champion_name_normalization():
    """Display names (Kai'Sa, Dr. Mundo) must match Match-v5 names (KaiSa, DrMundo)."""
    fake = FakeClient({"m1": _match("m1", "DrMundo", "KaiSa", True)})
    record = get_matchup_record(fake, "me", "americas", "Dr. Mundo", "Kai'Sa")
    assert record["games"] == 1 and record["wins"] == 1


def test_processed_matches_not_refetched():
    fake = FakeClient({"m1": _match("m1", "Malphite", "Sett", True)})
    get_matchup_record(fake, "me", "americas", "Malphite", "Sett")
    assert fake.detail_calls == 1
    # Second lookup: id already processed, no new detail calls.
    record = get_matchup_record(fake, "me", "americas", "Malphite", "Sett")
    assert fake.detail_calls == 1
    assert record["games"] == 1


def test_no_games_returns_zero_record():
    record = get_matchup_record(FakeClient({}), "me", "americas", "Malphite", "Sett")
    assert record == {"games": 0, "wins": 0, "losses": 0, "recent": []}


def test_recent_capped_at_five_newest_first():
    matches = {
        f"m{i}": _match(f"m{i}", "Malphite", "Sett", win=(i % 2 == 0))
        for i in range(7)
    }
    # Distinct timestamps so ordering is meaningful (m6 newest).
    for i in range(7):
        matches[f"m{i}"]["info"]["gameEndTimestamp"] = 1700000000000 + i
    fake = FakeClient(matches)
    record = get_matchup_record(fake, "me", "americas", "Malphite", "Sett")
    assert record["games"] == 7
    assert len(record["recent"]) == 5
    # m6 (win) newest first, then m5 (loss), m4 (win), m3 (loss), m2 (win)
    assert record["recent"] == ["win", "loss", "win", "loss", "win"]


def test_history_endpoint(monkeypatch):
    match = _match("m1", "Malphite", "Sett", True)
    match["info"]["participants"][0]["puuid"] = VALID_PUUID
    fake = FakeClient({"m1": match})
    monkeypatch.setattr(main_module, "RiotClient", lambda: fake)
    monkeypatch.setattr(main_module, "riot_key_present", lambda: True)

    response = client.post("/api/matchup-history", json={
        "puuid": VALID_PUUID, "platform": "na1",
        "myChampion": "Malphite", "enemyChampion": "Sett",
    })
    data = response.json()
    assert data["ok"] is True
    assert data["record"]["games"] == 1
    assert data["record"]["wins"] == 1


@pytest.mark.parametrize("puuid", [
    "me",                     # far too short
    "x" * 77,                 # one char short
    "x" * 79,                 # one char long
    "x" * 77 + "!",           # right length, bad charset
    "../" + "x" * 75,         # path characters must never reach the Riot URL
])
def test_history_endpoint_rejects_malformed_puuid(puuid, monkeypatch):
    monkeypatch.setattr(main_module, "riot_key_present", lambda: True)
    response = client.post("/api/matchup-history", json={
        "puuid": puuid, "platform": "na1",
        "myChampion": "Malphite", "enemyChampion": "Sett",
    })
    assert response.status_code == 400


def test_unknown_puuid_creates_no_database_row():
    """Riot returning zero matches for a never-seen player must not write:
    this route is unauthenticated, so junk PUUIDs must not grow the table."""
    update_history(FakeClient({}), "never-seen", "americas")
    assert storage.history_get("never-seen") is None


def test_known_player_row_still_written_and_updated():
    fake = FakeClient({"m1": _match("m1", "Malphite", "Sett", True)})
    update_history(fake, "me", "americas")
    assert storage.history_get("me")["processed"] == ["m1"]

    # A later fetch with no new games still updates the existing row.
    update_history(FakeClient({}), "me", "americas")
    assert storage.history_get("me")["processed"] == ["m1"]
