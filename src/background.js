importScripts("shared.js");

(() => {
const {
  getLocalDateKey,
  secondsUntilTomorrow,
  getState,
  setState,
  initializeState,
  applyPendingRulesIfReady,
  getMatchingRule,
  isRuleOverLimit,
  getUsageSeconds
} = self.BlockerShared;

const TICK_SECONDS = 30;
const WARNING_THRESHOLD_SECONDS = 10 * 60;
const CHASE_FIND_GAME_MS = 10 * 60 * 1000;
const CHASE_MAX_MS = 60 * 60 * 1000;
const CHASE_START_URL = "https://www.chess.com/play/online";
const LOSS_RESULTS = new Set(["checkmated", "resigned", "timeout", "abandoned", "lose", "bughousepartnerlose", "kingofthehill", "threecheck"]);
let activeContext = null;
let lastTickAt = Date.now();

chrome.runtime.onInstalled.addListener(async () => {
  await initializeState();
  await applyPendingRulesIfReady();
  await scheduleResetAlarm();
  await refreshActiveContext();
  await enforceActiveTab();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeState();
  await applyPendingRulesIfReady();
  await scheduleResetAlarm();
  await refreshActiveContext();
  await enforceActiveTab();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "usage-tick") {
    await handleUsageTick().catch(console.error);
  }

  if (alarm.name === "daily-reset") {
    await handleDailyReset().catch(console.error);
  }
});

chrome.tabs.onActivated.addListener(async () => {
  await refreshActiveContext();
  await enforceActiveTab();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    await refreshActiveContext();
    await enforceTab(tabId);
  }
});

chrome.windows.onFocusChanged.addListener(async () => {
  await refreshActiveContext();
  await enforceActiveTab();
});

chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId === 0) {
    await enforceTab(details.tabId);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "chase-status") {
    getChaseEligibility().then(sendResponse).catch((error) => sendResponse({ eligible: false, reason: error.message }));
    return true;
  }

  if (message?.type === "chase-start") {
    startChase(_sender.tab?.id).then(sendResponse).catch((error) => sendResponse({ ok: false, reason: error.message }));
    return true;
  }

  return false;
});

async function scheduleResetAlarm() {
  chrome.alarms.create("usage-tick", { periodInMinutes: TICK_SECONDS / 60 });
  chrome.alarms.create("daily-reset", { when: Date.now() + secondsUntilTomorrow() * 1000 + 1000 });
}

async function handleUsageTick() {
  await initializeState();
  const state = await applyPendingRulesIfReady();
  await refreshActiveContext(state);

  const now = Date.now();
  const elapsedSeconds = Math.max(0, Math.min(TICK_SECONDS * 2, Math.round((now - lastTickAt) / 1000)));
  lastTickAt = now;

  if (!activeContext?.ruleId || elapsedSeconds === 0) {
    return;
  }

  const currentState = await getState();
  const rule = currentState.activeRules.find((candidate) => candidate.id === activeContext.ruleId);

  if (!rule || isRuleOverLimit(currentState, rule)) {
    await enforceActiveTab();
    return;
  }

  const dateKey = getLocalDateKey();
  const dateUsage = currentState.usageByDate[dateKey] || {};
  const limitSeconds = Number(rule.minutes) * 60;
  const previousSeconds = getUsageSeconds(currentState, rule.id, dateKey);
  const nextSeconds = Math.min(limitSeconds, previousSeconds + elapsedSeconds);
  const warningNotices = maybeMarkWarningNotice(currentState, rule, previousSeconds, nextSeconds, dateKey);

  await setState({
    usageByDate: {
      ...currentState.usageByDate,
      [dateKey]: {
        ...dateUsage,
        [rule.id]: nextSeconds
      }
    },
    ...(warningNotices ? { warningNoticesByDate: warningNotices } : {})
  });

  if (warningNotices) {
    await createNotification(`budget-warning-${rule.id}-${dateKey}`, {
      title: "10 minutes left",
      message: `${rule.pattern} will be blocked for today when this budget runs out.`
    });
  }

  if (nextSeconds >= Number(rule.minutes) * 60) {
    await maybeCreateGraceForCurrentGame(rule, dateKey);
    await enforceActiveTab();
  }
}

async function handleDailyReset() {
  await applyPendingRulesIfReady();
  await clearOldDailyState();
  await scheduleResetAlarm();
  await refreshActiveContext();
  await enforceActiveTab();
}

