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

// ---------- Home / results mode ----------

// Splash art rotated on the landing hero (Data Dragon, no key needed).
const HOME_SPLASHES = [
    "Ahri", "Jinx", "Yasuo", "Leona", "Lux", "Yone", "Sett", "Riven",
    "Akali", "Malphite", "Kaisa", "LeeSin",
];

function goHome() {
    document.getElementById("loading").classList.add("hidden");
    errorPanel.classList.add("hidden");
    document.getElementById("no-game").classList.add("hidden");
    dashboard.classList.add("hidden");

    const splash = document.getElementById("home-splash");
    const pick = HOME_SPLASHES[Math.floor(Math.random() * HOME_SPLASHES.length)];
    splash.src = `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${pick}_0.jpg`;

    // The search inputs live in the hero on the home screen; the saved-player
    // controls (Find My Matchup / auto-detect) stay in the top bar in every
    // view. Status panels (loading / error / no-game) show above the inputs.
    document.getElementById("hero-status").append(
        document.getElementById("loading"),
        errorPanel,
        document.getElementById("no-game")
    );
    document.getElementById("hero-search").append(
        document.getElementById("analyze-form"),
        demoBtn
    );
    document.body.classList.add("is-home");
    document.getElementById("home").classList.remove("hidden");
    hideSettings();
    hideHistory();
    renderProfileArea();
    window.scrollTo({ top: 0, behavior: "instant" });
}

function leaveHome() {
    if (!document.body.classList.contains("is-home")) return;
    document.getElementById("home").classList.add("hidden");
    document.body.classList.remove("is-home");

    // Controls return to the top bar (account chip stays LAST so it is
    // always pinned to the right edge); status panels to the results column.
    document.querySelector(".topbar").append(
        document.getElementById("profile-area"),
        document.getElementById("analyze-form"),
        demoBtn,
        document.getElementById("account-area")
    );
    dashboard.parentNode.insertBefore(document.getElementById("loading"), dashboard);
    dashboard.parentNode.insertBefore(errorPanel, dashboard);
    dashboard.parentNode.insertBefore(document.getElementById("no-game"), dashboard);
    renderProfileArea();
}

// ---------- Settings view ----------

function setRailActive(view) {
    document.getElementById("rail-home").classList.toggle("active", view !== "settings" && view !== "history");
    document.getElementById("rail-history").classList.toggle("active", view === "history");
    document.getElementById("rail-settings").classList.toggle("active", view === "settings");
}

function showSettings() {
    leaveHome();
    hideHistory();
    dashboard.classList.add("hidden");
    document.getElementById("loading").classList.add("hidden");
    errorPanel.classList.add("hidden");
    document.getElementById("no-game").classList.add("hidden");

    // Prefill from the saved profile.
    const profile = loadProfile();
    document.getElementById("settings-game-name").value = profile ? profile.gameName : "";
    document.getElementById("settings-tag-line").value = profile ? profile.tagLine : "";
    if (profile && profile.platform) {
        document.getElementById("settings-platform").value = profile.platform;
    }
    document.getElementById("settings-feedback").textContent = "";
    document.getElementById("settings-sync-note").textContent = currentUser
        ? `Synced to your Discord account (${currentUser.username}) — available on any device you sign in on.`
        : "Saved in this browser. Sign in with Discord to sync across devices.";

    document.getElementById("settings").classList.remove("hidden");
    setRailActive("settings");
    window.scrollTo({ top: 0, behavior: "instant" });
}

function hideSettings() {
    document.getElementById("settings").classList.add("hidden");
    setRailActive("main");
}

// ---------- Discord account ----------

let currentUser = null;
let discordConfigured = false;

const DISCORD_LOGO =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037 19.736 19.736 0 0 0-4.885 1.515.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>';

function renderAccountArea() {
    const area = document.getElementById("account-area");
    area.replaceChildren();

    if (currentUser) {
        const wrap = el("div", "account-menu-wrap");

        // The chip itself (avatar + name) toggles the dropdown.
        const chip = el("button", "account-chip");
        chip.type = "button";
        chip.title = "Account menu";
        if (currentUser.avatar) {
            const img = document.createElement("img");
            img.src = `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png?size=64`;
            img.alt = "";
            chip.appendChild(img);
        }
        chip.appendChild(el("span", "account-name", currentUser.username));
        const caret = el("span", "account-caret");
        caret.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
        chip.appendChild(caret);

        const menu = el("div", "account-menu hidden");

        const settingsItem = el("button", "account-menu-item");
        settingsItem.type = "button";
        settingsItem.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
        settingsItem.appendChild(el("span", null, "Settings"));
        settingsItem.addEventListener("click", () => {
            menu.classList.add("hidden");
            showSettings();
        });

        const signOutItem = el("button", "account-menu-item");
        signOutItem.type = "button";
        signOutItem.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
        signOutItem.appendChild(el("span", null, "Sign out"));
        signOutItem.addEventListener("click", async () => {
            try {
                await fetch("/auth/logout", { method: "POST" });
            } catch (err) { /* signing out is best-effort */ }
            currentUser = null;
            renderAccountArea();
            // Matchup history is account data: drop it and lock the tab.
            historyGames = null;
            historySelected = null;
            if (!document.getElementById("history").classList.contains("hidden")) {
                renderHistoryTab();
            }
        });

        menu.append(settingsItem, signOutItem);
        chip.addEventListener("click", (event) => {
            event.stopPropagation();
            menu.classList.toggle("hidden");
        });

        wrap.append(chip, menu);
        area.appendChild(wrap);
    } else if (discordConfigured) {
        const button = el("button", "discord-btn");
        button.type = "button";
        button.innerHTML = DISCORD_LOGO;
        button.appendChild(el("span", null, "Sign in"));
        button.addEventListener("click", () => { window.location.href = "/auth/login"; });
        area.appendChild(button);
    }
}

