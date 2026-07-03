// LaneLens frontend. Talks only to the LaneLens backend (/api/*) —
// the Riot API key never reaches the browser. Champion, item, and rune
// images come from the public Data Dragon CDN (no key required).

const form = document.getElementById("analyze-form");
const analyzeBtn = document.getElementById("analyze-btn");
const demoBtn = document.getElementById("demo-btn");
const errorDemoBtn = document.getElementById("error-demo-btn");
const loadingPanel = document.getElementById("loading");
const loadingMessage = document.getElementById("loading-message");
const errorPanel = document.getElementById("error");
const errorMessage = document.getElementById("error-message");
const dashboard = document.getElementById("dashboard");

const LOADING_STEPS = [
    "Looking up Riot account...",
    "Checking for live game...",
    "Analyzing lane matchup...",
    "Generating game plan...",
];

let loadingTimer = null;
let lastRequestBody = null;

// ---------- UI state helpers ----------

function setBusy(busy) {
    analyzeBtn.disabled = busy;
    demoBtn.disabled = busy;
    analyzeBtn.textContent = busy ? "Analyzing..." : "Analyze My Matchup";
}

function startLoading() {
    let step = 0;
    errorPanel.classList.add("hidden");
    dashboard.classList.add("hidden");
    loadingPanel.classList.remove("hidden");
    loadingMessage.textContent = LOADING_STEPS[0];
    loadingTimer = setInterval(() => {
        step = Math.min(step + 1, LOADING_STEPS.length - 1);
        loadingMessage.textContent = LOADING_STEPS[step];
    }, 1100);
}

function stopLoading() {
    clearInterval(loadingTimer);
    loadingPanel.classList.add("hidden");
}

function showError(message) {
    stopLoading();
    dashboard.classList.add("hidden");
    errorMessage.textContent = message;
    errorPanel.classList.remove("hidden");
}

// ---------- Data Dragon item index (for item icons) ----------

let itemIndexPromise = null;

function loadItemIndex(version) {
    if (!itemIndexPromise) {
        itemIndexPromise = fetch(
            `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/item.json`
        )
            .then((response) => response.json())
            .then((data) => {
                const seen = new Set();
                const items = [];
                for (const [id, item] of Object.entries(data.data)) {
                    if (!item.name || item.name.includes("<")) continue;
                    const key = item.name.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    items.push({ id, name: item.name, nameLower: key });
                }
                // Longest names first so "Doran's Blade" wins over partial hits.
                items.sort((a, b) => b.nameLower.length - a.nameLower.length);
                return items;
            })
            .catch(() => []);
    }
    return itemIndexPromise;
}

// Find known item names mentioned inside a piece of advice text.
function findItemsInText(items, text, limit) {
    if (!text) return [];
    const lower = text.toLowerCase();
    const found = [];
    for (const item of items) {
        if (item.nameLower.length < 5) continue;
        if (lower.includes(item.nameLower)) {
            found.push(item);
            if (found.length >= limit) break;
        }
    }
    return found;
}

// Exact item lookup by name, falling back to a text scan.
function findItem(items, name) {
    if (!name) return null;
    const lower = name.toLowerCase();
    return (
        items.find((item) => item.nameLower === lower) ||
        findItemsInText(items, name, 1)[0] ||
        null
    );
}

// ---------- API calls ----------

