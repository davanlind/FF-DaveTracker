/* Settings screen: connect the Google Sheet, sync, backups. */
FF.views.settings = (() => {
  const U = FF.util;
  const S = FF.store;
  const esc = U.esc;

  function viewerRender() {
    const s = S.settings();
    const st = FF.sync.status();
    const who = FF.viewer.ownerName();
    return `
      <div class="page-head"><h1>Settings</h1></div>
      <section class="card">
        <div class="card-head"><h3>👀 View only</h3><span class="sync-dot ${st.state}">${esc(st.label)}</span></div>
        <p>You're looking at <b>${esc(who ? `${who}'s` : 'someone\'s')}</b> F&amp;F Tracker. You can see everything (Today, Plan, Review and the Log day by day) but you can't change anything.</p>
        <p class="muted small">It refreshes by itself every minute. Last update: ${s.lastSync ? esc(new Date(s.lastSync).toLocaleString('en-AU')) : 'not yet'}</p>
        ${st.error ? `<p class="error-box">${esc(st.error)}</p>` : ''}
        <div class="btn-row wrap">
          <button class="btn primary" data-action="sync-now">↻ Refresh now</button>
          <button class="btn ghost" data-action="viewer-stop">Stop viewing</button>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h3>About</h3></div>
        <p class="muted small">F&amp;F Tracker v${esc(FF.VERSION)}</p>
      </section>`;
  }

  function shareCard() {
    const s = S.settings();
    return `
      <section class="card">
        <div class="card-head"><h3>Share a view-only link</h3></div>
        <p class="muted">Let someone see your tracker the way you do (Today, Plan, Review, Log and charts) without being able to change anything.
        It needs a second "look only" password (<b>VIEW_KEY</b>) in your Sheet script. <a href="https://github.com/davanlind/FF-DaveTracker/blob/main/docs/GOOGLE_SHEET_SETUP.md#share-a-view-only-link" target="_blank" rel="noopener">How to add it</a></p>
        <form data-form="share-make" autocomplete="off">
          <div class="row2">
            <div class="field"><label for="s-viewkey">View-only key</label>
              <input id="s-viewkey" name="viewKey" value="${esc(s.viewKey || '')}" placeholder="The VIEW_KEY from your script" required></div>
            <div class="field"><label for="s-myname">Your name <span class="muted">(shown to them)</span></label>
              <input id="s-myname" name="myName" value="${esc(s.myName || '')}" placeholder="e.g. Dave" autocapitalize="words"></div>
          </div>
          <button class="btn primary" type="submit">Make link</button>
        </form>
        ${s.shareLink ? `
          <div class="share-out">
            <input id="s-share" value="${esc(s.shareLink)}" readonly data-nokeep aria-label="View-only link">
            <div class="btn-row wrap">
              <button class="btn" data-action="share-copy">⧉ Copy link</button>
              ${navigator.share ? '<button class="btn ghost" data-action="share-send">Send…</button>' : ''}
            </div>
            <p class="hint">Anyone with this link can <b>see</b> your tracker (not change it). To stop it working, change VIEW_KEY in your script and deploy a new version.</p>
          </div>` : ''}
      </section>`;
  }

  function render() {
    if (FF.viewer && FF.viewer.isOn()) return viewerRender();
    const s = S.settings();
    const st = FF.sync.status();
    const connected = FF.sync.configured();
    return `
      <div class="page-head"><h1>Settings</h1></div>

      <section class="card">
        <div class="card-head"><h3>Google Sheet</h3><span class="sync-dot ${st.state}">${esc(st.label)}</span></div>
        ${connected
          ? `<p>Connected. Everything you log is saved to your Sheet, and other devices using the same link and key see the same data.</p>
             <p class="muted small">Last full sync: ${s.lastSync ? esc(new Date(s.lastSync).toLocaleString('en-AU')) : 'not yet'}</p>
             ${st.error ? `<p class="error-box">${esc(st.error)}</p>` : ''}
             <div class="btn-row wrap">
               <button class="btn primary" data-action="sync-now">↻ Sync now</button>
               <button class="btn ghost" data-action="sync-disconnect">Disconnect</button>
             </div>`
          : `<p>Right now your data is only saved in this browser. Connect a Google Sheet to keep an ongoing record and use the tracker on your phone and computer.</p>
             <p class="muted small">You need to do the one-off setup first. Follow <a href="https://github.com/davanlind/FF-DaveTracker/blob/main/docs/GOOGLE_SHEET_SETUP.md" target="_blank" rel="noopener">the Google Sheet setup guide</a>.</p>
             <form data-form="sync-connect" autocomplete="off">
               <div class="field"><label for="s-url">Web app URL</label>
                 <input id="s-url" name="url" value="${esc(s.url)}" placeholder="https://script.google.com/macros/s/…/exec" inputmode="url" required></div>
               <div class="field"><label for="s-key">Secret key</label>
                 <input id="s-key" name="key" value="${esc(s.key)}" placeholder="The SECRET_KEY you set in the script" required></div>
               <button class="btn primary" type="submit">Connect</button>
             </form>`}
      </section>

      ${connected ? shareCard() : ''}

      <section class="card">
        <div class="card-head"><h3>Backup</h3></div>
        <p class="muted">Download everything as one file, or restore from one. Useful before changing devices.</p>
        <div class="btn-row wrap">
          <button class="btn" data-action="backup-download">⇩ Download backup</button>
          <label class="btn ghost file-btn">⇧ Restore backup<input type="file" accept="application/json,.json" data-change="backup-restore" hidden></label>
        </div>
      </section>

      ${FF.isApp ? '' : `
      <section class="card">
        <div class="card-head"><h3>Android app</h3></div>
        <p class="muted">Install F&amp;F Tracker on an Android phone. Connect it to the same Sheet (same URL and key) and it shares everything with this website.</p>
        <a class="btn" href="${esc(FF.APK_URL)}">⇩ Download the Android app (APK)</a>
      </section>`}

      <section class="card">
        <div class="card-head"><h3>Pixel Watch</h3></div>
        <p class="muted">The watch app shows what you're working on and lets you start, switch, pause and finish tasks from your wrist.
        ${FF.isApp ? 'This phone app links it to your Google Sheet automatically once you\'re connected above.' : 'Install the Android app on your phone too: it links the watch to your Sheet.'}</p>
        <div class="btn-row wrap">
          <a class="btn" href="${esc(FF.WATCH_APK_URL)}">⇩ Watch app (APK)</a>
          <a class="btn ghost" href="${esc(FF.WATCH_GUIDE_URL)}" target="_blank" rel="noopener">How to install it</a>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h3>About</h3></div>
        <p class="muted small">F&amp;F Tracker v${esc(FF.VERSION)}${FF.isApp ? ` · Android app ${esc(window.FFAndroid.appVersion ? window.FFAndroid.appVersion() : '')} · <a href="${esc(FF.APK_URL)}">Get the latest APK</a>` : ''} · <a href="https://github.com/davanlind/FF-DaveTracker" target="_blank" rel="noopener">Code on GitHub</a></p>
      </section>`;
  }

  FF.forms['sync-connect'] = async (form) => {
    const url = form.elements.url.value.trim();
    const key = form.elements.key.value.trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      FF.ui.toast('That URL should start with https://script.google.com/ and end with /exec', 'error');
      return;
    }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      await FF.sync.connect(url, key);
      FF.ui.toast('Connected to your Google Sheet', 'ok');
    } catch (e) {
      FF.ui.toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  };

  FF.forms['share-make'] = async (form) => {
    const s = S.settings();
    const viewKey = form.elements.viewKey.value.trim();
    const myName = form.elements.myName.value.trim();
    if (!viewKey) return FF.ui.toast('Type the VIEW_KEY from your script', 'error');
    if (viewKey === s.key) return FF.ui.toast("That's your main password. Use the separate VIEW_KEY, so the link can't change anything.", 'error');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    try {
      const res = await FF.sync.ping(s.url, viewKey);
      if (res.role !== 'view') throw new Error('That key can change things. Use the VIEW_KEY.');
      S.setSettings({ viewKey, myName, shareLink: FF.viewer.makeLink(s.url, viewKey, myName) });
      FF.app.render();
      FF.ui.toast('Link ready. Copy it and send it.', 'ok');
    } catch (e) {
      FF.ui.toast(/Wrong secret key/.test(e.message) ? "The Sheet doesn't know that view key yet. Check VIEW_KEY in your script and deploy a new version." : e.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Make link';
    }
  };

  FF.actions['share-copy'] = async () => {
    const link = S.settings().shareLink;
    if (!link) return;
    const ok = await FF.viewer.copy(link);
    FF.ui.toast(ok ? 'Link copied' : 'Press and hold the link to copy it', ok ? 'ok' : '');
    if (!ok) document.getElementById('s-share')?.select();
  };

  FF.actions['share-send'] = () => {
    const s = S.settings();
    if (navigator.share && s.shareLink) {
      navigator.share({ title: 'F&F Tracker (view only)', text: `${s.myName ? `${s.myName}'s` : 'My'} work tracker, view only`, url: s.shareLink }).catch(() => {});
    }
  };

  FF.actions['viewer-stop'] = async () => {
    const ok = await FF.ui.confirm('Stop viewing?', 'This removes the view-only copy from this browser. You can open the link again any time.', 'Stop viewing');
    if (ok) FF.viewer.stop();
  };

  FF.actions['sync-now'] = async (el) => {
    el.disabled = true;
    try {
      await FF.sync.pull();
      FF.ui.toast('Up to date', 'ok');
    } catch (e) {
      FF.ui.toast(e.message, 'error');
    }
    FF.app.render();
  };

  FF.actions['sync-disconnect'] = async () => {
    const ok = await FF.ui.confirm('Disconnect the Sheet?', 'Your data stays in the Sheet and in this browser. New changes will only be saved here until you connect again.', 'Disconnect');
    if (ok) FF.sync.disconnect();
  };

  FF.actions['backup-download'] = () =>
    U.download(`ff-tracker-backup-${U.today()}.json`, JSON.stringify(S.exportBackup(), null, 2), 'application/json');

  FF.changes['backup-restore'] = async (el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!obj || !Array.isArray(obj.log)) throw new Error('bad');
      const ok = await FF.ui.confirm('Restore this backup?', `It has ${obj.log.length} log entries. What's in this browser now will be replaced.`, 'Restore');
      if (ok) {
        S.importBackup(obj);
        FF.ui.toast('Backup restored', 'ok');
      }
    } catch (e) {
      FF.ui.toast("That file isn't an F&F Tracker backup", 'error');
    }
    el.value = '';
  };

  return { title: 'Settings', render };
})();