// Session check on load; a signed-in user's saved Riot profile follows them
// to any browser, hydrating the same saved-player UI localStorage feeds.
async function fetchMe() {
    try {
        const response = await fetch("/api/me");
        const result = await response.json();
        discordConfigured = !!result.configured;
        currentUser = result.authenticated ? result.user : null;
        renderAccountArea();
        if (currentUser && currentUser.riotProfile) {
            saveProfile(currentUser.riotProfile);
        }
    } catch (err) {
        /* backend unreachable - the analyze flow will surface it */
    }
}

// Persist the saved player on the account too (fire-and-forget).
function syncProfileToAccount(profile) {
    if (!currentUser) return;
    fetch("/api/me/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
    }).catch(() => {});
}

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
    syncWatch();
}

function clearProfile() {
    try {
        localStorage.removeItem(PROFILE_KEY);
    } catch (err) {
        /* ignore */
    }
    renderProfileArea(true);
    syncWatch();
}

// Show one-click "Find My Matchup" when a player is saved. On the home
// hero the inputs stay VISIBLE and prefilled alongside it (freely editable);
// only the compact top bar collapses the form behind the profile chip.
function renderProfileArea(forceForm) {
    const profile = loadProfile();
    const area = document.getElementById("profile-area");
    const isHome = document.body.classList.contains("is-home");
    const showProfileUi = !!profile && !forceForm;

    area.classList.toggle("hidden", !showProfileUi);
    form.classList.toggle("hidden", showProfileUi && !isHome);

    if (profile) {
        document.getElementById("profile-name").textContent =
            `${profile.gameName} #${profile.tagLine}`;
        // Keep the inputs auto-filled with the saved values.
        document.getElementById("game-name").value = profile.gameName;
        document.getElementById("tag-line").value = profile.tagLine;
        if (profile.platform) document.getElementById("platform").value = profile.platform;
    }
}

// ---------- UI state helpers ----------

function setBusy(busy) {
    isBusy = busy;
    analyzeBtn.disabled = busy;
    demoBtn.disabled = busy;
    // Text lives in an inner <span> (the shiny-CTA glow layer on home).
    (analyzeBtn.querySelector("span") || analyzeBtn).textContent =
        busy ? "Analyzing..." : "Analyze My Matchup";
    const findBtn = document.getElementById("find-my-matchup");
    findBtn.disabled = busy;
    findBtn.textContent = busy ? "Analyzing..." : "Find My Matchup";
}

function startLoading() {
    // Stay on the home screen while loading: errors and "no live game"
    // display there, above the search card. Success leaves via renderDashboard.
    let step = 0;
    enhanceToken++; // invalidate any in-flight AI enhancement
    clearAiStatus();
    hideSettings();
    hideHistory();
    errorPanel.classList.add("hidden");
    document.getElementById("no-game").classList.add("hidden");
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
    document.getElementById("no-game").classList.add("hidden");
    errorMessage.textContent = message;
    errorPanel.classList.remove("hidden");
}

// Calm state for "not in a game right now" - this isn't an error.
function showNoGame(body) {
    stopLoading();
    dashboard.classList.add("hidden");
    errorPanel.classList.add("hidden");
    const who = body && body.gameName ? `${body.gameName} #${body.tagLine}` : "this player";
    document.getElementById("no-game-text").textContent =
        `No live game found for ${who}. Start a League match, then try again.`;
    document.getElementById("no-game").classList.remove("hidden");
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
            if (response.status === 404 && /no live/i.test(data.error || "")) {
                showNoGame(body);
            } else {
                showError(friendlyError(response.status, data.error));
            }
            return;
        }
        // Remember this player so next time is one click (and on the
        // account, so it follows a signed-in user across devices).
        if (data.source === "riot-api" && data.player) {
            const profile = {
                gameName: data.player.gameName || body.gameName,
                tagLine: data.player.tagLine || body.tagLine,
                platform: body.platform,
            };
            saveProfile(profile);
            syncProfileToAccount(profile);
        }
        // Progressive load: show the instant deterministic result now, then
        // let the AI and match history fill in from the background.
        currentGameStart = (data.game && data.game.gameStartTime) || null;
        await renderDashboard(data);
        if (data.source === "riot-api" && data.matchup.enemyChampion) {
            enhanceAdvice(data);
            fetchMatchupHistory(data);
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

// ---------- Personal matchup history (background lookup) ----------

let historyToken = 0;

function renderHistoryLine(record, myChampion, enemyChampion) {
    const line = document.getElementById("history-line");
    line.replaceChildren();
    if (!record) {
        line.classList.add("hidden");
        return;
    }
    line.classList.remove("hidden");

    const text =
        record.games === 0
            ? `No recorded games as ${myChampion} vs ${enemyChampion} yet`
            : `Your record as ${myChampion} vs ${enemyChampion}: ${record.wins}W – ${record.losses}L`;
    line.appendChild(el("span", null, text));

    // Form strip: last 5 meetings, newest first; dots pad missing games.
    const strip = el("span", "form-strip");
    strip.title = "Last 5 games in this matchup (newest first)";
    const recent = record.recent || [];
    for (let slot = 0; slot < 5; slot++) {
        const result = recent[slot];
        if (result === "win") {
            strip.appendChild(el("span", "form-badge form-w", "W"));
        } else if (result === "loss") {
            strip.appendChild(el("span", "form-badge form-l", "L"));
        } else {
            strip.appendChild(el("span", "form-badge form-empty"));
        }
    }
    line.appendChild(strip);
}

async function fetchMatchupHistory(data) {
    const token = ++historyToken;
    try {
        const response = await fetch("/api/matchup-history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                puuid: data.player.puuid,
                platform: (lastRequestBody && lastRequestBody.platform) || "na1",
                myChampion: data.player.champion,
                enemyChampion: data.matchup.enemyChampion,
            }),
        });
        const result = await response.json();
        if (token !== historyToken) return;
        if (result.ok) {
            renderHistoryLine(result.record, data.player.champion, data.matchup.enemyChampion);
        }
    } catch (err) {
        /* history is optional - stay hidden on failure */
    }
}

