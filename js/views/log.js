/* Log screen.
 *  Day view (default): one day at a time with ‹ › to go back through history: timeline, clock,
 *                      time per task and location, and that day's entries.
 *  List view: everything in a week/month/etc, editable, downloadable as CSV. */
FF.views.log = (() => {
  const U = FF.util;
  const S = FF.store;
  const M = FF.model;
  const esc = U.esc;

  let range = 'this-week';
  let mode = 'day'; // 'day' | 'list'
  let day = null; // date shown in Day view (null = today)

  /** Show one day in the Log tab (used by Today and Review links too). */
  function showDay(date) {
    mode = 'day';
    day = date;
    if (location.hash !== '#log') location.hash = '#log';
    else FF.app.render();
  }

  function dayView() {
    const d = day || U.today();
    const isToday = d === U.today();
    const entries = M.logBetween(d, d);
    const split = M.soloHelpSplit(entries);
    // days that have something logged, to jump over empty days
    const days = [...new Set(S.all('log').map((e) => e.date))].sort();
    const prevDay = days.filter((x) => x < d).pop();
    const nextDay = days.find((x) => x > d && x <= U.today());
    return `
      <div class="period-nav day-nav">
        <button class="icon-btn" data-action="day-step" data-to="${esc(U.addDays(d, -1))}" aria-label="Previous day">‹</button>
        <div class="period-title">
          <strong>${esc(U.fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' }))}</strong>
          <span class="muted small">${isToday ? 'Today' : esc(U.fmtDate(d, { year: 'numeric' }))}</span>
        </div>
        <button class="icon-btn" data-action="day-step" data-to="${esc(U.addDays(d, 1))}" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
      </div>
      <div class="toolbar day-tools">
        <input type="date" id="logDay" value="${esc(d)}" max="${esc(U.today())}" data-change="log-day" data-nokeep aria-label="Pick a day">
        ${prevDay ? `<button class="btn ghost" data-action="day-step" data-to="${esc(prevDay)}" title="Previous day with entries">⇤ Last logged day</button>` : ''}
        ${nextDay && !isToday ? `<button class="btn ghost" data-action="day-step" data-to="${esc(nextDay)}">Next logged day ⇥</button>` : ''}
        ${isToday ? '' : `<button class="btn ghost" data-action="day-step" data-to="${esc(U.today())}">Today</button>`}
      </div>
      <section class="stats">
        <div class="stat"><span class="stat-num">${U.fmtMins(U.sum(entries, (e) => e.minutes))}</span><span class="stat-label">Logged</span></div>
        <div class="stat"><span class="stat-num">${U.fmtMins(split.solo)}</span><span class="stat-label">Solo</span></div>
        <div class="stat"><span class="stat-num">${U.fmtMins(split.help)}</span><span class="stat-label">With help</span></div>
      </section>
      <section class="card">
        ${FF.charts.dayCharts(d)}
        <div class="card-head entries-head-row"><h4 class="entries-head">Entries</h4>
          <button class="btn ghost small-btn" data-action="entry-new-day" data-date="${esc(d)}">＋ Add to this day</button></div>
        ${entries.length ? entryList(entries) : '<p class="muted">No entries.</p>'}
      </section>`;
  }

  FF.actions['open-day'] = (el) => showDay(el.dataset.date);
  FF.actions['day-step'] = (el) => {
    const to = el.dataset.to;
    if (to > U.today()) return;
    day = to;
    FF.app.render();
  };
  FF.changes['log-day'] = (el) => {
    if (el.value) {
      day = el.value > U.today() ? U.today() : el.value;
      FF.app.render();
    }
  };
  FF.actions['log-mode'] = (el) => {
    mode = el.dataset.mode;
    FF.app.render();
  };
  FF.actions['entry-new-day'] = (el) => FF.ui.entryForm({ mode: 'new', entry: { date: el.dataset.date } });

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
                ${e.location ? `<span class="badge loc">📍 ${esc(e.location)}</span>` : ''}
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
    const head = `
      <div class="page-head">
        <h1>Log</h1>
        <button class="btn primary" data-action="entry-new">＋ Add entry</button>
      </div>
      <div class="mode-switch" role="tablist">
        <button role="tab" aria-selected="${mode === 'day'}" class="${mode === 'day' ? 'on' : ''}" data-action="log-mode" data-mode="day">Day by day</button>
        <button role="tab" aria-selected="${mode === 'list'}" class="${mode === 'list' ? 'on' : ''}" data-action="log-mode" data-mode="list">List</button>
      </div>`;
    return head + (mode === 'day' ? dayView() : listView());
  }

  function listView() {
    const [start, end] = rangeDates(range);
    const entries = M.logBetween(start, end);
    const total = U.sum(entries, (e) => e.minutes);
    const split = M.soloHelpSplit(entries);
    const byDate = U.groupBy(entries, (e) => e.date);
    const opt = (v, l) => `<option value="${v}" ${v === range ? 'selected' : ''}>${l}</option>`;
    return `
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
            <div class="card-head"><h3><button class="as-btn day-link" data-action="open-day" data-date="${esc(d)}">${esc(U.fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' }))} ›</button></h3><span class="small strong">${U.fmtMins(U.sum(list, (e) => e.minutes))}</span></div>
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
    const rows = [['Date', 'Start', 'End', 'Minutes', 'Hours', 'Task', 'Location', 'Type', 'Worked', 'Helpers', 'Notes', 'Planned target (min)', 'ID']];
    entries.forEach((e) => {
      const item = e.planItemId ? S.get('planItems', e.planItemId) : null;
      rows.push([e.date, e.start, e.end, e.minutes, (e.minutes / 60).toFixed(2), e.task, e.location, e.type, e.worked, e.helpers, e.notes, item ? item.targetMinutes : '', e.id]);
    });
    U.download(`ff-tracker-log-${range}-${U.today()}.csv`, U.toCsv(rows), 'text/csv');
  };

  return { title: 'Log', render, entryList, showDay };
})();
