"""LaneLens API.

Main flow: POST /api/analyze-matchup
  Riot ID -> PUUID (Account-v1) -> live game (Spectator-v5) -> champion
  mapping (Data Dragon) -> lane/opponent inference -> structured advice.

The frontend is served as static files from /. The Riot API key never
leaves this backend.
"""

import os
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import champions, runes
from app.advice_engine import build_advice, build_team_notes
from app.ai_agent import refine_advice_with_ai
from app.config import DEFAULT_PLATFORM, REGION_BY_PLATFORM, riot_key_present
from app.demo import get_demo_response
from app.lane_detection import assign_lanes, find_lane_opponent
from app.match_stats import get_recent_build_stats, promote_common_items
from app.riot_client import RiotApiError, RiotClient

app = FastAPI(title="LaneLens")

QUEUE_NAMES = {
    400: "Normal Draft",
    420: "Ranked Solo/Duo",
    430: "Normal Blind",
    440: "Ranked Flex",
    450: "ARAM",
    480: "Swiftplay",
    490: "Quickplay",
    700: "Clash",
    1700: "Arena",
}

SUMMONER_SPELLS = {
    1: "Cleanse", 3: "Exhaust", 4: "Flash", 6: "Ghost", 7: "Heal",
    11: "Smite", 12: "Teleport", 13: "Clarity", 14: "Ignite",
    21: "Barrier", 32: "Mark",
}


class AnalyzeRequest(BaseModel):
    gameName: str = ""
    tagLine: str = ""
    platform: str = DEFAULT_PLATFORM
    region: Optional[str] = None
    # Manual override when auto lane detection is wrong or unavailable.
    manualEnemyChampion: Optional[str] = None
    manualLane: Optional[str] = None


def error_response(status_code, message):
    return JSONResponse(status_code=status_code, content={"ok": False, "error": message})


def _format_member(participant, champ, lanes, player_puuid, opponent_puuid):
    spells = [
        SUMMONER_SPELLS.get(participant.get(key), None)
        for key in ("spell1Id", "spell2Id")
    ]
    return {
        "championName": champ["name"],
        "imageKey": champ["id"],
        "summonerName": participant.get("riotId") or participant.get("summonerName"),
        "spells": [spell for spell in spells if spell],
        "isPlayer": participant["puuid"] == player_puuid,
        "isOpponent": participant["puuid"] == opponent_puuid,
        "lane": lanes.get(participant["puuid"]),
    }


@app.get("/api/health")
def health():
    return {"ok": True, "riotKeyConfigured": riot_key_present()}


@app.get("/api/demo-matchup")
def demo_matchup():
    return get_demo_response(champions.get_ddragon_version())