async function analyze(body) {
    lastRequestBody = body;
    setBusy(true);
    startLoading();
    try {
        const response = await fetch("/api/analyze-matchup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => null);

        if (!data) {
            showError("The LaneLens backend returned an unreadable response. Is the server running?");
            return;
        }
        if (!data.ok) {
            showError(friendlyError(response.status, data.error));
            return;
        }
        await renderDashboard(data);
    } catch (err) {
        showError("Could not reach the LaneLens backend. Make sure the server is running, then try again.");
    } finally {
        stopLoading();
        setBusy(false);
    }
}

async function loadDemo() {
    setBusy(true);
    startLoading();
    try {
        const response = await fetch("/api/demo-matchup");
        const data = await response.json();
        await renderDashboard(data);
    } catch (err) {
        showError("Could not load the demo match. Is the backend running?");
    } finally {
        stopLoading();
        setBusy(false);
    }
}

function friendlyError(status, message) {
    if (status === 404 && /no live/i.test(message || "")) {
        return "No live game found. Start a League match, then try again.";
    }
    if (status === 429) {
        return "Riot API rate limit hit. Wait a minute, then try again.";
    }
    return message || "Unexpected error. Try again, or use the demo match.";
}

// ---------- Rendering helpers ----------

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function champIcon(imageKey, version, size) {
    const img = document.createElement("img");
    img.width = size;
    img.height = size;
    img.alt = "";
    if (imageKey && version) {
        img.src = `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${imageKey}.png`;
    }
    return img;
}

function itemIcon(itemId, version) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = `https://ddragon.leagueoflegends.com/cdn/${version}/img/item/${itemId}.png`;
    return img;
}

function runeIcon(rune, size) {
    const img = document.createElement("img");
    img.width = size;
    img.height = size;
    img.alt = rune.name;
    img.title = rune.name;
    img.src = `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`;
    return img;
}

// ---------- Section renderers ----------

function renderOverview(data) {
    const allMembers = [...data.teams.blue, ...data.teams.red];
    const me = allMembers.find((m) => m.isPlayer);
    const enemy = allMembers.find((m) => m.isOpponent);

    const meImg = document.getElementById("ov-me");
    const enemyImg = document.getElementById("ov-enemy");
    meImg.replaceWith(Object.assign(champIcon(me && me.imageKey, data.ddragonVersion, 64), { id: "ov-me" }));
    enemyImg.replaceWith(Object.assign(champIcon(enemy && enemy.imageKey, data.ddragonVersion, 64), { id: "ov-enemy" }));

    document.getElementById("ov-me-name").textContent = data.player.champion;
    document.getElementById("ov-enemy-name").textContent =
        data.matchup.enemyChampion || "Unknown";

    // Faded splash art of the player's champion behind the overview card.
    const splash = document.getElementById("ov-splash");
    if (me && me.imageKey) {
        splash.src = `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${me.imageKey}_0.jpg`;
        splash.style.display = "";
    } else {
        splash.removeAttribute("src");
        splash.style.display = "none";
    }

    const ring = document.getElementById("diff-ring");
    ring.className = "diff-ring";
    const difficulty = data.matchup.difficulty || "—";
    if (difficulty !== "—") {
        ring.classList.add("difficulty-" + difficulty.toLowerCase());
    }
    document.getElementById("diff-text").textContent = difficulty;
}

function renderBadges(matchup, game) {
    const badges = document.getElementById("matchup-badges");
    badges.replaceChildren();
    if (matchup.lane) badges.appendChild(el("span", "badge lane", matchup.lane + " lane"));
    badges.appendChild(el("span", "badge confidence", "Matchup: " + matchup.confidence));
    if (game && game.queue) badges.appendChild(el("span", "badge", game.queue));
}

function renderOverride(data) {
    const area = document.getElementById("override-area");
    // Manual override only makes sense for real (non-demo) games.
    if (data.source !== "riot-api") {
        area.classList.add("hidden");
        return;
    }
    area.classList.remove("hidden");

    const select = document.getElementById("override-champion");
    select.replaceChildren(el("option", null, "Enemy laner..."));
    select.options[0].value = "";

    // The enemy team is whichever side the player is NOT on.
    const playerOnBlue = data.teams.blue.some((m) => m.isPlayer);
    const enemyTeam = playerOnBlue ? data.teams.red : data.teams.blue;

    for (const member of enemyTeam) {
        const option = el("option", null, member.championName);
        option.value = member.championName;
        if (member.isOpponent) option.selected = true;
        select.appendChild(option);
    }

    document.getElementById("override-lane").value = data.matchup.lane || "";
}

function featuredRow(glyph, label, text, headline) {
    const row = el("div", "featured-row" + (headline ? " headline" : ""));
    row.appendChild(el("span", "glyph", glyph));
    const wrap = el("div", "fr-text");
    wrap.append(el("span", "fr-label", label), el("p", null, text));
    row.appendChild(wrap);
    return row;
}

