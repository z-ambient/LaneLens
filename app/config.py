import os
from dotenv import load_dotenv

load_dotenv()

RIOT_API_KEY = os.getenv("RIOT_API_KEY")
DEFAULT_REGION = os.getenv("DEFAULT_REGION", "na1")
DEFAULT_ROUTING = os.getenv("DEFAULT_ROUTING", "americas")

if not RIOT_API_KEY:
    raise RuntimeError("Missing RIOT_API_KEY")

