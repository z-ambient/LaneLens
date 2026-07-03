// LaneLens frontend. Talks only to the LaneLens backend (/api/*) —
// the Riot API key never reaches the browser. Champion and item images
// come from the public Data Dragon CDN (no key required).

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

// Loading-screen art for the hero section (versionless CDN path).
function heroArt(imgEl, nameEl, imageKey, name) {
    nameEl.textContent = name || "Unknown";
    if (imageKey) {
        imgEl.src = `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${imageKey}_0.jpg`;
        imgEl.style.visibility = "visible";
    } else {
        imgEl.removeAttribute("src");
        imgEl.style.visibility = "hidden";
    }
}

// ---------- Section renderers ----------

function renderHero(data) {
    const allMembers = [...data.teams.blue, ...data.teams.red];
    const me = allMembers.find((m) => m.isPlayer);
    const enemy = allMembers.find((m) => m.isOpponent);

    heroArt(
        document.getElementById("hero-me"),
        document.getElementById("hero-me-name"),
        me && me.imageKey,
        data.player.champion
    );
    heroArt(
        document.getElementById("hero-enemy"),
        document.getElementById("hero-enemy-name"),
        enemy && enemy.imageKey,
        data.matchup.enemyChampion || "Select opponent"
    );
}

function renderBadges(matchup, game) {
    const badges = document.getElementById("matchup-badges");
    badges.replaceChildren();
    if (matchup.lane) badges.appendChild(el("span", "badge lane", matchup.lane + " lane"));
    if (matchup.difficulty) {
        badges.appendChild(
            el("span", "badge difficulty-" + matchup.difficulty.toLowerCase(), matchup.difficulty)
        );
    }
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

function buildSlotCard(slot, items, version) {
    const card = el("div", "build-slot");
    card.appendChild(el("span", "slot-label", slot.label));

    const main = el("div", "slot-main");
    main.append(
        slotIcon(findItem(items, slot.item), version),
        el("span", "slot-name", slot.item || "—")
    );
    card.appendChild(main);

    const options = (slot.options || []).filter(Boolean);
    if (options.length) {
        const row = el("div", "slot-options");
        row.appendChild(el("span", "or", "or"));
        for (const name of options) {
            const chip = el("span", "option-chip");
            const match = findItem(items, name);
            if (match) chip.appendChild(itemIcon(match.id, version));
            chip.appendChild(el("span", null, name));
            row.appendChild(chip);
        }
        card.appendChild(row);
    }
    return card;
}

function renderBuild(advice, items, version) {
    const grid = document.getElementById("build-grid");
    grid.replaceChildren();

    // Full build with alternatives; fall back to the three basic slots if an
    // (older/AI) response is missing fullBuild.
    const slots = Array.isArray(advice.fullBuild) && advice.fullBuild.length
        ? advice.fullBuild
        : [
              { label: "Starting", item: advice.startingItem, options: [] },
              { label: "Boots", item: advice.boots, options: [] },
              { label: "First Item", item: advice.firstItem, options: [] },
          ];
    for (const slot of slots) {
        grid.appendChild(buildSlotCard(slot, items, version));
    }

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
    const grid = document.getElementById("lane-tips");
    grid.replaceChildren();
    const steps = [
        ["Early lane plan", advice.lanePlan, true],
        ["Trading pattern", advice.tradingPattern, false],
        ["Danger windows", advice.dangerWindows, false],
        ["How to win lane", advice.howToWinLane, false],
        ["Common mistakes", advice.commonMistakes, false],
    ];
    for (const [label, text, featured] of steps) {
        if (!text) continue;
        const card = el("div", "tip-card" + (featured ? " span-2" : ""));
        const head = el("div", "tip-head");
        head.append(el("span", "tip-glyph", TIP_GLYPHS[label] || "▸"), el("h4", null, label));
        card.append(head, el("p", null, text));
        grid.appendChild(card);
    }
}

function renderDirection(advice, extras) {
    const list = document.getElementById("direction-list");
    list.replaceChildren();
    const entries = [
        ["Game direction", advice.gameDirection],
        ["Teamfight plan", advice.teamfightPlan],
        ["Win condition", extras.winCondition],
        ["Biggest threats", extras.biggestThreats],
        ["Play around", extras.playAround],
    ];
    for (const [label, text] of entries) {
        if (!text) continue;
        const item = el("div", "def-item");
        item.append(el("span", "def-label", label), el("p", null, text));
        list.appendChild(item);
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

function extraCard(title, content) {
    const card = el("div", "extra-card");
    card.appendChild(el("h4", null, title));
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

    renderHero(data);
    renderBadges(data.matchup, data.game);
    renderOverride(data);
    renderBuild(advice, items, data.ddragonVersion);
    renderLaneTips(advice);
    renderDirection(advice, extras);

    renderTeam("blue-team", data.teams.blue, data.ddragonVersion);
    renderTeam("red-team", data.teams.red, data.ddragonVersion);

    const notes = document.getElementById("team-notes");
    notes.replaceChildren();
    (data.teamNotes || []).forEach((note) => notes.appendChild(el("li", null, note)));

    const extraCards = document.getElementById("extra-cards");
    extraCards.replaceChildren();
    const cards = [
        ["Jungle threat", extras.jungleThreat],
        ["Best recall timing", extras.recallTiming],
        ["First 10 minutes", extras.first10Min],
        ["Who to focus", extras.focusTarget],
        ["Who to avoid", extras.avoidTarget],
        ["Anti-heal needed?", extras.antiHeal],
        ["Armor or MR priority", extras.resistPriority],
        ["Itemization warnings", extras.itemWarnings],
    ];
    for (const [title, content] of cards) {
        if (content && (!Array.isArray(content) || content.length)) {
            extraCards.appendChild(extraCard(title, content));
        }
    }

    // Extra tips live in the same section as a full-width card.
    if (advice.extraTips && advice.extraTips.length) {
        const tipsCard = extraCard("Quick tips", advice.extraTips);
        tipsCard.classList.add("span-all");
        extraCards.appendChild(tipsCard);
    }

    const sourceNote = document.getElementById("source-note");
    if (data.source === "demo") {
        sourceNote.textContent = "Demo match — sample data, no Riot API call was made.";
    } else if (data.matchup.confidence === "inferred") {
        sourceNote.textContent =
            (data.aiEnhanced ? "AI-enhanced advice. " : "") +
            "Lane opponent was inferred from champion roles and summoner spells — correct it above if wrong.";
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
