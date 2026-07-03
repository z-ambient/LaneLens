"""Unit tests for match-history build stats and item promotion (offline)."""

import pytest

import app.match_stats as match_stats
from app.match_stats import get_recent_build_stats, promote_common_items


@pytest.fixture(autouse=True)
def clear_stats_cache():
    match_stats._cache.clear()
    yield
    match_stats._cache.clear()


class FakeMatchClient:
    """Riot client stub returning canned Match-v5 data."""

    def __init__(self, matches):
        self.matches = matches

    def get_match_ids(self, puuid, region, count=20):
        return list(self.matches.keys())

    def get_match(self, match_id, region):
        return self.matches[match_id]


def _match(champion_id, win, items, keystone=8437):
    return {
        "info": {
            "participants": [
                {
                    "puuid": "me",
                    "championId": champion_id,
                    "win": win,
                    "perks": {"styles": [{"selections": [{"perk": keystone}]}]},
                    **{"item{}".format(i): item for i, item in enumerate(items + [0] * (6 - len(items)))},
                }
            ]
        }
    }


def test_stats_aggregate_only_current_champion(monkeypatch):
    # Item names resolved offline.
    monkeypatch.setattr(
        "app.match_stats._load_item_names",
        lambda: {3068: "Sunfire Aegis", 3075: "Thornmail"},
    )
    client = FakeMatchClient({
        "m1": _match(54, True, [3068, 3075]),
        "m2": _match(54, False, [3068]),
        "m3": _match(999, True, [1001]),  # different champion - ignored
    })
    stats = get_recent_build_stats(client, "me", 54, "americas")
    assert stats["gamesAnalyzed"] == 2
    assert stats["wins"] == 1
    assert stats["topItems"][0]["name"] == "Sunfire Aegis"
    assert stats["topItems"][0]["games"] == 2
    assert stats["keystoneId"] == 8437


def test_stats_none_without_history():
    client = FakeMatchClient({})
    assert get_recent_build_stats(client, "nobody", 54, "americas") is None


def test_promote_common_items_swaps_frequent_option():
    build = [
        {"label": "Core", "item": "Sunfire Aegis", "options": ["Heartsteel"]},
        {"label": "Armor", "item": "Thornmail", "options": ["Frozen Heart"]},
    ]
    stats = {
        "gamesAnalyzed": 4,
        "topItems": [
            {"itemId": 1, "name": "Heartsteel", "games": 3},
            {"itemId": 2, "name": "Thornmail", "games": 4},
        ],
    }
    promoted = promote_common_items(build, stats)
    # Heartsteel (built 3/4 games) becomes the main Core recommendation.
    assert promoted[0]["item"] == "Heartsteel"
    assert "Sunfire Aegis" in promoted[0]["options"]
    assert promoted[0]["note"]
    # Thornmail already the main item - just tagged.
    assert promoted[1]["item"] == "Thornmail"
    assert promoted[1]["note"]


def test_promote_no_stats_is_noop():
    build = [{"label": "Core", "item": "Trinity Force", "options": []}]
    assert promote_common_items(build, None) == build
