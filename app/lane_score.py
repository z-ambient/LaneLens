"""Lane Performance Score - version 1.

Turns one stored matchup game (see app.matchup_history) into a 0-100 score,
a letter grade, and a plain-English label. The score is deliberately NOT
win/loss: you can win lane and lose the game, or lose lane and get carried.
Result is only a small nudge.

HOW THE SCORE IS BUILT
Each component is normalized to 0-100, then combined with WEIGHTS:

    farm      25%  CS + gold per minute vs a strong-laner baseline
                   (supports are judged on gold only; junglers get a
                   lower CS baseline - camps, not waves)
    kda       25%  KDA curve + kill participation + a per-death penalty
    opponent  20%  head-to-head vs the enemy laner: KDA, CS, gold, damage
    damage    15%  damage share vs the enemy laner - fair for tanks,
                   because a tank is compared to the opposing laner
                   (usually also a tank), not to a carry's numbers
    result    10%  won or lost the game (small on purpose; a loss still
                   scores LOSS_RESULT because the lane may have been won)
    (context   5%  reserved for a future AI/context adjustment - when a
                   game carries one, add it to _components and WEIGHTS)

A component whose inputs are missing is dropped and the remaining weights
are re-normalized. A game stored without enemy stats therefore scores from
roughly 33% farm / 33% KDA / 20% damage-per-minute / 13% result - the
fallback mix. Games stored before stat capture existed score as None.

Head-to-head comparisons map an even lane to EVEN_SHARE (not 50): going
even with your opponent is a solid lane, not a failure. Calibration:
an even lane in a won game lands around B, a clear stat lead around A,
a stomp in the low 90s (S), and getting run over in the 30s (F).

TUNING: everything is a named constant below. The UI and API layers only
ever see the final score/grade - change the math freely here.
"""

# Component weights (must be positive; they are normalized at use, so the
# reserved context slice simply redistributes until it exists).
WEIGHTS = {
    "farm": 25.0,
    "kda": 25.0,
    "opponent": 20.0,
    "damage": 15.0,
    "result": 10.0,
}

# Farm baselines: per-minute rates that earn full marks.
STRONG_CSPM = 8.0            # laners
JUNGLE_STRONG_CSPM = 6.5     # camps tick slower than waves
STRONG_GPM = 450.0
SUPPORT_STRONG_GPM = 320.0   # supports earn less gold by design

# KDA component: 100 * kda / (kda + KDA_CURVE) - a 2.5 KDA (an even game)
# lands near 68, a 5+ KDA above 80, and it never quite saturates.
KDA_CURVE = 1.2
STRONG_KILL_PARTICIPATION = 0.70
DEATH_COST = 10.0            # points off the deaths sub-score per death

# Head-to-head share mapping: an exactly even split scores EVEN_SHARE, and
# every percentage point of the mine/(mine+theirs) split moves SHARE_SLOPE
# points, so a ~66% split (a 2:1 lead) maxes the component.
EVEN_SHARE = 65.0
SHARE_SLOPE = 2.2

# Damage fallback (no enemy stats stored): damage per minute for full marks.
FALLBACK_STRONG_DPM = 800.0

# Result: winning helps a little; losing is not zero because this score is
# about the LANE, and lost games contain won lanes.
WIN_RESULT = 100.0
LOSS_RESULT = 25.0

# Score -> grade thresholds (checked in order) and plain-English labels.
GRADE_THRESHOLDS = [
    (95, "S+"),
    (90, "S"),
    (80, "A"),
    (70, "B"),
    (60, "C"),
    (50, "D"),
]

GRADE_LABELS = {
    "S+": "Dominated matchup",
    "S": "Dominated matchup",
    "A": "Won lane",
    "B": "Solid / even lane",
    "C": "Struggled but playable",
    "D": "Lost lane",
    "F": "Lost lane hard",
}


def _clamp(value, low=0.0, high=100.0):
    return max(low, min(high, value))


