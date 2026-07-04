"""Optional AI refinement of matchup advice (OpenAI, carried over from
LaneLens-Manual but upgraded to return structured JSON instead of prose).

The deterministic advice from app.advice_engine is always generated first and
acts as both the AI's grounding context and the guaranteed fallback: any AI
failure (missing key, auth, rate limit, bad JSON) returns None and the caller
keeps the deterministic advice.

Two modes:
- refine_advice_with_ai: one call refining everything (legacy full mode).
- refine_section: one small call per dashboard section, so the frontend can
  run four in parallel and update each panel as its answer lands.
"""

import json

from app.config import OPENAI_API_KEY

# Per-section field groups. build/lane are matchup-specific (cacheable);
# gameplan/extras depend on the actual teams, so they run fresh every game.
SECTION_SPECS = {
    "build": {
        "text": ["startingItem", "boots", "firstItem", "buildDirection"],
        "full_build": True,
        "extras": [],
        "focus": "the item build for this matchup; buildDirection must briefly explain WHY the build fits",
    },
    "lane": {
        "text": ["lanePlan", "tradingPattern", "dangerWindows", "howToWinLane", "commonMistakes"],
        "tips": True,
        "extras": [],
        "focus": "the laning phase: name specific abilities to respect and concrete level power spikes",
    },
    "gameplan": {
        "text": ["gameDirection", "teamfightPlan"],
        "extras": ["winCondition", "playAround", "biggestThreats"],
        "focus": "the macro game plan for THESE two team compositions",
    },
    "extras": {
        "text": [],
        "extras": ["jungleThreat", "recallTiming", "first10Min", "focusTarget",
                   "avoidTarget", "antiHeal", "resistPriority"],
        "warnings": True,
        "focus": "practical extras: jungle danger, recall timing, target priority, itemization warnings",
    },
}

CACHEABLE_SECTIONS = {"build", "lane"}

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
    "markdown). buildDirection must briefly explain WHY the build fits this "
    "game. Return ONLY a JSON object with exactly these keys: "
    + ", ".join(_TEXT_FIELDS)
    + ", fullBuild (array of {label, item, options} - the full recommended "
    "build order using exact in-game item names, with options as alternative "
    "item names), extraTips (array of 3-6 short strings), and extras (object with keys: "
    + ", ".join(_EXTRA_FIELDS)
    + ", itemWarnings as array of short strings). Do not add other keys."
)


def _call_openai(instructions, payload, timeout=30):
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY, timeout=timeout)
    response = client.responses.create(
        model="gpt-5.5",
        reasoning={"effort": "low"},
        instructions=instructions,
        input=json.dumps(payload),
    )
    return response.output_text


def refine_advice_with_ai(context, base_advice):
    """Return an improved advice dict, or None to keep deterministic advice."""
    if not OPENAI_API_KEY:
        return None

    try:
        raw = _call_openai(
            _INSTRUCTIONS,
            {"matchContext": context, "baselineAdvice": base_advice},
        )
        return _parse_and_merge(raw, base_advice)
    except Exception:
        # Any AI-side failure silently falls back to deterministic advice.
        return None


def _section_instructions(section):
    spec = SECTION_SPECS[section]
    keys = list(spec["text"])
    if spec.get("full_build"):
        keys.append("fullBuild (array of {label, item, options} - the full build order using exact in-game item names)")
    if spec.get("tips"):
        keys.append("extraTips (array of 3-6 short strings)")
    keys.extend(spec["extras"])
    if spec.get("warnings"):
        keys.append("itemWarnings (array of short strings)")
    return (
        "You are a challenger-level League of Legends coach. You receive a live "
        "matchup context and baseline advice as JSON. Improve ONLY " + spec["focus"] + ", "
        "using real knowledge of the champions involved. Keep every field short and "
        "loading-screen friendly (1-3 sentences, no markdown). Return ONLY a JSON "
        "object with exactly these keys: " + ", ".join(keys) + ". Do not add other keys."
    )


def refine_section(context, base_advice, section):
    """One small AI call for one dashboard section.

    Returns a DELTA dict (only that section's fields; extras nested under
    'extras'), or None to keep the deterministic values.
    """
    if not OPENAI_API_KEY or section not in SECTION_SPECS:
        return None

    try:
        raw = _call_openai(
            _section_instructions(section),
            {"matchContext": context, "baselineAdvice": base_advice},
        )
        return _parse_section(raw, section)
    except Exception:
        return None


def _parse_section(raw_text, section):
    spec = SECTION_SPECS[section]
    data = json.loads(_strip_fences(raw_text))

    delta = {}
    for field in spec["text"]:
        value = data.get(field)
        if isinstance(value, str) and value.strip():
            delta[field] = value.strip()

    if spec.get("full_build"):
        cleaned = _clean_full_build(data.get("fullBuild"))
        if cleaned:
            delta["fullBuild"] = cleaned

    if spec.get("tips"):
        tips = data.get("extraTips")
        if isinstance(tips, list) and tips:
            delta["extraTips"] = [str(tip) for tip in tips][:6]

    extras = {}
    for field in spec["extras"]:
        value = data.get(field)
        if isinstance(value, str) and value.strip():
            extras[field] = value.strip()
    if spec.get("warnings"):
        warnings = data.get("itemWarnings")
        if isinstance(warnings, list) and warnings:
            extras["itemWarnings"] = [str(warning) for warning in warnings][:6]
    if extras:
        delta["extras"] = extras

    return delta or None


def _strip_fences(text):
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    return text


def _clean_full_build(full_build):
    if not isinstance(full_build, list):
        return None
    cleaned = []
    for slot in full_build[:8]:
        if isinstance(slot, dict) and slot.get("item"):
            cleaned.append({
                "label": str(slot.get("label", "Item")),
                "item": str(slot["item"]),
                "options": [str(option) for option in (slot.get("options") or [])][:3],
            })
    return cleaned or None


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

    full_build = data.get("fullBuild")
    if isinstance(full_build, list):
        cleaned = []
        for slot in full_build[:8]:
            if isinstance(slot, dict) and slot.get("item"):
                cleaned.append({
                    "label": str(slot.get("label", "Item")),
                    "item": str(slot["item"]),
                    "options": [str(option) for option in (slot.get("options") or [])][:3],
                })
        if cleaned:
            merged["fullBuild"] = cleaned

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
