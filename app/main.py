"""LaneLens API.

Main flow: POST /api/analyze-matchup
  Riot ID -> PUUID (Account-v1) -> live game (Spectator-v5) -> champion
  mapping (Data Dragon) -> lane/opponent inference -> structured advice.

The frontend is served as static files from /. The Riot API key never
leaves this backend.
"""

import os
from typing import Annotated, List, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StringConstraints
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app import advice_cache, auth, champions, matchup_history, runes
from app.advice_engine import build_advice, build_team_notes
from app.ai_agent import CACHEABLE_SECTIONS, SECTION_SPECS, refine_advice_with_ai, refine_section
from app.config import (
    DEFAULT_PLATFORM,
    REGION_BY_PLATFORM,
    TRUSTED_PROXY_HOPS,
    riot_key_present,
)
from app.demo import get_demo_response
from app.lane_detection import LANES, assign_lanes, find_lane_opponent
from app.riot_client import RiotApiError, RiotClient

app = FastAPI(title="LaneLens")


def client_ip(request: Request) -> str:
    """Rate-limit key: the real client IP, resistant to header spoofing.

    A client can PREPEND fake entries to X-Forwarded-For, but every trusted
    proxy in front of us APPENDS the address it actually saw. So the real
    client sits TRUSTED_PROXY_HOPS entries from the RIGHT end - never the
    left/client-controlled end that get_remote_address would read. When the
    header is missing (local/direct) or too short to trust, fall back to the
    socket IP, which fails safe (over-limits rather than under-limits).

    All X-Forwarded-For headers are flattened in wire order before indexing:
    a client can split its spoofed entries across several separate headers,
    but the trusted proxy's appended value is always last overall, so the
    rightmost entry of the combined chain is still the one we can trust.
    """
    if TRUSTED_PROXY_HOPS:
        parts = [
            entry.strip()
            for header in request.headers.getlist("x-forwarded-for")
            for entry in header.split(",")
            if entry.strip()
        ]
        if len(parts) >= TRUSTED_PROXY_HOPS:
            return parts[-TRUSTED_PROXY_HOPS]
    return get_remote_address(request)


# Per-IP rate limiting: protects the Riot quota and the OpenAI budget when
# the app is exposed to the internet. Generous for one player, tight enough
# that a stranger can't drain anything.
limiter = Limiter(key_func=client_ip)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"ok": False, "error": "Too many requests. Wait a minute, then try again."},
    )


@app.exception_handler(RequestValidationError)
def validation_handler(request: Request, exc: RequestValidationError):
    # Keep the app's {ok, error} shape and, importantly, don't echo back the
    # rejected payload the way Pydantic's default 422 body does.
    return JSONResponse(
        status_code=400,
        content={"ok": False, "error": "Invalid request."},
    )


# Reject oversized bodies before any handler parses them or forwards them to a
# paid LLM call. Legitimate enhance payloads are a few KB; 64 KB is generous.
MAX_BODY_BYTES = 64 * 1024


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    length = request.headers.get("content-length")
    if length is not None:
        try:
            too_big = int(length) > MAX_BODY_BYTES
        except ValueError:
            return JSONResponse(
                status_code=400, content={"ok": False, "error": "Invalid request."}
            )
        if too_big:
            return JSONResponse(
                status_code=413, content={"ok": False, "error": "Request body too large."}
            )
    return await call_next(request)


# Champion display names top out around 14 chars ("Nunu & Willump"); 40 leaves
# room while rejecting anything pathological before it reaches the LLM.
ChampionName = Annotated[str, StringConstraints(max_length=40)]

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

# Queue strings a client may echo back to /api/enhance-advice: our own queue
# labels plus raw gameMode values (used when the queue id is unknown).
KNOWN_QUEUES = set(QUEUE_NAMES.values()) | {
    "CLASSIC", "ARAM", "URF", "ARURF", "NEXUSBLITZ", "ONEFORALL",
    "ULTBOOK", "CHERRY", "PRACTICETOOL", "TUTORIAL",
}

SUMMONER_SPELLS = {
    1: "Cleanse", 3: "Exhaust", 4: "Flash", 6: "Ghost", 7: "Heal",
    11: "Smite", 12: "Teleport", 13: "Clarity", 14: "Ignite",
    21: "Barrier", 32: "Mark",
}