// ---------- Matchup History tab ----------
// Data comes from GET /api/my/matchup-history (session cookie = the only
// credential). Every game already carries laneScore/laneGrade/gradeLabel,
// computed server-side in app/lane_score.py - the ONLY place the scoring
// math lives. The gradeForScore copy below exists solely to grade client-
// side AVERAGES of those server scores (and the sample data).

let mePromise = null;        // resolved /api/me check (auth state known)
let historyGames = null;     // fetched games, newest first; null = not loaded
let historyNeedsProfile = false;
let historyStale = false;    // served from storage, Riot refresh failed
let historyLoading = false;
let historyDemoMode = false;
let historySelected = null;  // "MyChampion|EnemyChampion" of the open detail

const HISTORY_STATES = [
    "history-locked", "history-no-profile", "history-loading",
    "history-error", "history-empty", "history-content",
];

// Mirrors GRADE_THRESHOLDS in app/lane_score.py.
function gradeForScore(score) {
    if (score >= 95) return "S+";
    if (score >= 90) return "S";
    if (score >= 80) return "A";
    if (score >= 70) return "B";
    if (score >= 60) return "C";
    if (score >= 50) return "D";
    return "F";
}

const GRADE_CLASS = {
    "S+": "grade-splus", "S": "grade-s", "A": "grade-a", "B": "grade-b",
    "C": "grade-c", "D": "grade-d", "F": "grade-f",
};

function gradeBadge(grade, big) {
    if (!grade) return el("span", "grade-badge grade-none" + (big ? " big" : ""), "—");
    return el("span", "grade-badge " + (GRADE_CLASS[grade] || "grade-none") + (big ? " big" : ""), grade);
}

// Champion icons in this tab reuse the ddragon CDN (already CSP-whitelisted);
// the current patch version is fetched once, lazily.
let ddragonVersionPromise = null;

function historyDdragonVersion() {
    if (!ddragonVersionPromise) {
        ddragonVersionPromise = fetch("https://ddragon.leagueoflegends.com/api/versions.json")
            .then((response) => response.json())
            .then((versions) => versions[0])
            .catch(() => null);
    }
    return ddragonVersionPromise;
}

// ----- Sample data (the logged-out "preview" and a stand-in until real
// games accumulate). Grades mirror what app/lane_score.py would produce.
let demoHistoryCache = null;

function demoHistoryGames() {
    if (demoHistoryCache) return demoHistoryCache;
    const day = 86400000;
    const now = Date.now();
    const game = (daysAgo, mine, enemy, win, score, mineStats, enemyStats, summary) => ({
        matchId: `demo-${daysAgo}-${mine}-${enemy}`,
        myChampion: mine, enemyChampion: enemy, position: "TOP",
        win, endedAt: now - daysAgo * day, duration: 1860,
        kills: mineStats[0], deaths: mineStats[1], assists: mineStats[2],
        cs: mineStats[3], gold: mineStats[4], damage: mineStats[5],
        teamKills: mineStats[0] + mineStats[2] + 8,
        enemyKills: enemyStats[0], enemyDeaths: enemyStats[1], enemyAssists: enemyStats[2],
        enemyCs: enemyStats[3], enemyGold: enemyStats[4], enemyDamage: enemyStats[5],
        laneScore: score, laneGrade: gradeForScore(score),
        gradeLabel: {
            "S+": "Dominated matchup", "S": "Dominated matchup", "A": "Won lane",
            "B": "Solid / even lane", "C": "Struggled but playable",
            "D": "Lost lane", "F": "Lost lane hard",
        }[gradeForScore(score)],
        aiSummary: summary || null,
    });
    demoHistoryCache = [
        game(1, "Malphite", "Sett", true, 84, [4, 2, 9, 184, 12400, 14200], [2, 4, 3, 160, 10100, 16800],
            "You played the lane safely, avoided extended trades, and had strong teamfight impact after level 6."),
        game(2, "Malphite", "Fiora", false, 38, [1, 6, 2, 142, 8900, 7600], [8, 1, 3, 210, 13600, 21500],
            "Fiora punished every wave you stepped up to. Consider Bramble Vest first back and shorter trades."),
        game(4, "Garen", "Teemo", true, 91, [9, 1, 4, 201, 13800, 22400], [2, 7, 2, 155, 9400, 14100],
            "Excellent patience — you tracked Teemo's blind cooldown and only committed when it was down."),
        game(6, "Malphite", "Sett", false, 55, [2, 4, 7, 168, 10200, 9800], [4, 3, 5, 181, 11600, 17300]),
        game(8, "Malphite", "Darius", false, 44, [1, 5, 4, 150, 9100, 8400], [6, 2, 3, 195, 12800, 19000],
            "Darius controlled the bush and forced trades with ghost up. Respect level 1-3 and farm with Q."),
        game(9, "Garen", "Teemo", true, 90, [7, 1, 6, 192, 12700, 18900], [2, 5, 3, 154, 9700, 13600]),
        game(12, "Malphite", "Sett", true, 72, [3, 3, 8, 172, 11000, 12100], [3, 3, 4, 175, 11000, 16000]),
        game(15, "Malphite", "Darius", true, 66, [2, 3, 9, 161, 10400, 10600], [3, 2, 5, 178, 11400, 15400]),
        game(18, "Garen", "Sett", true, 82, [7, 2, 3, 190, 12600, 18700], [3, 5, 2, 165, 10200, 15900]),
        game(21, "Malphite", "Sett", false, 47, [1, 5, 5, 149, 9200, 8100], [7, 2, 4, 188, 12500, 18600]),
        game(24, "Garen", "Teemo", true, 96, [12, 0, 6, 216, 14600, 24100], [1, 8, 2, 139, 8500, 11200],
            "Total lane control — you denied CS, dodged every blind, and turned the lead into two towers."),
        game(27, "Malphite", "Fiora", false, 52, [2, 4, 6, 158, 9800, 9200], [5, 3, 4, 186, 12100, 17800]),
        game(29, "Malphite", "Sett", true, 76, [3, 2, 10, 178, 11300, 12800], [2, 4, 6, 170, 10700, 15100]),
    ];
    return demoHistoryCache;
}

