/* Log screen: everything you've logged, filterable, editable, downloadable as CSV. */
FF.views.log = (() => {
  const U = FF.util;
  const S = FF.store;
  const M = FF.model;
  const esc = U.esc;

  let range = 'this-week';

  function rangeDates(key) {
    const t = U.today();
    const mon = U.mondayOf(t);
    switch (key) {
      case 'this-week': return [mon, U.addDays(mon, 6)];
      case 'last-week': return [U.addDays(mon, -7), U.addDays(mon, -1)];
      case 'this-plan': {
        const p = M.planFor(t);
        return p ? [p.start, p.end] : [mon, U.addDays(mon, 6)];
      }
      case 'this-month': return [t.slice(0, 8) + '01', t.slice(0, 8) + '31'];
      default: return ['0000-01-01', '9999-12-31'];
    }
  }

  /** A list of entries — also used on the Today screen. */
  function entryList(entries, { showDate = false } = {}) {
    return `<ul class="entries">${entries
      .map((e) => {
        const item = e.planItemId ? S.get('planItems', e.planItemId) : null;
        return `
        <li>
          <button class="entry" data-action="entry-edit" data-id="${esc(e.id)}">
            <span class="entry-time">${esc(e.start)}–${esc(e.end)}${showDate ? `<br><span class="muted">${esc(U.fmtDate(e.date, { weekday: 'short' }))}</span>` : ''}</span>
            <span class="entry-main">
              <span class="entry-name"><i class="dot" style="background:${esc(FF.colors.colorFor(e.task))}"></i>${esc(e.task)}</span>
              <span class="entry-meta">
                <span class="badge ${e.worked === 'With help' ? 'help' : 'solo'}">${e.worked === 'With help' ? `Help${e.helpers ? `: ${esc(e.helpers)}` : ''}` : 'Solo'}</span>
                ${e.type === 'One-off' ? '<span class="badge">One-off</span>' : ''}
                ${item ? `<span class="badge plan">Planned</span>` : ''}
              </span>
              ${e.notes ? `<span class="entry-notes">${esc(e.notes)}</span>` : ''}
            </span>
            <span class="entry-dur">${U.fmtMins(e.minutes)}<span class="entry-edit">✎ Edit</span></span>
          </button>
        </li>`;
      })
      .join('')}</ul>`;
  }

  function render() {
    const [start, end] = rangeDates(range);
    const entries = M.logBetween(start, end);
    const total = U.sum(entries, (e) => e.minutes);
    const split = M.soloHelpSplit(entries);
    const byDate = U.groupBy(entries, (e) => e.date);
    const opt = (v, l) => `<option value="${v}" ${v === range ? 'selected' : ''}>${l}</option>`;
    return `
      <div class="page-head">
        <h1>Log</h1>
        <button class="btn primary" data-action="entry-new">＋ Add entry</button>
      </div>
      <div class="toolbar">
        <select id="logRange" data-change="log-range" aria-label="Show">
          ${opt('this-week', 'This week')}${opt('last-week', 'Last week')}${opt('this-plan', 'Current plan period')}${opt('this-month', 'This month')}${opt('all', 'Everything')}
        </select>
        <button class="btn ghost" data-action="log-csv">⇩ Download CSV</button>
      </div>
      <p class="hint">Tap an entry to change its date, times, task or notes.</p>
      <section class="stats">
        <div class="stat"><span class="stat-num">${U.fmtMins(total)}</span><span class="stat-label">Total</span></div>
        <div class="stat"><span class="stat-num">${U.fmtMins(split.solo)}</span><span class="stat-label">Solo</span></div>
        <div class="stat"><span class="stat-num">${U.fmtMins(split.help)}</span><span class="stat-label">With help</span></div>
      </section>
      ${entries.length
        ? [...byDate.entries()].map(([d, list]) => `
          <section class="card">
            <div class="card-head"><h3>${esc(U.fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' }))}</h3><span class="small strong">${U.fmtMins(U.sum(list, (e) => e.minutes))}</span></div>
            ${entryList(list)}
          </section>`).join('')
        : `<section class="card empty"><p class="muted">Nothing logged in this period.</p></section>`}`;
  }

  FF.changes['log-range'] = (el) => {
    range = el.value;
    FF.app.render();
  };

  FF.actions['entry-edit'] = (el) => {
    const e = S.get('log', el.dataset.id);
    if (e) FF.ui.entryForm({ mode: 'edit', entry: e });
  };

  FF.actions['log-csv'] = () => {
    const [start, end] = rangeDates(range);
    const entries = M.logBetween(start, end).slice().reverse();
    const rows = [['Date', 'Start', 'End', 'Minutes', 'Hours', 'Task', 'Type', 'Worked', 'Helpers', 'Notes', 'Planned target (min)', 'ID']];
    entries.forEach((e) => {
      const item = e.planItemId ? S.get('planItems', e.planItemId) : null;
      rows.push([e.date, e.start, e.end, e.minutes, (e.minutes / 60).toFixed(2), e.task, e.type, e.worked, e.helpers, e.notes, item ? item.targetMinutes : '', e.id]);
    });
    U.download(`ff-tracker-log-${range}-${U.today()}.csv`, U.toCsv(rows), 'text/csv');
  };

  return { title: 'Log', render, entryList };
})();
