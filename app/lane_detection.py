"""Best-effort lane assignment and lane-opponent inference.

Spectator-v5 does NOT include lane/role data, so V1 infers lanes:
  1. Smite (summoner spell 11) marks the jungler - strongest signal.
  2. A curated champion -> preferred-positions map covers popular picks.
  3. Data Dragon tags provide a rough fallback (Marksman -> Bot, etc.).

Lanes are assigned per team by greedy best-score matching so each of the five
lanes gets exactly one player. Results are always reported to the frontend as
"inferred" (or "manual" when the user overrides) - never "confirmed".
"""

SMITE_SPELL_ID = 11

LANES = ["Top", "Jungle", "Mid", "Bot", "Support"]

# Preferred positions (most common first) for frequently played champions.
# Champions not listed fall back to Data Dragon tag heuristics.
POSITION_PREFERENCES = {
    "Aatrox": ["Top"], "Ahri": ["Mid"], "Akali": ["Mid", "Top"],
    "Akshan": ["Mid", "Top"], "Alistar": ["Support"], "Ambessa": ["Top", "Jungle"],
    "Amumu": ["Jungle", "Support"], "Anivia": ["Mid"], "Annie": ["Mid", "Support"],
    "Aphelios": ["Bot"], "Ashe": ["Bot", "Support"], "Aurelion Sol": ["Mid"],
    "Aurora": ["Mid", "Top"], "Azir": ["Mid"], "Bard": ["Support"],
    "Bel'Veth": ["Jungle"], "Blitzcrank": ["Support"], "Brand": ["Support", "Mid"],
    "Braum": ["Support"], "Briar": ["Jungle"], "Caitlyn": ["Bot"],
    "Camille": ["Top"], "Cassiopeia": ["Mid"], "Cho'Gath": ["Top"],
    "Corki": ["Mid", "Bot"], "Darius": ["Top"], "Diana": ["Jungle", "Mid"],
    "Dr. Mundo": ["Top", "Jungle"], "Draven": ["Bot"], "Ekko": ["Jungle", "Mid"],
    "Elise": ["Jungle"], "Evelynn": ["Jungle"], "Ezreal": ["Bot"],
    "Fiddlesticks": ["Jungle"], "Fiora": ["Top"], "Fizz": ["Mid"],
    "Galio": ["Mid", "Support"], "Gangplank": ["Top"], "Garen": ["Top"],
    "Gnar": ["Top"], "Gragas": ["Jungle", "Top"], "Graves": ["Jungle"],
    "Gwen": ["Top"], "Hecarim": ["Jungle"], "Heimerdinger": ["Mid", "Top"],
    "Hwei": ["Mid", "Support"], "Illaoi": ["Top"], "Irelia": ["Top", "Mid"],
    "Ivern": ["Jungle"], "Janna": ["Support"], "Jarvan IV": ["Jungle"],
    "Jax": ["Top", "Jungle"], "Jayce": ["Top", "Mid"], "Jhin": ["Bot"],
    "Jinx": ["Bot"], "K'Sante": ["Top"], "Kai'Sa": ["Bot"],
    "Kalista": ["Bot"], "Karma": ["Support"], "Karthus": ["Jungle"],
    "Kassadin": ["Mid"], "Katarina": ["Mid"], "Kayle": ["Top"],
    "Kayn": ["Jungle"], "Kennen": ["Top"], "Kha'Zix": ["Jungle"],
    "Kindred": ["Jungle"], "Kled": ["Top"], "Kog'Maw": ["Bot"],
    "LeBlanc": ["Mid"], "Lee Sin": ["Jungle"], "Leona": ["Support"],
    "Lillia": ["Jungle"], "Lissandra": ["Mid"], "Lucian": ["Bot"],
    "Lulu": ["Support"], "Lux": ["Support", "Mid"], "Malphite": ["Top", "Support"],
    "Malzahar": ["Mid"], "Maokai": ["Support", "Jungle"], "Master Yi": ["Jungle"],
    "Mel": ["Mid", "Support"], "Milio": ["Support"], "Miss Fortune": ["Bot"],
    "Mordekaiser": ["Top"], "Morgana": ["Support"], "Naafiri": ["Mid", "Jungle"],
    "Nami": ["Support"], "Nasus": ["Top"], "Nautilus": ["Support"],
    "Neeko": ["Mid", "Support"], "Nidalee": ["Jungle"], "Nilah": ["Bot"],
    "Nocturne": ["Jungle"], "Nunu & Willump": ["Jungle"], "Olaf": ["Top", "Jungle"],
    "Orianna": ["Mid"], "Ornn": ["Top"], "Pantheon": ["Support", "Top", "Mid"],
    "Poppy": ["Jungle", "Top"], "Pyke": ["Support"], "Qiyana": ["Mid"],
    "Quinn": ["Top"], "Rakan": ["Support"], "Rammus": ["Jungle"],
    "Rek'Sai": ["Jungle"], "Rell": ["Support"], "Renata Glasc": ["Support"],
    "Renekton": ["Top"], "Rengar": ["Jungle", "Top"], "Riven": ["Top"],
    "Rumble": ["Top", "Mid"], "Ryze": ["Mid"], "Samira": ["Bot"],
    "Sejuani": ["Jungle"], "Senna": ["Support", "Bot"], "Seraphine": ["Support", "Bot"],
    "Sett": ["Top", "Support"], "Shaco": ["Jungle", "Support"], "Shen": ["Top", "Support"],
    "Shyvana": ["Jungle"], "Singed": ["Top"], "Sion": ["Top"],
    "Sivir": ["Bot"], "Skarner": ["Jungle", "Top"], "Smolder": ["Bot", "Mid"],
    "Sona": ["Support"], "Soraka": ["Support"], "Swain": ["Support", "Mid"],
    "Sylas": ["Mid", "Top"], "Syndra": ["Mid"], "Tahm Kench": ["Support", "Top"],
    "Taliyah": ["Jungle", "Mid"], "Talon": ["Mid", "Jungle"], "Taric": ["Support"],
    "Teemo": ["Top"], "Thresh": ["Support"], "Tristana": ["Bot", "Mid"],
    "Trundle": ["Top", "Jungle"], "Tryndamere": ["Top"], "Twisted Fate": ["Mid"],
    "Twitch": ["Bot", "Jungle"], "Udyr": ["Jungle", "Top"], "Urgot": ["Top"],
    "Varus": ["Bot"], "Vayne": ["Bot", "Top"], "Veigar": ["Mid"],
    "Vel'Koz": ["Support", "Mid"], "Vex": ["Mid"], "Vi": ["Jungle"],
    "Viego": ["Jungle"], "Viktor": ["Mid"], "Vladimir": ["Mid", "Top"],
    "Volibear": ["Jungle", "Top"], "Warwick": ["Jungle", "Top"], "Wukong": ["Jungle", "Top"],
    "Xayah": ["Bot"], "Xerath": ["Support", "Mid"], "Xin Zhao": ["Jungle"],
    "Yasuo": ["Mid", "Top"], "Yone": ["Mid", "Top"], "Yorick": ["Top"],
    "Yunara": ["Bot"], "Yuumi": ["Support"], "Zac": ["Jungle", "Top"],
    "Zed": ["Mid", "Jungle"], "Zeri": ["Bot"], "Ziggs": ["Bot", "Mid"],
    "Zilean": ["Support", "Mid"], "Zoe": ["Mid", "Support"], "Zyra": ["Support", "Jungle"],
}

