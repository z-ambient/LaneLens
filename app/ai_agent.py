"""Optional AI refinement of matchup advice (OpenAI, carried over from
LaneLens-Manual but upgraded to return structured JSON instead of prose).

The deterministic advice from app.advice_engine is always generated first and
acts as both the AI's grounding context and the guaranteed fallback: any AI
failure (missing key, auth, rate limit, bad JSON) returns None and the caller
keeps the deterministic advice.
"""

import json

from app.config import OPENAI_API_KEY

_TEXT_FIELDS = [
    "startingItem", "boots", "firstItem", "buildDirection", "lanePlan",
    "tradingPattern", "dangerWindows", "howToWinLane", "commonMistakes",
    "gameDirection", "teamfightPlan",
]

_EXTRA_FIELDS = [
    "winCondition", "biggestThreats", "playAround", "focusTarget",
    "avoidTarget", "jungleThreat", "recallTiming", "first10Min",
    "antiHeal", "resistPriority",
]

_INSTRUCTIONS = (
    "You are a challenger-level League of Legends coach. You receive a live "
    "matchup context and baseline advice as JSON. Rewrite and improve the "
    "advice using real knowledge of the champions involved: name specific "
    "abilities to respect, real item names, and concrete level power spikes. "
    "Keep every field short and loading-screen friendly (1-3 sentences, no "
    "markdown). Return ONLY a JSON object with exactly these keys: "
    + ", ".join(_TEXT_FIELDS)
    + ", extraTips (array of 3-6 short strings), and extras (object with keys: "
    + ", ".join(_EXTRA_FIELDS)
    + ", itemWarnings as array of short strings). Do not add other keys."
)


def refine_advice_with_ai(context, base_advice):
    """Return an improved advice dict, or None to keep deterministic advice."""
    if not OPENAI_API_KEY:
        return None

    try:
        from openai import OpenAI

        client = OpenAI(api_key=OPENAI_API_KEY, timeout=30)
        response = client.responses.create(
            model="gpt-5.5",
            reasoning={"effort": "low"},
            instructions=_INSTRUCTIONS,
            input=json.dumps({"matchContext": context, "baselineAdvice": base_advice}),
        )
        return _parse_and_merge(response.output_text, base_advice)
    except Exception:
        # Any AI-side failure silently falls back to deterministic advice.
        return None


def _parse_and_merge(raw_text, base_advice):
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    data = json.loads(text)

    merged = dict(base_advice)
    for field in _TEXT_FIELDS:
        value = data.get(field)
        if isinstance(value, str) and value.strip():
            merged[field] = value.strip()

    tips = data.get("extraTips")
    if isinstance(tips, list) and tips:
        merged["extraTips"] = [str(tip) for tip in tips][:6]

    extras = dict(base_advice.get("extras", {}))
    ai_extras = data.get("extras")
    if isinstance(ai_extras, dict):
        for field in _EXTRA_FIELDS:
            value = ai_extras.get(field)
            if isinstance(value, str) and value.strip():
                extras[field] = value.strip()
        warnings = ai_extras.get("itemWarnings")
        if isinstance(warnings, list) and warnings:
            extras["itemWarnings"] = [str(warning) for warning in warnings][:6]
    merged["extras"] = extras

    return merged
