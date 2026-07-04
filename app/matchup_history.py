"""Personal matchup history from the player's real finished games (Match-v5).

Builds a per-player record like "3W-1L as Malphite vs Sett" by walking recent
Summoner's Rift matches and pairing the player with the enemy in the same
teamPosition. Processed games are stored in the database (SQLite locally,
Postgres in production - see app.storage) so each analysis only fetches match
details it has never seen - the history gets richer and cheaper over time,
like the advice cache.
"""

import logging

from app import storage

logger = logging.getLogger("uvicorn.error")

# Queues with meaningful lane assignments (Summoner's Rift).
RIFT_QUEUES = {400, 420, 430, 440, 490}

# Riot call budget per request: 1 id-list call + at most this many details.
MAX_NEW_DETAILS = 10
REMAKE_SECONDS = 300


def _extract_lane_matchup(match, puuid):
    """One stored record: my champion vs the enemy in my position."""
    info = match.get("info", {})
    if info.get("queueId") not in RIFT_QUEUES:
        return None
    if info.get("gameDuration", 0) < REMAKE_SECONDS:
        return None  # remake - not a real game

    participants = info.get("participants", [])
    me = next((p for p in participants if p.get("puuid") == puuid), None)
    if me is None or not me.get("teamPosition"):
        return None

    opponent = next(
        (
            p for p in participants
            if p.get("teamId") != me.get("teamId")
            and p.get("teamPosition") == me.get("teamPosition")
        ),
        None,
    )
    if opponent is None:
        return None

    return {
        "myChampion": me.get("championName"),
        "enemyChampion": opponent.get("championName"),
        "position": me.get("teamPosition"),
        "win": bool(me.get("win")),
        "endedAt": info.get("gameEndTimestamp") or info.get("gameCreation"),
    }


def update_history(client, puuid, region):
    """Fetch match details we have not processed yet and store their matchups."""
    entry = storage.history_get(puuid) or {"processed": [], "games": []}
    processed = set(entry["processed"])

    match_ids = client.get_match_ids(puuid, region, count=30)
    new_ids = [match_id for match_id in match_ids if match_id not in processed]

    for match_id in new_ids[:MAX_NEW_DETAILS]:
        match = client.get_match(match_id, region)
        entry["processed"].append(match_id)
        if not match:
            continue
        record = _extract_lane_matchup(match, puuid)
        if record:
            record["matchId"] = match_id
            entry["games"].append(record)

    # Keep the store bounded per player.
    entry["processed"] = entry["processed"][-400:]
    entry["games"] = entry["games"][-300:]
    storage.history_set(puuid, entry)
    return entry


def get_matchup_record(client, puuid, region, my_champion, enemy_champion):
    """Win/loss record for this exact champion matchup, from real games.

    Returns {"games", "wins", "losses", "lastResult"} or None on failure.
    """
    try:
        entry = update_history(client, puuid, region)
    except Exception:
        logger.info("Matchup history unavailable for this analysis", exc_info=True)
        return None

    def _norm(name):
        # Match-v5 championName has no spaces/punctuation (e.g. DrMundo,
        # KaiSa); normalize display names the same way before comparing.
        return "".join(ch for ch in (name or "") if ch.isalnum()).lower()

    mine, theirs = _norm(my_champion), _norm(enemy_champion)
    relevant = sorted(
        (
            g for g in entry["games"]
            if _norm(g["myChampion"]) == mine and _norm(g["enemyChampion"]) == theirs
        ),
        key=lambda g: g.get("endedAt") or 0,
    )
    wins = sum(1 for g in relevant if g["win"])
    return {
        "games": len(relevant),
        "wins": wins,
        "losses": len(relevant) - wins,
        # Form strip: results of the last 5 meetings, newest first.
        "recent": ["win" if g["win"] else "loss" for g in relevant[-5:]][::-1],
    }
