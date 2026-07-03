// LaneLens frontend. Talks only to the LaneLens backend (/api/*) —
// the Riot API key never reaches the browser. Champion icons come from
// the public Data Dragon CDN (no key required).

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
        renderDashboard(data);
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
        renderDashboard(data);
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

// ---------- Rendering ----------

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

function statItem(label, value) {
    const wrap = el("div");
    wrap.append(el("dt", null, label), el("dd", null, value || "—"));
    return wrap;
}

function fillStatList(id, entries) {
    const list = document.getElementById(id);
    list.replaceChildren();
    for (const [label, value] of entries) {
        if (value) list.appendChild(statItem(label, value));
    }
}

function renderVersus(data) {
    const versus = document.getElementById("versus");
    versus.replaceChildren();

    const allMembers = [...data.teams.blue, ...data.teams.red];
    const me = allMembers.find((m) => m.isPlayer);
    const enemy = allMembers.find((m) => m.isOpponent);

    const mine = el("div", "champ");
    mine.append(
        champIcon(me ? me.imageKey : null, data.ddragonVersion, 72),
        el("strong", null, data.player.champion)
    );
    versus.appendChild(mine);
    versus.appendChild(el("span", "vs", "VS"));

    const theirs = el("div", "champ enemy");
    theirs.append(
        champIcon(enemy ? enemy.imageKey : null, data.ddragonVersion, 72),
        el("strong", null, data.matchup.enemyChampion || "Select opponent")
    );
    versus.appendChild(theirs);
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

    const laneSelect = document.getElementById("override-lane");
    laneSelect.value = data.matchup.lane || "";
}

function renderTeam(listId, members, version) {
    const list = document.getElementById(listId);
    list.replaceChildren();
    for (const member of members) {
        const item = el("li");
        if (member.isPlayer) item.classList.add("is-player");
        if (member.isOpponent) item.classList.add("is-opponent");
        item.appendChild(champIcon(member.imageKey, version, 28));

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

function renderDashboard(data) {
    errorPanel.classList.add("hidden");

    renderVersus(data);
    renderBadges(data.matchup, data.game);
    renderOverride(data);

    const advice = data.advice;
    const extras = advice.extras || {};

    fillStatList("overview-list", [
        ["Starting item", advice.startingItem],
        ["Boots", advice.boots],
        ["First item", advice.firstItem],
        ["Build direction", advice.buildDirection],
    ]);

    fillStatList("lane-tips-list", [
        ["Early lane plan", advice.lanePlan],
        ["Trading pattern", advice.tradingPattern],
        ["Danger windows", advice.dangerWindows],
        ["How to win lane", advice.howToWinLane],
        ["Common mistakes", advice.commonMistakes],
    ]);

    fillStatList("direction-list", [
        ["Game direction", advice.gameDirection],
        ["Teamfight plan", advice.teamfightPlan],
        ["Win condition", extras.winCondition],
        ["Biggest threats", extras.biggestThreats],
        ["Play around", extras.playAround],
    ]);

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

    const tips = document.getElementById("extra-tips");
    tips.replaceChildren();
    (advice.extraTips || []).forEach((tip) => tips.appendChild(el("li", null, tip)));

    const sourceNote = document.getElementById("source-note");
    if (data.source === "demo") {
        sourceNote.textContent = "Demo match — sample data, no Riot API call was made.";
    } else if (data.matchup.confidence === "inferred") {
        sourceNote.textContent =
            (data.aiEnhanced ? "AI-enhanced advice. " : "") +
            "Lane opponent was inferred from champion roles and summoner spells — correct it above if wrong.";
    } else {
        sourceNote.textContent = data.aiEnhanced ? "AI-enhanced advice from live game data." : "Advice generated from live game data.";
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