function renderFeatured(advice, extras) {
    const rows = document.getElementById("featured-rows");
    rows.replaceChildren();
    const entries = [
        ["★", "Win condition", extras.winCondition, true],
        ["▶", "Game direction", advice.gameDirection, false],
        ["⚑", "Teamfight plan", advice.teamfightPlan, false],
        ["♦", "Play around", extras.playAround, false],
    ];
    for (const [glyph, label, text, headline] of entries) {
        if (text) rows.appendChild(featuredRow(glyph, label, text, headline));
    }
}

function renderTiles(extras) {
    const tiles = document.getElementById("stat-tiles");
    tiles.replaceChildren();
    const entries = [
        ["🛡", "g-gold", "Armor or MR priority", extras.resistPriority],
        ["✚", "g-green", "Anti-heal needed?", extras.antiHeal],
        ["◎", "g-red", "Who to focus", extras.focusTarget],
        ["⚠", "g-blue", "Biggest threats", extras.biggestThreats],
    ];
    for (const [glyph, color, label, value] of entries) {
        if (!value) continue;
        const tile = el("div", "tile");
        tile.appendChild(el("span", "tile-glyph " + color, glyph));
        const meta = el("div", "tile-meta");
        meta.append(el("span", "tile-label", label), el("p", null, value));
        tile.appendChild(meta);
        tiles.appendChild(tile);
    }
}

function runeTreeHeader(style, fallback) {
    const head = el("div", "tree-head");
    if (style && style.icon) head.appendChild(runeIcon(style, 22));
    head.appendChild(el("span", "tree-name", style ? style.name : fallback));
    return head;
}

function runeRow(rune, isKeystone) {
    const row = el("div", "rune-row" + (isKeystone ? " keystone" : ""));
    row.appendChild(runeIcon(rune, isKeystone ? 44 : 28));
    const meta = el("div", "rune-row-meta");
    meta.appendChild(el("span", "rune-row-name", rune.name));
    if (rune.desc) meta.appendChild(el("span", "rune-row-desc", rune.desc));
    row.appendChild(meta);
    return row;
}

function renderRunes(runesData) {
    const body = document.getElementById("runes-row");
    body.replaceChildren();
    if (!runesData || !runesData.keystone) {
        body.appendChild(
            el("p", "runes-empty", "Rune data is not available for this game.")
        );
        return;
    }

    // Oversized keystone icon as a faint decorative background.
    const bg = runeIcon(runesData.keystone, 240);
    bg.className = "runes-bg";
    bg.removeAttribute("title");
    body.appendChild(bg);

    // Spectator perk order: keystone, 3 primary minors, 2 secondary minors.
    const minors = runesData.runes || [];
    const primaryMinors = minors.slice(0, 3);
    const secondaryMinors = minors.slice(3);

    const primary = el("div", "rune-tree");
    primary.appendChild(runeTreeHeader(runesData.primaryStyle, "Primary"));
    primary.appendChild(runeRow(runesData.keystone, true));
    primaryMinors.forEach((rune) => primary.appendChild(runeRow(rune, false)));
    body.appendChild(primary);

    if (secondaryMinors.length) {
        const secondary = el("div", "rune-tree secondary");
        secondary.appendChild(runeTreeHeader(runesData.subStyle, "Secondary"));
        secondaryMinors.forEach((rune) => secondary.appendChild(runeRow(rune, false)));
        body.appendChild(secondary);
    }

    if (runesData.shards && runesData.shards.length) {
        const shards = el("div", "rune-tree shards");
        shards.appendChild(runeTreeHeader(null, "Shards"));
        runesData.shards.forEach((shard) => {
            const row = el("div", "rune-row shard");
            row.appendChild(el("span", "shard-dot", "◆"));
            const meta = el("div", "rune-row-meta");
            // Shards may be plain strings (older payloads) or {name, desc}.
            meta.appendChild(el("span", "rune-row-name", shard.name || shard));
            if (shard.desc) meta.appendChild(el("span", "rune-row-desc", shard.desc));
            row.appendChild(meta);
            shards.appendChild(row);
        });
        body.appendChild(shards);
    }
}

