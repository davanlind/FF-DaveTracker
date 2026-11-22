/* F&F Tracker — talks to the Google Sheet through the Apps Script "web app".
 *
 * Read:  GET  <url>?action=all&key=<key>       -> { ok, data: { tasks, plans, planItems, log } }
 * Write: POST <url>  body {action:'apply', key, ops:[...]} -> { ok, applied }
 *
 * The POST is sent as text/plain on purpose: Google's servers don't allow
 * the extra "preflight" check browsers do for JSON, and text/plain skips it.
 */
FF.sync = (() => {
  const S = FF.store;
  let debounce = null;
  let busy = false;
  let state = 'local'; // local | pending | syncing | synced | error
  let lastError = '';

  const configured = () => {
    const s = S.settings();
    return !!(s.url && s.key && s.connected);
  };

  function setState(next, err = '') {
    state = next;
    lastError = err;
    S.emit('status');
  }

  function status() {
    if (!configured()) return { state: 'local', label: 'Only on this device', error: '' };
    if (state === 'syncing') return { state, label: 'Saving…', error: '' };
    if (state === 'error') return { state, label: 'Sheet not reached', error: lastError };
    if (S.pendingCount()) return { state: 'pending', label: `${S.pendingCount()} to send`, error: '' };
    return { state: 'synced', label: 'Saved to Sheet', error: '' };
  }

  async function readJson(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(
        "Google sent back a web page instead of data. Check the web app URL ends in /exec and that 'Who has access' is set to 'Anyone'."
      );
    }
  }

  async function request(method, params, body) {
    const s = S.settings();
    const url = new URL(s.url);
    Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const opts = { method, redirect: 'follow' };
    if (body) {
      opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
      opts.body = JSON.stringify({ ...body, key: s.key });
    } else {
      url.searchParams.set('key', s.key);
    }
    let res;
    try {
      res = await fetch(url.toString(), opts);
    } catch (e) {
      throw new Error('No connection to Google. Are you online?');
    }
    const json = await readJson(res);
    if (!json.ok) throw new Error(json.error || 'The Sheet said no.');
    return json;
  }

  /** Check a URL + key before saving them. */
  async function test(url, key) {
    const prev = S.settings();
    S.setSettings({ url, key });
    try {
      return await request('GET', { action: 'ping' });
    } catch (e) {
      S.setSettings({ url: prev.url, key: prev.key });
      throw e;
    }
  }

  /** Send waiting changes to the Sheet. */
  async function flush() {
    if (!configured() || busy) return;
    const { n, ops } = S.queueSnapshot();
    if (!n) {
      if (state !== 'error') setState('synced');
      return;
    }
    busy = true;
    setState('syncing');
    try {
      await request('POST', null, { action: 'apply', ops });
      S.ackQueue(n);
      setState('synced');
    } catch (e) {
      setState('error', e.message);
      throw e;
    } finally {
      busy = false;
    }
    if (S.pendingCount()) schedule();
  }

  /** Send changes, then download everything so this device matches the Sheet. */
  async function pull() {
    if (!configured()) return;
    await flush();
    busy = true;
    setState('syncing');
    try {
      const json = await request('GET', { action: 'all' });
      S.replaceAll(json.data || {});
      S.setSettings({ lastSync: new Date().toISOString() });
      setState('synced');
    } catch (e) {
      setState('error', e.message);
      throw e;
    } finally {
      busy = false;
    }
  }

  /** First connection from this device: send what's here, then load what's there. */
  async function connect(url, key) {
    await test(url, key);
    S.setSettings({ url, key, connected: true });
    S.queueEverything();
    await pull();
  }

  function disconnect() {
    S.setSettings({ connected: false });
    setState('local');
  }

  function schedule() {
    if (!configured()) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => flush().catch(() => {}), 1200);
    S.emit('status');
  }

  /** Called once when the app opens: catch up, and refresh when you come back to the tab. */
  function start() {
    if (configured()) pull().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !configured()) return;
      const last = S.settings().lastSync;
      if (!last || Date.now() - new Date(last).getTime() > 60 * 1000) pull().catch(() => {});
    });
    window.addEventListener('online', () => configured() && flush().catch(() => {}));
  }

  return { configured, status, test, flush, pull, connect, disconnect, schedule, start };
})();
