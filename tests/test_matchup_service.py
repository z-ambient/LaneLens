from app.matchup_service import (get_matchup_data, format_participant, find_my_participant,
                                 split_teams, summarize_live_game, load_matchup_data)

def test_get_existing_matchup():
    advice = get_matchup_data("Malphite", "Sett")

    assert advice is not None
    assert advice["difficulty"] == "Medium"
    assert len(advice["tips"]) > 0

def test_format_participant():
    participant = {
        "summonerName": "Big Stepper Z",
        "championId": 54,
        "teamId": 100,
    }

    result = format_participant(participant)

    assert result == {
        "summoner_name": "Big Stepper Z",
        "champion_id": 54,
        "champion_name": "Malphite",
        "team_id": 100,
    }

def test_find_my_participant():
    current_game = {
        "participants": [
            {
                "puuid": "player1",
                "summonerName": "Big Stepper Z",
                "championId": 54,
                "teamId": 100,
            },
            {
                "puuid": "player2",
                "summonerName": "trashcanbigbad",
                "championId": 85,
                "teamId": 200,
            },
        ]
    }

    result = find_my_participant(current_game, "player1")

    assert result == current_game["participants"][0]

def test_find_my_participant_none():
    current_game = {
        "participants": [
            {
                "puuid": "player1",
                "summonerName": "Big Stepper Z",
                "championId": 54,
                "teamId": 100,
            },
            {
                "puuid": "player2",
                "summonerName": "trashcanbigbad",
                "championId": 85,
                "teamId": 200,
            },
        ]
    }

    result = find_my_participant(current_game, "lebron james")

    assert result is None

# So I don't have to keep remaking fake game data
def make_current_game():
    return {
        "participants": [
            {
                "puuid": "player1",
                "summonerName": "Big Stepper Z",
                "championId": 54,
                "teamId": 100,
            },
            {
                "puuid": "player2",
                "summonerName": "trashcanbigbad",
                "championId": 85,
                "teamId": 200,
            },
        ]
    }

def test_split_teams():
    current_game = make_current_game()

    team_100, team_200 = split_teams(current_game)

    assert team_100[0]["summoner_name"] == "Big Stepper Z"
    assert team_200[0]["champion_id"] == 85

def test_summarize_live_game():
    current_game = make_current_game()

    summary = summarize_live_game(current_game, "player1")

    assert summary["my_participant"]["summoner_name"] == "Big Stepper Z"

def test_summarize_live_game_none():
    current_game = make_current_game()

    summary = summarize_live_game(current_game, "fakegamer")

    assert summary is None

def test_load_matchup_data():
    matchups = load_matchup_data()

    assert isinstance(matchups, dict)
    assert "Dr. Mundo" in matchups