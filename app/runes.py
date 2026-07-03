"""Rune (perk) mapping via Riot Data Dragon runesReforged.json.

Spectator-v5 exposes each participant's selected runes as raw perk IDs
(perks.perkIds + perkStyle/perkSubStyle). This module maps those IDs to
names and icon paths so the frontend can render the player's actual rune
page for the live game. Loaded lazily; failures degrade to None so an
analysis never fails because of runes.
"""

import requests

_cache = {"styles": None, "runes": None}

# Stat shards are not part of runesReforged.json.
STAT_SHARDS = {
    5001: "Health Scaling",
    5002: "Armor",
    5003: "Magic Resist",
    5005: "Attack Speed",
    5007: "Ability Haste",
    5008: "Adaptive Force",
    5010: "Move Speed",
    5011: "Health",
    5013: "Tenacity and Slow Resist",
}


def _ensure_loaded():
    if _cache["styles"] is not None:
        return True
    try:
        versions = requests.get(
            "https://ddragon.leagueoflegends.com/api/versions.json", timeout=10
        ).json()
        data = requests.get(
            "https://ddragon.leagueoflegends.com/cdn/{v}/data/en_US/runesReforged.json".format(
                v=versions[0]
            ),
            timeout=10,
        ).json()
    except Exception:
        return False

    styles, runes = {}, {}
    for style in data:
        styles[style["id"]] = {"name": style["name"], "icon": style["icon"]}
        for slot in style["slots"]:
            for rune in slot["runes"]:
                runes[rune["id"]] = {"name": rune["name"], "icon": rune["icon"]}
    _cache["styles"] = styles
    _cache["runes"] = runes
    return True


def rune_info(perk_id):
    """Name/icon for a single rune or keystone ID, or None."""
    if not _ensure_loaded():
        return None
    return _cache["runes"].get(perk_id)


def extract_runes(perks):
    """Build a display-ready rune summary from spectator perks data.

    perks: {"perkIds": [...], "perkStyle": id, "perkSubStyle": id}
    Returns None when perks are missing or Data Dragon is unreachable.
    """
    if not perks or not perks.get("perkIds") or not _ensure_loaded():
        return None

    styles = _cache["styles"]
    runes, shards = [], []
    for perk_id in perks["perkIds"]:
        if perk_id in STAT_SHARDS:
            shards.append(STAT_SHARDS[perk_id])
            continue
        info = _cache["runes"].get(perk_id)
        if info:
            runes.append(dict(info))

    if not runes:
        return None

    return {
        # Convention: the first perk ID is the keystone.
        "keystone": runes[0],
        "runes": runes[1:],
        "shards": shards,
        "primaryStyle": styles.get(perks.get("perkStyle")),
        "subStyle": styles.get(perks.get("perkSubStyle")),
    }
