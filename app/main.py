from fastapi import FastAPI
from app.config import DEFAULT_REGION, DEFAULT_ROUTING
from app.matchup_service import summarize_live_game
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