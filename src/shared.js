(() => {
const DEFAULT_RULES = [
  {
    id: "chess-com",
    pattern: "*://*.chess.com/*",
    minutes: 30,
    enabled: true
  }
];

const STORAGE_DEFAULTS = {
  activeRules: DEFAULT_RULES,
  pendingRules: null,
  pendingRulesCreatedDate: null,
  usageByDate: {},
  warningNoticesByDate: {},
  graceUrlsByDate: {}
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTomorrowStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

function getNextResetLabel(date = new Date()) {
  return getTomorrowStart(date).toLocaleString([], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function secondsUntilTomorrow(date = new Date()) {
  return Math.max(1, Math.ceil((getTomorrowStart(date).getTime() - date.getTime()) / 1000));
}

function cloneRules(rules) {
  return JSON.parse(JSON.stringify(rules || []));
}

function ensureRuleIds(rules) {
  return cloneRules(rules).map((rule) => ({
    ...rule,
    id: rule.id || createRuleId(rule.pattern)
  }));
}

function createRuleId(pattern) {
  const normalized = String(pattern || "rule").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${normalized || "rule"}-${Date.now().toString(36)}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function patternToRegExp(pattern) {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function getMatchingRule(url, rules) {
  if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://") || url.startsWith("edge://")) {
    return null;
  }

  return (rules || []).find((rule) => {
    if (!rule.enabled) {
      return false;
    }

    try {
      if (patternToRegExp(rule.pattern).test(url)) {
        return true;
      }

      if (rule.pattern.includes("://*.")) {
        const rootPattern = rule.pattern.replace("://*.", "://");
        return patternToRegExp(rootPattern).test(url);
      }

      return false;
    } catch (_error) {
      return false;
    }
  }) || null;
}

function getUsageSeconds(state, ruleId, dateKey = getLocalDateKey()) {
  return Number(state.usageByDate?.[dateKey]?.[ruleId] || 0);
}

function isRuleOverLimit(state, rule, dateKey = getLocalDateKey()) {
  return getUsageSeconds(state, rule.id, dateKey) >= Number(rule.minutes || 0) * 60;
}

function minutesFromSeconds(seconds) {
  return Math.floor(seconds / 60);
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

async function getState() {
  const state = await chrome.storage.local.get(STORAGE_DEFAULTS);
  const activeRules = ensureRuleIds(state.activeRules?.length ? state.activeRules : DEFAULT_RULES);
  return {
    ...STORAGE_DEFAULTS,
    ...state,
    activeRules,
    pendingRules: state.pendingRules ? ensureRuleIds(state.pendingRules) : null,
    usageByDate: state.usageByDate || {},
    warningNoticesByDate: state.warningNoticesByDate || {},
    graceUrlsByDate: state.graceUrlsByDate || {}
  };
}

async function setState(partialState) {
  await chrome.storage.local.set(partialState);
}

async function initializeState() {
  const stored = await chrome.storage.local.get(["activeRules", "usageByDate", "warningNoticesByDate", "graceUrlsByDate"]);
  const patch = {};

  if (!stored.activeRules) {
    patch.activeRules = DEFAULT_RULES;
  }

  if (!stored.usageByDate) {
    patch.usageByDate = {};
  }

  if (!stored.warningNoticesByDate) {
    patch.warningNoticesByDate = {};
  }

  if (!stored.graceUrlsByDate) {
    patch.graceUrlsByDate = {};
  }

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
}

async function applyPendingRulesIfReady(date = new Date()) {
  const state = await getState();
  const today = getLocalDateKey(date);

  if (!state.pendingRules || state.pendingRulesCreatedDate === today) {
    return state;
  }

  const nextState = {
    ...state,
    activeRules: ensureRuleIds(state.pendingRules),
    pendingRules: null,
    pendingRulesCreatedDate: null
  };

  await setState({
    activeRules: nextState.activeRules,
    pendingRules: null,
    pendingRulesCreatedDate: null
  });

  return nextState;
}

if (typeof self !== "undefined") {
  self.BlockerShared = {
    DEFAULT_RULES,
    STORAGE_DEFAULTS,
    MS_PER_DAY,
    getLocalDateKey,
    getTomorrowStart,
    getNextResetLabel,
    secondsUntilTomorrow,
    cloneRules,
    ensureRuleIds,
    createRuleId,
    getMatchingRule,
    getUsageSeconds,
    isRuleOverLimit,
    minutesFromSeconds,
    formatDuration,
    getState,
    setState,
    initializeState,
    applyPendingRulesIfReady
  };
}
})();
