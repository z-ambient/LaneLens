import requests
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def test_read_root():
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {
        "message": "Welcome to LaneLens"
    }

def test_get_existing_matchup():
    response = client.get(
        "/matchup",
        params={
            "my_champion": "Malphite",
            "enemy_champion": "Sett"
        },
    )

    data = response.json()

    assert response.status_code == 200
    assert data["found"] is True
    assert data["my_champion"] == "Malphite"

def test_get_existing_matchup_missing():
    response = client.get(
        "/matchup",
        params={
            "my_champion": "Malphite",
            "enemy_champion": "Zebastian"
        },
    )

    data = response.json()

    assert response.status_code == 200
    assert response.json()["found"] is False

def test_live_game_not_in_game(monkeypatch):
    def fake_account(self, game_name, tag_line, routing):
        return {"puuid": "player-123"}
    
    def fake_current_game(self, puuid, region):
        return None
    
    monkeypatch.setattr(
        "app.main.RiotClient.get_account_by_riot_id",
        fake_account,
    )

    monkeypatch.setattr(
        "app.main.RiotClient.get_current_game_by_puuid",
        fake_current_game,
    )

    response = client.get(
        "/live-game",
        params={
            "game_name": "ambient",
            "tag_line": "zee",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "account_found": True,
        "in_game": False,
    }

def test_live_game_invalid_api_key(monkeypatch):
    def fake_account(self, game_name, tag_line, routing):
        response = requests.Response()
        response.status_code = 401

        raise requests.exceptions.HTTPError(response=response)
    
    monkeypatch.setattr(
        "app.main.RiotClient.get_account_by_riot_id",
        fake_account,
    )

    response = client.get(
        "/live-game",
        params={
            "game_name": "ambient",
            "tag_line": "zee",
        },
    )

    assert response.status_code == 401
    assert response.json() == {
        "detail": "Riot API key is invalid or expired"
    }

def test_live_game_requires_game_name():
    response = client.get(
        "/live-game",
        params={"tag_line": "zee"}
    )

    assert response.status_code == 422

def test_live_game_unexptected_riot_error(monkeypatch):
    def fake_account(self, game_name, tag_line, routing):
        response = requests.Response()
        response.status_code = 500
        raise requests.exceptions.HTTPError(response=response)

    monkeypatch.setattr(
        "app.main.RiotClient.get_account_by_riot_id",
        fake_account,
    )

    response = client.get(
        "/live-game",
        params={"game_name": "ambient", "tag_line": "zee"},
    )

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Unexpected error from Riot API"
    }

def test_live_game_rate_limit(monkeypatch):
    def fake_account(self, game_name, tag_line, routing):
        response = requests.Response()
        response.status_code = 429
        raise requests.exceptions.HTTPError(response=response)
    
    monkeypatch.setattr(
        "app.main.RiotClient.get_account_by_riot_id",
        fake_account,
    )

    response = client.get(
        "/live-game",
        params={"game_name": "ambient", "tag_line": "zee"},
    )
    
    assert response.status_code == 429
    assert response.json() == {
        "detail": "Riot API rate limit exceeded. Try again later."
    }