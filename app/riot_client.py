"""Thin client for the Riot Games API.

Only two endpoints are needed for LaneLens:
  1. Account-v1  (regional routing, e.g. americas) - Riot ID -> PUUID
  2. Spectator-v5 (platform routing, e.g. na1)     - PUUID -> live game

The API key is sent only from this backend via the X-Riot-Token header and is
never logged or returned to the browser.
"""

import requests
from requests.utils import quote

from app.config import RIOT_API_KEY


class RiotApiError(Exception):
    """Raised for unexpected Riot API failures (auth, rate limit, 5xx)."""

    def __init__(self, status_code, message):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


class MissingApiKeyError(RiotApiError):
    def __init__(self):
        super().__init__(503, "Riot API key is not configured on the server.")


def _classify_error(status_code):
    if status_code in (401, 403):
        return RiotApiError(502, "Riot API key is invalid or expired.")
    if status_code == 429:
        return RiotApiError(429, "Riot API rate limit exceeded. Try again in a minute.")
    return RiotApiError(502, "Unexpected error from the Riot API.")


class RiotClient:
    def __init__(self, api_key=None, timeout=10):
        self.api_key = api_key if api_key is not None else RIOT_API_KEY
        self.timeout = timeout

    def _get(self, url):
        if not self.api_key:
            raise MissingApiKeyError()

        # Riot API call - authenticated with the backend-only API key.
        try:
            response = requests.get(
                url,
                headers={"X-Riot-Token": self.api_key},
                timeout=self.timeout,
            )
        except requests.exceptions.RequestException:
            raise RiotApiError(502, "Could not reach the Riot API.")

        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise _classify_error(response.status_code)

        return response.json()

    def get_account_by_riot_id(self, game_name, tag_line, region):
        """Account-v1: resolve a Riot ID (name#tag) to an account with a PUUID.

        Uses REGIONAL routing (americas / europe / asia / sea).
        Returns None when the Riot ID does not exist.
        """
        url = (
            "https://{region}.api.riotgames.com"
            "/riot/account/v1/accounts/by-riot-id/{name}/{tag}"
        ).format(
            region=region,
            name=quote(game_name, safe=""),
            tag=quote(tag_line, safe=""),
        )
        return self._get(url)

    def get_match_ids(self, puuid, region, count=20):
        """Match-v5: recent match IDs for a player (REGIONAL routing)."""
        url = (
            "https://{region}.api.riotgames.com"
            "/lol/match/v5/matches/by-puuid/{puuid}/ids?start=0&count={count}"
        ).format(region=region, puuid=quote(puuid, safe=""), count=count)
        return self._get(url) or []

    def get_match(self, match_id, region):
        """Match-v5: full detail for one finished match (REGIONAL routing)."""
        url = (
            "https://{region}.api.riotgames.com/lol/match/v5/matches/{match_id}"
        ).format(region=region, match_id=quote(match_id, safe=""))
        return self._get(url)

    def get_active_game(self, puuid, platform):
        """Spectator-v5: fetch the player's current live game, if any.

        Uses PLATFORM routing (na1 / euw1 / kr / ...).
        Returns None when the player is not in a live game.
        """
        url = (
            "https://{platform}.api.riotgames.com"
            "/lol/spectator/v5/active-games/by-summoner/{puuid}"
        ).format(platform=platform, puuid=quote(puuid, safe=""))
        return self._get(url)
