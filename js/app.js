/* F&F Tracker — starts the app, switches screens, and wires up clicks.
 *
 * How screens work: each file in js/views/ makes FF.views.<name> with a
 * render() that returns HTML. Buttons say what they do with data-action="...",
 * forms with data-form="...", dropdowns/checkboxes with data-change="...".
 * The matching functions live in FF.actions / FF.forms / FF.changes.
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
      if (!el || !root.contains(el) || el.dataset.change === 'log-range' || el.dataset.change === 'review-plan') return;
      if (el.type === 'checkbox') return; // checkboxes always show saved state
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v)) return;
      el.value = v;
      if (el.dataset.change && FF.changes[el.dataset.change] && el.tagName === 'SELECT') FF.changes[el.dataset.change](el);
    });
    if (focused) document.getElementById(focused)?.focus();

    document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
    document.title = `${FF.views[name].title} · F&F Tracker`;
    renderStatus();
    tick();
  }

  function renderStatus() {
    const pill = document.getElementById('syncPill');
    const st = FF.sync.status();
    pill.className = `sync-pill ${st.state}`;
    pill.querySelector('.sync-label').textContent = st.label;
    pill.title = st.error || st.label;
  }

  /** Update running clocks every second without re-drawing the screen. */
  function tick() {
    document.querySelectorAll('[data-elapsed]').forEach((el) => {
      el.textContent = FF.util.fmtClock(Date.now() - new Date(el.dataset.elapsed).getTime());
    });
    const t = S.timer();
    const badge = document.getElementById('timerBadge');
    badge.hidden = !t;
    if (t) badge.textContent = FF.util.fmtClock(Date.now() - new Date(t.startedAt).getTime()).replace(/:\d\d$/, '');
  }

  function wire() {
    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || !FF.actions[el.dataset.action]) return;
      e.preventDefault();
      FF.actions[el.dataset.action](el, e);
    });
    document.addEventListener('submit', (e) => {
      const form = e.target.closest('form[data-form]');
      if (!form || !FF.forms[form.dataset.form]) return;
      e.preventDefault();
      FF.forms[form.dataset.form](form, e);
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-change]');
      if (el && FF.changes[el.dataset.change]) FF.changes[el.dataset.change](el, e);
    });
    window.addEventListener('hashchange', () => {
      render();
      window.scrollTo(0, 0);
    });
    S.subscribe((what) => (what === 'status' ? renderStatus() : render()));
    FF.actions['open-settings'] = () => (location.hash = '#settings');
    setInterval(tick, 1000);
  }

  function start() {
    wire();
    render();
    tick();
    FF.sync.start();
  }

  return { start, render };
})();

document.addEventListener('DOMContentLoaded', FF.app.start);
