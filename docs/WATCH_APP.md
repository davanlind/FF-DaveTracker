# F&F Tracker on your Pixel Watch

The watch app shows what you're working on and lets you start, switch, pause and finish tasks
from your wrist. It saves to the **same Google Sheet** as the phone app and website, so
everything matches wherever you log it.

## How it works

- **Main window:** the task running now, a big clock, a ring that fills like a stopwatch
  (once round = 1 hour), where you are, today's total and how many tasks are on hold.
  **❚❚** pauses, **✎** opens the edit menu.
- **Swipe up / down** (or turn the crown) to flip through tasks, one per screen, each in
  its own colour: tasks on hold first, then pinned, planned, most used, your tasks, recent ones.
  Tap **▶** to start one (whatever was running goes on hold). Tap **✎** for more.
- **Edit menu** (scroll with the crown): Pause / Resume / Start, **Finish & save**
  (choose Solo or Had help, tick "Planned task finished"), **Location**, **Pin to top**, **Discard**.
- **Swipe right** to go back.

## What you need first

1. The **Google Sheet set up** and connected in the **phone app** (see GOOGLE_SHEET_SETUP.md).
   The phone app passes the Sheet link to the watch, so you never type it on the watch.
2. The **latest phone app** installed (the version that came out with the watch app).

## Install it on the watch

The watch app isn't on the Play Store, so you install it yourself. This is called
**sideloading**. You do it once, then again only to update.

### 1. Turn on wireless debugging on the watch

1. On the watch: **Settings → System → About → Versions** and tap **Build number** 7 times.
   It says you're now a developer.
2. Go back to **Settings → Developer options** and turn on **ADB debugging** and
   **Wireless debugging**. The watch and phone must be on the **same Wi-Fi**.

### 2. Install with an app on your phone

Use a free installer app from the Play Store on your phone, such as
**GeminiMan WearOS Manager** or **Wear Installer 2**:

1. On your phone, download **FF-Tracker-Watch.apk** from
   **https://github.com/davanlind/FF-DaveTracker/releases/latest/download/FF-Tracker-Watch.apk**
   (or tap *Watch app (APK)* in the tracker's Settings).
2. Open the installer app and connect to the watch. On the watch, under
   **Wireless debugging → Pair new device**, it shows a pairing code, IP address and port;
   type those into the installer app when it asks.
3. Choose **Install APK** and pick **FF-Tracker-Watch.apk** from your Downloads.
4. Open **F&F Tracker** on the watch. If it says to open the phone app, open F&F Tracker on
   your phone once (connected to the Sheet), then tap ↻ on the watch.

When you're done, you can turn **Wireless debugging** off again to save battery.

### Updating

When there's a new version, download **FF-Tracker-Watch.apk** again and install it the same
way. Your watch settings are kept.

## Good to know

- The watch syncs when you open it and every 30 seconds while it's on screen. If there's no
  connection, your taps are kept and sent later (it says "waiting" at the bottom).
- New places are added on the phone (Today → 📍). The watch lets you pick from places you've used.
- The phone app and watch app use the same app id and signing key. That's what lets them
  find each other, so always install both from this repo's Releases.

## For developers and AI assistants

- Code: `android/wear/` (Kotlin, Compose for Wear OS). `Repo.kt` = data, Sheet API, offline
  queue and timer rules (a port of `js/timers.js`; keep them in step). `Ui.kt` = screens.
- Config comes from the phone over the Wear Data Layer: path `/ff-config`, keys `url` and `key`,
  written by `MainActivity.Bridge.shareConfig` in the phone app (called from `js/sync.js`).
- The watch reads `?action=summary&since=YYYY-MM-DD` (all tables, log trimmed) and writes with the
  same `apply` ops as the website.
- Built by `.github/workflows/android.yml` as `FF-Tracker-Watch.apk`. It can't be built in
  sandboxes that block Google's Maven, so check the Actions run.
