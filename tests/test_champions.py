from app.champions import get_champion_name, load_champion_ids

def test_get_champion_name():
    assert get_champion_name(54) == "Malphite"

def test_get_champion_name_unknown():
    assert get_champion_name(777777) == "Unknown Champion ID: 777777"

def test_load_champion_ids():
    result = load_champion_ids()

    assert isinstance(result, dict)
    assert result[54] == "Malphite"
    assert all(isinstance(name, str) for name in result.values())