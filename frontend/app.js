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
    document.getElementById("rail-home").classList.toggle("active", view !== "settings");
    document.getElementById("rail-settings").classList.toggle("active", view === "settings");
}

function showSettings() {
    leaveHome();
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
fetchMe();
