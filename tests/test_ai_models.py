"""Per-section AI model routing (OpenAI mocked, offline)."""

import json

import pytest

import app.ai_agent as ai_agent


@pytest.fixture
def capture_model(monkeypatch):
    calls = []
    monkeypatch.setattr(ai_agent, "OPENAI_API_KEY", "test-key")

    def fake_call(instructions, payload, model, timeout=30):
        calls.append(model)
        return json.dumps({
            "lanePlan": "x", "gameDirection": "x", "buildDirection": "x",
            "winCondition": "x", "jungleThreat": "x",
        })

    monkeypatch.setattr(ai_agent, "_call_openai", fake_call)
    return calls


def test_cacheable_sections_use_primary_model(capture_model):
    ai_agent.refine_section({}, {}, "build")
    ai_agent.refine_section({}, {}, "lane")
    assert capture_model == [ai_agent.AI_MODEL_PRIMARY] * 2


def test_per_game_sections_use_fast_model(capture_model):
    ai_agent.refine_section({}, {}, "gameplan")
    ai_agent.refine_section({}, {}, "extras")
    assert capture_model == [ai_agent.AI_MODEL_FAST] * 2


def test_defaults():
    assert ai_agent.AI_MODEL_PRIMARY == "gpt-5.5"
    assert ai_agent.AI_MODEL_FAST == "gpt-5.4-mini"


def test_full_mode_uses_primary(capture_model, monkeypatch):
    monkeypatch.setattr(ai_agent, "_parse_and_merge", lambda raw, base: {"ok": True})
    ai_agent.refine_advice_with_ai({}, {})
    assert capture_model == [ai_agent.AI_MODEL_PRIMARY]