// ----- View plumbing -----

function hideHistory() {
    document.getElementById("history").classList.add("hidden");
}

async function showHistory() {
    leaveHome();
    hideSettings();
    dashboard.classList.add("hidden");
    loadingPanel.classList.add("hidden");
    errorPanel.classList.add("hidden");
    document.getElementById("no-game").classList.add("hidden");
    document.getElementById("history").classList.remove("hidden");
    setRailActive("history");
    window.scrollTo({ top: 0, behavior: "instant" });
    if (mePromise) await mePromise; // auth state must be known before rendering
    renderHistoryTab();
}

function historyShowState(id) {
    HISTORY_STATES.forEach((state) =>
        document.getElementById(state).classList.toggle("hidden", state !== id)
    );
    // The champion splash belongs to the content view only.
    if (id !== "history-content") setHistorySplash(null);
}

// Faded splash art of the most played champion behind the tab (like the
// overview card's champion splash).
function setHistorySplash(games) {
    const splash = document.getElementById("history-splash");
    if (!games || !games.length) {
        splash.classList.add("hidden");
        splash.removeAttribute("src");
        return;
    }
    const most = mostCommon(games.map((g) => g.myChampion)).name;
    splash.onerror = () => splash.classList.add("hidden");
    splash.src = `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${most}_0.jpg`;
    splash.classList.remove("hidden");
}

function renderHistoryTab() {
    if (historyDemoMode) {
        renderHistoryContent(demoHistoryGames(), true);
        return;
    }
    if (!currentUser) {
        historyShowState("history-locked");
        document.getElementById("history-login").classList.toggle("hidden", !discordConfigured);
        document.getElementById("history-login-note").classList.toggle("hidden", discordConfigured);
        return;
    }
    if (historyGames === null) {
        fetchMyHistory();
        return;
    }
    if (historyNeedsProfile) {
        historyShowState("history-no-profile");
        return;
    }
    if (!historyGames.length) {
        historyShowState("history-empty");
        return;
    }
    renderHistoryContent(historyGames, false);
}

async function fetchMyHistory() {
    if (historyLoading) return;
    historyLoading = true;
    historyShowState("history-loading");
    try {
        const response = await fetch("/api/my/matchup-history");
        const data = await response.json().catch(() => null);
        if (!data) throw new Error("unreadable");
        if (!data.ok) {
            if (response.status === 401) {
                // Session expired since page load - fall back to the locked state.
                currentUser = null;
                renderAccountArea();
                historyLoading = false;
                renderHistoryTab();
                return;
            }
            document.getElementById("history-error-text").textContent =
                friendlyError(response.status, data.error);
            historyShowState("history-error");
            return;
        }
        historyGames = data.games || [];
        historyNeedsProfile = !!data.needsProfile;
        historyStale = data.refreshed === false;
        historyLoading = false;
        renderHistoryTab();
        return;
    } catch (err) {
        document.getElementById("history-error-text").textContent =
            "Could not reach the LaneLens backend. Make sure the server is running, then try again.";
        historyShowState("history-error");
    } finally {
        historyLoading = false;
    }
}

// ----- Filters, grouping, and math -----

function historyFilterValues() {
    return {
        champ: document.getElementById("hf-champ").value,
        enemy: document.getElementById("hf-enemy").value,
        result: document.getElementById("hf-result").value,
        grade: document.getElementById("hf-grade").value,
        rangeDays: Number(document.getElementById("hf-range").value) || 0,
        sort: document.getElementById("hf-sort").value,
    };
}

function populateHistoryChampFilters(games) {
    const fill = (id, names, label) => {
        const select = document.getElementById(id);
        const previous = select.value;
        select.replaceChildren();
        const all = el("option", null, label);
        all.value = "";
        select.appendChild(all);
        [...names].sort().forEach((name) => {
            const option = el("option", null, name);
            option.value = name;
            select.appendChild(option);
        });
        if ([...select.options].some((o) => o.value === previous)) select.value = previous;
    };
    fill("hf-champ", new Set(games.map((g) => g.myChampion)), "All champions");
    fill("hf-enemy", new Set(games.map((g) => g.enemyChampion)), "All enemies");
}

function filteredHistoryGames(games) {
    const f = historyFilterValues();
    const cutoff = f.rangeDays ? Date.now() - f.rangeDays * 86400000 : null;
    return games.filter((g) =>
        (!f.champ || g.myChampion === f.champ) &&
        (!f.enemy || g.enemyChampion === f.enemy) &&
        (!f.result || (f.result === "win") === !!g.win) &&
        (!f.grade || g.laneGrade === f.grade) &&
        (!cutoff || (g.endedAt || 0) >= cutoff)
    );
}

// One row per "my champion vs enemy champion" pair.
function groupMatchups(games) {
    const map = new Map();
    for (const game of games) {
        const key = game.myChampion + "|" + game.enemyChampion;
        if (!map.has(key)) {
            map.set(key, { key, myChampion: game.myChampion, enemyChampion: game.enemyChampion, games: [] });
        }
        map.get(key).games.push(game);
    }
    return [...map.values()].map((matchup) => {
        const wins = matchup.games.filter((g) => g.win).length;
        const scored = matchup.games.filter((g) => g.laneScore != null);
        const avgScore = scored.length
            ? Math.round(scored.reduce((sum, g) => sum + g.laneScore, 0) / scored.length)
            : null;
        return {
            ...matchup,
            wins,
            losses: matchup.games.length - wins,
            winRate: wins / matchup.games.length,
            avgScore,
            avgGrade: avgScore == null ? null : gradeForScore(avgScore),
            lastPlayed: Math.max(...matchup.games.map((g) => g.endedAt || 0)),
        };
    });
}

