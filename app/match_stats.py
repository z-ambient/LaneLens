"""Real build data from the player's recent matches (Riot Match-v5).

Third-party stat sites (op.gg, u.gg, lolalytics) block programmatic access,
so LaneLens aggregates *actual game data* the legitimate way: it pulls the
player's recent finished matches on their current champion through the Riot
API and counts which items they really finished and which keystone they ran.

Results are cached in-memory per (puuid, champion) for a few minutes to stay
inside dev-key rate limits, and every failure degrades to None so the main
analysis never breaks because of match history.
"""

import time
from collections import Counter

import requests

# Keep the Riot call budget small: 1 id-list call + at most this many
# match-detail calls per analysis (dev keys allow 100 requests / 2 min).
MAX_DETAIL_CALLS = 8
MAX_GAMES_ON_CHAMPION = 4

_CACHE_TTL_SECONDS = 600
_cache = {}

_item_names = {"loaded": False, "by_id": {}}

# Trinkets / consumables that shouldn't appear as "core items you built".
_IGNORED_ITEMS = {2003, 2031, 2055, 2138, 2139, 2140, 3340, 3363, 3364, 2052}


def _load_item_names():
    """Item ID -> name via Data Dragon (optional; used to promote options)."""
    if _item_names["loaded"]:
        return _item_names["by_id"]
    _item_names["loaded"] = True
    try:
        versions = requests.get(
            "https://ddragon.leagueoflegends.com/api/versions.json", timeout=10
        ).json()
        data = requests.get(
            "https://ddragon.leagueoflegends.com/cdn/{v}/data/en_US/item.json".format(
                v=versions[0]
            ),
            timeout=10,
        ).json()["data"]
        _item_names["by_id"] = {int(item_id): item["name"] for item_id, item in data.items()}
    except Exception:
        pass
    return _item_names["by_id"]


def get_recent_build_stats(client, puuid, champion_id, region):
    """Aggregate the player's recent real games on this champion.

    Returns {"gamesAnalyzed", "wins", "topItems": [{itemId, name, games}],
    "keystoneId"} or None when history is unavailable / empty.
    """
    cache_key = (puuid, champion_id)
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]

    try:
        stats = _compute_stats(client, puuid, champion_id, region)
    except Exception:
        # Rate limit, transient Riot failure, or malformed data - skip the
        # stats rather than failing the whole analysis.
        stats = None

    _cache[cache_key] = (time.time(), stats)
    return stats


def _compute_stats(client, puuid, champion_id, region):
    match_ids = client.get_match_ids(puuid, region, count=20)
    if not match_ids:
        return None

    item_counts = Counter()
    keystones = Counter()
    games = 0
    wins = 0

    for match_id in match_ids[:MAX_DETAIL_CALLS]:
        if games >= MAX_GAMES_ON_CHAMPION:
            break
        match = client.get_match(match_id, region)
        if not match:
            continue
        me = next(
            (p for p in match["info"].get("participants", []) if p.get("puuid") == puuid),
            None,
        )
        if me is None or me.get("championId") != champion_id:
            continue

        games += 1
        if me.get("win"):
            wins += 1
        for slot in range(6):
            item_id = me.get("item{}".format(slot), 0)
            if item_id and item_id not in _IGNORED_ITEMS:
                item_counts[item_id] += 1
        try:
            keystone = me["perks"]["styles"][0]["selections"][0]["perk"]
            keystones[keystone] += 1
        except (KeyError, IndexError, TypeError):
            pass

    if games == 0:
        return None

    names = _load_item_names()
    top_items = [
        {"itemId": item_id, "name": names.get(item_id), "games": count}
        for item_id, count in item_counts.most_common(8)
    ]
    return {
        "gamesAnalyzed": games,
        "wins": wins,
        "topItems": top_items,
        "keystoneId": keystones.most_common(1)[0][0] if keystones else None,
    }


def promote_common_items(full_build, stats):
    """Nudge the recommended build toward what the player actually builds.

    If an alternative item was finished in at least half of the analyzed
    games (and the slot's main item wasn't), swap it into the main slot and
    tag the slot so the UI can say why.
    """
    if not stats or not stats.get("topItems"):
        return full_build

    threshold = max(2, (stats["gamesAnalyzed"] + 1) // 2)
    frequent = {
        item["name"] for item in stats["topItems"]
        if item["name"] and item["games"] >= threshold
    }
    if not frequent:
        return full_build

    for slot in full_build:
        if slot["item"] in frequent:
            slot["note"] = "You built this in most recent games"
            continue
        for option in list(slot.get("options", [])):
            if option in frequent:
                slot["options"].remove(option)
                slot["options"].insert(0, slot["item"])
                slot["item"] = option
                slot["note"] = "Promoted - built in most of your recent games"
                break
    return full_build
