"""Environment configuration for LaneLens.

Secrets are loaded from a .env file (see .env.example). The Riot API key is
intentionally NOT validated at import time so the app can still start and
return a clean setup error from the API instead of crashing.
"""

import os

from dotenv import load_dotenv

load_dotenv()

RIOT_API_KEY = os.getenv("RIOT_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Discord OAuth (optional) - enables "Sign in with Discord" accounts.
DISCORD_CLIENT_ID = os.getenv("DISCORD_CLIENT_ID")
DISCORD_CLIENT_SECRET = os.getenv("DISCORD_CLIENT_SECRET")

# AI models. PRIMARY answers the cacheable matchup sections (build, lane) -
# generated once per matchup per patch and reused by everyone, so quality
# compounds. FAST answers the per-game sections (gameplan, extras) that run
# fresh on every analysis - this is where recurring cost lives.
AI_MODEL_PRIMARY = os.getenv("AI_MODEL_PRIMARY", "gpt-5.5")
AI_MODEL_FAST = os.getenv("AI_MODEL_FAST", "gpt-5.4-mini")

DEFAULT_PLATFORM = os.getenv("DEFAULT_PLATFORM", "na1")
DEFAULT_REGION = os.getenv("DEFAULT_REGION", "americas")

# Platform (e.g. na1) -> regional routing (e.g. americas) for the Account API.
REGION_BY_PLATFORM = {
    "na1": "americas",
    "br1": "americas",
    "la1": "americas",
    "la2": "americas",
    "oc1": "americas",
    "euw1": "europe",
    "eun1": "europe",
    "tr1": "europe",
    "ru": "europe",
    "kr": "asia",
    "jp1": "asia",
    "sg2": "sea",
    "tw2": "sea",
    "vn2": "sea",
}


def riot_key_present():
    return bool(RIOT_API_KEY)
