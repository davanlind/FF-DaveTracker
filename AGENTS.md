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
js/timers.js               FF.timers: open tasks (one running, others on hold), pause/resume/switch, finish → log rows
js/colors.js               FF.colors: a colour per task name (auto from a validated palette, or user-picked), picker pop-up
js/charts.js               FF.charts: one day's timeline bar, clock ring (12h, outer AM / inner PM), bars per task and per location
js/picks.js                FF.picks: pins (tasks/locations), most-used/recent lists, type-or-pick "chips" form field
js/ui.js                   FF.ui: modal, confirm, toast, shared forms (log entry form, plan item form)
js/views/*.js              one file per screen: today, plan, review, log, tasks, settings
js/app.js                  router (#today, #plan…), click/submit/change wiring, timer tick
apps-script/Code.gs        Google Apps Script "backend"; pasted into the Sheet by the user
docs/GOOGLE_SHEET_SETUP.md step-by-step setup for the Sheet (beginner friendly)
tests/                     Node tests: Code.gs against a fake Sheet + Playwright end-to-end
android/                   Android app (Kotlin WebView shell) that bundles the web files above
.github/workflows/android.yml  GitHub Actions: builds the APK on push, publishes a Release
docs/ANDROID_APP.md        install/update steps for the APK (beginner friendly)
```

- **No build step, no modules, no dependencies at runtime.** Classic `<script>` tags sharing one global, `window.FF`.
  This is deliberate so it runs from GitHub Pages *and* by double-clicking `index.html`.
- **Screens** are `FF.views.<name> = { title, render() }`, where `render()` returns an HTML string.
  The whole screen is re-rendered whenever data changes (`FF.store.subscribe`). Typed input values are preserved across re-renders by element `id`.
- **Events** use attributes, not inline handlers:
  `data-action="x"` → `FF.actions.x(el, event)` (click) ·
  `data-form="x"` → `FF.forms.x(form, event)` (submit) ·
  `data-change="x"` → `FF.changes.x(el, event)` (change) ·
  `data-input="x"` → `FF.inputs.x(el, event)` (every keystroke; also re-run after a re-render to restore state).
- **Always escape user text** with `FF.util.esc()` when building HTML.
- The Today "start a task" box is a type-or-pick list (`taskSuggestions()` / `suggestHtml()` in `js/views/today.js`):
  open planned items, repeatable tasks, then recent one-offs from the log. Typed text matching a name exactly uses that task;
  anything else starts a new one-off. (The Log/Plan forms still use the `FF.ui.taskOptions()` dropdown.)
- Pop-up forms use `FF.ui.modal()` (a `<dialog id="modal">`); confirmations use a second `<dialog id="confirm-modal">` so they can sit on top.

## Android app

- `android/app/src/main/java/au/ff/tracker/MainActivity.kt` is the **only** Kotlin file. It shows a WebView that loads
  `https://appassets.androidplatform.net/www/index.html`, served from APK assets via `WebViewAssetLoader`.
- The web files are **copied in at build time** by the `copyWebAssets` task in `android/app/build.gradle.kts`
  (`index.html`, `manifest.webmanifest`, `css/`, `js/`, `icons/`). Never edit copies inside `android/`; change the web files.
  If you add a new top-level web folder, add it to that task's `includes` **and** to the workflow's `paths`.
- The page talks to the app through `window.FFAndroid` (a `@JavascriptInterface`): `saveFile(name, mime, text)` and
  `appVersion()`. `FF.isApp` is true inside the app (the page gets class `in-app` on `<html>`). The app's back button calls
  `FF.app.back()`, which closes an open dialog and returns true.
- Data sharing between the website and the app happens **only through the Google Sheet** (each has its own localStorage).
- Builds: `.github/workflows/android.yml` runs `./gradlew assembleRelease` on ubuntu (JDK 17), then publishes the APK as a
  GitHub Release tagged `android-1.0.<run number>`. The stable link is `releases/latest/download/FF-Tracker.apk`.
  `versionCode` = GitHub run number, so every build installs as an update.
- Signing uses `android/ff-tracker-sideload.keystore` (password `fftracker`), **committed on purpose** so every build has the
  same signature and updates keep the user's data. It's for side-loading only. If this ever goes to the Play Store,
  make a new private key and keep it in GitHub Secrets.
- Versions: AGP 8.7.3, Kotlin 2.1.0, Gradle 8.11.1 (wrapper), compileSdk/targetSdk 35, minSdk 26. No Compose, no AppCompat.
- The Android build can't run in sandboxes that block Google's Maven. Check the GitHub Actions run instead.

## Data model

Five tables. The same names are used in the browser (`FF.store.all('log')`) and as tabs in the Sheet.

| table | Sheet tab | key fields |
|---|---|---|
| `tasks` | Tasks | `id, name, category, targetMinutes, active, notes` |
| `plans` | Plans | `id, start` (a Monday), `end` (inclusive), `weeks` (1 or 2), `notes` |
| `planItems` | Plan Items | `id, planId, planStart, taskId` ('' for one-off), `task` (name), `type` ('Repeatable'/'One-off'), `targetMinutes, day` ('' = any day), `done, notes` |
| `log` | Log | `id, date, start, end, minutes, hours, task, location, type, worked` ('Solo'/'With help'), `helpers, notes, planId, planItemId, taskId` |
| `pins` | Pinned | `id` (= `pin:<kind>:` + lower-case name), `kind` ('task'/'location'), `name` |
| `colors` | Colours | `id` (= `color:` + lower-case task name), `name, color` (#rrggbb), `auto` (true if picked automatically) |
| `active` | Active timers | `id, task, type, taskId, planItemId, planId, segments` (array of `{start, end, location}`; ISO times; `end` '' = running). Stored as JSON text in the Sheet (kind `json`). |

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
- Timers: several tasks can be open; at most one has a running segment. Starting/resuming one pauses the running one
  (`FF.timers.start/resume`). Finishing turns **each segment** into its own `log` row (`FF.timers.toEntries`, stints under
  1 minute are dropped) and deletes the `active` record. Open timers sync like any table. A v1.0 single timer
  (`ff.timer.v1`) is migrated into `active` on load.
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

## Charts and colours

- Task colours come from `FF.colors.PALETTE`, 8 colours checked for colour-blind safety with the dataviz skill's
  `validate_palette.js` (light mode, white card). Don't add generated colours to the automatic set; the picker has extras.
  Three palette colours are under 3:1 contrast on white, so charts must always show task names/times as text too.
- Colour follows the task **name** (not its rank), assigned the first time a task appears and then saved (synced).
- `FF.charts.dayRing` draws log entries plus open timer segments (faded). Arcs are split at midday onto the AM/PM rings.
  Today re-renders once a minute (`tick()` in app.js) so the "now" hand moves, but not while a pop-up or input is in use.

## Locations, pins, day history

- Location is free text, on each log row and each timer segment. The device's current location
  (`settings.currentLocation`, not synced, set from Today's 📍 button) is given to new segments; changing it while a task runs
  splits the segment (`FF.timers.relocateRunning`) so time is credited to the right place.
- Pick lists: pinned first, then most used (count in recent log), then recent. Pins sync via the `pins` table.
- Log tab has two modes: Day by day (default; `dayView()` in `js/views/log.js`, uses `FF.charts.dayCharts`) and List.
  `FF.views.log.showDay(date)` / `data-action="open-day" data-date="…"` jumps to a day from anywhere.
- Inputs whose value is driven by state should carry `data-nokeep` so a re-render doesn't restore the old value.

## Conventions

- Australian English in the UI ("finished", "colour", "fortnight"); dates shown with `en-AU`.
- Plain, friendly wording in the UI and in code comments.
- Mobile first: check new screens at ~400px wide. Inputs use 16px text so phones don't zoom in.
- Bump `FF.VERSION` in `js/util.js` for user-visible changes.

## Ideas not built yet

Android notification while a timer runs · reminder if a timer has been running for hours · edit plan notes · weekly summary tab in the Sheet ·
offline caching with a service worker (be careful: cached old versions confuse beginners) · charts over many weeks.