function slotIcon(item, version) {
    const icon = el("div", "slot-icon");
    if (item) {
        icon.appendChild(itemIcon(item.id, version));
    } else {
        icon.classList.add("empty");
        icon.textContent = "•";
    }
    return icon;
}

// Smooth SVG arrow between build steps.
function flowArrow() {
    const wrap = el("span", "flow-arrow");
    wrap.innerHTML =
        '<svg viewBox="0 0 34 16" fill="none" aria-hidden="true">' +
        '<path d="M1 8h30m0 0l-7-6.5M31 8l-7 6.5" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return wrap;
}

function flowStep(slot, items, version) {
    const step = el("div", "flow-step");
    step.appendChild(el("span", "slot-label", slot.label));

    // A slot may hold one item or a whole purchase (e.g. starter + potions).
    const purchase = Array.isArray(slot.items) && slot.items.length ? slot.items : [slot.item];
    const icons = el("div", "flow-icons");
    for (const name of purchase) {
        icons.appendChild(slotIcon(findItem(items, name), version));
    }
    step.appendChild(icons);
    step.appendChild(el("span", "flow-name", purchase.filter(Boolean).join(" + ") || "—"));

    const options = (slot.options || []).filter(Boolean);
    if (options.length) {
        const optionRow = el("div", "flow-options");
        optionRow.appendChild(el("span", "or", "or"));
        for (const name of options) {
            const chip = el("span", "option-chip");
            const match = findItem(items, name);
            if (match) chip.appendChild(itemIcon(match.id, version));
            chip.appendChild(el("span", null, name));
            optionRow.appendChild(chip);
        }
        step.appendChild(optionRow);
    }
    return step;
}

function renderBuild(advice, items, version) {
    const flow = document.getElementById("build-flow");
    flow.replaceChildren();

    const slots = Array.isArray(advice.fullBuild) && advice.fullBuild.length
        ? advice.fullBuild
        : [
              { label: "Starting", item: advice.startingItem, options: [] },
              { label: "Boots", item: advice.boots, options: [] },
              { label: "First Item", item: advice.firstItem, options: [] },
          ];
    slots.forEach((slot, index) => {
        if (index > 0) flow.appendChild(flowArrow());
        flow.appendChild(flowStep(slot, items, version));
    });

    const direction = document.getElementById("build-direction");
    direction.replaceChildren();
    direction.appendChild(el("span", "slot-label", "Why this build"));
    direction.appendChild(el("p", null, advice.buildDirection || "—"));
}

const TIP_GLYPHS = {
    "Early lane plan": "▶",
    "Trading pattern": "↔",
    "Danger windows": "⚠",
    "How to win lane": "★",
    "Common mistakes": "✕",
};

function renderLaneTips(advice) {
    const stack = document.getElementById("lane-tips");
    stack.replaceChildren();
    const steps = [
        ["Early lane plan", advice.lanePlan, true],
        ["Trading pattern", advice.tradingPattern, false],
        ["Danger windows", advice.dangerWindows, false],
        ["How to win lane", advice.howToWinLane, false],
        ["Common mistakes", advice.commonMistakes, false],
    ];
    for (const [label, text, headline] of steps) {
        if (!text) continue;
        const card = el("div", "tip-card" + (headline ? " headline" : ""));
        const head = el("div", "tip-head");
        head.append(el("span", "tip-glyph", TIP_GLYPHS[label] || "▸"), el("h4", null, label));
        card.append(head, el("p", null, text));
        stack.appendChild(card);
    }
}

function renderTeam(listId, members, version) {
    const list = document.getElementById(listId);
    list.replaceChildren();
    for (const member of members) {
        const item = el("li");
        if (member.isPlayer) item.classList.add("is-player");
        if (member.isOpponent) item.classList.add("is-opponent");
        item.appendChild(champIcon(member.imageKey, version, 30));

        let label = member.championName;
        if (member.isPlayer) label += " (You)";
        if (member.isOpponent) label += " (Lane opponent)";
        item.appendChild(el("span", "champ-name", label));

        if (member.lane) item.appendChild(el("span", "lane-tag", member.lane));
        list.appendChild(item);
    }
}

