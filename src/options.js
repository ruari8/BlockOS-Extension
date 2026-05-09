(() => {
const shared = self.BlockerShared;

const {
  getLocalDateKey,
  getNextResetLabel,
  cloneRules,
  ensureRuleIds,
  createRuleId,
  getUsageSeconds,
  formatDuration,
  getState,
  setState,
  initializeState,
  applyPendingRulesIfReady
} = shared || {};

const todayEl = document.querySelector("#today");
const statusMessageEl = document.querySelector("#statusMessage");
const activeRulesEl = document.querySelector("#activeRules");
const rulesForm = document.querySelector("#rulesForm");
const addRuleButton = document.querySelector("#addRuleButton");
const discardButton = document.querySelector("#discardButton");
const resetUsageButton = document.querySelector("#resetUsageButton");
const activeRuleTemplate = document.querySelector("#activeRuleTemplate");
const editableRuleTemplate = document.querySelector("#editableRuleTemplate");

let draftRules = [];

boot();

function boot() {
  if (!shared || !globalThis.chrome?.storage?.local) {
    showStatus("Extension storage is not available. Reload the unpacked extension from chrome://extensions.", true);
    return;
  }

  addRuleButton.addEventListener("click", addDraftRule);
  discardButton.addEventListener("click", discardPendingRules);
  resetUsageButton.addEventListener("click", resetTodayUsage);
  rulesForm.addEventListener("submit", saveDraftRules);
  render().catch((error) => showStatus(error.message, true));
}

async function render() {
  showStatus("Loading rules...");
  await initializeState();
  const state = await applyPendingRulesIfReady();
  const dateKey = getLocalDateKey();
  draftRules = cloneRules(state.pendingRules || state.activeRules);

  todayEl.textContent = `Today: ${dateKey} · resets ${getNextResetLabel()}`;
  renderActiveRules(state, dateKey);
  renderDraftRules();
  showStatus("");
}

function renderActiveRules(state, dateKey) {
  activeRulesEl.textContent = "";

  for (const rule of state.activeRules) {
    const node = activeRuleTemplate.content.firstElementChild.cloneNode(true);
    const used = getUsageSeconds(state, rule.id, dateKey);
    const limit = Number(rule.minutes) * 60;

    node.querySelector('[data-field="pattern"]').textContent = rule.pattern;
    node.querySelector('[data-field="status"]').textContent = rule.enabled ? "Enabled" : "Disabled";
    node.querySelector('[data-field="used"]').textContent = formatDuration(used);
    node.querySelector('[data-field="limit"]').textContent = `of ${formatDuration(limit)}`;
    activeRulesEl.append(node);
  }

  if (state.activeRules.length === 0) {
    activeRulesEl.append(emptyState("No active rules."));
  }
}

function renderDraftRules() {
  rulesForm.textContent = "";

  for (const rule of draftRules) {
    const row = editableRuleTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.ruleId = rule.id;
    row.querySelector('[name="pattern"]').value = rule.pattern;
    row.querySelector('[name="minutes"]').value = rule.minutes;
    row.querySelector('[name="enabled"]').checked = Boolean(rule.enabled);
    row.querySelector('[data-action="remove"]').addEventListener("click", () => {
      draftRules = readDraftRules().filter((candidate) => candidate.id !== rule.id);
      renderDraftRules();
    });
    rulesForm.append(row);
  }

  if (draftRules.length === 0) {
    rulesForm.append(emptyState("No rules in tomorrow's draft."));
  }
}

function addDraftRule() {
  draftRules = readDraftRules();
  draftRules.push({
    id: createRuleId("new-rule"),
    pattern: "*://*.example.com/*",
    minutes: 30,
    enabled: true
  });
  renderDraftRules();
}

async function discardPendingRules() {
  await setState({
    pendingRules: null,
    pendingRulesCreatedDate: null
  });
  await notifyBackground();
  await render();
}

async function resetTodayUsage() {
  const state = await getState();
  const dateKey = getLocalDateKey();
  const nextUsageByDate = { ...state.usageByDate };
  delete nextUsageByDate[dateKey];
  await setState({ usageByDate: nextUsageByDate });
  await notifyBackground();
  await render();
}

async function saveDraftRules(event) {
  event.preventDefault();
  const pendingRules = ensureRuleIds(readDraftRules()).map((rule) => ({
    id: rule.id,
    pattern: rule.pattern.trim(),
    minutes: Number(rule.minutes),
    enabled: Boolean(rule.enabled)
  }));

  await setState({
    pendingRules,
    pendingRulesCreatedDate: getLocalDateKey()
  });
  await notifyBackground();
  await render();
}

function readDraftRules() {
  return [...rulesForm.querySelectorAll(".editor-row")].map((row) => ({
    id: row.dataset.ruleId,
    pattern: row.querySelector('[name="pattern"]').value,
    minutes: Number(row.querySelector('[name="minutes"]').value),
    enabled: row.querySelector('[name="enabled"]').checked
  }));
}

function emptyState(message) {
  const element = document.createElement("p");
  element.className = "empty muted";
  element.textContent = message;
  return element;
}

async function notifyBackground() {
  try {
    await chrome.runtime.sendMessage({ type: "rules-updated" });
  } catch (_error) {
    // The options page still works if the background worker is asleep.
  }
}

function showStatus(message, isError = false) {
  statusMessageEl.hidden = !message;
  statusMessageEl.textContent = message;
  statusMessageEl.classList.toggle("error", isError);
}
})();
