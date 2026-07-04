"""Persistent cache for AI-refined matchup advice.

The slow part of an analysis is the AI call (~30-60s). The matchup-specific
parts of its output (how Malphite plays vs Sett top) barely change between
games, so they are cached in the database keyed by (champion, enemy, lane)
and reused until the game patch changes - Data Dragon's version acts as the
freshness check. Team-dependent fields (game direction, teamfight plan,
extras) are NEVER cached: they are regenerated for the actual teams in every
game. Storage: SQLite locally, Postgres in production (see app.storage).
"""

from app import storage

# Matchup-specific advice fields that are safe to reuse across games.
CORE_FIELDS = [
    "startingItem", "boots", "firstItem", "fullBuild", "buildDirection",
    "lanePlan", "tradingPattern", "dangerWindows", "howToWinLane",
    "commonMistakes", "extraTips",
]


def _key(my_champion, enemy_champion, lane):
    return "|".join([my_champion, enemy_champion, lane or "any"]).lower()


def get_cached(my_champion, enemy_champion, lane, patch):
    """Return cached core advice for this matchup on the current patch."""
    hit = storage.cache_get(_key(my_champion, enemy_champion, lane))
    if hit and hit[0] == patch:
        return hit[1]
    return None


def store(my_champion, enemy_champion, lane, patch, advice):
    """Persist the matchup-core subset of an AI-refined advice object."""
    core = {field: advice[field] for field in CORE_FIELDS if field in advice}
    if not core:
        return
    storage.cache_set(_key(my_champion, enemy_champion, lane), patch, core)


def merge_cached(fresh_advice, cached_core):
    """Overlay cached matchup-core fields onto freshly generated advice.

    Team-dependent fields (gameDirection, teamfightPlan, extras) keep their
    fresh values because they were computed for THIS game's comps.
    """
    merged = dict(fresh_advice)
    merged.update(cached_core)
    return merged
