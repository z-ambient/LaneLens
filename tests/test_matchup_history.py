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


def _stats(kills, deaths, assists, cs, gold, damage):
    return {
        "kills": kills, "deaths": deaths, "assists": assists,
        "totalMinionsKilled": cs - 8, "neutralMinionsKilled": 8,
        "goldEarned": gold, "totalDamageDealtToChampions": damage,
    }


def _match(match_id, my_champ, enemy_champ, win, queue=420, duration=1800, position="TOP"):
    return {
        "metadata": {"matchId": match_id},
        "info": {
            "queueId": queue,
            "gameDuration": duration,
            "gameEndTimestamp": 1700000000000,
            "participants": [
                {"puuid": "me", "teamId": 100, "teamPosition": position,
                 "championName": my_champ, "win": win,
                 **_stats(8, 2, 6, 220, 13000, 25000)},
                {"puuid": "m2", "teamId": 100, "teamPosition": "JUNGLE",
                 "championName": "Sejuani", "win": win,
                 **_stats(3, 4, 11, 160, 10000, 12000)},
                {"puuid": "e1", "teamId": 200, "teamPosition": position,
                 "championName": enemy_champ, "win": not win,
                 **_stats(2, 5, 3, 170, 10000, 16000)},
                {"puuid": "e2", "teamId": 200, "teamPosition": "JUNGLE",
                 "championName": "LeeSin", "win": not win,
                 **_stats(4, 3, 5, 150, 9500, 11000)},
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


# ---------- Stat capture + the signed-in history tab endpoint ----------


def test_stored_game_captures_lane_score_stats():
    update_history(FakeClient({"m1": _match("m1", "Malphite", "Sett", True)}), "me", "americas")
    game = storage.history_get("me")["games"][0]
    assert game["kills"] == 8 and game["deaths"] == 2 and game["assists"] == 6
    assert game["cs"] == 220 and game["gold"] == 13000 and game["damage"] == 25000
    assert game["enemyKills"] == 2 and game["enemyCs"] == 170
    assert game["enemyGold"] == 10000 and game["enemyDamage"] == 16000
    assert game["teamKills"] == 11  # me (8) + my jungler (3)
    assert game["duration"] == 1800


class FakeAccountClient(FakeClient):
    def __init__(self, matches, puuid=VALID_PUUID):
        super().__init__(matches)
        self.puuid = puuid

    def get_account_by_riot_id(self, game_name, tag_line, region):
        return {"puuid": self.puuid, "gameName": game_name, "tagLine": tag_line}


def _signed_in_headers(with_profile=True):
    """A real session row (hashed at rest) + user, no Discord mocking needed."""
    import time

    storage.user_upsert("42", "TestSummoner", None)
    if with_profile:
        storage.user_set_riot_profile("42", "Me", "NA1", "na1")
    storage.session_create("test-token", "42", int(time.time()) + 3600)
    return {"Cookie": "lanelens_session=test-token"}


def test_my_history_requires_login():
    assert client.get("/api/my/matchup-history").status_code == 401


def test_my_history_without_saved_profile():
    data = client.get("/api/my/matchup-history",
                      headers=_signed_in_headers(with_profile=False)).json()
    assert data["ok"] is True
    assert data["needsProfile"] is True
    assert data["games"] == []


def test_my_history_returns_scored_games(monkeypatch):
    match = _match("m1", "Malphite", "Sett", True)
    match["info"]["participants"][0]["puuid"] = VALID_PUUID
    monkeypatch.setattr(main_module, "RiotClient", lambda: FakeAccountClient({"m1": match}))
    monkeypatch.setattr(main_module, "riot_key_present", lambda: True)

    data = client.get("/api/my/matchup-history", headers=_signed_in_headers()).json()
    assert data["ok"] is True and data["refreshed"] is True
    assert data["profile"]["gameName"] == "Me"
    game = data["games"][0]
    assert game["myChampion"] == "Malphite" and game["enemyChampion"] == "Sett"
    assert isinstance(game["laneScore"], int)
    assert game["laneGrade"] in ("S+", "S", "A", "B", "C", "D", "F")
    assert game["gradeLabel"]


def test_my_history_serves_stored_games_when_riot_fails(monkeypatch):
    # First call stores a game normally...
    match = _match("m1", "Malphite", "Sett", True)
    match["info"]["participants"][0]["puuid"] = VALID_PUUID
    update_history(FakeAccountClient({"m1": match}), VALID_PUUID, "americas")

    # ...then Riot starts failing mid-refresh: stored games still come back.
    class BrokenClient(FakeAccountClient):
        def get_match_ids(self, puuid, region, count=30):
            raise RuntimeError("riot down")

    monkeypatch.setattr(main_module, "RiotClient", lambda: BrokenClient({}))
    monkeypatch.setattr(main_module, "riot_key_present", lambda: True)

    data = client.get("/api/my/matchup-history", headers=_signed_in_headers()).json()
    assert data["ok"] is True
    assert data["refreshed"] is False
    assert len(data["games"]) == 1