# Rough lane guesses from Data Dragon tags, used only when a champion is
# missing from POSITION_PREFERENCES.
_TAG_LANES = {
    "Marksman": ["Bot", "Mid"],
    "Support": ["Support"],
    "Mage": ["Mid", "Support"],
    "Assassin": ["Mid", "Jungle"],
    "Fighter": ["Top", "Jungle"],
    "Tank": ["Top", "Support"],
}


def _lane_scores(participant, champion):
    """Score how well a participant fits each lane. Higher = better fit."""
    scores = {lane: 0 for lane in LANES}

    has_smite = SMITE_SPELL_ID in (
        participant.get("spell1Id"),
        participant.get("spell2Id"),
    )
    if has_smite:
        scores["Jungle"] += 100

    prefs = POSITION_PREFERENCES.get(champion["name"])
    if prefs:
        for index, lane in enumerate(prefs):
            scores[lane] += 20 - index * 6
    else:
        for tag in champion.get("tags", []):
            for index, lane in enumerate(_TAG_LANES.get(tag, [])):
                scores[lane] += 8 - index * 3

    return scores


def assign_lanes(participants, champions_by_puuid):
    """Greedy-assign the five lanes within one team.

    participants: spectator participant dicts for one team.
    champions_by_puuid: puuid -> champion record.
    Returns puuid -> lane. Non-5-player teams (e.g. Arena) get no lanes.
    """
    if len(participants) != 5:
        return {}

    all_scores = []
    for participant in participants:
        champ = champions_by_puuid[participant["puuid"]]
        scores = _lane_scores(participant, champ)
        for lane, score in scores.items():
            all_scores.append((score, participant["puuid"], lane))

    # Highest scores claim their lane first; each player and lane used once.
    all_scores.sort(key=lambda item: -item[0])
    assigned = {}
    taken_lanes = set()
    for score, puuid, lane in all_scores:
        if puuid in assigned or lane in taken_lanes:
            continue
        assigned[puuid] = lane
        taken_lanes.add(lane)

    return assigned


def find_lane_opponent(my_lane, enemy_participants, enemy_lanes):
    """Return the enemy participant assigned to the same lane, if any."""
    if not my_lane:
        return None
    for participant in enemy_participants:
        if enemy_lanes.get(participant["puuid"]) == my_lane:
            return participant
    return None
