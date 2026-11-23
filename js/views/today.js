/* Today screen: running task, tasks on hold, start/switch, quick-start planned tasks, today's log. */
FF.views = FF.views || {};
FF.actions = FF.actions || {};
FF.forms = FF.forms || {};
FF.changes = FF.changes || {};

FF.views.today = (() => {
  const U = FF.util;
  const S = FF.store;
  const M = FF.model;
  const esc = U.esc;

  const T = FF.timers;

  function runningCard() {
    const r = T.running();
    if (!r) return '';
    const seg = T.last(r);
    const segStart = new Date(seg.start);
    const item = r.planItemId ? S.get('planItems', r.planItemId) : null;
    const resumed = r.segments.length > 1;
    return `
      <section class="card timer running">
        <div class="eyebrow">Working on</div>
        <div class="timer-task">${esc(r.task)} ${r.type === 'One-off' ? '<span class="badge">One-off</span>' : ''}</div>
        ${seg.location ? `<div class="timer-loc">📍 ${esc(seg.location)}</div>` : ''}
        <div class="clock" data-clock="${esc(r.id)}">${U.fmtClock(T.elapsedMs(r))}</div>
        <div class="muted small">${resumed ? 'Resumed' : 'Started'} ${U.hm(segStart)}${U.ymd(segStart) !== U.today() ? ` on ${esc(U.fmtDate(U.ymd(segStart)))}` : ''} · <button class="link-btn inline" data-action="active-adjust" data-id="${esc(r.id)}">change</button>${item ? ` · target ${U.fmtMins(item.targetMinutes)}, ${U.fmtMins(M.actualFor(item.id))} logged before` : ''}</div>
        <div class="btn-row two">
          <button class="btn outline-light big" data-action="active-pause" data-id="${esc(r.id)}">❚❚ Pause</button>
          <button class="btn primary big" data-action="active-finish" data-id="${esc(r.id)}">■ Finish</button>
        </div>
      </section>`;
  }

  function onHoldCard() {
    const held = T.onHold();
    if (!held.length) return '';
    return `
      <section class="card on-hold">
        <div class="card-head"><h3>On hold</h3><span class="small muted">${held.length} task${held.length === 1 ? '' : 's'}</span></div>
        <ul class="items">${held.map((r) => `
          <li class="item-row">
            <div class="item-main">
              <div class="item-name">${esc(r.task)} ${r.type === 'One-off' ? '<span class="badge">One-off</span>' : ''}</div>
              <div class="muted small"><b>${U.fmtMins(T.elapsedMs(r) / 60000)}</b> so far · paused ${esc(U.hm(new Date(T.last(r).end)))}${U.ymd(new Date(T.last(r).end)) !== U.today() ? ` ${esc(U.fmtDate(U.ymd(new Date(T.last(r).end))))}` : ''}</div>
            </div>
            <button class="icon-btn" data-action="active-finish" data-id="${esc(r.id)}" aria-label="Finish ${esc(r.task)}" title="Finish">■</button>
            <button class="icon-btn play" data-action="active-resume" data-id="${esc(r.id)}" aria-label="Resume ${esc(r.task)}" title="Resume">▶</button>
          </li>`).join('')}
        </ul>
      </section>`;
  }

  /* ---------- "type or pick a task" box ---------- */

  /**
   * Everything you might want to start, in groups:
   * Pinned, Planned, Most used, Your tasks (repeatable), Used recently (one-offs).
   * value: "p:<planItemId>" | "t:<taskId>" | "o:<one-off name>"
   */
  function taskSuggestions() {
    const P = FF.picks;
    const date = U.today();
    const plan = M.planFor(date);
    const byName = new Map(); // lower-case name -> { value, sub }
    const note = (name, value, sub) => {
      const k = P.key(name);
      if (k && !byName.has(k)) byName.set(k, { name, value, sub });
    };
    if (plan) {
      M.itemsFor(plan.id).filter((i) => !i.done).forEach((i) =>
        note(i.task, `p:${i.id}`, `Planned · target ${U.fmtMins(i.targetMinutes)}${i.day === date ? ' · today' : ''}`));
    }
    M.activeTasks().forEach((t) => note(t.name, `t:${t.id}`, t.category || 'Repeatable task'));
    const used = P.usage('task', 60);
    used.forEach((u) => note(u.name, `o:${u.name}`, 'One-off'));

    const out = [];
    const seen = new Set();
    const add = (name, group, sub) => {
      const k = P.key(name);
      if (!k || seen.has(k)) return;
      seen.add(k);
      const known = byName.get(k) || { value: `o:${name}`, sub: 'One-off' };
      out.push({ value: known.value, label: known.name || name, sub: sub || known.sub, group });
    };
    P.pinned('task').forEach((p) => add(p.name, 'Pinned'));
    if (plan) M.itemsFor(plan.id).filter((i) => !i.done).forEach((i) => add(i.task, 'Planned'));
    used.filter((u) => u.count >= 2).slice(0, 5).forEach((u) => add(u.name, 'Most used', `${byName.get(P.key(u.name)).sub} · used ${u.count} times`));
    M.activeTasks().forEach((t) => add(t.name, 'Your tasks'));
    used
      .slice()
      .sort((x, y) => y.last.localeCompare(x.last))
      .forEach((u) => {
        if (out.filter((x) => x.group === 'Used recently').length < 8) add(u.name, 'Used recently', `${byName.get(P.key(u.name)).sub} · last ${U.fmtDate(u.last.slice(0, 10), { day: 'numeric', month: 'short' })}`);
      });
    return out;
  }

  function suggestHtml(text) {
    const q = text.trim().toLowerCase();
    const all = taskSuggestions();
    const item = (x) => `
      <li class="pick-row">
        <button type="button" class="suggest-item" data-action="start-suggest" data-value="${esc(x.value)}">
          <span class="suggest-name">${esc(x.label)}</span><span class="suggest-sub">${esc(x.sub)}</span>
          <span class="suggest-go">▶</span>
        </button>
        ${FF.picks.pinButton('task', x.label)}
      </li>`;
    if (!q) {
      if (!all.length) return '<p class="hint">Type what you\'re doing and tap Start. Tasks you use show up here to tap next time, and you can 📌 pin your favourites.</p>';
      const groups = U.groupBy(all, (x) => x.group);
      return [...groups.entries()].map(([g, list]) => `<div class="suggest-group">${esc(g)}</div><ul class="suggest">${list.map(item).join('')}</ul>`).join('');
    }
    const hits = FF.picks.filter(all.map((x) => ({ ...x, name: x.label })), text).slice(0, 8);
    const exact = all.some((x) => x.label.trim().toLowerCase() === q);
    return `<ul class="suggest">${hits.map(item).join('')}
      ${exact ? '' : `<li class="pick-row"><button type="button" class="suggest-item new" data-action="start-typed">
        <span class="suggest-name">Start “${esc(text.trim())}”</span><span class="suggest-sub">New one-off task</span><span class="suggest-go">▶</span>
      </button></li>`}</ul>`;
  }

  function startCard() {
    const busy = !!T.running();
    return `
      <section class="card timer start-card">
        <form data-form="timer-start" class="start-form" autocomplete="off">
          <div class="start-head">
            <label for="startTask" class="eyebrow">${busy ? 'Jump to another task' : 'Start a task'}</label>
            <button type="button" class="loc-chip ${S.currentLocation() ? '' : 'empty'}" data-action="location-choose">📍 ${esc(S.currentLocation() || 'Set location')}</button>
          </div>
          <div class="picker-row">
            <input id="startTask" name="task" placeholder="Type a task, or pick one below" autocomplete="off" autocapitalize="sentences" enterkeyhint="go" data-input="start-filter">
            <button class="btn primary" type="submit">▶ Start</button>
          </div>
          <div id="startSuggest" class="suggest-box">${suggestHtml('')}</div>
          ${busy ? '<p class="hint">Starting another task puts the current one on hold.</p>' : ''}
        </form>
        <button class="link-btn" data-action="entry-new">or log time without the timer</button>
      </section>`;
  }

  function planCard() {
    const date = U.today();
    const plan = M.planFor(date);
    if (!plan) {
      return `
        <section class="card empty">
          <h3>No plan for this week yet</h3>
          <p class="muted">Set targets for the week or fortnight ahead, then see how you go.</p>
          <a class="btn" href="#plan">Make a plan</a>
        </section>`;
    }
    const items = M.itemsFor(plan.id);
    const open = items.filter((i) => !i.done);
    const todayFirst = open.filter((i) => i.day === date).concat(open.filter((i) => !i.day), open.filter((i) => i.day && i.day !== date && i.day > date));
    const late = open.filter((i) => i.day && i.day < date);
    const target = U.sum(items, (i) => i.targetMinutes);
    const actual = U.sum(items, (i) => M.actualFor(i.id));
    const doneCount = items.length - open.length;
    const running = T.running();
    const held = new Set(T.onHold().map((r) => r.planItemId).filter(Boolean));
    const row = (i, tag = '') => {
      const st = M.statusOf(i);
      const pct = st.target ? Math.min(100, (st.actual / st.target) * 100) : 0;
      return `
        <li class="item-row">
          <div class="item-main">
            <div class="item-name">${esc(i.task)} ${tag}</div>
            <div class="bar ${st.key}"><span style="width:${pct}%"></span></div>
            <div class="muted small">${U.fmtMins(st.actual)} of ${U.fmtMins(st.target)}${i.day && i.day !== date ? ` · ${U.fmtDate(i.day, { weekday: 'short' })}` : ''}</div>
          </div>
          ${running && running.planItemId === i.id
            ? '<span class="badge running">Running</span>'
            : `${held.has(i.id) ? '<span class="badge">On hold</span>' : ''}<button class="icon-btn play" data-action="timer-start-item" data-id="${esc(i.id)}" aria-label="Start ${esc(i.task)}">▶</button>`}
        </li>`;
    };
    return `
      <section class="card">
        <div class="card-head">
          <h3>${plan.weeks === 2 ? 'This fortnight' : 'This week'}</h3>
          <a href="#review" class="small">${doneCount}/${items.length} done · ${U.fmtMins(actual)} of ${U.fmtMins(target)}</a>
        </div>
        ${open.length ? '' : `<p class="muted">${items.length ? 'Everything planned is finished. Nice work.' : 'Nothing planned yet.'} <a href="#plan">Open plan</a></p>`}
        ${late.length ? `<div class="eyebrow warn">Overdue</div><ul class="items">${late.map((i) => row(i)).join('')}</ul>` : ''}
        ${todayFirst.length ? `<ul class="items">${todayFirst.map((i) => row(i, i.day === date ? '<span class="badge today">Today</span>' : '')).join('')}</ul>` : ''}
      </section>`;
  }

  function logCard() {
    const date = U.today();
    const entries = M.logBetween(date, date);
    const total = U.sum(entries, (e) => e.minutes);
    return `
      <section class="card logged-today">
        <div class="card-head">
          <h3>Logged today</h3>
          <span class="small strong">${U.fmtMins(total)}</span>
        </div>
        ${FF.charts.dayCharts(date)}
        ${entries.length ? `<h4 class="entries-head">Entries</h4>${FF.views.log.entryList(entries)}` : ''}
        <button class="link-btn" data-action="open-day" data-date="${esc(U.addDays(date, -1))}">← Look back at earlier days</button>
      </section>`;
  }

  function render() {
    return `
      <div class="page-head">
        <h1>${esc(U.fmtDateLong(U.today()))}</h1>
      </div>
      ${runningCard()}
      ${onHoldCard()}
      ${startCard()}
      ${planCard()}
      ${logCard()}`;
  }

  /* ---------- actions ---------- */
  function startTimer(choice) {
    const res = T.start(choice);
    if (res.already) return FF.ui.toast(`${choice.task} is already running`);
    const verb = res.resumed ? 'Resumed' : 'Started';
    FF.ui.toast(res.paused ? `${verb} ${res.rec.task} · ${res.paused.task} on hold` : `${verb} ${res.rec.task}`, 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  FF.inputs = FF.inputs || {};
  FF.inputs['start-filter'] = (el) => {
    const box = document.getElementById('startSuggest');
    if (box) box.innerHTML = suggestHtml(el.value);
  };

  /** Turn typed text into a task: a planned item or repeatable task with that name, or a new one-off. */
  function choiceFromText(text) {
    const q = text.trim().toLowerCase();
    const match = taskSuggestions().find((x) => x.label.trim().toLowerCase() === q);
    if (match) return choiceFromValue(match.value);
    return { task: text.trim(), type: 'One-off', taskId: '', planItemId: '', planId: '' };
  }
  function choiceFromValue(v) {
    if (v.startsWith('o:')) return { task: v.slice(2), type: 'One-off', taskId: '', planItemId: '', planId: '' };
    return FF.ui.resolveTaskChoice(v, '', U.today());
  }

  FF.forms['timer-start'] = (form) => {
    const text = form.elements.task.value;
    if (!text.trim()) {
      FF.ui.toast('Type what you\'re working on, or tap one from the list', 'error');
      form.elements.task.focus();
      return;
    }
    form.elements.task.value = '';
    form.elements.task.blur();
    startTimer(choiceFromText(text));
  };
  FF.actions['start-typed'] = () => {
    const form = document.querySelector('form[data-form="timer-start"]');
    if (form) FF.forms['timer-start'](form);
  };
  FF.actions['start-suggest'] = (el) => {
    const choice = choiceFromValue(el.dataset.value);
    const input = document.getElementById('startTask');
    if (input) {
      input.value = '';
      input.blur();
    }
    if (choice) startTimer(choice);
  };

  FF.actions['timer-start-item'] = (el) => {
    const item = S.get('planItems', el.dataset.id);
    if (item) startTimer({ task: item.task, type: item.type, taskId: item.taskId, planItemId: item.id, planId: item.planId });
  };

  FF.actions['active-resume'] = (el) => {
    const res = T.resume(el.dataset.id);
    if (res.rec) FF.ui.toast(res.paused ? `Resumed ${res.rec.task} · ${res.paused.task} on hold` : `Resumed ${res.rec.task}`, 'ok');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  FF.actions['active-pause'] = (el) => {
    const r = S.get('active', el.dataset.id);
    T.pause(el.dataset.id);
    if (r) FF.ui.toast(`${r.task} on hold`);
  };

  /** Finish a task: save its time to the Log (one row per stint). */
  FF.actions['active-finish'] = (el) => {
    const r = S.get('active', el.dataset.id);
    if (!r) return;
    const rows = T.toEntries(r);
    const base = { task: r.task, type: r.type, taskId: r.taskId, planItemId: r.planItemId, planId: r.planId, activeId: r.id };
    if (rows.length === 1) {
      FF.ui.entryForm({ mode: 'stop', entry: { ...base, ...rows[0] } });
      return;
    }
    finishMany(r, base, rows);
  };

  function finishMany(r, base, rows) {
    const item = r.planItemId ? S.get('planItems', r.planItemId) : null;
    const total = U.sum(rows, (e) => e.minutes);
    const worked = S.settings().lastWorked || 'Solo';
    const sameLoc = rows.every((e) => e.location === rows[0].location);
    FF.ui.modal({
      title: 'Save this time',
      cancelLabel: 'Not yet',
      submitLabel: `Save ${rows.length} entries`,
      body: `
        <div class="field"><span class="label">Task</span><div class="readonly">${esc(r.task)}</div></div>
        <div class="field">
          <span class="label">You worked on it ${rows.length} times · ${U.fmtMins(total)} in total</span>
          <ul class="stints">${rows.map((e) => `<li><span>${esc(U.fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' }))}${!sameLoc && e.location ? `<br><span class="muted small">📍 ${esc(e.location)}</span>` : ''}</span><span>${esc(e.start)}–${esc(e.end)}</span><b>${U.fmtMins(e.minutes)}</b></li>`).join('')}</ul>
          <p class="hint">Each one is saved as its own row. You can change any of them later in the Log.</p>
        </div>
        ${sameLoc ? FF.picks.field({ name: 'location', label: 'Location <span class="muted">(optional)</span>', value: rows[0].location, kind: 'location', placeholder: 'e.g. Warehouse', id: 'fm-location' }) : ''}
        ${FF.ui.workedField(worked, '')}
        ${item ? `<div class="field"><label class="check"><input type="checkbox" name="done" ${item.done ? 'checked' : ''}><span>This planned task is now <b>finished</b></span></label>
          <div class="hint">Counts towards: ${esc(item.task)} (target ${U.fmtMins(item.targetMinutes)})</div></div>` : ''}
        <div class="field"><label for="fm-notes">Notes <span class="muted">(optional)</span></label>
          <textarea id="fm-notes" name="notes" rows="2"></textarea></div>`,
      extraButtons: [{
        label: 'Discard', cls: 'danger ghost',
        onClick: async () => {
          const ok = await FF.ui.confirm('Throw away this timer?', 'None of this time will be logged.', 'Discard');
          if (!ok) return false;
          S.remove('active', r.id);
          FF.ui.toast('Timer discarded');
        },
      }],
      onOpen: (form) => FF.ui.wireWorked(form),
      onSubmit: (form) => {
        const f = form.elements;
        const w = f.worked.value || 'Solo';
        const helpers = w === 'With help' ? f.helpers.value.trim() : '';
        rows.forEach((e) => S.upsert('log', { ...base, ...e, ...(sameLoc ? { location: f.location.value.trim() } : {}), worked: w, helpers, notes: f.notes.value.trim() }, { silent: true }));
        if (item && f.done && item.done !== f.done.checked) S.upsert('planItems', { ...item, done: f.done.checked }, { silent: true });
        S.setSettings({ lastWorked: w });
        S.remove('active', r.id);
        FF.ui.toast(`Logged ${U.fmtMins(total)} on ${r.task}`, 'ok');
      },
    });
  }

  // Forgot to press start? Move the running segment's start.
  FF.actions['active-adjust'] = (el) => {
    const r = S.get('active', el.dataset.id);
    if (!T.isRunning(r)) return;
    const started = new Date(T.last(r).start);
    FF.ui.modal({
      title: 'Change start time',
      body: `
        <p class="muted">Forgot to start the timer? Set when you really started. It keeps running from there.</p>
        <div class="row2">
          <div class="field"><label for="ta-date">Date</label><input id="ta-date" type="date" name="date" value="${esc(U.ymd(started))}" max="${esc(U.today())}" required></div>
          <div class="field"><label for="ta-time">Start time</label><input id="ta-time" type="time" name="time" value="${esc(U.hm(started))}" required></div>
        </div>`,
      submitLabel: 'Update timer',
      onSubmit: (form) => {
        const f = form.elements;
        if (!f.date.value || !f.time.value) return FF.ui.invalid(form, 'time', 'Pick a date and time.');
        const [h, m] = f.time.value.split(':').map(Number);
        const d = U.parseYmd(f.date.value);
        d.setHours(h, m, 0, 0);
        const err = T.setCurrentStart(r.id, d);
        if (err) return FF.ui.invalid(form, 'time', err);
        FF.ui.toast(`Timer now started at ${f.time.value}`, 'ok');
      },
    });
  };

  /** "Where are you?" — sets this device's current location for new timers. */
  FF.actions['location-choose'] = () => {
    const running = T.running();
    const current = S.currentLocation();
    let typed = '';
    const choose = (name) => {
      const loc = String(name || '').trim();
      S.setSettings({ currentLocation: loc });
      const also = document.querySelector('#modal input[name=alsoRunning]');
      if (running && (!also || also.checked)) T.relocateRunning(loc);
      S.emit();
      document.getElementById('modal').close();
      FF.ui.toast(loc ? `Location: ${loc}` : 'Location cleared', 'ok');
    };
    FF.actions['location-set'] = (el) => choose(el.dataset.name);
    FF.ui.modal({
      title: 'Where are you?',
      body: `
        <div class="field"><input id="loc-search" placeholder="Type a place, or pick one below" autocomplete="off" autocapitalize="words" data-input="loc-search" enterkeyhint="done"></div>
        <div id="loc-list" class="suggest-box tall">${FF.picks.pinList('location', '', { action: 'location-set', actionLabel: 'Use' })}</div>
        ${running ? `<label class="check"><input type="checkbox" name="alsoRunning" checked><span>Also for <b>${esc(running.task)}</b> from now on</span></label>` : ''}
        <p class="hint">New tasks you start on this device get this location. Tap 📌 to keep a place at the top.</p>`,
      submitLabel: 'Done',
      extraButtons: current ? [{ label: 'No location', cls: 'ghost', onClick: () => choose('') }] : [],
      onSubmit: () => {
        if (typed.trim()) choose(typed);
      },
    });
    FF.inputs['loc-search'] = (el) => {
      typed = el.value;
      document.getElementById('loc-list').innerHTML = FF.picks.pinList('location', el.value, { action: 'location-set', actionLabel: 'Use' });
    };
  };

  FF.actions['entry-new'] = () => FF.ui.entryForm({ mode: 'new' });

  return { title: 'Today', render };
})();