function sortMatchupRows(rows, mode) {
    const by = {
        newest: (a, b) => b.lastPlayed - a.lastPlayed,
        played: (a, b) => b.games.length - a.games.length || b.lastPlayed - a.lastPlayed,
        winrate: (a, b) => b.winRate - a.winRate || b.games.length - a.games.length,
        best: (a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1),
        worst: (a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101),
    };
    return [...rows].sort(by[mode] || by.newest);
}

function fmtPercent(ratio) {
    const value = ratio * 100;
    return (Number.isInteger(value) ? value : value.toFixed(1)) + "%";
}

function fmtThousands(value) {
    if (value == null) return "—";
    return value >= 1000 ? (value / 1000).toFixed(1) + "k" : String(value);
}

function fmtWhen(timestamp) {
    if (!timestamp) return "—";
    const minutes = Math.floor((Date.now() - timestamp) / 60000);
    if (minutes < 60) return "just now";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
}

// ----- Renderers -----

async function renderHistoryContent(games, isDemo) {
    historyShowState("history-content");
    document.getElementById("history-demo-note").classList.toggle("hidden", !isDemo);
    document.getElementById("history-stale-note").classList.toggle("hidden", isDemo || !historyStale);

    setHistorySplash(games);
    populateHistoryChampFilters(games);
    renderHistorySummary(games);

    const version = await historyDdragonVersion();
    const filtered = filteredHistoryGames(games);
    const rows = sortMatchupRows(groupMatchups(filtered), historyFilterValues().sort);

    renderHistoryTable(rows, version);
    renderHistoryDetail(rows, version);
}

function summaryCard(label, value, sub) {
    const card = el("div", "hs-card");
    card.appendChild(el("span", "hs-label", label));
    if (value instanceof Node) {
        const wrap = el("div", "hs-value");
        wrap.appendChild(value);
        card.appendChild(wrap);
    } else {
        card.appendChild(el("div", "hs-value", value));
    }
    if (sub) card.appendChild(el("span", "hs-sub", sub));
    return card;
}

// Small donut: the gold arc is the share of games won.
function winRateRing(ratio) {
    const ns = "http://www.w3.org/2000/svg";
    const circumference = 2 * Math.PI * 24;
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 60 60");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("hs-ring");

    const track = document.createElementNS(ns, "circle");
    track.setAttribute("cx", "30");
    track.setAttribute("cy", "30");
    track.setAttribute("r", "24");
    track.classList.add("hs-ring-track");
    svg.appendChild(track);

    const fill = document.createElementNS(ns, "circle");
    fill.setAttribute("cx", "30");
    fill.setAttribute("cy", "30");
    fill.setAttribute("r", "24");
    fill.setAttribute("stroke-dasharray", `${circumference * ratio} ${circumference}`);
    fill.setAttribute("transform", "rotate(-90 30 30)"); // start at 12 o'clock
    fill.classList.add("hs-ring-fill");
    svg.appendChild(fill);
    return svg;
}

function mostCommon(names) {
    const counts = new Map();
    names.forEach((name) => counts.set(name, (counts.get(name) || 0) + 1));
    let best = null;
    for (const [name, count] of counts) {
        if (!best || count > best.count) best = { name, count };
    }
    return best;
}

// Summary cards always cover ALL tracked games (filters only shape the table).
function renderHistorySummary(games) {
    const summary = document.getElementById("history-summary");
    summary.replaceChildren();

    const wins = games.filter((g) => g.win).length;
    summary.appendChild(summaryCard("Tracked games", String(games.length), `${wins}W – ${games.length - wins}L`));

    const rate = wins / games.length;
    const rateWrap = el("div", "hs-rate");
    rateWrap.appendChild(winRateRing(rate));
    rateWrap.appendChild(el("span", "hs-rate-value", fmtPercent(rate)));
    summary.appendChild(summaryCard("Overall win rate", rateWrap, `${wins} of ${games.length} games won`));

    // Best/worst need 2+ meetings so one lucky game doesn't crown a matchup.
    const rows = groupMatchups(games).filter((row) => row.games.length >= 2);
    if (rows.length) {
        const best = sortMatchupRows(rows, "winrate")[0];
        const worst = sortMatchupRows(rows, "winrate")[rows.length - 1];
        summary.appendChild(summaryCard("Best matchup", `${best.myChampion} vs ${best.enemyChampion}`,
            `${fmtPercent(best.winRate)} over ${best.games.length} games`));
        summary.appendChild(summaryCard("Worst matchup", `${worst.myChampion} vs ${worst.enemyChampion}`,
            `${fmtPercent(worst.winRate)} over ${worst.games.length} games`));
    }

    const played = mostCommon(games.map((g) => g.myChampion));
    const enemy = mostCommon(games.map((g) => g.enemyChampion));
    summary.appendChild(summaryCard("Most played champion", played.name, `${played.count} games`));
    summary.appendChild(summaryCard("Most common enemy", enemy.name, `${enemy.count} meetings`));

    const scored = games.filter((g) => g.laneScore != null);
    if (scored.length) {
        const avg = Math.round(scored.reduce((sum, g) => sum + g.laneScore, 0) / scored.length);
        summary.appendChild(summaryCard("Average lane grade", gradeBadge(gradeForScore(avg), true), `score ${avg} / 100`));
    }
}

function champSide(name, version, size, extraClass) {
    const side = el("span", "hm-side" + (extraClass ? " " + extraClass : ""));
    side.appendChild(champIcon(name, version, size));
    side.appendChild(el("span", "hm-name", name));
    return side;
}

// Works for both matchup rows and game cards ({myChampion, enemyChampion}).
// My side is mirrored (.mine) so "vs" sits centered between the champions.
function matchupCell(row, version, size) {
    const cell = el("div", "hm-champs");
    cell.appendChild(champSide(row.myChampion, version, size || 28, "mine"));
    cell.appendChild(el("span", "hm-vs", "vs"));
    cell.appendChild(champSide(row.enemyChampion, version, size || 28));
    return cell;
}

