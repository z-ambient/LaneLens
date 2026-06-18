import requests

from app.config import RIOT_API_KEY


class RiotClient:
    def __init__(self):
        self.headers = {
            "X-Riot-Token": RIOT_API_KEY,
        }
    
    def get_account_by_riot_id(self, game_name, tag_line, routing):
        url = (
            f"https://{routing}.api.riotgames.com"
            f"/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}"
        )

        response = requests.get(url, headers=self.headers, timeout=10)

        if response.status_code == 404:
            return None
        
        response.raise_for_status()
        return response.json()
    
    def get_current_game_by_puuid(self, puuid, region):
        url = (
            f"https://{region}.api.riotgames.com"
            f"/lol/spectator/v5/active-games/by-summoner/{puuid}"
        )

        response = requests.get(url, headers=self.headers, timeout=10)

        if response.status_code == 404:
            return None
        
        response.raise_for_status()
        return response.json()