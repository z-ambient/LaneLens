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

// ---------- Saved player profile (browser localStorage) ----------

const PROFILE_KEY = "lanelens.profile";

function loadProfile() {
    try {
        const raw = localStorage.getItem(PROFILE_KEY);
        const profile = raw ? JSON.parse(raw) : null;
        return profile && profile.gameName && profile.tagLine ? profile : null;
    } catch (err) {
        return null;
    }
}

function saveProfile(profile) {
    try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (err) {
        /* storage unavailable (private mode) - feature just stays off */
    }
    renderProfileArea();
}

function clearProfile() {
    try {
        localStorage.removeItem(PROFILE_KEY);
    } catch (err) {
        /* ignore */
    }
    renderProfileArea(true);
}

// Show one-click "Find My Matchup" when a player is saved; otherwise the form.
function renderProfileArea(forceForm) {
    const profile = loadProfile();
    const area = document.getElementById("profile-area");
    const showForm = forceForm || !profile;

    area.classList.toggle("hidden", showForm);
    form.classList.toggle("hidden", !showForm);

    if (profile) {
        document.getElementById("profile-name").textContent =
            `${profile.gameName} #${profile.tagLine}`;
        // Prefill the form for when the user switches back to it.
        document.getElementById("game-name").value = profile.gameName;
        document.getElementById("tag-line").value = profile.tagLine;
        if (profile.platform) document.getElementById("platform").value = profile.platform;
    }
}

// ---------- UI state helpers ----------

function setBusy(busy) {
    analyzeBtn.disabled = busy;
    demoBtn.disabled = busy;
    analyzeBtn.textContent = busy ? "Analyzing..." : "Analyze My Matchup";
    const findBtn = document.getElementById("find-my-matchup");
    findBtn.disabled = busy;
    findBtn.textContent = busy ? "Analyzing..." : "Find My Matchup";
}

