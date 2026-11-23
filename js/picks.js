/* F&F Tracker — pinned and recently used tasks/locations, and the "type or pick" box for forms.
 *
 * Pins live in the 'pins' table (Sheet tab "Pinned"):  { id: 'pin:<kind>:<name lower-case>', kind, name }
 * kind is 'task' or 'location'. Pinned things always show first in pick lists.
 *
 * FF.picks.field({...}) makes a text box with tappable suggestions under it (chips).
 * Typing filters them; tapping one fills the box. Anything new can just be typed.
 */
FF.actions = FF.actions || {};
FF.inputs = FF.inputs || {};

FF.picks = (() => {
  const S = FF.store;
  const U = FF.util;
  const esc = U.esc;

  const key = (s) => String(s || '').trim().toLowerCase();
  const pinId = (kind, name) => `pin:${kind}:${key(name)}`;
  const isPinned = (kind, name) => !!S.get('pins', pinId(kind, name));
  const pinned = (kind) =>
    S.all('pins')
      .filter((p) => p.kind === kind && p.name)
      .sort((a, b) => a.name.localeCompare(b.name));

  function togglePin(kind, name) {
    if (!String(name || '').trim()) return false;
    if (isPinned(kind, name)) {
      S.remove('pins', pinId(kind, name));
      return false;
    }
    S.upsert('pins', { id: pinId(kind, name), kind, name: String(name).trim() });
    return true;
  }

  /**
   * How often each task name / location has been used recently.
   * Returns [{ name, count, last }] sorted by most used, then most recent.
   */
  function usage(field, days = 90) {
    const since = U.addDays(U.today(), -days);
    const map = new Map();
    const bump = (name, when) => {
      const k = key(name);
      if (!k) return;
      if (!map.has(k)) map.set(k, { name: String(name).trim(), count: 0, last: '' });
      const u = map.get(k);
      u.count += 1;
      if (when > u.last) u.last = when;
    };
    S.all('log').forEach((e) => e.date >= since && bump(e[field], `${e.date} ${e.start}`));
    S.all('active').forEach((r) =>
      r.segments.forEach((g) => bump(field === 'task' ? r.task : g.location, U.ymd(new Date(g.start)) + ' ' + U.hm(new Date(g.start))))
    );
    return [...map.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last));
  }

  /** Locations to offer: pinned, most used, then recent. [{ name, sub, group }] */
  function locationSuggestions() {
    const out = [];
    const seen = new Set();
    const add = (name, sub, group) => {
      if (!key(name) || seen.has(key(name))) return;
      seen.add(key(name));
      out.push({ name, sub, group });
    };
    pinned('location').forEach((p) => add(p.name, 'Pinned', 'Pinned'));
    const used = usage('location');
    used.filter((u) => u.count >= 2).slice(0, 5).forEach((u) => add(u.name, `Used ${u.count} times`, 'Most used'));
    used
      .slice()
      .sort((a, b) => b.last.localeCompare(a.last))
      .slice(0, 10)
      .forEach((u) => add(u.name, `Last ${U.fmtDate(u.last.slice(0, 10), { day: 'numeric', month: 'short' })}`, 'Recent'));
    return out;
  }

  /** Task names to offer in forms (not the Today start box, which has its own richer list). */
  function taskNameSuggestions() {
    const out = [];
    const seen = new Set();
    const add = (name, group) => {
      if (!key(name) || seen.has(key(name))) return;
      seen.add(key(name));
      out.push({ name, sub: group, group });
    };
    pinned('task').forEach((p) => add(p.name, 'Pinned'));
    usage('task').slice(0, 10).forEach((u) => add(u.name, 'Recent'));
    return out;
  }

  const sources = { location: locationSuggestions, task: taskNameSuggestions };

  /** Filter suggestions by what's typed (every word must appear). */
  function filter(list, text) {
    const q = key(text);
    if (!q) return list;
    const words = q.split(/\s+/);
    return list
      .filter((x) => words.every((w) => key(x.name).includes(w)))
      .sort((a, b) => key(b.name).startsWith(q) - key(a.name).startsWith(q));
  }

  /* ---------- the chip box used in forms ---------- */
  function chips(kind, text, max = 10) {
    const all = sources[kind]();
    const current = key(text);
    // when the box holds something already in the list, show the whole list with it highlighted
    const list = (all.some((x) => key(x.name) === current) ? all : filter(all, text)).slice(0, max);
    if (!list.length) {
      return all.length ? '' : `<span class="hint">${kind === 'location' ? 'Places you type are remembered for next time.' : ''}</span>`;
    }
    return list
      .map((x) => `<button type="button" class="chip ${key(x.name) === current ? 'on' : ''}" data-action="picker-fill" data-name="${esc(x.name)}">${isPinned(kind, x.name) ? '📌 ' : ''}${esc(x.name)}</button>`)
      .join('');
  }

  /** A form field: text box + suggestion chips. */
  function field({ name, label, value = '', kind, placeholder = '', id, hint = '' }) {
    const fid = id || `pk-${name}`;
    return `
      <div class="field picker-field" data-kind="${esc(kind)}">
        <label for="${esc(fid)}">${label}</label>
        <input id="${esc(fid)}" name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autocapitalize="words" data-input="picker">
        <div class="chips">${chips(kind, value)}</div>
        ${hint ? `<p class="hint">${hint}</p>` : ''}
      </div>`;
  }

  FF.inputs.picker = (el) => {
    const box = el.closest('.picker-field');
    if (box) box.querySelector('.chips').innerHTML = chips(box.dataset.kind, el.value);
  };
  FF.actions['picker-fill'] = (el) => {
    const box = el.closest('.picker-field');
    const input = box.querySelector('input');
    input.value = el.dataset.name;
    box.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === el));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  /* ---------- full list with pin buttons (used in the "Where are you?" pop-up) ---------- */
  function pinList(kind, text, { action, actionLabel = '' } = {}) {
    const list = filter(sources[kind](), text).slice(0, 12);
    const groups = U.groupBy(list, (x) => (key(text) ? 'Matches' : x.group));
    const exact = list.some((x) => key(x.name) === key(text));
    const row = (x) => `
      <li class="pick-row">
        <button type="button" class="pick-main" data-action="${esc(action)}" data-name="${esc(x.name)}">
          <span class="suggest-name">${esc(x.name)}</span><span class="suggest-sub">${esc(x.sub)}</span>
        </button>
        ${pinButton(kind, x.name)}
      </li>`;
    return `${[...groups.entries()].map(([g, l]) => `<div class="suggest-group">${esc(g)}</div><ul class="suggest">${l.map(row).join('')}</ul>`).join('')}
      ${key(text) && !exact ? `<ul class="suggest"><li class="pick-row"><button type="button" class="pick-main new" data-action="${esc(action)}" data-name="${esc(text.trim())}">
        <span class="suggest-name">${esc(actionLabel)} “${esc(text.trim())}”</span><span class="suggest-sub">New</span></button></li></ul>` : ''}
      ${!list.length && !key(text) ? '<p class="hint">Type a place (e.g. Warehouse, Showroom, Studio). It will show up here next time, and you can 📌 pin the ones you use most.</p>' : ''}`;
  }

  function pinButton(kind, name) {
    const on = isPinned(kind, name);
    return `<button type="button" class="pin-btn ${on ? 'on' : ''}" data-action="pin-toggle" data-kind="${esc(kind)}" data-name="${esc(name)}"
      aria-pressed="${on}" aria-label="${on ? 'Unpin' : 'Pin'} ${esc(name)}" title="${on ? 'Unpin' : 'Pin to the top'}">📌</button>`;
  }

  FF.actions['pin-toggle'] = (el) => {
    const on = togglePin(el.dataset.kind, el.dataset.name);
    el.classList.toggle('on', on);
    el.setAttribute('aria-pressed', on);
    FF.ui.toast(on ? `Pinned ${el.dataset.name}` : `Unpinned ${el.dataset.name}`);
  };

  return { key, isPinned, pinned, togglePin, usage, locationSuggestions, filter, chips, field, pinList, pinButton };
})();
