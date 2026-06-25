import pytest
import requests

from app.riot_client import RiotClient

class FakeResponse:
    def __init__(self, status_code, data=None):
        self.status_code = status_code
        self.data = data
    
    def json(self):
        return self.data
    
    def raise_for_status(self):
        if self.status_code >= 400:
            error = requests.exceptions.HTTPError(
                f"{self.status_code} Riot API error"
            )
            error.response = self
            raise error

def test_get_account_by_riot_id(monkeypatch):
    client = RiotClient()

    def fake_get(url, headers, timeout):
        assert url == (
            "https://americas.api.riotgames.com"
            "/riot/account/v1/accounts/by-riot-id/ambient/zee"
        )
        assert headers == client.headers
        assert timeout == 10

        return FakeResponse(
            200,
            {
                "puuid": "player-123",
                "gameName": "ambient",
                "tagLine": "zee",
            },
        )
    
    monkeypatch.setattr(
        "app.riot_client.requests.get",
        fake_get,
    )

    result = client.get_account_by_riot_id(
        "ambient",
        "zee",
        "americas",
    )

    assert result["puuid"] == "player-123"

def test_get_account_by_riot_id_none_found(monkeypatch):
    client = RiotClient()

    def fake_get(url, headers, timeout):
        return FakeResponse(404)
    
    monkeypatch.setattr(
        "app.riot_client.requests.get",
        fake_get,
    )

    result = client.get_account_by_riot_id(
        "ambient",
        "zee",
        "americas",
    )

    assert result is None

def test_get_current_game_by_puuid(monkeypatch):
    client = RiotClient()

    def fake_get(url, headers, timeout):
        assert url == (
            "https://na1.api.riotgames.com"
            "/lol/spectator/v5/active-games/by-summoner/player-123"
        )

        return FakeResponse(
            200,
            {"gameId": 12345, "participants": []},
        )

    monkeypatch.setattr(
        "app.riot_client.requests.get",
        fake_get,
    )

    result = client.get_current_game_by_puuid(
        "player-123",
        "na1",
    )

    assert result["gameId"] == 12345

def test_get_current_game_by_puuid_none(monkeypatch):
    client = RiotClient()

    def fake_get(url, headers, timeout):
        return FakeResponse(404)
    
    monkeypatch.setattr(
        "app.riot_client.requests.get",
        fake_get,
    )

    result = client.get_current_game_by_puuid(
        "player-123",
        "na1",
    )

    assert result is None

def test_riotclient_raise_for_status(monkeypatch):
    client = RiotClient()

    def fake_get(url, headers, timeout):
        return FakeResponse(429)
    
    monkeypatch.setattr(
        "app.riot_client.requests.get",
        fake_get,
    )

    with pytest.raises(requests.exceptions.HTTPError):
        client.get_account_by_riot_id(
            "ambient",
            "zee",
            "americas"
        )