function startLoading() {
    let step = 0;
    enhanceToken++; // invalidate any in-flight AI enhancement
    setAiStatus(null);
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
        // Remember this player so next time is one click.
        if (data.source === "riot-api" && data.player) {
            saveProfile({
                gameName: data.player.gameName || body.gameName,
                tagLine: data.player.tagLine || body.tagLine,
                platform: body.platform,
            });
        }
        // Progressive load: show the instant deterministic result now, then
        // let the AI refine it in the background.
        await renderDashboard(data);
        if (data.source === "riot-api" && data.matchup.enemyChampion) {
            enhanceAdvice(data);
        }
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

// ---------- Background AI enhancement (progressive loading) ----------

let enhanceToken = 0;

// Panels whose content the AI refines - they glow while it works.
const AI_GLOW_SELECTOR = ".main-card, .featured, .build, .extras, #stat-tiles .tile";

function setAiStatus(state) {
    document.querySelectorAll(".ai-status").forEach((badge) => {
        badge.classList.remove("hidden", "thinking", "done");
        if (state === "thinking") {
            badge.classList.add("thinking");
            badge.textContent = "✦ AI refining advice…";
        } else if (state === "done") {
            badge.classList.add("done");
            badge.textContent = "✦ AI enhanced";
        } else {
            badge.classList.add("hidden");
            badge.textContent = "";
        }
    });
    document.querySelectorAll(AI_GLOW_SELECTOR).forEach((panel) => {
        panel.classList.toggle("ai-glow", state === "thinking");
    });
}

async function enhanceAdvice(data) {
    const token = ++enhanceToken;
    const playerOnBlue = data.teams.blue.some((m) => m.isPlayer);
    const myTeam = playerOnBlue ? data.teams.blue : data.teams.red;
    const enemyTeam = playerOnBlue ? data.teams.red : data.teams.blue;

    setAiStatus("thinking");
    try {
        const response = await fetch("/api/enhance-advice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                myChampion: data.player.champion,
                enemyChampion: data.matchup.enemyChampion,
                lane: data.matchup.lane,
                myTeam: myTeam.map((m) => m.championName),
                enemyTeam: enemyTeam.map((m) => m.championName),
                queue: data.game && data.game.queue,
                selectedRunes: data.runes,
                advice: data.advice,
            }),
        });
        const result = await response.json();

        // A newer analysis started while this one was in flight - discard.
        if (token !== enhanceToken) return;

        if (result.ok && result.aiEnhanced) {
            data.advice = result.advice;
            const items = await loadItemIndex(data.ddragonVersion);
            renderAdviceSections(result.advice, items, data.ddragonVersion);
            setSourceNote(data, result.cached ? "cached" : "enhanced");
            setAiStatus("done");
        } else {
            setAiStatus(null);
        }
    } catch (err) {
        if (token === enhanceToken) setAiStatus(null);
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

// ---------- Inline SVG icon set (stroke style, inherits currentColor) ----------

const ICONS = {
    play: '<polygon points="6 4 20 12 6 20 6 4"/>',
    trade: '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="m16 21 4-4-4-4"/><path d="M20 17H4"/>',
    alert: '<path d="m10.29 3.86-8.2 14.14A2 2 0 0 0 3.8 21h16.4a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    heal: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    recall: '<path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    diamond: '<path d="M12 2 22 12 12 22 2 12 12 2z"/>',
};

function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("icon");
    svg.innerHTML = ICONS[name] || ICONS.star;
    return svg;
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

    // Reset the dial; the difficulty class is applied after the dashboard is
    // visible (see renderDashboard) so the arc animates up from zero.
    const ring = document.getElementById("diff-ring");
    ring.className = "diff-ring";
    const difficulty = data.matchup.difficulty || "—";
    ring.dataset.difficulty =
        difficulty !== "—" ? "difficulty-" + difficulty.toLowerCase() : "";
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

function featuredRow(iconName, label, text, headline) {
    const row = el("div", "featured-row" + (headline ? " headline" : ""));
    const glyph = el("span", "glyph");
    glyph.appendChild(icon(iconName));
    row.appendChild(glyph);
    const wrap = el("div", "fr-text");
    wrap.append(el("span", "fr-label", label), el("p", null, text));
    row.appendChild(wrap);
    return row;
}

function renderFeatured(advice, extras) {
    const rows = document.getElementById("featured-rows");
    rows.replaceChildren();
    const entries = [
        ["star", "Win condition", extras.winCondition, true],
        ["compass", "Game direction", advice.gameDirection, false],
        ["flag", "Teamfight plan", advice.teamfightPlan, false],
        ["users", "Play around", extras.playAround, false],
    ];
    for (const [iconName, label, text, headline] of entries) {
        if (text) rows.appendChild(featuredRow(iconName, label, text, headline));
    }
}

function renderTiles(extras) {
    const tiles = document.getElementById("stat-tiles");
    tiles.replaceChildren();
    const entries = [
        ["shield", "g-gold", "Armor or MR priority", extras.resistPriority],
        ["heal", "g-green", "Anti-heal needed?", extras.antiHeal],
        ["target", "g-red", "Who to focus", extras.focusTarget],
        ["alert", "g-blue", "Biggest threats", extras.biggestThreats],
    ];
    for (const [iconName, color, label, value] of entries) {
        if (!value) continue;
        const tile = el("div", "tile");
        const glyph = el("span", "tile-glyph " + color);
        glyph.appendChild(icon(iconName));
        tile.appendChild(glyph);
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
    // Riot's live API sometimes shares only part of the page ("partial") -
    // then the primary/secondary split isn't reliable, so everything known
    // goes under the primary tree.
    const minors = runesData.runes || [];
    const primaryMinors = runesData.partial ? minors : minors.slice(0, 3);
    const secondaryMinors = runesData.partial ? [] : minors.slice(3);

    const primary = el("div", "rune-tree");
    primary.appendChild(runeTreeHeader(runesData.primaryStyle, "Primary"));
    primary.appendChild(runeRow(runesData.keystone, true));
    primaryMinors.forEach((rune) => primary.appendChild(runeRow(rune, false)));
    body.appendChild(primary);

    if (secondaryMinors.length || (runesData.partial && runesData.subStyle)) {
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
            const dot = el("span", "shard-dot");
            dot.appendChild(icon("diamond"));
            row.appendChild(dot);
            const meta = el("div", "rune-row-meta");
            // Shards may be plain strings (older payloads) or {name, desc}.
            meta.appendChild(el("span", "rune-row-name", shard.name || shard));
            if (shard.desc) meta.appendChild(el("span", "rune-row-desc", shard.desc));
            row.appendChild(meta);
            shards.appendChild(row);
        });
        body.appendChild(shards);
    }

    if (runesData.partial) {
        body.appendChild(
            el(
                "p",
                "runes-note",
                "Riot's live-game API shared only part of the rune page for this game."
            )
        );
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

const TIP_ICONS = {
    "Early lane plan": "play",
    "Trading pattern": "trade",
    "Danger windows": "alert",
    "How to win lane": "star",
    "Common mistakes": "x",
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
        const glyph = el("span", "tip-glyph");
        glyph.appendChild(icon(TIP_ICONS[label] || "play"));
        head.append(glyph, el("h4", null, label));
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

function extraCard(title, content, iconName, colorClass) {
    const card = el("div", "extra-card");
    const head = el("div", "extra-head");
    const glyph = el("span", "extra-glyph " + (colorClass || "g-gold"));
    glyph.appendChild(icon(iconName || "star"));
    head.appendChild(glyph);
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

// Advice-driven sections, callable again when AI enhancement arrives.
function renderAdviceSections(advice, items, version) {
    const extras = advice.extras || {};
    renderFeatured(advice, extras);
    renderTiles(extras);
    renderBuild(advice, items, version);
    renderLaneTips(advice);

    // Extra info: tiles cover resist/anti-heal/focus/threats, so this grid
    // holds the remaining cards plus the quick tips.
    const extraCards = document.getElementById("extra-cards");
    extraCards.replaceChildren();
    const cards = [
        ["Jungle threat", extras.jungleThreat, "eye", "g-red", false],
        ["Best recall timing", extras.recallTiming, "recall", "g-gold", false],
        ["First 10 minutes", extras.first10Min, "clock", "g-blue", false],
        ["Who to avoid", extras.avoidTarget, "x", "g-red", false],
        ["Itemization warnings", extras.itemWarnings, "alert", "g-gold", true],
    ];
    for (const [title, content, iconName, color, span] of cards) {
        if (content && (!Array.isArray(content) || content.length)) {
            const card = extraCard(title, content, iconName, color);
            if (span) card.classList.add("span-all");
            extraCards.appendChild(card);
        }
    }
    if (advice.extraTips && advice.extraTips.length) {
        const tipsCard = extraCard("Quick tips", advice.extraTips, "zap", "g-green");
        tipsCard.classList.add("span-all");
        extraCards.appendChild(tipsCard);
    }
}

function setSourceNote(data, aiState) {
    const sourceNote = document.getElementById("source-note");
    const parts = [];
    if (data.source === "demo") {
        parts.push("Demo match — sample data, no Riot API call was made.");
    } else {
        if (aiState === "enhanced") parts.push("AI-enhanced advice.");
        if (aiState === "cached") parts.push("AI-enhanced advice (from your matchup cache).");
        if (data.matchup.confidence === "inferred") {
            parts.push("Lane opponent was inferred from champion roles and summoner spells — correct it in the overview if wrong.");
        }
        if (!parts.length) parts.push("Advice generated from live game data.");
    }
    sourceNote.textContent = parts.join(" ");
}

async function renderDashboard(data) {
    errorPanel.classList.add("hidden");

    const items = await loadItemIndex(data.ddragonVersion);

    renderOverview(data);
    renderBadges(data.matchup, data.game);
    renderOverride(data);
    renderRunes(data.runes);
    renderAdviceSections(data.advice, items, data.ddragonVersion);

    renderTeam("blue-team", data.teams.blue, data.ddragonVersion);
    renderTeam("red-team", data.teams.red, data.ddragonVersion);

    const notes = document.getElementById("team-notes");
    notes.replaceChildren();
    (data.teamNotes || []).forEach((note) => notes.appendChild(el("li", null, note)));

    setSourceNote(data, null);

    dashboard.classList.remove("hidden");

    // Two frames after reveal: transitions only run once the element is
    // rendered, so this makes the difficulty arc sweep up from zero.
    requestAnimationFrame(() =>
        requestAnimationFrame(() => {
            const ring = document.getElementById("diff-ring");
            if (ring.dataset.difficulty) ring.classList.add(ring.dataset.difficulty);
        })
    );

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

// Saved-profile controls.
document.getElementById("find-my-matchup").addEventListener("click", () => {
    const profile = loadProfile();
    if (!profile) {
        renderProfileArea(true);
        return;
    }
    analyze({
        gameName: profile.gameName,
        tagLine: profile.tagLine,
        platform: profile.platform || "na1",
    });
});

document.getElementById("profile-change").addEventListener("click", () => renderProfileArea(true));
document.getElementById("profile-clear").addEventListener("click", clearProfile);

// Restore the saved player on page load.
renderProfileArea();
