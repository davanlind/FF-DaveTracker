# AGENTS.md: notes for AI assistants (and humans) working on F&F Tracker

This file is the hand-over for any AI model (Claude, ChatGPT/Codex, Gemini, Copilot…) picking up this repo.
`CLAUDE.md` just points here.

## Who it's for

The owner (Dave) is **new to app building**. When you talk to him:
- explain setup steps simply, one step at a time, and say *where* to click;
- briefly explain technical terms the first time you use them, and gently correct terminology;
- don't add build tools, frameworks or paid services without asking. Keeping it simple is a feature.

## What the app does

A time tracker for work tasks: a start/stop timer or manual entries, repeatable and one-off tasks,
solo vs "with help" (and who helped), week/fortnight plans that **always start on Monday** with a target time per task,
and a review of target vs actual. Data syncs to a Google Sheet that acts as the ongoing record.

## Architecture (keep it this simple)

```
index.html                 the single page; loads the scripts below IN ORDER
css/styles.css             all styling (mobile first, CSS variables at the top)
js/util.js                 FF.util: dates ('YYYY-MM-DD' strings), times ('HH:MM'), durations, escaping, CSV
js/store.js                FF.store: data in localStorage + change queue; FF.model: questions about the data
js/sync.js                 FF.sync: talks to the Apps Script web app (Google Sheet)
js/ui.js                   FF.ui: modal, confirm, toast, shared forms (log entry form, plan item form)
js/views/*.js              one file per screen: today, plan, review, log, tasks, settings
js/app.js                  router (#today, #plan…), click/submit/change wiring, timer tick
apps-script/Code.gs        Google Apps Script "backend"; pasted into the Sheet by the user
docs/GOOGLE_SHEET_SETUP.md step-by-step setup for the Sheet (beginner friendly)
tests/                     Node tests: Code.gs against a fake Sheet + Playwright end-to-end
```

- **No build step, no modules, no dependencies at runtime.** Classic `<script>` tags sharing one global, `window.FF`.
  This is deliberate so it runs from GitHub Pages *and* by double-clicking `index.html`.
- **Screens** are `FF.views.<name> = { title, render() }`, where `render()` returns an HTML string.
  The whole screen is re-rendered whenever data changes (`FF.store.subscribe`). Typed input values are preserved across re-renders by element `id`.
- **Events** use attributes, not inline handlers:
  `data-action="x"` → `FF.actions.x(el, event)` (click) ·
  `data-form="x"` → `FF.forms.x(form, event)` (submit) ·
  `data-change="x"` → `FF.changes.x(el, event)` (change).
- **Always escape user text** with `FF.util.esc()` when building HTML.
- Pop-up forms use `FF.ui.modal()` (a `<dialog id="modal">`); confirmations use a second `<dialog id="confirm-modal">` so they can sit on top.

## Data model

Four tables. The same names are used in the browser (`FF.store.all('log')`) and as tabs in the Sheet.

| table | Sheet tab | key fields |
|---|---|---|
| `tasks` | Tasks | `id, name, category, targetMinutes, active, notes` |
| `plans` | Plans | `id, start` (a Monday), `end` (inclusive), `weeks` (1 or 2), `notes` |
| `planItems` | Plan Items | `id, planId, planStart, taskId` ('' for one-off), `task` (name), `type` ('Repeatable'/'One-off'), `targetMinutes, day` ('' = any day), `done, notes` |
| `log` | Log | `id, date, start, end, minutes, hours, task, type, worked` ('Solo'/'With help'), `helpers, notes, planId, planItemId, taskId` |

Every record also has `updatedAt`. IDs are strings made by `FF.util.uid(prefix)`.
Task names are **copied** onto plan items and log entries on purpose, so the Sheet is readable and old entries survive a task being deleted.

A log entry counts towards a plan target **only through `planItemId`**. Picking a repeatable task auto-links it with `FF.model.matchPlanItem()`.
Status rules live in `FF.model.statusOf()`.

**Changing the data model?** Update all of: `normalize` in `js/store.js`, `SCHEMA` in `apps-script/Code.gs`, this table, and tests.
New Sheet columns are added automatically (matched by header name), but the user must **deploy a new version** of the script (see docs).

## Sync

- Every `FF.store.upsert/remove` saves to localStorage and appends to a queue (`ff.queue.v1`).
- `FF.sync.flush()` POSTs queued ops to the web app (debounced). `FF.sync.pull()` flushes, then GETs all tables and replaces local data, re-applying anything still queued.
- POST bodies are sent as `text/plain` to avoid a CORS preflight, which Apps Script can't answer. Keep it that way.
- The running timer is stored only on the device (`ff.timer.v1`) and is not synced.
- Last write wins; there's no conflict merging. Fine for one person on a few devices.

## Testing

```bash
npm install && npm test            # both suites
node tests/apps-script.test.js     # just the Sheet connector (no install needed)
SCREENSHOTS=1 npm run test:e2e     # also saves screenshots to tests/screenshots/
```
`tests/gas-mock.js` fakes just enough of SpreadsheetApp to run `Code.gs` in Node. The e2e test routes
`script.google.com` requests to that fake, so the app and connector are tested together. Add a step to
`tests/e2e.test.js` for any new feature. Run the tests before you commit.

## Conventions

- Australian English in the UI ("finished", "colour", "fortnight"); dates shown with `en-AU`.
- Plain, friendly wording in the UI and in code comments.
- Mobile first: check new screens at ~400px wide. Inputs use 16px text so phones don't zoom in.
- Bump `FF.VERSION` in `js/util.js` for user-visible changes.

## Ideas not built yet

Pause/resume the timer · sync a running timer across devices · edit plan notes · weekly summary tab in the Sheet ·
offline caching with a service worker (be careful: cached old versions confuse beginners) · charts over many weeks.
