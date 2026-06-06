# BlockOS Extension

A small Manifest V3 browser extension for local-only site budgets. It tracks time spent in matching active tabs and blocks the site for the rest of the local day after the budget is used.

I originally built this as a practical answer to my Chess.com habit: enough friction to stop a casual "one more game" spiral, without pretending to be OS-level parental-control software. It is now part of my everyday browser setup and acts as a lightweight companion to BlockOS.

## What it does

- Tracks active-tab time against configurable URL patterns.
- Ships with a default Chess.com rule: `*://*.chess.com/*` for 30 minutes per local day.
- Blocks matching tabs once the daily budget is used.
- Applies rule edits the next day, so limits cannot be changed in the moment.
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

Open the extension popup or options page to view today's active rules and edit tomorrow's draft rules. A rule has:

- `pattern`: a URL pattern such as `*://*.chess.com/*`
- `minutes`: the daily active-tab budget
- `enabled`: whether the rule is active

Saved changes become active at the next local day. The options page also includes **Reset today for testing**, which clears today's usage and restores blocked tabs so short budgets can be tested without waiting until midnight.

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