// One "chase a loss" per day: if your most recent Chess.com game today was a
// loss, you may play exactly one more game. The chase allows Chess.com until a
// /game/ URL opens, then only that game URL, and expires after CHASE_MAX_MS.
async function getChaseEligibility() {
  const state = await getState();
  const dateKey = getLocalDateKey();

  if (state.chaseByDate?.[dateKey]) {
    return { eligible: false, reason: "You've already used today's chase." };
  }

  if (!state.chessUsername) {
    return { eligible: false, reason: "Set your Chess.com username in the extension popup to enable chasing a loss (takes effect tomorrow)." };
  }

  const lastGame = await fetchLastGameToday(state.chessUsername);

  if (!lastGame) {
    return { eligible: false, reason: "No finished game found today yet. Chess.com can take a minute to publish it.", retry: true };
  }

  if (!lastGame.lost) {
    return { eligible: false, reason: `Your last game was a ${lastGame.result}. Done for today.`, retry: true };
  }

  return { eligible: true, reason: `Your last game was a loss (${lastGame.result}). You get one game to chase it, once per day.` };
}

async function startChase(tabId) {
  const eligibility = await getChaseEligibility();

  if (!eligibility.eligible) {
    return { ok: false, reason: eligibility.reason };
  }

  const state = await getState();
  await setState({
    chaseByDate: {
      ...state.chaseByDate,
      [getLocalDateKey()]: { startedAt: Date.now(), gameUrl: null }
    }
  });

  if (tabId) {
    await chrome.tabs.update(tabId, { url: CHASE_START_URL });
  }

  return { ok: true };
}

async function fetchLastGameToday(username) {
  const now = new Date();
  const archiveUrl = `https://api.chess.com/pub/player/${encodeURIComponent(username.toLowerCase())}/games/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const response = await fetch(archiveUrl, { cache: "no-store" });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Chess.com API returned ${response.status}.`);
  }

  const { games = [] } = await response.json();
  const dateKey = getLocalDateKey(now);
  const lastGame = games
    .filter((game) => game.end_time && getLocalDateKey(new Date(game.end_time * 1000)) === dateKey)
    .sort((a, b) => b.end_time - a.end_time)[0];

  if (!lastGame) {
    return null;
  }

  const name = username.toLowerCase();
  const side = lastGame.white?.username?.toLowerCase() === name ? lastGame.white : lastGame.black;
  const result = side?.result || "unknown";
  return { result, lost: LOSS_RESULTS.has(result) };
}

// Returns true when the active chase lets this URL through. Locks the chase to
// the first game URL it sees.
async function chaseAllows(state, url) {
  const dateKey = getLocalDateKey();
  const chase = state.chaseByDate?.[dateKey];

  if (!chase || !isChessUrl(url)) {
    return false;
  }

  const elapsed = Date.now() - chase.startedAt;

  if (elapsed > CHASE_MAX_MS) {
    return false;
  }

  if (!chase.gameUrl) {
    if (elapsed > CHASE_FIND_GAME_MS) {
      return false;
    }

    if (isChessGameUrl(url)) {
      await setState({
        chaseByDate: {
          ...state.chaseByDate,
          [dateKey]: { ...chase, gameUrl: normalizeGraceUrl(url) }
        }
      });
    }

    return true;
  }

  return normalizeGraceUrl(url) === chase.gameUrl;
}

function isChessUrl(url) {
  try {
    return /(^|\.)chess\.com$/i.test(new URL(url).hostname);
  } catch (_error) {
    return false;
  }
}

function maybeMarkWarningNotice(state, rule, previousSeconds, nextSeconds, dateKey) {
  const limitSeconds = Number(rule.minutes) * 60;
  const previousRemaining = limitSeconds - previousSeconds;
  const nextRemaining = limitSeconds - nextSeconds;
  const dateNotices = state.warningNoticesByDate?.[dateKey] || {};

  if (
    limitSeconds <= WARNING_THRESHOLD_SECONDS ||
    dateNotices[rule.id] ||
    previousRemaining <= WARNING_THRESHOLD_SECONDS ||
    nextRemaining > WARNING_THRESHOLD_SECONDS
  ) {
    return null;
  }

  return {
    ...state.warningNoticesByDate,
    [dateKey]: {
      ...dateNotices,
      [rule.id]: true
    }
  };
}

