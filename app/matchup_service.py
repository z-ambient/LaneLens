from app.champions import get_champion_name

def find_my_participant(current_game, my_puuid):
    for participant in current_game["participants"]:
        if participant["puuid"] == my_puuid:
            return participant
    return None

def format_participant(participant):
    champion_id = participant["championId"]

    return {
        "summoner_name": participant.get("summonerName"),
        "champion_id": champion_id,
        "champion_name": get_champion_name(champion_id),
        "team_id": participant["teamId"]
    }

def split_teams(current_game):
    team_100 = []
    team_200 = []

    for participant in current_game["participants"]:
        formatted = format_participant(participant)


        if participant["teamId"] == 100:
            team_100.append(formatted)
        else:
            team_200.append(formatted)
    
    return team_100, team_200

def summarize_live_game(current_game, my_puuid):
    my_participant = find_my_participant(current_game, my_puuid)

    if my_participant is None:
        return None
    
    my_team_id = my_participant["teamId"]
    team_100, team_200 = split_teams(current_game)

    if my_team_id == 100:
        my_team = team_100
        enemy_team = team_200
    else:
        my_team = team_200
        enemy_team = team_100

    formatted_me = format_participant(my_participant)

    return {
        "my_champion": formatted_me["champion_name"],
        "my_participant": formatted_me,
        "my_team": my_team,
        "enemy_team": enemy_team,
    }