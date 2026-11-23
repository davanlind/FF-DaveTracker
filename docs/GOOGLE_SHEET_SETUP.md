# Connect F&F Tracker to a Google Sheet

You only do this once. It takes about 10 minutes. After that, everything you log is
added to your Google Sheet straight away, and every device you connect sees the same data.

**What's going on:** the tracker website can't write to Google Sheets by itself. So you
add a small script to your Sheet (an **Apps Script**). Then you publish that script as a
**web app**, which gives it its own web address (a URL) that the tracker sends your data to.
A **secret key** (a password you make up) stops anyone else from using that address.

---

## 1. Make the Sheet

1. Go to [sheets.new](https://sheets.new) to make a new blank Google Sheet.
2. Name it something like **F&F Tracker data** (click "Untitled spreadsheet" at the top left).

## 2. Add the script

1. In the Sheet's menu, click **Extensions → Apps Script**. A new tab opens with a code editor.
2. Delete everything in the editor (the `function myFunction() {}` bit).
3. Open [`apps-script/Code.gs`](../apps-script/Code.gs) in this repo, click the **copy** button
   (the two-squares icon at the top right of the code), and paste it into the editor.
4. Near the top, find this line:
   ```js
   const SECRET_KEY = 'CHANGE-ME';
   ```
   Change `CHANGE-ME` to a long password only you know, e.g. `'sunny-forklift-4821-teapot'`.
   Keep the quote marks. Write it down because you'll type it into the tracker.
5. Click the **💾 Save** icon. You can name the project "F&F Tracker" if it asks.

## 3. Create the tabs (and give permission)

1. In the bar above the code there's a dropdown of function names. Choose **setup**, then click **▶ Run**.
2. Google asks for permission. Click **Review permissions**, then pick your account.
3. You'll probably see **"Google hasn't verified this app"**. That's normal for a script
   you wrote yourself. Click **Advanced → Go to F&F Tracker (unsafe) → Allow**.
4. Go back to your Sheet. You should now see tabs called **Log, Plan Items, Plans, Tasks, Active timers, Colours, Pinned**.
   (*Active timers* holds tasks you're timing or have on hold right now, so your phone and the website show the same ones.)

## 4. Publish it as a web app

1. In the Apps Script tab, click **Deploy → New deployment**.
2. Click the ⚙️ gear next to "Select type" and choose **Web app**.
3. Set:
   - **Description:** F&F Tracker
   - **Execute as:** *Me*
   - **Who has access:** *Anyone*

   ("Anyone" sounds scary, but nobody can read or change anything without your secret key.
   It's needed so the tracker website can reach the script without a Google sign-in screen.)
4. Click **Deploy**. Copy the **Web app URL**. It looks like
   `https://script.google.com/macros/s/AKfy…long…/exec`

## 5. Connect the tracker

1. Open the tracker website and tap the grey **"Only on this device"** button at the top right (or go to Settings).
2. Paste the **Web app URL** and type your **Secret key**.
3. Tap **Connect**. The button at the top should turn green and say **Saved to Sheet**.

Anything you'd already logged is sent to the Sheet at this point. Do steps 5.1–5.3 on each
device you use (phone, work computer…) with the same URL and key.

---

## Changing the script later

If you (or an AI) change `Code.gs`, paste the new version into the editor, save, then
**Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
Doing it this way keeps the **same URL**, so you don't have to reconnect devices.
(Clicking "New deployment" again would give you a different URL.)

## Share a view-only link

Want someone (e.g. your manager) to see your tracker the way you do (Today, Plan, Review,
the Log day by day, all the charts) without being able to change anything?

1. In the Apps Script, find this line near the top and put a **second** password between the quotes
   (different from SECRET_KEY):
   ```js
   const VIEW_KEY = 'peek-pallet-2093';
   ```
2. Save, then **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**.
3. In the tracker: **Settings → Share a view-only link**. Type the VIEW_KEY and your name, tap
   **Make link**, then **Copy link** and send it.

When they open the link, a blue bar says *Viewing Dave's tracker · view only*. All buttons that
change things are gone, and the Sheet refuses any change made with the VIEW_KEY anyway.
To stop a link working, change VIEW_KEY and deploy a new version.

## Using the Sheet

- The **Log** tab is your ongoing record: one row per stint of work, with Date, Start, End,
  Minutes, Hours, Task, Type (Repeatable / One-off), Worked (Solo / With help), Helpers and Notes.
- You can **add your own columns to the right** (e.g. a formula, or a comment for your manager).
  The tracker leaves them alone.
- You can sort, filter, or make charts and pivot tables on other tabs.
- **Don't rename the header row** and **don't edit the ID column**. That's how the tracker
  finds each row. Making changes in the app is safest; if you edit a cell directly in the
  Sheet, the app picks it up next time it syncs.

## Troubleshooting

| Message in the app | What to do |
|---|---|
| *Wrong secret key* | The key in the app doesn't match `SECRET_KEY` in the script. Check for typos and spaces. If you changed it in the script, deploy a new version (see above). |
| *Set SECRET_KEY in the Apps Script first* | You left it as `CHANGE-ME`. Change it, save, deploy a new version. |
| *Google sent back a web page instead of data* | The URL should end in `/exec` (not `/dev`), and "Who has access" must be **Anyone**. |
| *No connection to Google* | You're offline. Keep working: changes are saved on the device and sent when you're back online. |