function renderHistoryTable(rows, version) {
    const body = document.getElementById("history-rows");
    body.replaceChildren();
    document.getElementById("history-no-results").classList.toggle("hidden", rows.length > 0);

    for (const row of rows) {
        const tr = el("tr", row.key === historySelected ? "is-selected" : null);

        const matchup = el("td");
        matchup.appendChild(matchupCell(row, version));
        tr.appendChild(matchup);

        tr.appendChild(el("td", "hm-num", String(row.games.length)));
        tr.appendChild(el("td", "hm-num hm-wins", String(row.wins)));
        tr.appendChild(el("td", "hm-num hm-losses", String(row.losses)));

        const rate = el("td", "hm-rate");
        rate.appendChild(el("span", null, fmtPercent(row.winRate)));
        const bar = el("span", "hm-bar");
        const fill = el("span", "hm-bar-fill");
        fill.style.width = Math.round(row.winRate * 100) + "%";
        bar.appendChild(fill);
        rate.appendChild(bar);
        tr.appendChild(rate);

        const grade = el("td", "hm-grade-cell");
        grade.appendChild(gradeBadge(row.avgGrade));
        tr.appendChild(grade);

        tr.appendChild(el("td", "hm-num", row.avgScore == null ? "—" : String(row.avgScore)));
        tr.appendChild(el("td", "hm-when", fmtWhen(row.lastPlayed)));

        const actions = el("td", "hm-actions");
        const view = el("button", "btn-ghost small", row.key === historySelected ? "Viewing" : "View games");
        view.type = "button";
        actions.appendChild(view);
        tr.appendChild(actions);

        tr.addEventListener("click", () => {
            historySelected = row.key === historySelected ? null : row.key;
            renderHistoryTab();
            if (historySelected) {
                setTimeout(() =>
                    document.getElementById("history-detail")
                        .scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
            }
        });
        body.appendChild(tr);
    }
}

function statBlock(label, value) {
    const block = el("div", "hg-stat");
    block.appendChild(el("span", "hg-stat-label", label));
    block.appendChild(el("span", "hg-stat-value", value));
    return block;
}

function historyGameCard(game, version) {
    const card = el("div", "hgame " + (game.win ? "is-win" : "is-loss"));

    // Result + date lead from the top-left, over the matching color wash.
    const top = el("div", "hg-top");
    top.appendChild(el("span", "hg-result " + (game.win ? "is-win" : "is-loss"), game.win ? "Victory" : "Defeat"));
    top.appendChild(el("span", "hg-when", fmtWhen(game.endedAt)));
    card.appendChild(top);

    // Aligned columns (same widths on every card): matchup | stats | grade.
    const main = el("div", "hg-main");

    main.appendChild(matchupCell(game, version, 34));

    if (game.laneScore != null) {
        const stats = el("div", "hg-stats");
        stats.appendChild(statBlock("KDA", `${game.kills} / ${game.deaths} / ${game.assists}`));
        stats.appendChild(statBlock("CS", String(game.cs)));
        stats.appendChild(statBlock("Gold", fmtThousands(game.gold)));
        stats.appendChild(statBlock("Damage", fmtThousands(game.damage)));
        main.appendChild(stats);
    }

    // Grade rides the right edge: score/label first, emblem outermost.
    const gradeWrap = el("div", "hg-grade");
    gradeWrap.appendChild(gradeBadge(game.laneGrade, true));
    const gradeMeta = el("div", "hg-grade-meta");
    gradeMeta.appendChild(el("span", "hg-score",
        game.laneScore == null ? "No stats stored" : `${game.laneScore} / 100`));
    if (game.gradeLabel) gradeMeta.appendChild(el("span", "hg-grade-label", game.gradeLabel));
    gradeWrap.appendChild(gradeMeta);
    main.appendChild(gradeWrap);

    card.appendChild(main);

    if (game.enemyKills != null) {
        card.appendChild(el("p", "hg-enemy-line",
            `${game.enemyChampion}: ${game.enemyKills} / ${game.enemyDeaths} / ${game.enemyAssists}` +
            ` · ${game.enemyCs} CS · ${fmtThousands(game.enemyGold)} gold · ${fmtThousands(game.enemyDamage)} dmg`));
    }
    if (game.aiSummary) {
        card.appendChild(el("p", "hg-summary", `“${game.aiSummary}”`));
    }
    return card;
}

function renderHistoryDetail(rows, version) {
    const detail = document.getElementById("history-detail");
    const row = rows.find((r) => r.key === historySelected);
    if (!row) {
        historySelected = null;
        detail.classList.add("hidden");
        return;
    }
    detail.classList.remove("hidden");
    document.getElementById("history-detail-title").textContent =
        `${row.myChampion} vs ${row.enemyChampion} — ${row.wins}W · ${row.losses}L`;

    const list = document.getElementById("history-games");
    list.replaceChildren();
    row.games.forEach((game) => list.appendChild(historyGameCard(game, version)));
}

// ---------- Auto-detect: watch for the saved player's next game ----------

const AUTODETECT_KEY = "lanelens.autodetect";
const WATCH_INTERVAL_MS = 30000;

let watchTimer = null;
let watchBackoff = 0;
let currentGameStart = null;
let isBusy = false;

function autoDetectEnabled() {
    try {
        return localStorage.getItem(AUTODETECT_KEY) === "1";
    } catch (err) {
        return false;
    }
}

function setWatchStatus(text) {
    const chip = document.getElementById("watch-status");
    if (text) {
        chip.classList.remove("hidden");
        document.getElementById("watch-text").textContent = text;
    } else {
        chip.classList.add("hidden");
    }
}

function syncWatch() {
    const button = document.getElementById("auto-detect");
    const on = autoDetectEnabled();
    button.textContent = "Auto-detect: " + (on ? "On" : "Off");
    button.classList.toggle("on", on);

    const shouldRun = on && !!loadProfile();
    if (shouldRun && !watchTimer) {
        watchTimer = setInterval(watchTick, WATCH_INTERVAL_MS);
        setWatchStatus("Watching for your next game…");
        watchTick();
    } else if (!shouldRun && watchTimer) {
        clearInterval(watchTimer);
        watchTimer = null;
        setWatchStatus(null);
    } else if (!shouldRun) {
        setWatchStatus(null);
    }
}

// One silent poll: no loading screen, no error panel.
async function watchTick() {
    if (document.hidden || isBusy) return;
    if (watchBackoff > 0) {
        watchBackoff--;
        return;
    }
    const profile = loadProfile();
    if (!profile) return;

    const stamp = new Date().toLocaleTimeString();
    try {
        const response = await fetch("/api/analyze-matchup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                gameName: profile.gameName,
                tagLine: profile.tagLine,
                platform: profile.platform || "na1",
            }),
        });
        const data = await response.json().catch(() => null);

        if (response.status === 429) {
            watchBackoff = 3; // give the rate limit ~90s of air
            setWatchStatus(`Rate limited — pausing checks · ${stamp}`);
            return;
        }
        if (!data || !data.ok) {
            setWatchStatus(`Watching for your next game · checked ${stamp}`);
            return;
        }

        const gameStart = data.game && data.game.gameStartTime;
        if (gameStart && gameStart === currentGameStart) {
            setWatchStatus("In game — dashboard is live");
            return; // same game already on screen; don't reset the view
        }

        // New live game found: bring up the full dashboard.
        currentGameStart = gameStart || Date.now();
        lastRequestBody = {
            gameName: profile.gameName,
            tagLine: profile.tagLine,
            platform: profile.platform || "na1",
        };
        setWatchStatus("Game found — analyzing!");
        await renderDashboard(data);
        if (data.matchup.enemyChampion) {
            enhanceAdvice(data);
            fetchMatchupHistory(data);
        }
        setWatchStatus("In game — dashboard is live");
    } catch (err) {
        setWatchStatus(`Backend unreachable · ${stamp}`);
    }
}