function extraCard(title, content, glyph, colorClass) {
    const card = el("div", "extra-card");
    const head = el("div", "extra-head");
    head.appendChild(el("span", "extra-glyph " + (colorClass || "g-gold"), glyph || "▸"));
    head.appendChild(el("h4", null, title));
    card.appendChild(head);
    if (Array.isArray(content)) {
        const list = el("ul");
        content.forEach((entry) => list.appendChild(el("li", null, entry)));
        card.appendChild(list);
    } else {
        card.appendChild(el("p", null, content));
    }
    return card;
}

async function renderDashboard(data) {
    errorPanel.classList.add("hidden");

    const items = await loadItemIndex(data.ddragonVersion);
    const advice = data.advice;
    const extras = advice.extras || {};

    renderOverview(data);
    renderBadges(data.matchup, data.game);
    renderOverride(data);
    renderFeatured(advice, extras);
    renderTiles(extras);
    renderRunes(data.runes);
    renderBuild(advice, items, data.ddragonVersion);
    renderLaneTips(advice);

    renderTeam("blue-team", data.teams.blue, data.ddragonVersion);
    renderTeam("red-team", data.teams.red, data.ddragonVersion);

    const notes = document.getElementById("team-notes");
    notes.replaceChildren();
    (data.teamNotes || []).forEach((note) => notes.appendChild(el("li", null, note)));

    // Extra info: tiles cover resist/anti-heal/focus/threats, so this grid
    // holds the remaining cards plus the quick tips.
    const extraCards = document.getElementById("extra-cards");
    extraCards.replaceChildren();
    const cards = [
        ["Jungle threat", extras.jungleThreat, "◈", "g-red", false],
        ["Best recall timing", extras.recallTiming, "↺", "g-gold", false],
        ["First 10 minutes", extras.first10Min, "◔", "g-blue", false],
        ["Who to avoid", extras.avoidTarget, "✕", "g-red", false],
        ["Itemization warnings", extras.itemWarnings, "!", "g-gold", true],
    ];
    for (const [title, content, glyph, color, span] of cards) {
        if (content && (!Array.isArray(content) || content.length)) {
            const card = extraCard(title, content, glyph, color);
            if (span) card.classList.add("span-all");
            extraCards.appendChild(card);
        }
    }
    if (advice.extraTips && advice.extraTips.length) {
        const tipsCard = extraCard("Quick tips", advice.extraTips, "★", "g-green");
        tipsCard.classList.add("span-all");
        extraCards.appendChild(tipsCard);
    }

    const sourceNote = document.getElementById("source-note");
    if (data.source === "demo") {
        sourceNote.textContent = "Demo match — sample data, no Riot API call was made.";
    } else if (data.matchup.confidence === "inferred") {
        sourceNote.textContent =
            (data.aiEnhanced ? "AI-enhanced advice. " : "") +
            "Lane opponent was inferred from champion roles and summoner spells — correct it in the overview if wrong.";
    } else {
        sourceNote.textContent = data.aiEnhanced
            ? "AI-enhanced advice from live game data."
            : "Advice generated from live game data.";
    }

    dashboard.classList.remove("hidden");
    dashboard.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Events ----------

form.addEventListener("submit", (event) => {
    event.preventDefault();
    const gameName = document.getElementById("game-name").value.trim();
    const tagLine = document.getElementById("tag-line").value.trim().replace(/^#/, "");
    const platform = document.getElementById("platform").value;

    if (!gameName) {
        showError("Enter your Riot game name (the part before the #).");
        return;
    }
    if (!tagLine) {
        showError("Enter your Riot tagline (the part after the #, e.g. NA1).");
        return;
    }
    analyze({ gameName, tagLine, platform });
});

demoBtn.addEventListener("click", loadDemo);
errorDemoBtn.addEventListener("click", loadDemo);

document.getElementById("override-btn").addEventListener("click", () => {
    if (!lastRequestBody) return;
    const champion = document.getElementById("override-champion").value;
    const lane = document.getElementById("override-lane").value;
    if (!champion) return;
    analyze({
        ...lastRequestBody,
        manualEnemyChampion: champion,
        manualLane: lane || null,
    });
});