class AnalyzeRequest(BaseModel):
    gameName: str = Field("", max_length=40)
    tagLine: str = Field("", max_length=16)
    platform: str = Field(DEFAULT_PLATFORM, max_length=8)
    region: Optional[str] = Field(None, max_length=16)
    # Manual override when auto lane detection is wrong or unavailable.
    manualEnemyChampion: Optional[str] = Field(None, max_length=40)
    manualLane: Optional[str] = Field(None, max_length=16)


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
@limiter.limit("20/minute")
def analyze_matchup(request: Request, body: AnalyzeRequest):
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

    # Step 7: the player's selected runes for THIS game (Spectator perks).
    # AI refinement is NOT done here - the frontend requests it separately
    # via /api/enhance-advice so results appear instantly (progressive load).
    selected_runes = runes.extract_runes(me.get("perks"))

    return {
        "ok": True,
        "source": "riot-api",
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
        "advice": advice,
    }


class HistoryRequest(BaseModel):
    # Riot PUUIDs are 78 chars; cap at the storage column width (128).
    puuid: str = Field(max_length=128)
    platform: str = Field(DEFAULT_PLATFORM, max_length=8)
    region: Optional[str] = Field(None, max_length=16)
    myChampion: ChampionName
    enemyChampion: ChampionName


@app.post("/api/matchup-history")
@limiter.limit("15/minute")
def get_matchup_history(request: Request, body: HistoryRequest):
    """Background lookup: the player's real win/loss record in this matchup.

    Walks recent Match-v5 games (only ones not seen before - results persist
    on disk) and returns e.g. 3W-1L as Malphite vs Sett.
    """
    if not riot_key_present():
        return error_response(503, "Server is missing its Riot API key.")

    region = (body.region or REGION_BY_PLATFORM.get(body.platform.lower(), "americas")).lower()
    record = matchup_history.get_matchup_record(
        RiotClient(), body.puuid, region, body.myChampion, body.enemyChampion
    )
    if record is None:
        return {"ok": False, "error": "Match history is unavailable right now."}
    return {"ok": True, "record": record}


class EnhanceRequest(BaseModel):
    myChampion: ChampionName
    enemyChampion: Optional[ChampionName] = None
    lane: Optional[str] = Field(None, max_length=16)
    # A Rift team is 5; 10 leaves headroom for other modes without letting a
    # client push a huge list (the handler further validates and caps at 5).
    myTeam: List[ChampionName] = Field(default_factory=list, max_length=10)
    enemyTeam: List[ChampionName] = Field(default_factory=list, max_length=10)
    queue: Optional[str] = Field(None, max_length=32)
    # advice/selectedRunes are free-form dicts; the body-size limit bounds them.
    selectedRunes: Optional[dict] = None
    advice: dict
    # One of app.ai_agent.SECTION_SPECS; omitted = legacy full refinement.
    section: Optional[str] = Field(None, max_length=32)


def _team_records(names, fallback_champ):
    """Client-sent team names -> validated champion records.

    Unknown names are dropped (never trusted); an empty result falls back to
    the laner so the advice engine always has a team to reason about.
    """
    records = [champions.find_champion_by_name(name) for name in names[:5]]
    records = [record for record in records if record]
    return records or [fallback_champ]


