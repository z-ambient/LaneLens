"""Pre-warm the AI advice cache for meta matchups.

Batch-generates the cacheable advice sections (build + lane) so first-time
users hit the cache instead of waiting ~10s per section. Matchups observed
in real games (the matchup_history store) are warmed first, then a curated
meta list in popularity order. Already-cached matchups are skipped, so the
script is safe to re-run - each run continues where the last stopped and a
patch change naturally invalidates everything for re-warming.

Usage:
    python -m app.prewarm --dry-run           # show the plan, no AI calls
    python -m app.prewarm --limit 25          # warm up to 25 matchups
    python -m app.prewarm --lane Top          # one lane only

Warm PRODUCTION by pointing at its database (2 AI calls per matchup):
    DATABASE_URL='postgresql://...' python -m app.prewarm --limit 50
"""

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from app import advice_cache, champions, storage
from app.advice_engine import build_advice
from app.ai_agent import refine_section
from app.config import OPENAI_API_KEY

# Enduringly popular picks per lane, most popular first. Pairs are generated
# in popularity order, so small --limit runs cover the most common games.
META_LANE_CHAMPIONS = {
    "Top": ["Darius", "Garen", "Sett", "Aatrox", "Malphite", "Mordekaiser",
            "Camille", "Fiora", "Jax", "Riven", "Renekton", "Teemo"],
    "Jungle": ["Lee Sin", "Vi", "Warwick", "Master Yi", "Kayn", "Graves",
               "Hecarim", "Jarvan IV", "Kha'Zix", "Viego"],
    "Mid": ["Ahri", "Yasuo", "Zed", "Yone", "Sylas", "Viktor", "Orianna",
            "Katarina", "Akali", "Lux", "Syndra", "Vex"],
    "Bot": ["Jinx", "Kai'Sa", "Caitlyn", "Ezreal", "Jhin", "Vayne", "Ashe",
            "Miss Fortune", "Lucian", "Xayah"],
    "Support": ["Thresh", "Lux", "Leona", "Nautilus", "Morgana", "Nami",
                "Pyke", "Blitzcrank", "Karma", "Milio"],
}

POSITION_TO_LANE = {
    "TOP": "Top", "JUNGLE": "Jungle", "MIDDLE": "Mid",
    "BOTTOM": "Bot", "UTILITY": "Support",
}

WARM_SECTIONS = ("build", "lane")


def observed_matchups():
    """Real matchups from stored game history, deduped, most frequent first."""
    counts = {}
    for game in storage.history_all_games():
        lane = POSITION_TO_LANE.get(game.get("position"))
        me, enemy = game.get("myChampion"), game.get("enemyChampion")
        if not (lane and me and enemy):
            continue
        key = (me, enemy, lane)
        counts[key] = counts.get(key, 0) + 1
    return [key for key, _ in sorted(counts.items(), key=lambda kv: -kv[1])]


def meta_matchups(lane_filter=None):
    """Ordered champion pairs per lane, most popular combinations first."""
    pairs = []
    for lane, champs in META_LANE_CHAMPIONS.items():
        if lane_filter and lane != lane_filter:
            continue
        for i, me in enumerate(champs):
            for j, enemy in enumerate(champs):
                if me != enemy:
                    pairs.append((i + j, (me, enemy, lane)))
    pairs.sort(key=lambda entry: entry[0])
    return [pair for _, pair in pairs]


def sections_missing(me, enemy, lane, patch):
    return [
        section for section in WARM_SECTIONS
        if advice_cache.get_cached_section(me, enemy, lane, patch, section) is None
    ]


