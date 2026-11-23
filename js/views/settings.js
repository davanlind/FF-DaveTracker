/* Settings screen: connect the Google Sheet, sync, backups. */
FF.views.settings = (() => {
  const U = FF.util;
  const S = FF.store;
  const esc = U.esc;

  function render() {
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
