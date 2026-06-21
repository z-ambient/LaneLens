from fastapi import FastAPI
from app.config import DEFAULT_REGION, DEFAULT_ROUTING
from app.matchup_service import summarize_live_game, get_matchup_data
from app.riot_client import RiotClient

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Welcome to LaneLens"}

@app.get("/live-game")
def get_live_game(
    game_name: str,
    tag_line: str,
    region: str = DEFAULT_REGION,
    routing: str = DEFAULT_ROUTING
    ):
    
    client = RiotClient()

    account = client.get_account_by_riot_id(game_name, tag_line, routing)

    if account is None:
        return {
            "account_found": False,
            "in_game": False,
        }
    
    puuid = account["puuid"]
    current_game = client.get_current_game_by_puuid(puuid, region)

    if current_game is None:
        return {
            "account_found": True,
            "in_game": False,
        }
    
    return {
        "account_found": True,
        "in_game": True,
        "current_game": current_game,
    }

@app.get("/summary")
def get_summary(
    game_name: str,
    tag_line: str,
    region: str = DEFAULT_REGION,
    routing: str = DEFAULT_ROUTING
):
    
    client = RiotClient()

    account = client.get_account_by_riot_id(game_name, tag_line, routing)

    if account is None:
        return {
            "account_found": False,
            "in_game": False,
        }
    
    puuid = account["puuid"]
    current_game = client.get_current_game_by_puuid(puuid, region)

    if current_game is None:
        return {
            "account_found": True,
            "in_game": False,
        }
    
    summary = summarize_live_game(current_game, puuid)

    return {
        "account_found": True,
        "in_game": True,
        "summary": summary,
    }

@app.get("/matchup")
def get_matchup(
    my_champion: str,
    enemy_champion: str,
):
    advice = get_matchup_data(my_champion, enemy_champion)

    if advice is None:
        return {
            "found": False,
            "my_champion": my_champion,
            "enemy_champion": enemy_champion,
        }
    
    return {
        "found": True,
        "my_champion": my_champion,
        "enemy_champion": enemy_champion,
        "advice": advice,
    }

@app.get("/live-matchup")
def get_live_matchup(
    game_name: str,
    tag_line: str,
    enemy_champion: str,
    region: str = DEFAULT_REGION,
    routing: str = DEFAULT_ROUTING,
):
    client = RiotClient()

    account = client.get_account_by_riot_id(game_name, tag_line, routing)

    if account is None:
        return {
            "account_found": False,
            "in_game": False,
        }
    
    puuid = account["puuid"]
    current_game = client.get_current_game_by_puuid(puuid, region)

    if current_game is None:
        return {
            "account_found": True,
            "in_game": False,
        }
    
    summary = summarize_live_game(current_game, puuid)
    my_champion = summary["my_champion"]
    
    advice = get_matchup_data(my_champion, enemy_champion)

    return {
        "account_found": True,
        "in_game": True,
        "my_champion": my_champion,
        "enemy_champion": enemy_champion,
        "summary": summary,
        "advice_found": advice is not None,
        "advice": advice,
    }