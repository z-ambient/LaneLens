"""Tests for the Lane Performance Score (app.lane_score) - pure math, offline."""

import pytest

from app.lane_score import describe, grade_for_score, label_for_grade, score_game


def _game(**overrides):
    """An unremarkable even lane in a 30-minute win."""
    game = {
        "myChampion": "Malphite",
        "enemyChampion": "Sett",
        "position": "TOP",
        "win": True,
        "duration": 1800,
        "kills": 4, "deaths": 4, "assists": 6,
        "cs": 180, "gold": 11000, "damage": 15000,
        "teamKills": 20,
        "enemyKills": 4, "enemyDeaths": 4, "enemyAssists": 6,
        "enemyCs": 180, "enemyGold": 11000, "enemyDamage": 15000,
    }
    game.update(overrides)
    return game


def test_legacy_record_without_stats_scores_none():
    legacy = {"myChampion": "Malphite", "enemyChampion": "Sett", "win": True}
    assert score_game(legacy) is None
    assert describe(legacy) == {"laneScore": None, "laneGrade": None, "gradeLabel": None}


def test_score_stays_in_bounds():
    zero = _game(kills=0, deaths=15, assists=0, cs=10, gold=3000, damage=1000,
                 win=False, enemyKills=15, enemyDeaths=0, enemyAssists=10,
                 enemyCs=300, enemyGold=20000, enemyDamage=40000)
    huge = _game(kills=25, deaths=0, assists=20, cs=320, gold=22000, damage=50000,
                 teamKills=45, enemyKills=0, enemyDeaths=12, enemyAssists=1,
                 enemyCs=90, enemyGold=7000, enemyDamage=5000)
    assert 0 <= score_game(zero) <= 100
    assert 0 <= score_game(huge) <= 100


def test_stomp_grades_s_range():
    stomp = _game(kills=12, deaths=1, assists=10, cs=250, gold=15000,
                  damage=30000, duration=1680, teamKills=35,
                  enemyKills=1, enemyDeaths=8, enemyAssists=2,
                  enemyCs=140, enemyGold=8000, enemyDamage=10000)
    assert score_game(stomp) >= 90


def test_getting_run_over_grades_f():
    fed_on = _game(kills=1, deaths=6, assists=2, cs=150, gold=9000,
                   damage=8000, win=False, teamKills=10,
                   enemyKills=7, enemyDeaths=2, enemyAssists=4,
                   enemyCs=200, enemyGold=12000, enemyDamage=20000)
    assert score_game(fed_on) < 50


def test_even_lane_lands_mid_band():
    assert 55 <= score_game(_game()) <= 79


def test_result_is_a_small_nudge_not_the_score():
    # Identical stats: the win must score higher, but only slightly.
    win, loss = score_game(_game(win=True)), score_game(_game(win=False))
    assert win > loss
    assert win - loss <= 10

    # Won lane hard but lost the game: still clearly a good lane.
    carried_loss = _game(kills=8, deaths=2, assists=6, cs=220, gold=13000,
                         damage=25000, win=False, teamKills=18,
                         enemyKills=4, enemyDeaths=6, enemyAssists=2,
                         enemyCs=180, enemyGold=10500, enemyDamage=18000)
    assert score_game(carried_loss) >= 70


def test_support_judged_on_gold_not_cs():
    stats = dict(kills=1, deaths=3, assists=18, cs=40, gold=8000,
                 damage=12000, teamKills=25)
    support = _game(position="UTILITY", **stats)
    laner = _game(position="TOP", **stats)
    assert score_game(support) > score_game(laner)


def test_fallback_scoring_without_enemy_stats():
    game = _game()
    for key in list(game):
        if key.startswith("enemy"):
            del game[key]
    assert 0 <= score_game(game) <= 100


@pytest.mark.parametrize("score,grade", [
    (100, "S+"), (95, "S+"), (94, "S"), (90, "S"), (89, "A"), (80, "A"),
    (79, "B"), (70, "B"), (69, "C"), (60, "C"), (59, "D"), (50, "D"), (49, "F"), (0, "F"),
])
def test_grade_thresholds(score, grade):
    assert grade_for_score(score) == grade


def test_every_grade_has_a_label():
    for grade in ("S+", "S", "A", "B", "C", "D", "F"):
        assert label_for_grade(grade)
    assert label_for_grade("A") == "Won lane"
    assert label_for_grade("F") == "Lost lane hard"
