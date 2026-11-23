# F&F Tracker Android app

The Android app is the same tracker as the website, packed into an **APK** (an Android
install file). It works offline. Connect it to the **same Google Sheet** as the website
and they share everything: log something on your phone and it shows up on the website, and the other way round.

## Install it

1. On your Android phone, open this link in Chrome:
   **https://github.com/davanlind/FF-DaveTracker/releases/latest/download/FF-Tracker.apk**
   (It's also on the website: **Settings → Download the Android app**.)
2. When it's downloaded, tap **Open** (or find it in **Files → Downloads**).
3. The first time, Android says Chrome isn't allowed to install apps. Tap **Settings**, switch on
   **Allow from this source**, then go back.
4. Tap **Install**. If **Google Play Protect** says it doesn't recognise the app, tap
   **More details → Install anyway**. It warns about any app that isn't from the Play Store.
5. Open **F&F Tracker**, tap the grey button at the top right (Settings), and connect with the
   **same Web app URL and Secret key** you used on the website.

## Updating

Each time the app's code changes, GitHub builds a new APK by itself (it takes about 5 minutes).
To update, download it from the same link and install it over the top. **Your data is kept.**
Settings → About shows which version you have.

## Good to know

- **Timer:** a running timer only lives on the device you started it on. Stop it there.
  The saved time then appears everywhere.
- **Download CSV / Download backup** save into **Downloads › FF Tracker** on the phone.
- The phone's **back button** closes pop-ups, then goes back through screens.

## How it's built (for the curious)

- `android/` holds a small Android app (Kotlin) whose only job is to show the tracker's web
  page, using a built-in browser view called a **WebView**. The web files are copied into the APK when it's built,
  so the phone and website always run the same code.
- `.github/workflows/android.yml` is a **GitHub Actions workflow**: instructions GitHub follows on
  its own computers to build the APK and publish it on the repo's **Releases** page.
- To see a build in progress, or start one by hand: repo → **Actions** tab → **Build Android app** → **Run workflow**.
