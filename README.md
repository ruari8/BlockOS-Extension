# Personal Site Budget Blocker

A local-only Chromium extension for Chrome and Helium that tracks daily active-tab time budgets and blocks matching sites after the limit is used.

## Load Unpacked

1. Open `chrome://extensions` in Chrome or Helium.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select this project folder.

## Default Rule

The first install creates one active rule:

- Pattern: `*://*.chess.com/*`
- Budget: 30 minutes per local day
- Enforcement: blocked until the next local day after the budget is used

## Notes

- Rule edits are saved as pending changes and apply the next day.
- The options page includes a **Reset today for testing** button so you can test short budgets without waiting for midnight.
- This is extension-level friction, not OS-level enforcement. Disabling the extension, removing it, or using a browser/profile without it will bypass the blocker.
