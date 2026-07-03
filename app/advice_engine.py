"""Deterministic matchup-advice engine.

Produces the full structured advice payload from champion classes, team
damage profiles, and the curated matchup knowledge in data/matchups.json
(carried over from the original LaneLens-Manual project). This engine always
works with no LLM key; app.ai_agent can optionally refine its output.
"""

import json
import os

_MATCHUPS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "matchups.json",
)

# Champions whose sustain usually justifies anti-heal.
HEALING_CHAMPIONS = {
    "Aatrox", "Briar", "Dr. Mundo", "Fiora", "Gwen", "Illaoi", "Irelia",
    "Kayn", "Maokai", "Nami", "Nasus", "Olaf", "Rhaast", "Sett", "Sona",
    "Soraka", "Swain", "Sylas", "Trundle", "Vladimir", "Warwick", "Yuumi",
    "Zac",
}

# Champions with strong hard-engage for team-comp notes.
ENGAGE_CHAMPIONS = {
    "Alistar", "Amumu", "Diana", "Gragas", "Hecarim", "Jarvan IV", "Kennen",
    "Leona", "Malphite", "Maokai", "Nautilus", "Nocturne", "Ornn", "Rakan",
    "Rell", "Sejuani", "Sion", "Vi", "Wukong", "Zac",
}

# Champions that outscale most opponents into the late game.
SCALING_CHAMPIONS = {
    "Aphelios", "Aurelion Sol", "Azir", "Cho'Gath", "Fiora", "Gangplank",
    "Hwei", "Jax", "Jinx", "Karthus", "Kassadin", "Kayle", "Kindred",
    "Kog'Maw", "Master Yi", "Nasus", "Ornn", "Ryze", "Senna", "Seraphine",
    "Smolder", "Sona", "Twitch", "Vayne", "Veigar", "Vladimir", "Zeri",
}


def load_curated_matchups():
    with open(_MATCHUPS_PATH) as file:
        return json.load(file)


def get_curated_matchup(my_champion_name, enemy_champion_name):
    matchups = load_curated_matchups()
    return matchups.get(my_champion_name, {}).get(enemy_champion_name)


def _primary_class(champ):
    tags = champ.get("tags") or []
    return tags[0] if tags else "Fighter"


def _is_ad(champ):
    return champ.get("attack", 5) >= champ.get("magic", 5)


def _team_damage_profile(team):
    """Rough physical/magic split for a list of champion records."""
    physical = sum(1 for champ in team if _is_ad(champ))
    magic = len(team) - physical
    return physical, magic


def _starting_item(my_class, enemy_champ, my_lane):
    if my_lane == "Jungle":
        return "Jungle companion (Mosstomper for tanks, Gustwalker/Scorchling otherwise)"
    if my_lane == "Support":
        return "World Atlas"
    if my_class == "Marksman":
        return "Doran's Blade"
    if my_class == "Mage":
        return "Doran's Ring"
    if enemy_champ and _primary_class(enemy_champ) in ("Marksman", "Mage"):
        return "Doran's Shield (survive ranged poke)"
    return "Doran's Shield"


def _boots(my_class, enemy_champ, enemy_team):
    physical, magic = _team_damage_profile(enemy_team)
    if my_class == "Marksman":
        return "Berserker's Greaves"
    if enemy_champ is not None:
        if _is_ad(enemy_champ) and physical >= magic:
            return "Plated Steelcaps"
        if not _is_ad(enemy_champ):
            return "Mercury's Treads"
    return "Plated Steelcaps" if physical >= magic else "Mercury's Treads"


