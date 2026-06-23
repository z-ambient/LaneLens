# LaneLens

A FastAPI backend that uses the RIOT API to provide live matchup advice in League of Legends.

AI is intentionally not added

## Current Features

- Look up Riot account by Riot ID
- Get a player's current live game
- Summarize current champion, team, and enemy team
- Convert champion IDs into champion names
- Look up matchup advice from data/matchups.json
- Combine live game data with manual enemy champion matchup advice 

## Tech Stack

- Python
- FastAPI
- Uvicorn
- requests
- python-dotenv
- Riot API
- Json

## Setup
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt

Creat a .env file
RIOT_API_KEY=your-riot-api-key
DEFAULT_REGION=na1
DEFAULT_ROUTING=americas

Run the server
uvicorn app.main:app --reload

Routes:
GET /live-game?game_name=ambient&tag_line=zee
GET /summary?game_name=ambient&tag_line=zee
GET /matchup?my_champion=Malphite&enemy_champion=Sett
GET /live_matchup?game_name=ambient&tag_line=zee&enemy_champion=Sett