/* F&F Tracker — starts the app, switches screens, and wires up clicks.
 *
 * How screens work: each file in js/views/ makes FF.views.<name> with a
 * render() that returns HTML. Buttons say what they do with data-action="...",
 * forms with data-form="...", dropdowns/checkboxes with data-change="...", and text boxes
 * that react while typing with data-input="...".
 * The matching functions live in FF.actions / FF.forms / FF.changes / FF.inputs.
 */
FF.app = (() => {
  const S = FF.store;
  const ROUTES = ['today', 'plan', 'review', 'log', 'tasks', 'settings'];
  const view = () => document.getElementById('view');

  const current = () => {
    const r = location.hash.replace('#', '');
    return ROUTES.includes(r) ? r : 'today';
  };

  /** Re-draw the current screen, keeping whatever was typed into inputs. */
  function render() {
    const root = view();
    const name = current();
    const kept = {};
    root.querySelectorAll('input[id], select[id], textarea[id]').forEach((el) => {
      if (el.type !== 'file') kept[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    });
    const focused = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : null;

    root.innerHTML = FF.views[name].render();
    root.dataset.view = name;

    Object.entries(kept).forEach(([id, v]) => {
      const el = document.getElementById(id);
      if (!el || !root.contains(el) || el.hasAttribute('data-nokeep') || el.dataset.change === 'log-range' || el.dataset.change === 'review-plan') return;
      if (el.type === 'checkbox') return; // checkboxes always show saved state
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) return;
      el.value = v;
      if (el.dataset.change && FF.changes[el.dataset.change] && el.tagName === 'SELECT') FF.changes[el.dataset.change](el);
      if (el.dataset.input && FF.inputs && FF.inputs[el.dataset.input]) FF.inputs[el.dataset.input](el);
    });
    if (focused) document.getElementById(focused)?.focus();

    document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
    document.title = `${FF.views[name].title} · F&F Tracker`;
    renderStatus();
    updateClocks();
  }

  function renderStatus() {
    const viewing = FF.viewer && FF.viewer.isOn();
    document.documentElement.classList.toggle('viewer', viewing);
    const banner = document.getElementById('viewerBanner');
    if (banner) {
      banner.hidden = !viewing;
      if (viewing) banner.innerHTML = `👀 Viewing <b>${FF.util.esc(FF.viewer.ownerName() || 'a')}${FF.viewer.ownerName() ? "'s" : ''}</b> tracker · view only`;
    }
    const pill = document.getElementById('syncPill');
    const st = FF.sync.status();
    pill.className = `sync-pill ${st.state}`;
    pill.querySelector('.sync-label').textContent = st.label;
    pill.title = st.error || st.label;
  }

  /** Update running clocks every second without re-drawing the screen. */
  let lastMinute = new Date().getMinutes();
  function tick() {
    // once a minute, redraw Today so the clock chart's "now" hand and running arc move
    const minute = new Date().getMinutes();
    if (minute !== lastMinute) {
      lastMinute = minute;
      const busy = document.querySelector('dialog[open]') || (document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName));
      if (current() === 'today' && !busy) {
        render();
        return;
      }
    }
    updateClocks();
  }

  function updateClocks() {
    document.querySelectorAll('.clock[data-clock]').forEach((el) => {
      const r = S.get('active', el.dataset.clock);
      if (r) el.textContent = FF.util.fmtClock(FF.timers.elapsedMs(r));
    });
    const r = FF.timers.running();
    const held = FF.timers.onHold().length;
    const badge = document.getElementById('timerBadge');
    badge.hidden = !r && !held;
    badge.classList.toggle('paused', !r);
    if (r) badge.textContent = FF.util.fmtClock(FF.timers.elapsedMs(r)).replace(/:\d\d$/, '') + (held ? ` +${held}` : '');
    else if (held) badge.textContent = `${held} on hold`;
  }

  function wire() {
    const viewBlocked = (kind, name) => {
      if (!FF.viewer || !FF.viewer.isOn()) return false;
      const ok = { action: FF.viewer.ALLOWED_ACTIONS, change: FF.viewer.ALLOWED_CHANGES, form: FF.viewer.ALLOWED_FORMS }[kind];
      if (ok.has(name)) return false;
      FF.ui.toast(`View only: you can look but not change ${FF.viewer.ownerName() ? `${FF.viewer.ownerName()}'s` : 'this'} tracker`);
      return true;
    };
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || !FF.actions[el.dataset.action]) return;
      e.preventDefault();
      if (viewBlocked('action', el.dataset.action)) return;
      FF.actions[el.dataset.action](el, e);
    });
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('form[data-form]');
      if (!form || !FF.forms[form.dataset.form]) return;
      e.preventDefault();
      if (viewBlocked('form', form.dataset.form)) return;
      FF.forms[form.dataset.form](form, e);
    });
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (el && FF.inputs && FF.inputs[el.dataset.input]) FF.inputs[el.dataset.input](el, e);
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      if (!el || !FF.changes[el.dataset.change]) return;
      if (viewBlocked('change', el.dataset.change)) {
        render(); // put the checkbox/dropdown back
        return;
      }
      FF.changes[el.dataset.change](el, e);
    });
    window.addEventListener('hashchange', () => {
      if (/^#view=/.test(location.hash)) {
        FF.viewer.openFromHash();
        return;
      }
      render();
      window.scrollTo(0, 0);
    });
    S.subscribe((what) => (what === 'status' ? renderStatus() : render()));
    FF.actions['open-settings'] = () => (location.hash = '#settings');
    setInterval(tick, 1000);
  }

  /** Android back button: close an open pop-up. Returns true if it did. */
  function back() {
    for (const id of ['confirm-modal', 'modal']) {
      const d = document.getElementById(id);
      if (d && d.open) {
        d.close();
        return true;
      }
    }
    return false;
  }

  function start() {
    if (FF.isApp) document.documentElement.classList.add('in-app');
    wire();
    const viaLink = /^#view=/.test(location.hash); // opened a view-only link
    render();
    if (viaLink) FF.viewer.openFromHash();
    FF.sync.start();
  }

  return { start, render, back };
})();

document.addEventListener('DOMContentLoaded', FF.app.start);
