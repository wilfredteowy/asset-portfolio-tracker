Project-specific Copilot Instructions — Asset Portfolio Tracker

Overview
- This is a small React + Vite single-page app that reads/writes portfolio data in a Google Sheet and fetches market prices from CoinGecko and Yahoo Finance (via a CORS proxy).
- Key entry points: `src/main.jsx` (boot), `src/App.jsx` (single-file app + views), `src/config.js` (Google credentials and spreadsheet ID).

What to know before editing
- Google integration: `index.html` loads `https://accounts.google.com/gsi/client` and `https://apis.google.com/js/api.js`. Do not remove these scripts.
- OAuth flow: App uses `window.google.accounts.oauth2.initTokenClient(...)` and `gapi.client` for Sheets API. Tokens are set with `gapi.client.setToken(...)`.
- Sheets layout (expected ranges and columns):
  - `assets!A2:F` → [name, symbol, portfolio, category, exchange, currency]
  - `accounts!A2:B` → [accountName, owner]
  - `transactions!A2:H` → [date, type, asset, symbol, units, price, fees, accountName]

Architecture & data flow (concise)
- Single-page React app (`src/App.jsx`) manages these states: `masterAssets`, `transactions`, `accounts`, `prices`, `calculatedAssets`.
- Lifecycle: on sign-in app reads Sheets (`readSheet`), sets state, calls `calculateAssets()` (uses `prices` state), then `fetchPrices()` updates `prices` and re-runs `calculateAssets()`.
- Price sources: crypto → CoinGecko (`simple/price`), stocks → Yahoo Finance chart endpoint proxied through `https://api.allorigins.win/raw?url=...`.
- Key side-effects: fetching prices updates `prices` and triggers recalculation; writing transactions/assets uses `writeSheet` which appends rows to the sheet.

Project-specific patterns & gotchas
- Symbol handling: symbols are normalized to uppercase and compared by symbol OR asset name when matching transactions to assets (see `calculateAssets`).
- Exchange suffix mapping: `getTickerWithExchange()` maps exchanges to Yahoo suffixes (e.g., SGX -> `.SI`). If a symbol already contains a `.` suffix it is used as-is.
- Crypto fallback: CoinGecko ID map exists for common coins; otherwise uses lowercase symbol as the ID.
- CORS: the app relies on `api.allorigins.win` as a free proxy for Yahoo endpoints — expect occasional failures and rate limits. Prefer adding a reliable proxy or server-side fetch if you change this behavior.
- Currency handling: code applies a simple SGD conversion factor (1.35) when `currency !== 'SGD'` — this is a hard-coded simplification in `calculateAssets`.

Developer workflows
- Start dev server: `npm run dev` (runs Vite). Build: `npm run build`. Preview built app: `npm run preview`.
- Node engine is set to `20.x` in `package.json`; Vite 4 + React plugin are used.
- Debugging: use browser console. App logs helpful markers: `App mounting...`, `Fetching prices for ...`, `Calculating assets from transactions...`, and per-asset logs.

Editing guidance for AI agents
- Preserve `index.html` Google script tags and any use of `window.gapi` / `window.google` unless intentionally migrating auth to a different method.
- When modifying Sheets ranges or column mapping, update the three read/write helpers (`readSheet`, `writeSheet`) and the shapes built in `loadData()`.
- Be conservative with network changes: maintain the existing CoinGecko / Yahoo logic and proxy references, and add feature flags or new helpers rather than inlining large fetch rewrites.
- Tests & formatting: the repo currently has no test suite. Keep PRs small and run `npm run dev` to manually verify UI and Google integration.

Examples (copyable snippets)
- Read assets (from `loadData()`):
  - `const assetsData = await readSheet('assets!A2:F')`
  - `assetsData.map((row) => ({ name: row[0], symbol: (row[1]||'').toUpperCase(), ... }))`
- Write transaction (from `handleAddTransaction`):
  - `await writeSheet('transactions!A:H', [[date, type, asset, symbol, units, price, fees, accountName]])`

Where to look next
- `src/App.jsx` — large single-file implementation; split responsibilities into small modules if adding complex features.
- `src/config.js` — contains spreadsheet id and Google keys used at runtime (ensure secrets are handled appropriately).
- `vite.config.js` and `package.json` — build/dev scripts and plugin config.

If anything is unclear or you want this expanded into separate CONTRIBUTING/DEVELOPER docs, tell me which area (auth, price fetcher, sheets schema) to expand.
