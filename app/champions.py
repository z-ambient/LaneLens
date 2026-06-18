

CHAMPION_IDS = {
    54: "Malphite",
    875: "Sett",
    36: "Dr. Mundo",
    75: "Nasus",
    10: "Kayle",
    266: "Aatrox",
    58: "Renekton",
    24: "Jax",
    86: "Garen",
    122: "Darius",
}

def get_champion_name(champion_id):
    return CHAMPION_IDS.get(
        champion_id,
        f"Unknown Champion ID: {champion_id}",
    )