// ---------- Background AI enhancement (progressive loading) ----------

let enhanceToken = 0;

// Each AI section refines its own panels: they glow while that section is
// in flight and settle the moment its response lands.
// glow: elements ringed while in flight. swap: PERSISTENT containers to
// animate on re-render (tiles are recreated, so their parent animates).
// animateHeight: the build panel is content-sized, so its height change
// glides instead of snapping; every other panel is fixed-height.
const AI_SECTIONS = {
    build: { glow: [".build"], swap: [".build"], badge: null, animateHeight: true },
    lane: { glow: [".main-card"], swap: [".main-card"], badge: null },
    gameplan: { glow: [".featured"], swap: [".featured", "#stat-tiles"], badge: ".featured .ai-status" },
    extras: { glow: [".extras", "#stat-tiles .tile"], swap: [".extras", "#stat-tiles"], badge: ".extras .ai-status" },
};

// What to re-render when a section's delta arrives.
const SECTION_RENDER = {
    build: (advice, items, version) => renderBuild(advice, items, version),
    lane: (advice) => {
        renderLaneTips(advice);
        renderExtraCards(advice); // quick-tips card lives in the extras grid
    },
    gameplan: (advice) => {
        renderFeatured(advice, advice.extras || {});
        renderTiles(advice.extras || {}); // biggest-threats tile
    },
    extras: (advice) => {
        renderTiles(advice.extras || {});
        renderExtraCards(advice);
    },
};

// Re-render a section with a soft content fade. Most panels are fixed
// height so nothing shifts; content-sized panels (the build) glide
// smoothly from their old height to the new one.
function smoothUpdate(selectors, renderFn, animateHeight) {
    const panels = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]);
    const oldHeights = animateHeight ? panels.map((panel) => panel.offsetHeight) : null;

    renderFn();

    panels.forEach((panel, index) => {
        panel.classList.remove("ai-refresh");
        void panel.offsetWidth; // restart the fade animation
        panel.classList.add("ai-refresh");
        setTimeout(() => panel.classList.remove("ai-refresh"), 450);

        if (!animateHeight) return;
        const newHeight = panel.offsetHeight;
        if (Math.abs(newHeight - oldHeights[index]) > 2) {
            panel.style.height = oldHeights[index] + "px";
            panel.style.overflow = "hidden";
            panel.style.transition = "height 0.35s ease";
            requestAnimationFrame(() => {
                panel.style.height = newHeight + "px";
                setTimeout(() => {
                    panel.style.height = "";
                    panel.style.overflow = "";
                    panel.style.transition = "";
                }, 380);
            });
        }
    });
}

function setSectionState(section, state) {
    const spec = AI_SECTIONS[section];
    spec.glow.forEach((selector) =>
        document.querySelectorAll(selector).forEach((panel) =>
            panel.classList.toggle("ai-glow", state === "thinking")
        )
    );
    if (!spec.badge) return;
    const badge = document.querySelector(spec.badge);
    badge.classList.remove("hidden", "thinking", "done");
    if (state === "thinking") {
        badge.classList.add("thinking");
        badge.textContent = "✦ AI refining…";
    } else if (state === "done") {
        badge.classList.add("done");
        badge.textContent = "✦ AI enhanced";
    } else {
        badge.classList.add("hidden");
        badge.textContent = "";
    }
}

function clearAiStatus() {
    Object.keys(AI_SECTIONS).forEach((section) => setSectionState(section, null));
}