def _kda_value(kills, deaths, assists):
    return (kills + assists) / max(1, deaths)


def _share_score(mine, theirs):
    """Head-to-head split -> 0-100 with an even lane at EVEN_SHARE."""
    total = mine + theirs
    if total <= 0:
        return EVEN_SHARE
    share = 100.0 * mine / total
    return _clamp(EVEN_SHARE + (share - 50.0) * SHARE_SLOPE)


def _farm_component(game, minutes):
    gold_baseline = (
        SUPPORT_STRONG_GPM if game.get("position") == "UTILITY" else STRONG_GPM
    )
    gold_part = _clamp(100.0 * (game["gold"] / minutes) / gold_baseline)
    if game.get("position") == "UTILITY":
        return gold_part  # support CS is meaningless - gold tells the story

    cs_baseline = (
        JUNGLE_STRONG_CSPM if game.get("position") == "JUNGLE" else STRONG_CSPM
    )
    cs_part = _clamp(100.0 * (game["cs"] / minutes) / cs_baseline)
    return 0.6 * cs_part + 0.4 * gold_part


def _kda_component(game):
    kda = _kda_value(game["kills"], game["deaths"], game["assists"])
    kda_part = 100.0 * kda / (kda + KDA_CURVE)
    deaths_part = _clamp(100.0 - DEATH_COST * game["deaths"])

    team_kills = game.get("teamKills") or 0
    if team_kills > 0:
        participation = (game["kills"] + game["assists"]) / team_kills
        kp_part = _clamp(100.0 * participation / STRONG_KILL_PARTICIPATION)
        return 0.5 * kda_part + 0.25 * kp_part + 0.25 * deaths_part
    return 0.6 * kda_part + 0.4 * deaths_part


def _opponent_component(game):
    """Average head-to-head split across KDA, CS, gold, and damage."""
    my_kda = _kda_value(game["kills"], game["deaths"], game["assists"])
    enemy_kda = _kda_value(
        game["enemyKills"], game["enemyDeaths"], game["enemyAssists"]
    )
    parts = [
        _share_score(my_kda, enemy_kda),
        _share_score(game["cs"], game["enemyCs"]),
        _share_score(game["gold"], game["enemyGold"]),
        _share_score(game["damage"], game["enemyDamage"]),
    ]
    return sum(parts) / len(parts)


def _damage_component(game, minutes):
    if "enemyDamage" in game:
        return _share_score(game["damage"], game["enemyDamage"])
    return _clamp(100.0 * (game["damage"] / minutes) / FALLBACK_STRONG_DPM)


def _components(game):
    """Available component scores for this game; missing inputs drop out."""
    minutes = max(1.0, game.get("duration", 0) / 60.0)
    scores = {
        "farm": _farm_component(game, minutes),
        "kda": _kda_component(game),
        "damage": _damage_component(game, minutes),
        "result": WIN_RESULT if game.get("win") else LOSS_RESULT,
    }
    if "enemyKills" in game:
        scores["opponent"] = _opponent_component(game)
    return scores


def score_game(game):
    """Lane Performance Score (int 0-100), or None for records stored
    before stat capture existed (they only hold champions + result)."""
    if "kills" not in game:
        return None
    scores = _components(game)
    total_weight = sum(WEIGHTS[name] for name in scores)
    weighted = sum(WEIGHTS[name] * value for name, value in scores.items())
    return int(round(_clamp(weighted / total_weight)))


def grade_for_score(score):
    for threshold, grade in GRADE_THRESHOLDS:
        if score >= threshold:
            return grade
    return "F"


def label_for_grade(grade):
    return GRADE_LABELS.get(grade, "")


def describe(game):
    """The three score fields the API attaches to every returned game."""
    score = score_game(game)
    if score is None:
        return {"laneScore": None, "laneGrade": None, "gradeLabel": None}
    grade = grade_for_score(score)
    return {"laneScore": score, "laneGrade": grade, "gradeLabel": label_for_grade(grade)}
