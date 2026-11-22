# F&F Tracker

A simple website for tracking work time against targets.

- **Time your work** with a start/stop timer, or log time afterwards.
- **Repeatable tasks** (things you do often, each with a usual target time) and **one-off tasks**.
- Record whether you worked **solo or had help**, and who helped.
- **Plan a week or fortnight ahead**, always starting on a Monday, with a target time for each task.
- **Review** each plan: target vs actual, what was finished on target, what ran over, and unplanned work.
- Saves to an **ongoing Google Sheet**, so every device sees the same data. It also works offline and catches up later.
- Download your log as a **CSV** file, or a full backup.

Works on a phone or computer. On Android you can add it to your home screen
(Chrome menu ⋮ → **Add to Home screen**) and it opens like an app.

---

## Getting it running (one-off setup)

### 1. Turn on the website (GitHub Pages)

**GitHub Pages** is GitHub's free website hosting. It serves the files in this repo as a website.

1. In this repo on GitHub, go to **Settings → Pages** (left sidebar).
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Pick branch **main** and folder **/ (root)**, then **Save**.
4. Wait a minute or two and refresh. The page shows your link, e.g.
   `https://davanlind.github.io/FF-DaveTracker/`

> Free GitHub Pages only works on **public** repos. Only the app's code is in the repo,
> never your logged data (that lives in your browser and your Google Sheet).

### 2. Connect your Google Sheet

Follow **[docs/GOOGLE_SHEET_SETUP.md](docs/GOOGLE_SHEET_SETUP.md)**. Until you do, the tracker still
works, but data is only saved in that one browser.

---

## How to use it

| Screen | What it's for |
|---|---|
| **Today** | Start/stop the timer, quick-start anything planned (▶), see what you've logged today. |
| **Plan** | Pick a week, tap *Plan this week* or *Plan a fortnight*, then add tasks with target times. *Add all repeatable tasks* fills in your usual list in one go; *copy the plan from…* reuses last period's plan. Tick tasks when they're finished. |
| **Review** | For any plan: total target vs actual, each task's status (*Hit target*, *Over by…*, *In progress*, *Not started*), time per day, solo vs help, and unplanned work. |
| **Log** | Every entry, by week/month. Tap one to fix it. *Download CSV* for a spreadsheet file. |
| **Tasks** | Your list of repeatable tasks, each with a category and usual target time. |

**Hit target** = the task is ticked as finished and the time logged against it was no more than its target.

Durations can be typed as `90`, `1:30`, `1h 30m`, `1h30` or `1.5h`. All of those mean 90 minutes.

---

## For developers and AI assistants

Read **[AGENTS.md](AGENTS.md)**. It explains how the code is laid out and the rules for changing it.

Quick facts: plain HTML/CSS/JavaScript, **no build step, no frameworks**. Just open `index.html`.
The Google Sheet "backend" is `apps-script/Code.gs`.

Run the tests:

```bash
npm install          # once; installs Playwright for the browser tests
npx playwright install chromium   # once, if you don't already have Chrome
npm test
```