def _class_plans(my_class):
    """Default lane/teamfight plans per champion class."""
    plans = {
        "Tank": {
            "gameDirection": "Group with your team, start fights, and soak damage. You are the frontline.",
            "teamfightPlan": "Engage onto the enemy backline or peel for your carries - pick one job per fight.",
            "trading": "Take short trades around your crowd control, then reset. Avoid extended even trades before your first tank item.",
        },
        "Fighter": {
            "gameDirection": "Side-lane for pressure when your team is safe. Group when your team needs frontline or a fight is starting.",
            "teamfightPlan": "Flank or dive the enemy carries once key enemy cooldowns are used - do not walk in first through poke.",
            "trading": "Look for extended trades where your sustained damage wins. Back off when enemy burst cooldowns are up.",
        },
        "Assassin": {
            "gameDirection": "Roam from mid to snowball side lanes. Play for picks on isolated targets.",
            "teamfightPlan": "Wait for the fight to start, then delete the enemy carry. Never engage first into full crowd control.",
            "trading": "Short burst trades when your combo is up. Disengage before minion aggro and cooldown gaps punish you.",
        },
        "Mage": {
            "gameDirection": "Group with your team and control choke points with your range.",
            "teamfightPlan": "Stay behind your frontline and hit whoever is reachable safely - damage output beats hero plays.",
            "trading": "Poke when your key spell is up and the enemy walks up to farm. Keep distance when it is down.",
        },
        "Marksman": {
            "gameDirection": "Farm to your item spikes, group mid game, and take towers after picks.",
            "teamfightPlan": "Kite off your frontline, attack the nearest safe target, and never get touched first.",
            "trading": "Trade autos when the enemy goes for last-hits. Respect all-in ranges and keep the wave in a safe spot.",
        },
        "Support": {
            "gameDirection": "Roam mid after wave pushes, deep-ward with your jungler, and stay with your carry when the enemy looks for picks.",
            "teamfightPlan": "Peel for your best carry first; use your engage or utility only when it clearly wins the fight.",
            "trading": "Trade around your carry's damage windows, not alone. Track enemy support roams.",
        },
    }
    return plans.get(my_class, plans["Fighter"])


def _difficulty(my_champ, enemy_champ):
    """Honest rough estimate when no curated data exists."""
    if enemy_champ is None:
        return "Medium"
    my_class = _primary_class(my_champ)
    enemy_class = _primary_class(enemy_champ)
    hard_for = {
        "Tank": {"Mage", "Marksman"},
        "Fighter": {"Marksman", "Mage"},
        "Assassin": {"Tank"},
        "Mage": {"Assassin"},
        "Marksman": {"Assassin"},
        "Support": set(),
    }
    if enemy_class in hard_for.get(my_class, set()):
        return "Hard"
    return "Medium"


def build_team_notes(my_team, enemy_team):
    """Short comp notes like 'Enemy team has strong engage'."""
    notes = []
    my_names = {champ["name"] for champ in my_team}
    enemy_names = {champ["name"] for champ in enemy_team}

    if len(enemy_names & ENGAGE_CHAMPIONS) >= 2:
        notes.append("Enemy team has strong engage - respect fog of war and do not get picked.")
    if len(my_names & ENGAGE_CHAMPIONS) >= 2:
        notes.append("Your team has strong engage - look for fights when your combo is up.")
    if len(my_names & SCALING_CHAMPIONS) >= 2:
        notes.append("Your team scales well - avoid early 5v5s and trade objectives for farm.")
    if len(enemy_names & SCALING_CHAMPIONS) >= 2:
        notes.append("Enemy team outscales - force early plays and end before 30 minutes.")

    physical, magic = _team_damage_profile(enemy_team)
    if physical >= 4:
        notes.append("Enemy damage is almost all physical - armor items are very efficient.")
    elif magic >= 4:
        notes.append("Enemy damage is almost all magic - prioritize magic resist.")

    if not notes:
        notes.append("Balanced comps - play around whichever side hits item spikes first.")
    return notes


def _pick_target(team, wanted_classes):
    for champ in team:
        if _primary_class(champ) in wanted_classes:
            return champ["name"]
    return None


