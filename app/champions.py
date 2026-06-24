import requests

DATA_DRAGON_VERSION = "16.13.1"

def load_champion_ids():
    url = (f"https://ddragon.leagueoflegends.com/cdn/{DATA_DRAGON_VERSION}/data/en_US/champion.json")

    response = requests.get(url, timeout=10)
    response.raise_for_status()

    champion_data = response.json()["data"]

    champion_ids = {}

    for champion in champion_data.values():
        champion_id = int(champion["key"])
        champion_name = champion["name"]
        champion_ids[champion_id] = champion_name

    return champion_ids

CHAMPION_IDS = load_champion_ids()

def get_champion_name(champion_id):
    return CHAMPION_IDS.get(
        champion_id,
        f"Unknown Champion ID: {champion_id}",
    )