@app.post("/api/enhance-advice")
@limiter.limit("20/minute")
def enhance_advice(request: Request, body: EnhanceRequest):
    """Second phase of a progressive analysis: AI-refine the advice.

    Called by the frontend AFTER the instant deterministic result is already
    on screen - once per dashboard section, in parallel, so each panel
    updates as its own answer lands. Matchup-specific sections (build, lane)
    are cache-first per champion+enemy+lane+patch; team-dependent sections
    (gameplan, extras) run fresh for every game.

    This route is unauthenticated and cached results are served to EVERY
    other user, so nothing client-controlled may influence a cacheable AI
    call: champions and lane are validated against the real champion list,
    the baseline advice is rebuilt server-side, and cacheable sections use a
    matchup-only context (mirroring app.prewarm) - their AI input is fully
    determined by the cache key itself.
    """
    if not body.enemyChampion:
        if body.section:
            return {"ok": True, "aiEnhanced": False, "cached": False,
                    "section": body.section, "delta": {}}
        return {"ok": True, "aiEnhanced": False, "cached": False, "advice": body.advice}

    my_champ = champions.find_champion_by_name(body.myChampion)
    enemy_champ = champions.find_champion_by_name(body.enemyChampion)
    if my_champ is None or enemy_champ is None:
        return error_response(400, "Unknown champion name.")
    lane = body.lane or None
    if lane is not None and lane not in LANES:
        return error_response(400, "Unknown lane.")
    my_name, enemy_name = my_champ["name"], enemy_champ["name"]

    patch = champions.get_ddragon_version()

    # Matchup-only inputs for anything that may be cached: laner-only teams,
    # a fixed queue, no runes, and a server-generated baseline - exactly how
    # app.prewarm generates the same cache entries.
    _, matchup_base = build_advice(my_champ, enemy_champ, lane, [my_champ], [enemy_champ])
    matchup_context = {
        "myChampion": my_name,
        "enemyChampion": enemy_name,
        "lane": lane,
        "myTeam": [my_name],
        "enemyTeam": [enemy_name],
        "queue": "Ranked Solo/Duo",
        "selectedRunes": None,
    }

    # ---- Per-section mode ----
    if body.section:
        if body.section not in SECTION_SPECS:
            return error_response(400, "Unknown advice section.")

        if body.section in CACHEABLE_SECTIONS:
            cached = advice_cache.get_cached_section(
                my_name, enemy_name, lane, patch, body.section
            )
            if cached:
                return {"ok": True, "aiEnhanced": True, "cached": True,
                        "section": body.section, "delta": cached}

            delta = refine_section(matchup_context, matchup_base, body.section)
            if delta is None:
                return {"ok": True, "aiEnhanced": False, "cached": False,
                        "section": body.section, "delta": {}}
            advice_cache.store_section(my_name, enemy_name, lane, patch, delta, body.section)
            return {"ok": True, "aiEnhanced": True, "cached": False,
                    "section": body.section, "delta": delta}

        # Per-game sections are never cached, so this game's validated teams,
        # queue, and runes are safe context: the answer only reaches the
        # requester, never another user.
        my_team = _team_records(body.myTeam, my_champ)
        enemy_team = _team_records(body.enemyTeam, enemy_champ)
        _, game_base = build_advice(my_champ, enemy_champ, lane, my_team, enemy_team)
        game_context = {
            "myChampion": my_name,
            "enemyChampion": enemy_name,
            "lane": lane,
            "myTeam": [champ["name"] for champ in my_team],
            "enemyTeam": [champ["name"] for champ in enemy_team],
            "queue": body.queue if body.queue in KNOWN_QUEUES else None,
            "selectedRunes": body.selectedRunes,
        }
        delta = refine_section(game_context, game_base, body.section)
        if delta is None:
            return {"ok": True, "aiEnhanced": False, "cached": False,
                    "section": body.section, "delta": {}}
        return {"ok": True, "aiEnhanced": True, "cached": False,
                "section": body.section, "delta": delta}

    # ---- Legacy full mode ----
    # Cache-first refinement of the matchup-core fields. The AI call and the
    # stored entry are built from matchup_context/matchup_base only; the
    # client's own advice is merely the base the core delta is merged onto.
    cached = advice_cache.get_cached(my_name, enemy_name, lane, patch)
    if cached:
        return {
            "ok": True,
            "aiEnhanced": True,
            "cached": True,
            "advice": advice_cache.merge_cached(body.advice, cached),
        }

    ai_advice = refine_advice_with_ai(matchup_context, matchup_base)
    if ai_advice is None:
        return {"ok": True, "aiEnhanced": False, "cached": False, "advice": body.advice}

    advice_cache.store(my_name, enemy_name, lane, patch, ai_advice)
    core = {field: ai_advice[field] for field in advice_cache.CORE_FIELDS if field in ai_advice}
    return {"ok": True, "aiEnhanced": True, "cached": False,
            "advice": advice_cache.merge_cached(body.advice, core)}


app.include_router(auth.router)


# Serve the frontend last so /api/* routes take priority.
_FRONTEND_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend"
)
app.mount("/", StaticFiles(directory=_FRONTEND_DIR, html=True), name="frontend")
