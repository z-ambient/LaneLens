"""Static demo matchup (Malphite vs Sett) for testing the dashboard
without being in a live League game. Matches the standard response shape.
"""


def _member(name, image_key, is_player=False, is_opponent=False, lane=None):
    return {
        "championName": name,
        "imageKey": image_key,
        "summonerName": None,
        "isPlayer": is_player,
        "isOpponent": is_opponent,
        "lane": lane,
    }


def get_demo_response(ddragon_version):
    return {
        "ok": True,
        "source": "demo",
        "ddragonVersion": ddragon_version,
        "game": {"queue": "Demo Match", "gameMode": "CLASSIC", "gameStartTime": None},
        "player": {
            "gameName": "Demo Player",
            "tagLine": "NA1",
            "puuid": "demo-puuid",
            "champion": "Malphite",
        },
        "matchup": {
            "enemyChampion": "Sett",
            "lane": "Top",
            "difficulty": "Medium",
            "confidence": "confirmed",
        },
        "teams": {
            "blue": [
                _member("Malphite", "Malphite", is_player=True, lane="Top"),
                _member("Vi", "Vi", lane="Jungle"),
                _member("Orianna", "Orianna", lane="Mid"),
                _member("Jinx", "Jinx", lane="Bot"),
                _member("Thresh", "Thresh", lane="Support"),
            ],
            "red": [
                _member("Sett", "Sett", is_opponent=True, lane="Top"),
                _member("Lee Sin", "LeeSin", lane="Jungle"),
                _member("Ahri", "Ahri", lane="Mid"),
                _member("Kai'Sa", "Kaisa", lane="Bot"),
                _member("Leona", "Leona", lane="Support"),
            ],
        },
        "runes": {
            "keystone": {
                "name": "Grasp of the Undying",
                "icon": "perk-images/Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png",
                "desc": "Every 4s your next attack on a champion deals bonus magic damage, heals you, and permanently increases your health.",
            },
            "runes": [
                {"name": "Demolish", "icon": "perk-images/Styles/Resolve/Demolish/Demolish.png",
                 "desc": "Your third attack against turrets deals bonus damage."},
                {"name": "Second Wind", "icon": "perk-images/Styles/Resolve/SecondWind/SecondWind.png",
                 "desc": "After taking damage from an enemy champion heal back some missing health over time."},
                {"name": "Overgrowth", "icon": "perk-images/Styles/Resolve/Overgrowth/Overgrowth.png",
                 "desc": "Gain permanent max health when minions or monsters die near you."},
                {"name": "Biscuit Delivery", "icon": "perk-images/Styles/Inspiration/BiscuitDelivery/BiscuitDelivery.png",
                 "desc": "Gain a free Biscuit every 2 min, until 6 min. Consuming or selling a Biscuit permanently increases your max health."},
                {"name": "Approach Velocity", "icon": "perk-images/Styles/Resolve/ApproachVelocity/ApproachVelocity.png",
                 "desc": "Bonus move speed towards nearby enemy champions that are movement impaired."},
            ],
            "shards": [
                {"name": "Health Scaling", "desc": "+10-180 Health (based on level)"},
                {"name": "Armor", "desc": "+6 Armor"},
                {"name": "Health", "desc": "+65 Health"},
            ],
            "primaryStyle": {"name": "Resolve", "icon": "perk-images/Styles/7204_Resolve.png"},
            "subStyle": {"name": "Inspiration", "icon": "perk-images/Styles/7203_Whimsy.png"},
        },
        "teamNotes": [
            "Your team scales well - Jinx and Orianna spike hard at three items.",
            "Enemy team has strong engage - respect Leona and Lee Sin picks.",
            "Play around bot side - Jinx is your late-game win condition.",
            "Avoid early 5v5s before Malphite has Armor and level 6.",
        ],
        "advice": {
            "startingItem": "Doran's Shield",
            "boots": "Plated Steelcaps",
            "firstItem": "Sunfire Aegis",
            "fullBuild": [
                {"label": "Starting", "item": "Doran's Shield", "options": ["Doran's Ring"],
                 "items": ["Doran's Shield", "Health Potion"]},
                {"label": "Boots", "item": "Plated Steelcaps", "options": ["Mercury's Treads"]},
                {"label": "Core", "item": "Sunfire Aegis", "options": ["Heartsteel", "Iceborn Gauntlet"]},
                {"label": "Armor", "item": "Thornmail", "options": ["Frozen Heart", "Randuin's Omen"]},
                {"label": "Magic Resist", "item": "Kaenic Rookern", "options": ["Spirit Visage"]},
                {"label": "Late Game", "item": "Warmog's Armor", "options": ["Jak'Sho, The Protean"]},
                {"label": "Situational", "item": "Abyssal Mask", "options": ["Randuin's Omen"]},
            ],
            "buildDirection": (
                "Tank Malphite unless the team badly needs magic damage. Armor first - "
                "four of five enemies deal physical damage and it doubles your passive "
                "shield value against Sett. Thornmail covers anti-heal if he snowballs."
            ),
            "lanePlan": (
                "Play safe early and use Q to poke when Manaflow Band is available. "
                "Avoid long trades because Sett wins extended fights. Your goal is to "
                "survive lane, farm, and look for level 6 setup."
            ),
            "tradingPattern": (
                "Use short Q poke trades. Do not walk into extended melee fights. "
                "Avoid letting Sett pull you with E and then use W for a big shield "
                "and true damage."
            ),
            "dangerWindows": (
                "Sett is dangerous when he has high grit, when your Q is down, or when "
                "the wave is pushing away from you. Be careful before level 6 because "
                "he can punish bad spacing."
            ),
            "howToWinLane": (
                "Farm safely, poke when free, avoid long fights, and use level 6 to set "
                "up jungle ganks or roam. You do not need to solo kill Sett to win this "
                "matchup."
            ),
            "commonMistakes": (
                "Walking into Sett's E range with Q on cooldown, taking extended trades "
                "into his W shield, and spamming Q so hard you have no mana to escape ganks."
            ),
            "gameDirection": (
                "Group with your team once laning ends. Malphite's biggest value is "
                "reliable engage - play for picks and 5v5s where your ultimate starts the fight."
            ),
            "teamfightPlan": (
                "Look for a strong ultimate onto the enemy backline. If your carries are "
                "fed, peel for them instead of diving too deep."
            ),
            "extraTips": [
                "Armor is valuable if the enemy team is AD-heavy.",
                "Anti-heal can be useful if Sett or other healing champions get ahead.",
                "Malphite's biggest value is reliable engage.",
                "Do not waste ultimate on the tank unless it wins the fight.",
            ],
            "extras": {
                "winCondition": "Land a multi-person ultimate for Jinx and Orianna to follow up on.",
                "biggestThreats": "Kai'Sa (late game) and Leona engage on your carries.",
                "playAround": "Jinx - peel and engage for her once she has two items.",
                "focusTarget": "Kai'Sa - your ultimate can delete her positioning advantage.",
                "avoidTarget": "Do not dump your ultimate on Sett unless it clearly wins the fight.",
                "jungleThreat": "Lee Sin is strongest before 15 minutes - ward river early and respect level 3 ganks.",
                "recallTiming": "Crash the third wave, recall for Bramble Vest or armor components.",
                "first10Min": "Survive lane, farm, poke with Q when free, and set up your first item spike before trading seriously.",
                "itemWarnings": [
                    "Armor is valuable - four of five enemies deal mostly physical damage.",
                    "Consider anti-heal if Sett snowballs.",
                ],
                "antiHeal": "Useful if Sett or other healing champions get ahead.",
                "resistPriority": "Armor",
            },
        },
    }
