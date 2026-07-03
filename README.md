# LaneLens

![tests](https://github.com/z-ambient/LaneLens/actions/workflows/test.yml/badge.svg)

**Win lane. Play smarter. Know the matchup.**

LaneLens is a League of Legends live-matchup assistant. Enter your Riot ID while
loading into a game, click **Analyze My Matchup**, and get a practical game plan:
lane matchup tips, build direction, team-comp notes, and overall game direction —
all readable during a loading screen.

Built with Python + FastAPI on the backend and a static HTML/CSS/JS dashboard,
evolved from the original [LaneLens-Manual](https://github.com/z-ambient/LaneLens-Manual) project.

## How it works

1. **Account lookup** — Riot Account-v1 converts your Riot ID (name#tag) to a PUUID
   (regional routing, e.g. `americas`).
2. **Live game lookup** — Spectator-v5 fetches your current game (platform routing,
   e.g. `na1`). No live game returns a clean error.
3. **Champion mapping** — Data Dragon (latest version, with a bundled offline
   fallback) maps champion IDs to names and icons.
4. **Lane inference** — best-effort: Smite marks junglers, then a champion
   role-preference map assigns the remaining lanes. The dashboard always labels the
   matchup **confirmed / inferred / manual** — and you can correct the opponent
   manually and re-analyze.
5. **Advice** — a deterministic engine builds structured advice from curated
   matchup data (`data/matchups.json`), champion classes, and team damage
   profiles. If `OPENAI_API_KEY` is set, the advice is refined by AI; any AI
   failure silently falls back to the deterministic advice.
6. **Selected runes** — the player's rune page comes straight from the live
   game (Spectator perks), mapped to names and icons via Data Dragon.
7. **Progressive AI loading with a persistent matchup cache** — the analysis
   returns instantly with deterministic advice (~1s: just the two Riot
   calls), then the frontend requests AI refinement in the background
   (`POST /api/enhance-advice`) and the dashboard updates in place with an
   "AI enhanced" badge. The AI's matchup-specific output is cached on disk
   (`data/advice_cache.json`, keyed by champion + enemy + lane) and reused
   until the game patch changes — Data Dragon's version acts as the
   freshness check. The first time a matchup is analyzed the AI takes
   ~30-60s in the background; **every later game with the same matchup gets
   AI-quality advice in milliseconds**, so LaneLens gets faster the more
   you use it. Team-dependent fields (win condition, biggest threats, who
   to play around) are never cached — they are regenerated from the actual
   teams in every game.
8. **Auto-detect and matchup history** — with a saved player and Auto-detect
   on, the frontend quietly polls every 30s and brings up the dashboard the
   moment a live game appears (pauses while the tab is hidden; backs off on
   rate limits). The overview also shows your real win/loss record in the
   current matchup, built from Match-v5: each analysis processes only games
   it has never seen before (stored in `data/matchup_history.json`,
   gitignored), pairing you with the enemy in your `teamPosition` on
   Summoner's Rift queues and skipping remakes.

## Setup

Requires Python 3.10+ (developed on 3.13).

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create a `.env` file in the project root (copy `.env.example`):

```env
RIOT_API_KEY=your_api_key_here
OPENAI_API_KEY=            # optional - enables AI-refined advice
DEFAULT_PLATFORM=na1
DEFAULT_REGION=americas
```

Get a Riot API key at <https://developer.riotgames.com> (development keys expire
every 24 hours). The key is used **only on the backend** — it is never sent to,
logged by, or exposed in the browser.

## Run

```bash
uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000/> for the app, or <http://127.0.0.1:8000/docs> for
the interactive API docs.

## API

### `POST /api/analyze-matchup`

```json
{
  "gameName": "PlayerName",
  "tagLine": "NA1",
  "platform": "na1",
  "region": "americas",
  "manualEnemyChampion": "Sett",
  "manualLane": "Top"
}
```

`region` is derived from `platform` when omitted. `manualEnemyChampion` /
`manualLane` are optional overrides when lane inference guesses wrong.

Success returns `{"ok": true, "source": "riot-api", "player": {...},
"matchup": {...}, "teams": {"blue": [...], "red": [...]}, "advice": {...}}`.
Failures return `{"ok": false, "error": "..."}` with a matching HTTP status —
e.g. `404` with `"No live League of Legends game found for this player."`

### Other routes

| Route | Description |
|---|---|
| `POST /api/enhance-advice` | Background AI refinement of a matchup (cache-first; see step 7 above) |
| `POST /api/matchup-history` | Background lookup of the player's real W/L record in this matchup (Match-v5, incremental disk store) |
| `GET /api/demo-matchup` | Demo Malphite-vs-Sett dashboard data (no Riot call) |
| `GET /api/health` | Backend health + whether the Riot key is configured |
| `GET /` | The dashboard frontend |

## Tests

```bash
python -m pytest
```

All Riot calls are mocked — tests need no network or API key.

## Manual testing checklist

1. **Demo match** — click *Use Demo Match* with no `.env` at all; the full
   dashboard should render Malphite vs Sett.
2. **Missing Riot ID** — submit with an empty game name; inline error appears.
3. **Invalid Riot ID** — analyze `ThisNameDoesNotExist#XX99`; "Riot account not
   found" error appears.
4. **Not in game** — analyze your real Riot ID while not in a match; "No live
   game found. Start a League match, then try again."
5. **Live game** — start a match (practice tool does not appear in Spectator;
   use a real queue), then analyze during loading/early game; dashboard shows
   your champion, both teams, and the inferred lane opponent.
6. **Missing API key** — remove `RIOT_API_KEY` from `.env`, restart, analyze;
   a backend setup error appears (no secrets shown).
7. **Rate limit / Riot errors** — spam analyze ~25 times in 20s on a dev key;
   a rate-limit message with retry advice appears, and the demo match still works.

## Project structure

```text
LaneLens/
├── app/
│   ├── main.py            # FastAPI app + POST /api/analyze-matchup
│   ├── config.py          # env loading, platform->region routing map
│   ├── riot_client.py     # Riot Account-v1 + Spectator-v5 (key stays here)
│   ├── champions.py       # Data Dragon mapping (latest ver + offline fallback)
│   ├── lane_detection.py  # Smite + role preferences -> lane/opponent inference
│   ├── advice_engine.py   # deterministic structured advice + team notes
│   ├── ai_agent.py        # optional OpenAI refinement (falls back cleanly)
│   └── demo.py            # demo match payload
├── data/
│   ├── matchups.json            # curated matchup knowledge (from LaneLens-Manual)
│   └── champions_fallback.json  # bundled Data Dragon snapshot
├── frontend/              # static dashboard (HTML/CSS/JS, no build step)
├── tests/                 # pytest suite, Riot API mocked
├── .env.example
└── requirements.txt
```

## Known V1 limitations

- Lane inference is heuristic (Spectator-v5 has no role data) — hence the
  confidence badge and manual override.
- Curated matchup depth covers a few champions; everything else uses the
  generated class-based advice (or AI refinement when enabled).
- Riot development API keys expire daily and have low rate limits.

---

*LaneLens is not endorsed by Riot Games. League of Legends is a trademark of Riot Games, Inc.*
