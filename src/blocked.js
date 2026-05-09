(() => {
const {
  getLocalDateKey,
  getNextResetLabel,
  getUsageSeconds,
  formatDuration,
  getState,
  applyPendingRulesIfReady
} = self.BlockerShared;

document.addEventListener("DOMContentLoaded", renderBlockedPage);

async function renderBlockedPage() {
  await applyPendingRulesIfReady();
  const state = await getState();
  const params = new URLSearchParams(window.location.search);
  const ruleId = params.get("ruleId");
  const originalUrl = params.get("url");
  const rule = state.activeRules.find((candidate) => candidate.id === ruleId);
  const usage = rule ? getUsageSeconds(state, rule.id, getLocalDateKey()) : 0;

  document.querySelector("#title").textContent = originalUrl
    ? `${new URL(originalUrl).hostname} is blocked for today.`
    : "This site is blocked for today.";
  document.querySelector("#rulePattern").textContent = rule?.pattern || "Unknown rule";
  document.querySelector("#used").textContent = rule
    ? `${formatDuration(usage)} of ${formatDuration(Number(rule.minutes) * 60)}`
    : "-";
  document.querySelector("#reset").textContent = getNextResetLabel();
}
})();
