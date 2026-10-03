# BlockOS Extension

A small Manifest V3 browser extension for local-only site budgets. It tracks time spent in matching active tabs and blocks the site for the rest of the local day after the budget is used.

I originally built this as a practical answer to my Chess.com habit: enough friction to stop a casual "one more game" spiral, without pretending to be OS-level parental-control software. It is now part of my everyday browser setup and acts as a lightweight companion to BlockOS.

## What it does

- Tracks active-tab time against configurable URL patterns.
- Ships with a default Chess.com rule: `*://*.chess.com/*` for 30 minutes per local day.
- Blocks matching tabs once the daily budget is used.
- Has no rule editor or reset: limits are fixed in `src/shared.js`.
- Sends a warning notification with 10 minutes left.
- Allows the current Chess.com game URL to finish when the budget runs out, then blocks new Chess.com pages.
- Stores all rules and usage locally with `chrome.storage.local`.

## Install locally

1. Open `chrome://extensions` in Chrome, Chromium, or Helium.
2. Enable developer mode.
3. Choose **Load unpacked**.
4. Select this project folder.

No build step is required.

## Using it

The popup shows today's usage. The rule (`*://*.chess.com/*`, 30 minutes per local day) lives in `DEFAULT_RULES` in `src/shared.js`; changing it means editing code and reloading the extension. There is no reset button.

### Chase a loss

Once per day, if your most recent Chess.com game today was a loss, the blocked page lets you play one more game. The extension checks this against Chess.com's public API using the username saved in the popup. Username changes also only take effect the next day. A chase allows Chess.com for up to 10 minutes while you find a game, then only that one game URL, and it expires after an hour. Starting a new game or rematch blocks you again.

## Development

This is plain HTML, CSS, and JavaScript:

- `manifest.json` defines the Manifest V3 extension.
- `src/background.js` tracks usage, schedules resets, and enforces blocks.
- `src/shared.js` contains date, rule, matching, and storage helpers.
- `src/options.html` and `src/options.js` provide the rule editor.
- `src/blocked.html` and `src/blocked.js` render the blocked page.

Run the smoke check:

```sh
npm run check
```

The check validates the manifest's referenced files and syntax-checks the extension JavaScript.

## Limits

This is intentionally browser-level friction. Disabling the extension, removing it, switching profiles, or using another browser will bypass it. That tradeoff is acceptable for the use case: making the default path less impulsive without adding heavyweight monitoring or external services.