async function maybeCreateGraceForCurrentGame(rule, dateKey) {
  if (!activeContext?.url || !isChessGameUrl(activeContext.url)) {
    return;
  }

  const state = await getState();
  const dateGraceUrls = state.graceUrlsByDate?.[dateKey] || {};
  const ruleGraceUrls = dateGraceUrls[rule.id] || [];
  const normalizedUrl = normalizeGraceUrl(activeContext.url);

  if (ruleGraceUrls.includes(normalizedUrl)) {
    return;
  }

  await setState({
    graceUrlsByDate: {
      ...state.graceUrlsByDate,
      [dateKey]: {
        ...dateGraceUrls,
        [rule.id]: [...ruleGraceUrls, normalizedUrl]
      }
    }
  });

  await createNotification(`budget-grace-${rule.id}-${dateKey}`, {
    title: "Budget used",
    message: "You can finish this Chess.com game. New Chess.com pages are blocked until tomorrow."
  });
}

async function createNotification(id, options) {
  if (!chrome.notifications?.create) {
    return;
  }

  try {
    await chrome.notifications.create(id, {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      ...options
    });
  } catch (error) {
    console.warn("Notification failed", error);
  }
}

function isChessGameUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return /(^|\.)chess\.com$/i.test(parsedUrl.hostname) && /^\/game\//i.test(parsedUrl.pathname);
  } catch (_error) {
    return false;
  }
}

function normalizeGraceUrl(url) {
  const parsedUrl = new URL(url);
  parsedUrl.hash = "";
  return parsedUrl.href;
}

function isGraceUrl(state, rule, url) {
  try {
    const dateKey = getLocalDateKey();
    const normalizedUrl = normalizeGraceUrl(url);
    const graceUrls = state.graceUrlsByDate?.[dateKey]?.[rule.id] || [];
    return graceUrls.includes(normalizedUrl);
  } catch (_error) {
    return false;
  }
}

async function clearOldDailyState() {
  const state = await getState();
  const today = getLocalDateKey();

  const warningNoticesByDate = Object.keys(state.warningNoticesByDate || {}).every((dateKey) => dateKey === today)
    ? state.warningNoticesByDate
    : { [today]: state.warningNoticesByDate?.[today] || {} };

  const graceUrlsByDate = Object.keys(state.graceUrlsByDate || {}).every((dateKey) => dateKey === today)
    ? state.graceUrlsByDate
    : { [today]: state.graceUrlsByDate?.[today] || {} };

  const chaseByDate = Object.keys(state.chaseByDate || {}).every((dateKey) => dateKey === today)
    ? state.chaseByDate
    : (state.chaseByDate?.[today] ? { [today]: state.chaseByDate[today] } : {});

  if (
    warningNoticesByDate === state.warningNoticesByDate &&
    graceUrlsByDate === state.graceUrlsByDate &&
    chaseByDate === state.chaseByDate
  ) {
    return;
  }

  await setState({
    warningNoticesByDate,
    graceUrlsByDate,
    chaseByDate
  });
}

async function refreshActiveContext(state = null) {
  const focusedWindowId = await getFocusedWindowId();

  if (!focusedWindowId) {
    activeContext = null;
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindowId });

  if (!tab?.id || !tab.url) {
    activeContext = null;
    return;
  }

  const currentState = state || await getState();
  const rule = getMatchingRule(tab.url, currentState.activeRules);
  activeContext = rule ? { tabId: tab.id, url: tab.url, ruleId: rule.id } : null;
}

async function getFocusedWindowId() {
  try {
    const window = await chrome.windows.getLastFocused();
    return window?.focused ? window.id : null;
  } catch (_error) {
    return null;
  }
}

async function enforceActiveTab() {
  const focusedWindowId = await getFocusedWindowId();

  if (!focusedWindowId) {
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, windowId: focusedWindowId });

  if (tab?.id) {
    await enforceTab(tab.id);
  }
}

async function enforceTab(tabId) {
  let tab;

  try {
    tab = await chrome.tabs.get(tabId);
  } catch (_error) {
    return;
  }

  if (!tab?.url || tab.url.startsWith(chrome.runtime.getURL(""))) {
    return;
  }

  const state = await applyPendingRulesIfReady();
  const rule = getMatchingRule(tab.url, state.activeRules);

  if (!rule || !isRuleOverLimit(state, rule) || isGraceUrl(state, rule, tab.url) || await chaseAllows(state, tab.url)) {
    return;
  }

  const blockedUrl = chrome.runtime.getURL(
    `src/blocked.html?ruleId=${encodeURIComponent(rule.id)}&url=${encodeURIComponent(tab.url)}`
  );

  if (tab.url !== blockedUrl) {
    await chrome.tabs.update(tabId, { url: blockedUrl });
  }
}
})();
