from app.ai_agent import format_matchup_advice

def test_format_matchup_advice():
    advice = {
        "difficulty": "Low",
        "first_buy": "Coffee Creamer",
        "lane_plan": "Pour creamer; don't spill",
        "build_direction": "Stormio into creamer into splenda",
        "tips": ["Use stirrer to stir", "Make sure to close the fridge"],
    }

    result = format_matchup_advice("Z", "Coffee Machine", advice)

    assert "Z vs Coffee Machine" in result
    assert "Difficulty: Low" in result
    assert "- Use stirrer to stir" in result
    assert "- Make sure to close the fridge" in result