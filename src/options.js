(() => {
const shared = self.BlockerShared;

const {
  getLocalDateKey,
  getNextResetLabel,
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
const usernameForm = document.querySelector("#usernameForm");
const usernameInput = document.querySelector("#usernameInput");
const usernameStatusEl = document.querySelector("#usernameStatus");
const activeRuleTemplate = document.querySelector("#activeRuleTemplate");

boot();

function boot() {
  if (!shared || !globalThis.chrome?.storage?.local) {
    showStatus("Extension storage is not available. Reload the unpacked extension from chrome://extensions.", true);
    return;
  }

  usernameForm.addEventListener("submit", saveUsername);
  render().catch((error) => showStatus(error.message, true));
}

async function render() {
  showStatus("Loading rules...");
  await initializeState();
  const state = await applyPendingRulesIfReady();
  const dateKey = getLocalDateKey();

  todayEl.textContent = `Today: ${dateKey} · resets ${getNextResetLabel()}`;
  renderActiveRules(state, dateKey);
  renderUsername(state);
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

function renderUsername(state) {
  const current = state.chessUsername || "not set";
  const pending = state.pendingChessUsername !== null ? ` · changing to "${state.pendingChessUsername || "none"}" tomorrow` : "";
  usernameStatusEl.textContent = `Once a day, if your last game was a loss, you can play one more. Username: ${current}${pending}.`;
  usernameInput.value = state.pendingChessUsername ?? state.chessUsername;
}

async function saveUsername(event) {
  event.preventDefault();
  await setState({
    pendingChessUsername: usernameInput.value.trim().replace(/^@/, ""),
    pendingChessUsernameDate: getLocalDateKey()
  });
  await render();
}

function emptyState(message) {
  const element = document.createElement("p");
  element.className = "empty muted";
  element.textContent = message;
  return element;
}

function showStatus(message, isError = false) {
  statusMessageEl.hidden = !message;
  statusMessageEl.textContent = message;
  statusMessageEl.classList.toggle("error", isError);
}
})();