def plan(patch, lane_filter=None, include_history=True, limit=25):
    """Decide what to warm: (list of (me, enemy, lane, missing_sections), skipped)."""
    candidates = []
    if include_history:
        candidates.extend(
            m for m in observed_matchups()
            if lane_filter is None or m[2] == lane_filter
        )
    candidates.extend(meta_matchups(lane_filter))

    seen, to_warm, skipped = set(), [], 0
    for me, enemy, lane in candidates:
        # Normalize to Data Dragon display names: history stores Match-v5's
        # compact names (MasterYi, MonkeyKing) but the live cache is keyed by
        # display names (Master Yi, Wukong) - keys must match to be useful.
        me_rec = champions.find_champion_by_name(me)
        enemy_rec = champions.find_champion_by_name(enemy)
        if not me_rec or not enemy_rec:
            continue
        me, enemy = me_rec["name"], enemy_rec["name"]

        key = (me.lower(), enemy.lower(), lane.lower())
        if key in seen:
            continue
        seen.add(key)
        missing = sections_missing(me, enemy, lane, patch)
        if not missing:
            skipped += 1
            continue
        to_warm.append((me, enemy, lane, missing))
        if len(to_warm) >= limit:
            break
    return to_warm, skipped


def warm_one(me_name, enemy_name, lane, missing, patch):
    """Generate and cache the missing sections for one matchup."""
    me = champions.find_champion_by_name(me_name)
    enemy = champions.find_champion_by_name(enemy_name)
    # Teams beyond the laners are unknown pre-warm; the cached sections are
    # matchup-core by design, so laner-only context is the right input.
    _, base_advice = build_advice(me, enemy, lane, [me], [enemy])
    context = {
        "myChampion": me["name"], "enemyChampion": enemy["name"], "lane": lane,
        "myTeam": [me["name"]], "enemyTeam": [enemy["name"]],
        "queue": "Ranked Solo/Duo", "selectedRunes": None,
    }

    warmed, failed = [], []
    for section in missing:
        delta = refine_section(context, base_advice, section)
        if delta:
            advice_cache.store_section(me["name"], enemy["name"], lane, patch, delta, section)
            warmed.append(section)
        else:
            failed.append(section)
    return warmed, failed


def main(argv=None):
    parser = argparse.ArgumentParser(description="Pre-warm the AI advice cache.")
    parser.add_argument("--limit", type=int, default=25, help="max matchups this run")
    parser.add_argument("--lane", choices=list(META_LANE_CHAMPIONS), help="only this lane")
    parser.add_argument("--meta-only", action="store_true",
                        help="skip history-observed matchups")
    parser.add_argument("--workers", type=int, default=3, help="parallel matchups")
    parser.add_argument("--dry-run", action="store_true", help="plan only, no AI calls")
    args = parser.parse_args(argv)

    if not args.dry_run and not OPENAI_API_KEY:
        print("OPENAI_API_KEY is not set - nothing to warm with.")
        return 1

    patch = champions.get_ddragon_version()
    to_warm, skipped = plan(
        patch, lane_filter=args.lane,
        include_history=not args.meta_only, limit=args.limit,
    )
    calls = sum(len(missing) for *_ , missing in to_warm)
    print(f"patch {patch} | already cached: {skipped} | to warm: {len(to_warm)} "
          f"matchups ({calls} AI calls, ~{calls * 12}s of AI time)")

    if args.dry_run:
        for me, enemy, lane, missing in to_warm:
            print(f"  {lane:8s} {me} vs {enemy}  (needs: {', '.join(missing)})")
        return 0
    if not to_warm:
        print("Nothing to do.")
        return 0

    started = time.time()
    done = failed_total = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(warm_one, me, enemy, lane, missing, patch): (me, enemy, lane)
            for me, enemy, lane, missing in to_warm
        }
        for future, (me, enemy, lane) in futures.items():
            try:
                warmed, failed = future.result()
                done += 1
                failed_total += len(failed)
                status = "ok" if not failed else f"FAILED: {', '.join(failed)}"
                print(f"[{done}/{len(to_warm)}] {lane} {me} vs {enemy} -> {status}")
            except Exception as error:
                failed_total += 1
                print(f"[!] {lane} {me} vs {enemy} -> error: {error}")

    print(f"Done in {time.time() - started:.0f}s - {done} matchups, "
          f"{failed_total} failed sections. Re-run to continue down the list.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