@app.post("/api/analyze-matchup")
def analyze_matchup(body: AnalyzeRequest):
    game_name = body.gameName.strip()
    tag_line = body.tagLine.strip().lstrip("#")

    if not game_name:
        return error_response(400, "Riot game name is required.")
    if not tag_line:
        return error_response(400, "Riot tagline is required (the part after the #).")

    platform = body.platform.strip().lower() or DEFAULT_PLATFORM
    region = (body.region or REGION_BY_PLATFORM.get(platform, "americas")).strip().lower()

    if not riot_key_present():
        return error_response(
            503,
            "Server is missing its Riot API key. Add RIOT_API_KEY to the backend .env file and restart.",
        )

    client = RiotClient()
    try:
        # Step 1: Riot ID -> account/PUUID (Account-v1, regional routing).
        account = client.get_account_by_riot_id(game_name, tag_line, region)
        if account is None:
            return error_response(
                404, "Riot account not found. Check the game name and tagline."
            )
        puuid = account["puuid"]

        # Step 2: PUUID -> live game (Spectator-v5, platform routing).
        game = client.get_active_game(puuid, platform)
        if game is None:
            return error_response(
                404, "No live League of Legends game found for this player."
            )
    except RiotApiError as error:
        return error_response(error.status_code, error.message)

    participants = game.get("participants", [])
    me = next((p for p in participants if p["puuid"] == puuid), None)
    if me is None:
        return error_response(502, "Live game data did not include this player.")

    # Step 3: champion ID -> champion records via Data Dragon.
    champs_by_puuid = {p["puuid"]: champions.get_champion(p["championId"]) for p in participants}

    blue = [p for p in participants if p["teamId"] == 100]
    red = [p for p in participants if p["teamId"] == 200]
    my_side, enemy_side = (blue, red) if me["teamId"] == 100 else (red, blue)

    # Step 4: best-effort lane inference (Smite + champion role preferences).
    lanes = {}
    if game.get("gameMode") == "CLASSIC":
        lanes.update(assign_lanes(blue, champs_by_puuid))
        lanes.update(assign_lanes(red, champs_by_puuid))
    my_lane = lanes.get(puuid)

    # Step 5: lane opponent - manual override wins, otherwise inferred.
    my_champ = champs_by_puuid[puuid]
    enemy_champ = None
    opponent_puuid = None
    confidence = "manual"

    if body.manualEnemyChampion:
        wanted = body.manualEnemyChampion.strip().lower()
        match = next(
            (p for p in enemy_side if champs_by_puuid[p["puuid"]]["name"].lower() == wanted),
            None,
        )
        if match is None:
            return error_response(
                400, "That champion is not on the enemy team in this game."
            )
        opponent_puuid = match["puuid"]
        enemy_champ = champs_by_puuid[opponent_puuid]
        my_lane = body.manualLane or my_lane
        confidence = "manual"
    else:
        opponent = find_lane_opponent(my_lane, enemy_side, lanes)
        if opponent is not None:
            opponent_puuid = opponent["puuid"]
            enemy_champ = champs_by_puuid[opponent_puuid]
            confidence = "inferred"

    # Step 6: structured advice (deterministic engine, optional AI refinement).
    my_team_champs = [champs_by_puuid[p["puuid"]] for p in my_side]
    enemy_team_champs = [champs_by_puuid[p["puuid"]] for p in enemy_side]
    difficulty, advice = build_advice(
        my_champ, enemy_champ, my_lane, my_team_champs, enemy_team_champs
    )

    # Step 7: real data - the player's selected runes for THIS game
    # (Spectator perks) and their actual builds from recent matches (Match-v5).
    selected_runes = runes.extract_runes(me.get("perks"))
    build_stats = get_recent_build_stats(client, puuid, me["championId"], region)
    advice["fullBuild"] = promote_common_items(advice["fullBuild"], build_stats)

    ai_advice = refine_advice_with_ai(
        {
            "myChampion": my_champ["name"],
            "enemyChampion": enemy_champ["name"] if enemy_champ else None,
            "lane": my_lane,
            "myTeam": [champ["name"] for champ in my_team_champs],
            "enemyTeam": [champ["name"] for champ in enemy_team_champs],
            "queue": QUEUE_NAMES.get(game.get("gameQueueConfigId"), "Unknown queue"),
            "selectedRunes": selected_runes,
            "recentMatchStats": build_stats,
        },
        advice,
    )
    if ai_advice is not None:
        advice = ai_advice

    return {
        "ok": True,
        "source": "riot-api",
        "aiEnhanced": ai_advice is not None,
        "ddragonVersion": champions.get_ddragon_version(),
        "game": {
            "queue": QUEUE_NAMES.get(game.get("gameQueueConfigId"), game.get("gameMode", "Unknown")),
            "gameMode": game.get("gameMode"),
            "gameStartTime": game.get("gameStartTime"),
        },
        "player": {
            "gameName": account.get("gameName", game_name),
            "tagLine": account.get("tagLine", tag_line),
            "puuid": puuid,
            "champion": my_champ["name"],
        },
        "matchup": {
            "enemyChampion": enemy_champ["name"] if enemy_champ else None,
            "lane": my_lane,
            "difficulty": difficulty,
            "confidence": confidence,
        },
        "teams": {
            "blue": [
                _format_member(p, champs_by_puuid[p["puuid"]], lanes, puuid, opponent_puuid)
                for p in blue
            ],
            "red": [
                _format_member(p, champs_by_puuid[p["puuid"]], lanes, puuid, opponent_puuid)
                for p in red
            ],
        },
        "teamNotes": build_team_notes(my_team_champs, enemy_team_champs),
        "runes": selected_runes,
        "buildStats": build_stats,
        "advice": advice,
    }


# Serve the frontend last so /api/* routes take priority.
_FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend"
)
app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
