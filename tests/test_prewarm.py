"""Tests for cache pre-warming (AI and Data Dragon mocked, offline)."""

import pytest

import app.champions as champions
import app.prewarm as prewarm
from app import advice_cache, storage


@pytest.fixture(autouse=True)
def seeded_champions(monkeypatch):
    """Seed the champion cache so no network is touched."""
    names = {name for lane in prewarm.META_LANE_CHAMPIONS.values() for name in lane}
    names |= {"Malphite", "Sett"}
    by_id = {
        index: {"name": name, "id": name.replace(" ", "").replace("'", ""),
                "tags": ["Fighter"], "attack": 7, "magic": 3}
        for index, name in enumerate(sorted(names))
    }
    # A champion whose Match-v5/id name differs from the display name.
    by_id[9999] = {"name": "Wukong", "id": "MonkeyKing",
                   "tags": ["Fighter"], "attack": 8, "magic": 2}
    monkeypatch.setitem(champions._cache, "version", "99.1.1")
    monkeypatch.setitem(champions._cache, "by_id", by_id)


def test_meta_matchups_popularity_order_and_no_self():
    pairs = prewarm.meta_matchups("Top")
    assert pairs[0] == ("Darius", "Garen", "Top")  # two most popular first
    assert all(me != enemy for me, enemy, _ in pairs)
    assert all(lane == "Top" for *_, lane in pairs)


def test_plan_prefers_observed_history():
    storage.history_set("p1", {"processed": [], "games": [
        {"myChampion": "Malphite", "enemyChampion": "Sett", "position": "TOP", "win": True},
        {"myChampion": "Malphite", "enemyChampion": "Sett", "position": "TOP", "win": False},
        {"myChampion": "Ahri", "enemyChampion": "Zed", "position": "MIDDLE", "win": True},
    ]})
    to_warm, _ = prewarm.plan("99.1.1", limit=3)
    matchups = [(me, enemy, lane) for me, enemy, lane, _ in to_warm]
    # Most-frequent observed matchup first, then the other observed one.
    assert matchups[0] == ("Malphite", "Sett", "Top")
    assert matchups[1] == ("Ahri", "Zed", "Mid")
    # Then the meta list takes over.
    assert matchups[2] == ("Darius", "Garen", "Top")


def test_plan_normalizes_matchv5_names_to_display_names():
    """History stores 'MonkeyKing'; the cache must be keyed as 'Wukong'."""
    storage.history_set("p1", {"processed": [], "games": [
        {"myChampion": "MonkeyKing", "enemyChampion": "MasterYi",
         "position": "JUNGLE", "win": True},
    ]})
    to_warm, _ = prewarm.plan("99.1.1", limit=1)
    assert to_warm[0][:3] == ("Wukong", "Master Yi", "Jungle")


def test_plan_skips_cached_and_respects_limit():
    advice_cache.store_section("Darius", "Garen", "Top", "99.1.1",
                               {"lanePlan": "x"}, "lane")
    advice_cache.store_section("Darius", "Garen", "Top", "99.1.1",
                               {"buildDirection": "x", "fullBuild": []}, "build")
    to_warm, skipped = prewarm.plan("99.1.1", lane_filter="Top", limit=2)
    assert skipped == 1
    assert len(to_warm) == 2
    assert ("Darius", "Garen", "Top") not in [(m, e, l) for m, e, l, _ in to_warm]


def test_plan_partial_cache_warms_missing_section_only():
    advice_cache.store_section("Darius", "Garen", "Top", "99.1.1",
                               {"lanePlan": "x"}, "lane")
    to_warm, _ = prewarm.plan("99.1.1", lane_filter="Top", limit=1)
    me, enemy, lane, missing = to_warm[0]
    assert (me, enemy, lane) == ("Darius", "Garen", "Top")
    assert missing == ["build"]


def test_warm_one_stores_sections(monkeypatch):
    calls = []
    monkeypatch.setattr(prewarm, "refine_section", lambda ctx, base, section: (
        calls.append(section) or {"lanePlan": "AI"} if section == "lane"
        else {"buildDirection": "AI", "fullBuild": [{"label": "Core", "item": "X", "options": []}]}
    ))
    warmed, failed = prewarm.warm_one("Malphite", "Sett", "Top", ["build", "lane"], "99.1.1")
    assert sorted(warmed) == ["build", "lane"]
    assert failed == []
    assert advice_cache.get_cached_section("Malphite", "Sett", "Top", "99.1.1", "lane")
    assert advice_cache.get_cached_section("Malphite", "Sett", "Top", "99.1.1", "build")


def test_warm_one_reports_failures(monkeypatch):
    monkeypatch.setattr(prewarm, "refine_section", lambda *a: None)
    warmed, failed = prewarm.warm_one("Malphite", "Sett", "Top", ["build"], "99.1.1")
    assert warmed == [] and failed == ["build"]


def test_dry_run_makes_no_ai_calls(monkeypatch, capsys):
    monkeypatch.setattr(prewarm, "refine_section",
                        lambda *a: pytest.fail("AI must not be called in dry-run"))
    monkeypatch.setattr(prewarm.champions, "get_ddragon_version", lambda: "99.1.1")
    code = prewarm.main(["--dry-run", "--limit", "3", "--lane", "Top"])
    assert code == 0
    out = capsys.readouterr().out
    assert "to warm: 3" in out
    assert "Darius vs Garen" in out