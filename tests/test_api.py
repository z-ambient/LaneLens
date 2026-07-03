"""API tests with the Riot API mocked out (no network, no key needed)."""

import pytest
from fastapi.testclient import TestClient

import app.main as main_module
from app.main import app
from app.riot_client import RiotApiError

client = TestClient(app)

# Champion IDs: Malphite 54, Sett 875, LeeSin 64, Ahri 103, Kaisa 145,
# Leona 89, Vi 254, Orianna 61, Jinx 222, Thresh 412.
BLUE = [
    {"puuid": "me", "teamId": 100, "championId": 54, "spell1Id": 4, "spell2Id": 12, "riotId": "Me#NA1"},
    {"puuid": "b2", "teamId": 100, "championId": 254, "spell1Id": 11, "spell2Id": 4, "riotId": "B2#NA1"},
    {"puuid": "b3", "teamId": 100, "championId": 61, "spell1Id": 4, "spell2Id": 14, "riotId": "B3#NA1"},
    {"puuid": "b4", "teamId": 100, "championId": 222, "spell1Id": 4, "spell2Id": 7, "riotId": "B4#NA1"},
    {"puuid": "b5", "teamId": 100, "championId": 412, "spell1Id": 4, "spell2Id": 3, "riotId": "B5#NA1"},
]
RED = [
    {"puuid": "r1", "teamId": 200, "championId": 875, "spell1Id": 4, "spell2Id": 12, "riotId": "R1#NA1"},
    {"puuid": "r2", "teamId": 200, "championId": 64, "spell1Id": 11, "spell2Id": 4, "riotId": "R2#NA1"},
    {"puuid": "r3", "teamId": 200, "championId": 103, "spell1Id": 4, "spell2Id": 14, "riotId": "R3#NA1"},
    {"puuid": "r4", "teamId": 200, "championId": 145, "spell1Id": 4, "spell2Id": 7, "riotId": "R4#NA1"},
    {"puuid": "r5", "teamId": 200, "championId": 89, "spell1Id": 4, "spell2Id": 14, "riotId": "R5#NA1"},
]

LIVE_GAME = {
    "gameMode": "CLASSIC",
    "gameQueueConfigId": 420,
    "gameStartTime": 1700000000000,
    "participants": BLUE + RED,
}


class FakeRiotClient:
    def __init__(self, account="default", game="default", error=None):
        self.account = {"puuid": "me", "gameName": "Me", "tagLine": "NA1"} if account == "default" else account
        self.game = LIVE_GAME if game == "default" else game
        self.error = error

    def get_account_by_riot_id(self, game_name, tag_line, region):
        if self.error:
            raise self.error
        return self.account

    def get_active_game(self, puuid, platform):
        return self.game


@pytest.fixture
def riot(monkeypatch):
    """Patch RiotClient and pretend a key is configured."""
    def _install(**kwargs):
        fake = FakeRiotClient(**kwargs)
        monkeypatch.setattr(main_module, "RiotClient", lambda: fake)
        monkeypatch.setattr(main_module, "riot_key_present", lambda: True)
        return fake
    return _install


BODY = {"gameName": "Me", "tagLine": "NA1", "platform": "na1"}


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_demo_matchup_shape():
    data = client.get("/api/demo-matchup").json()
    assert data["ok"] is True
    assert data["source"] == "demo"
    assert data["player"]["champion"] == "Malphite"
    assert data["matchup"]["enemyChampion"] == "Sett"
    assert len(data["teams"]["blue"]) == 5
    for field in ("startingItem", "boots", "lanePlan", "extraTips", "extras"):
        assert field in data["advice"]


def test_missing_game_name():
    response = client.post("/api/analyze-matchup", json={"gameName": " ", "tagLine": "NA1"})
    assert response.status_code == 400
    assert response.json()["ok"] is False


def test_missing_tag_line():
    response = client.post("/api/analyze-matchup", json={"gameName": "Me", "tagLine": ""})
    assert response.status_code == 400


def test_missing_api_key(monkeypatch):
    monkeypatch.setattr(main_module, "riot_key_present", lambda: False)
    response = client.post("/api/analyze-matchup", json=BODY)
    assert response.status_code == 503
    assert "RIOT_API_KEY" in response.json()["error"]


def test_account_not_found(riot):
    riot(account=None)
    response = client.post("/api/analyze-matchup", json=BODY)
    assert response.status_code == 404
    assert "not found" in response.json()["error"].lower()


def test_no_live_game(riot):
    riot(game=None)
    response = client.post("/api/analyze-matchup", json=BODY)
    assert response.status_code == 404
    assert response.json()["error"] == "No live League of Legends game found for this player."


def test_rate_limit(riot):
    riot(error=RiotApiError(429, "Riot API rate limit exceeded. Try again in a minute."))
    response = client.post("/api/analyze-matchup", json=BODY)
    assert response.status_code == 429


def test_live_game_full_flow(riot):
    riot()
    response = client.post("/api/analyze-matchup", json=BODY)
    assert response.status_code == 200
    data = response.json()

    assert data["ok"] is True
    assert data["source"] == "riot-api"
    assert data["player"]["champion"] == "Malphite"

    # Malphite top vs Sett top should be inferred as the lane matchup,
    # and the curated Malphite-vs-Sett advice should be used.
    assert data["matchup"]["enemyChampion"] == "Sett"
    assert data["matchup"]["lane"] == "Top"
    assert data["matchup"]["confidence"] == "inferred"
    assert data["matchup"]["difficulty"] == "Medium"
    assert data["advice"]["startingItem"] == "Doran's Shield"

    # Smite carriers must be assigned Jungle.
    blue = {m["championName"]: m for m in data["teams"]["blue"]}
    red = {m["championName"]: m for m in data["teams"]["red"]}
    assert blue["Vi"]["lane"] == "Jungle"
    assert red["Lee Sin"]["lane"] == "Jungle"
    assert blue["Malphite"]["isPlayer"] is True
    assert red["Sett"]["isOpponent"] is True

    assert data["teamNotes"]
    assert data["advice"]["extras"]["resistPriority"]


def test_manual_override(riot):
    riot()
    body = dict(BODY, manualEnemyChampion="Ahri", manualLane="Mid")
    data = client.post("/api/analyze-matchup", json=body).json()
    assert data["matchup"]["enemyChampion"] == "Ahri"
    assert data["matchup"]["lane"] == "Mid"
    assert data["matchup"]["confidence"] == "manual"


def test_manual_override_wrong_champion(riot):
    riot()
    body = dict(BODY, manualEnemyChampion="Teemo")
    response = client.post("/api/analyze-matchup", json=body)
    assert response.status_code == 400
    assert "enemy team" in response.json()["error"]