def build_advice(my_champ, enemy_champ, my_lane, my_team, enemy_team):
    """Return (difficulty, advice_dict) for the standardized response shape.

    my_team / enemy_team are lists of champion records (including my_champ /
    enemy_champ). enemy_champ may be None when no lane opponent is known.
    """
    my_class = _primary_class(my_champ)
    enemy_name = enemy_champ["name"] if enemy_champ else "your lane opponent"
    plans = _class_plans(my_class)

    curated = None
    if enemy_champ is not None:
        curated = get_curated_matchup(my_champ["name"], enemy_champ["name"])

    physical, magic = _team_damage_profile(enemy_team)
    resist_priority = "Armor" if physical > magic else (
        "Magic resist" if magic > physical else "Mixed - buy based on who is fed"
    )

    healers = sorted({champ["name"] for champ in enemy_team} & HEALING_CHAMPIONS)
    if healers:
        anti_heal = "Yes - buy anti-heal if {} get ahead.".format(" or ".join(healers))
    else:
        anti_heal = "Not required from champion select - buy only if enemy sustain items appear."

    focus = _pick_target(enemy_team, {"Marksman", "Mage"}) or enemy_name
    avoid = _pick_target(enemy_team, {"Tank"})
    play_around = _pick_target(
        [champ for champ in my_team if champ["name"] != my_champ["name"]],
        {"Marksman", "Mage"},
    )

    difficulty = curated["difficulty"] if curated else _difficulty(my_champ, enemy_champ)

    advice = {
        "startingItem": curated["first_buy"] if curated else _starting_item(my_class, enemy_champ, my_lane),
        "boots": _boots(my_class, enemy_champ, enemy_team),
        "firstItem": (
            "Follow your build direction below - finish your first full item before contesting long fights."
            if curated else
            "Take your champion's standard first item; adjust defensively if you fall behind against {}.".format(enemy_name)
        ),
        "buildDirection": curated["build_direction"] if curated else (
            "{} priority based on the enemy comp ({} physical / {} magic threats).".format(
                resist_priority, physical, magic
            )
        ),
        "lanePlan": curated["lane_plan"] if curated else (
            "Play the first waves safely, learn {}'s trading pattern, and only commit when their key ability is down.".format(enemy_name)
        ),
        "tradingPattern": plans["trading"],
        "dangerWindows": (
            "Most dangerous when your escape/trade cooldowns are down, when the wave pushes toward {}, and when their jungler is not visible.".format(enemy_name)
        ),
        "howToWinLane": (
            "Win on consistency: take the free trades your kit allows, keep even CS, and turn small leads into wave control - you do not need a solo kill."
        ),
        "commonMistakes": (
            "Forcing trades with cooldowns down, chasing past the river without vision, and ignoring the wave state to look for kills."
        ),
        "gameDirection": plans["gameDirection"],
        "teamfightPlan": plans["teamfightPlan"],
        "extraTips": list(curated["tips"]) if curated else [
            "Ward the closest river bush before minions meet on the third wave.",
            "Track the enemy jungler's start from leashes and first gank timing.",
        ],
        # Extended fields used by the dashboard's Game Direction / Extra Info cards.
        "extras": {
            "winCondition": plans["gameDirection"],
            "biggestThreats": focus,
            "playAround": play_around or "your strongest scaling teammate",
            "focusTarget": focus,
            "avoidTarget": avoid or "the enemy frontline - do not dump damage into tanks",
            "jungleThreat": "Assume the enemy jungler paths toward whichever lane is pushing - ward river at 2:45.",
            "recallTiming": "Recall after crashing a big wave into the enemy tower, ideally with enough gold for a component item.",
            "first10Min": "Farm > kills. Hit your first item component, keep vision on river, and match roams by pinging instead of chasing.",
            "itemWarnings": build_team_notes(my_team, enemy_team),
            "antiHeal": anti_heal,
            "resistPriority": resist_priority,
        },
    }
    return difficulty, advice
