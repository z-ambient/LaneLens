from openai import OpenAI

from app.config import OPENAI_API_KEY

def format_matchup_advice(my_champion, enemy_champion, advice):
    tips = advice.get("tips", [])

    formatted_tips = "\n".join(
        f"- {tip}" for tip in tips
    )

    return (
        f"{my_champion} vs {enemy_champion}\n"
        f"Difficulty: {advice['difficulty']}\n"
        f"First buy: {advice['first_buy']}\n"
        f"Lane plan: {advice['lane_plan']}\n"
        f"Build direction: {advice['build_direction']}\n"
        f"Tips:\n{formatted_tips}"
    )

def generate_ai_matchup_advice(
    my_champion,
    enemy_champion,
    advice,
):
    if not OPENAI_API_KEY:
        return format_matchup_advice(
            my_champion,
            enemy_champion,
            advice,
        )
    
    trusted_advice = format_matchup_advice(
        my_champion,
        enemy_champion,
        advice,
    )

    client = OpenAI(api_key=OPENAI_API_KEY, timeout=20)

    response = client.responses.create(
        model="gpt-5.5",
        reasoning={"effort": "low"},
        instructions=(
            "You are a League of Legends matchup coach. "
            "Rewrite only the supplied matchup information into "
            "clear, practical advice. Do not invent builds, facts, "
            "or matchup details."
        ),
        input=trusted_advice,
    )

    return response.output_text