// Fire one AI request per section in parallel; each panel updates as its
// own answer arrives instead of everything waiting for the slowest.
async function enhanceAdvice(data) {
    const token = ++enhanceToken;
    const playerOnBlue = data.teams.blue.some((m) => m.isPlayer);
    const myTeam = playerOnBlue ? data.teams.blue : data.teams.red;
    const enemyTeam = playerOnBlue ? data.teams.red : data.teams.blue;

    const base = {
        myChampion: data.player.champion,
        enemyChampion: data.matchup.enemyChampion,
        lane: data.matchup.lane,
        myTeam: myTeam.map((m) => m.championName),
        enemyTeam: enemyTeam.map((m) => m.championName),
        queue: data.game && data.game.queue,
        selectedRunes: data.runes,
        advice: data.advice,
    };

    let anyEnhanced = false;
    let anyCached = false;
    const sections = Object.keys(AI_SECTIONS);
    sections.forEach((section) => setSectionState(section, "thinking"));

    await Promise.all(
        sections.map(async (section) => {
            try {
                const response = await fetch("/api/enhance-advice", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ...base, section }),
                });
                const result = await response.json();

                // A newer analysis started while this was in flight - discard.
                if (token !== enhanceToken) return;

                if (result.ok && result.aiEnhanced && result.delta) {
                    const { extras, ...fields } = result.delta;
                    Object.assign(data.advice, fields);
                    if (extras) {
                        data.advice.extras = { ...(data.advice.extras || {}), ...extras };
                    }
                    const items = await loadItemIndex(data.ddragonVersion);
                    if (token !== enhanceToken) return;
                    smoothUpdate(
                        AI_SECTIONS[section].swap,
                        () => SECTION_RENDER[section](data.advice, items, data.ddragonVersion),
                        AI_SECTIONS[section].animateHeight
                    );
                    anyEnhanced = true;
                    if (result.cached) anyCached = true;
                    setSectionState(section, "done");
                } else {
                    setSectionState(section, null);
                }
            } catch (err) {
                if (token === enhanceToken) setSectionState(section, null);
            }
        })
    );

    if (token === enhanceToken && anyEnhanced) {
        setSourceNote(data, anyCached ? "cached" : "enhanced");
    }
}

function friendlyError(status, message) {
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

    // Show at most two alternatives per step so the flow's height stays
    // predictable inside the fixed, unscrolled build panel.
    const options = (slot.options || []).filter(Boolean).slice(0, 2);
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

// Extra info grid: tiles cover resist/anti-heal/focus/threats, so this
// holds the remaining cards plus the quick tips.
function renderExtraCards(advice) {
    const extras = advice.extras || {};
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

// Advice-driven sections, callable again when AI enhancement arrives.
function renderAdviceSections(advice, items, version) {
    const extras = advice.extras || {};
    renderFeatured(advice, extras);
    renderTiles(extras);
    renderBuild(advice, items, version);
    renderLaneTips(advice);
    renderExtraCards(advice);
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
    leaveHome(); // auto-detect can land here without a loading phase
    hideSettings();
    hideHistory();
    errorPanel.classList.add("hidden");

    const items = await loadItemIndex(data.ddragonVersion);

    renderOverview(data);
    renderBadges(data.matchup, data.game);
    renderOverride(data);
    // Demo ships a canned record; live games fill this in from the background.
    renderHistoryLine(data.matchupHistory || null, data.player.champion, data.matchup.enemyChampion);
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
document.getElementById("no-game-demo-btn").addEventListener("click", loadDemo);

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

document.getElementById("auto-detect").addEventListener("click", () => {
    try {
        localStorage.setItem(AUTODETECT_KEY, autoDetectEnabled() ? "0" : "1");
    } catch (err) {
        /* storage unavailable */
    }
    syncWatch();
});

// Check immediately when the tab becomes visible again.
document.addEventListener("visibilitychange", () => {
    if (!document.hidden && watchTimer) watchTick();
});

// Close the account dropdown when clicking anywhere else or pressing Escape.
document.addEventListener("click", (event) => {
    if (!event.target.closest(".account-menu-wrap")) {
        document.querySelectorAll(".account-menu").forEach((menu) => menu.classList.add("hidden"));
    }
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        document.querySelectorAll(".account-menu").forEach((menu) => menu.classList.add("hidden"));
    }
});

document.getElementById("brand-home").addEventListener("click", goHome);
document.getElementById("rail-home").addEventListener("click", goHome);
document.getElementById("rail-settings").addEventListener("click", showSettings);
document.getElementById("rail-history").addEventListener("click", showHistory);

// Matchup History tab controls.
document.getElementById("history-demo-btn").addEventListener("click", () => {
    historyDemoMode = true;
    historySelected = null;
    renderHistoryTab();
});
document.getElementById("history-demo-exit").addEventListener("click", () => {
    historyDemoMode = false;
    historySelected = null;
    renderHistoryTab();
});
document.getElementById("history-open-settings").addEventListener("click", showSettings);
document.getElementById("history-retry").addEventListener("click", () => {
    historyGames = null;
    renderHistoryTab();
});
document.getElementById("history-detail-close").addEventListener("click", () => {
    historySelected = null;
    renderHistoryTab();
});
["hf-champ", "hf-enemy", "hf-result", "hf-grade", "hf-range", "hf-sort"].forEach((id) =>
    document.getElementById(id).addEventListener("change", renderHistoryTab)
);

document.getElementById("settings-save").addEventListener("click", () => {
    const gameName = document.getElementById("settings-game-name").value.trim();
    const tagLine = document.getElementById("settings-tag-line").value.trim().replace(/^#/, "");
    const platform = document.getElementById("settings-platform").value;
    const feedback = document.getElementById("settings-feedback");

    if (!gameName || !tagLine) {
        feedback.textContent = "Enter both a game name and a tagline.";
        feedback.classList.add("is-error");
        return;
    }
    const profile = { gameName, tagLine, platform };
    saveProfile(profile);
    syncProfileToAccount(profile);
    feedback.classList.remove("is-error");
    feedback.textContent = "Saved ✓";
    setTimeout(() => { feedback.textContent = ""; }, 2500);
});

// Restore the saved player on page load and start on the home screen.
renderProfileArea();
syncWatch();
goHome();
mePromise = fetchMe();
