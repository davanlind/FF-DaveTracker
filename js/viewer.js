/* F&F Tracker — links that set up another device.
 *
 * Setup link (#connect=<code>): connects another browser/phone to YOUR Sheet with your main
 * password, so it can see and change everything. Made in Settings → Connect another device.
 *
 * View-only link (#view=<code>):
 * The owner makes a link in Settings → "Share a view-only link". It looks like
 *   https://davanlind.github.io/FF-DaveTracker/#view=<code>
 * where <code> holds the Sheet web app URL, the script's VIEW_KEY and the owner's name.
 * Opening it shows the owner's tracker exactly as they see it, but nothing can be changed:
 *   - the Sheet script refuses any change made with the VIEW_KEY (the real protection)
 *   - the app also hides/blocks every editing control and never queues changes.
 */
FF.viewer = (() => {
  const S = FF.store;
  const SITE_URL = 'https://davanlind.github.io/FF-DaveTracker/';

  const isOn = () => {
    const s = S.settings();
    return !!(s.connected && s.role === 'view');
  };
  const ownerName = () => S.settings().ownerName || '';

  // base64url of JSON, safe for any characters in the name
  const encode = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decode = (code) => {
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  };

  const siteBase = () => (FF.isApp || !/^https?:/.test(location.protocol) ? SITE_URL : location.origin + location.pathname);

  /** The view-only link to send someone. */
  function makeLink(url, viewKey, name) {
    return `${siteBase()}#view=${encode({ u: url, k: viewKey, n: name || '' })}`;
  }

  /** A setup link for your own other devices (includes your main password). */
  function makeConnectLink(url, key) {
    return `${siteBase()}#connect=${encode({ u: url, k: key })}`;
  }

  /** Pull { u, k } out of a setup link (or null). */
  function readConnectLink(text) {
    const m = String(text || '').match(/#connect=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      const info = decode(m[1]);
      return info.u && info.k ? info : null;
    } catch (e) {
      return null;
    }
  }

  /** Opened a setup link: connect this device to that Sheet. */
  async function connectFromHash() {
    const info = readConnectLink(location.hash);
    history.replaceState(null, '', '#today');
    if (!info) {
      FF.ui.toast("That setup link isn't complete. Copy it again.", 'error');
      FF.app.render();
      return false;
    }
    const s = S.settings();
    if (s.connected && s.role !== 'view' && s.url === info.u && s.key === info.k) {
      FF.app.render();
      FF.ui.toast('Already connected', 'ok');
      return true;
    }
    if (s.connected) {
      const ok = await FF.ui.confirm(
        'Connect to this tracker?',
        s.role === 'view'
          ? 'This browser is showing a view-only copy of someone\'s tracker. Connecting replaces it with your own.'
          : 'This browser is connected to a different Sheet. Connecting switches it to the one in this link.',
        'Connect'
      );
      if (!ok) {
        FF.app.render();
        return false;
      }
      S.resetAll();
    }
    FF.app.render();
    try {
      await FF.sync.connect(info.u, info.k);
      FF.ui.toast('Connected. Your tracking is here now.', 'ok');
      FF.app.render();
      return true;
    } catch (e) {
      FF.ui.toast(e.message, 'error');
      return false;
    }
  }

  /** Opened a #view= link: switch this browser to a read-only copy of the owner's tracker. */
  async function openFromHash() {
    const m = location.hash.match(/^#view=([A-Za-z0-9_-]+)$/);
    if (!m) return false;
    let info;
    try {
      info = decode(m[1]);
      if (!info.u || !info.k) throw new Error('bad');
    } catch (e) {
      history.replaceState(null, '', '#today');
      FF.ui.toast("That view link isn't complete. Ask for it again.", 'error');
      return false;
    }
    const s = S.settings();
    const sameAlready = s.connected && s.role === 'view' && s.url === info.u && s.key === info.k;
    const hasOwnData = !s.connected && S.TABLES.some((t) => S.all(t).length);
    const ownTracker = s.connected && s.role !== 'view';
    if (!sameAlready && (ownTracker || hasOwnData)) {
      const ok = await FF.ui.confirm(
        `View ${info.n ? `${info.n}'s` : 'this'} tracker?`,
        ownTracker
          ? 'This browser is connected to your own tracker. Viewing replaces it here with a view-only copy (your data stays safe in your Sheet; reconnect any time).'
          : "This browser has tracker data that isn't saved to a Google Sheet. Viewing someone else's tracker will remove it from this browser.",
        'View it'
      );
      if (!ok) {
        history.replaceState(null, '', '#today');
        FF.app.render();
        return false;
      }
    }
    if (!sameAlready) {
      S.resetAll();
      S.setSettings({ url: info.u, key: info.k, connected: true, role: 'view', ownerName: info.n || '', lastSync: null });
    }
    history.replaceState(null, '', '#today');
    document.documentElement.classList.add('viewer');
    FF.app.render();
    try {
      await FF.sync.pull();
    } catch (e) {
      FF.ui.toast(e.message, 'error');
    }
    return true;
  }

  function stop() {
    S.resetAll();
    S.setSettings({ url: '', key: '', connected: false, role: '', ownerName: '', lastSync: null });
    document.documentElement.classList.remove('viewer');
    location.hash = '#today';
    FF.app.render();
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (er) { ok = false; }
      t.remove();
      return ok;
    }
  }

  /* What a viewer may still do: look around, change dates/filters, download a CSV. */
  const ALLOWED_ACTIONS = new Set([
    'open-settings', 'open-day', 'day-step', 'log-mode', 'chart-pick', 'log-csv',
    'plan-prev', 'plan-next', 'plan-jump-today', 'sync-now', 'viewer-stop',
  ]);
  const ALLOWED_CHANGES = new Set(['log-range', 'review-plan', 'log-day']);
  const ALLOWED_FORMS = new Set(['sync-connect']);

  return {
    isOn, ownerName, makeLink, makeConnectLink, readConnectLink, connectFromHash, openFromHash, stop, copy, encode, decode,
    ALLOWED_ACTIONS, ALLOWED_CHANGES, ALLOWED_FORMS,
  };
})();
