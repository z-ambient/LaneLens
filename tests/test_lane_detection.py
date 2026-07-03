"""Unit tests for lane inference and the advice engine (offline)."""

from app.advice_engine import build_advice, build_team_notes, get_curated_matchup
from app.lane_detection import assign_lanes, find_lane_opponent


def _participant(puuid, spell1=4, spell2=14):
    return {"puuid": puuid, "spell1Id": spell1, "spell2Id": spell2}


def _champ(name, tags=None, attack=5, magic=5):
    return {"name": name, "id": name, "tags": tags or ["Fighter"], "attack": attack, "magic": magic}


def test_smite_wins_jungle():
    participants = [
        _participant("top"), _participant("jg", spell1=11), _participant("mid"),
        _participant("bot"), _participant("sup"),
    ]
    champs = {
        "top": _champ("Darius"), "jg": _champ("Teemo"), "mid": _champ("Ahri", ["Mage"]),
        "bot": _champ("Jinx", ["Marksman"]), "sup": _champ("Thresh", ["Support"]),
    }
    lanes = assign_lanes(participants, champs)
    # Even a Teemo carries Smite -> Jungle beats his Top preference.
    assert lanes["jg"] == "Jungle"
    assert lanes["top"] == "Top"
    assert lanes["mid"] == "Mid"
    assert lanes["bot"] == "Bot"
    assert lanes["sup"] == "Support"
    assert len(set(lanes.values())) == 5


def test_non_five_player_team_gets_no_lanes():
    assert assign_lanes([_participant("a"), _participant("b")], {}) == {}


def test_find_lane_opponent():
    enemies = [_participant("e1"), _participant("e2")]
    lanes = {"e1": "Top", "e2": "Mid"}
    assert find_lane_opponent("Mid", enemies, lanes)["puuid"] == "e2"
    assert find_lane_opponent("Bot", enemies, lanes) is None
    assert find_lane_opponent(None, enemies, lanes) is None


def test_curated_matchup_loaded():
    curated = get_curated_matchup("Malphite", "Sett")
    assert curated["difficulty"] == "Medium"
    assert get_curated_matchup("Malphite", "Nobody") is None


def test_build_advice_without_opponent():
    me = _champ("Malphite", ["Tank"], attack=5, magic=7)
    team = [me] + [_champ("Ally{}".format(i)) for i in range(4)]
    enemies = [_champ("Enemy{}".format(i), attack=8, magic=2) for i in range(5)]
    difficulty, advice = build_advice(me, None, "Top", team, enemies)
    assert difficulty in ("Easy", "Medium", "Hard")
    assert advice["extras"]["resistPriority"] == "Armor"
    assert advice["startingItem"]
    assert isinstance(advice["extraTips"], list)


def test_anti_heal_flagged_for_healing_enemies():
    me = _champ("Garen", ["Fighter"])
    team = [me] + [_champ("A{}".format(i)) for i in range(4)]
    enemies = [_champ("Dr. Mundo", ["Tank"])] + [_champ("E{}".format(i)) for i in range(4)]
    _, advice = build_advice(me, enemies[0], "Top", team, enemies)
    assert advice["extras"]["antiHeal"].startswith("Yes")


def test_team_notes_ap_heavy_enemy():
    my_team = [_champ("A{}".format(i)) for i in range(5)]
    enemy_team = [_champ("E{}".format(i), attack=2, magic=9) for i in range(5)]
    notes = build_team_notes(my_team, enemy_team)
    assert any("magic resist" in note.lower() for note in notes)
