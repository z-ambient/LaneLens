"""Champion ID mapping via Riot Data Dragon.

Improvements over the manual version:
  - Fetches the LATEST Data Dragon version instead of a hardcoded one.
  - Loads lazily on first use instead of blocking at import time.
  - Falls back to a bundled snapshot (data/champions_fallback.json) when
    Data Dragon is unreachable, so the app and tests work offline.

Each champion record: {"name", "id" (image key, e.g. "MonkeyKing"),
"tags", "attack", "magic"} keyed by numeric champion ID.
"""

import json
import os

import requests

_FALLBACK_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "champions_fallback.json",
)

_cache = {"version": None, "by_id": None}


def _load_fallback():
    with open(_FALLBACK_PATH) as file:
        raw = json.load(file)
    by_id = {int(key): champ for key, champ in raw["champions"].items()}
    return raw["version"], by_id


def _load_from_data_dragon():
    # Data Dragon is a public CDN - no API key involved.
    versions = requests.get(
        "https://ddragon.leagueoflegends.com/api/versions.json", timeout=10
    ).json()
    version = versions[0]

    data = requests.get(
        "https://ddragon.leagueoflegends.com/cdn/{v}/data/en_US/champion.json".format(
            v=version
        ),
        timeout=10,
    ).json()["data"]

    by_id = {}
    for champ in data.values():
        by_id[int(champ["key"])] = {
            "name": champ["name"],
            "id": champ["id"],
            "tags": champ["tags"],
            "attack": champ["info"]["attack"],
            "magic": champ["info"]["magic"],
        }
    return version, by_id


def _ensure_loaded():
    if _cache["by_id"] is not None:
        return
    try:
        version, by_id = _load_from_data_dragon()
    except Exception:
        version, by_id = _load_fallback()
    _cache["version"] = version
    _cache["by_id"] = by_id


def get_ddragon_version():
    _ensure_loaded()
    return _cache["version"]


def get_champion(champion_id):
    """Return the champion record for a numeric ID, or a stub if unknown."""
    _ensure_loaded()
    champ = _cache["by_id"].get(int(champion_id))
    if champ is None:
        return {
            "name": "Unknown ({})".format(champion_id),
            "id": None,
            "tags": [],
            "attack": 5,
            "magic": 5,
        }
    return champ


def get_champion_name(champion_id):
    return get_champion(champion_id)["name"]


def find_champion_by_name(name):
    """Case-insensitive lookup by display name (for manual enemy selection)."""
    _ensure_loaded()
    wanted = name.strip().lower()
    for champ in _cache["by_id"].values():
        if champ["name"].lower() == wanted or (champ["id"] or "").lower() == wanted:
            return champ
    return None
