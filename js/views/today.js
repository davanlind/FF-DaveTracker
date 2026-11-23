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

  function startCard() {
    const busy = !!T.running();
    return `
      <section class="card timer ${busy ? 'compact' : ''}">
        <form data-form="timer-start" class="start-form" autocomplete="off">
          <label for="startPick" class="eyebrow">${busy ? 'Jump to another task' : 'Start a task'}</label>
          <select id="startPick" name="pick" data-change="start-pick">${FF.ui.taskOptions(U.today(), '')}</select>
          <div class="oneoff-field" id="startOneOffBox" hidden>
            <input id="startOneOff" name="oneoff" placeholder="One-off task name">
          </div>
          <button class="btn ${busy ? '' : 'primary big'}" type="submit">▶ ${busy ? 'Start (puts the current one on hold)' : 'Start timer'}</button>
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
      <section class="card">
        <div class="card-head">
          <h3>Logged today</h3>
          <span class="small strong">${U.fmtMins(total)}</span>
        </div>
        ${entries.length ? FF.views.log.entryList(entries) : '<p class="muted">Nothing logged yet today.</p>'}
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

  FF.changes['start-pick'] = (el) => {
    const box = document.getElementById('startOneOffBox');
    box.hidden = el.value !== '__oneoff';
    if (!box.hidden) document.getElementById('startOneOff').focus();
  };

  FF.forms['timer-start'] = (form) => {
    const pick = form.elements.pick.value;
    if (!pick) return FF.ui.toast('Choose a task first', 'error');
    const choice = FF.ui.resolveTaskChoice(pick, form.elements.oneoff.value, U.today());
    if (!choice) return FF.ui.toast('Type a name for the one-off task', 'error');
    form.reset();
    startTimer(choice);
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
    FF.ui.modal({
      title: 'Save this time',
      cancelLabel: 'Not yet',
      submitLabel: `Save ${rows.length} entries`,
      body: `
        <div class="field"><span class="label">Task</span><div class="readonly">${esc(r.task)}</div></div>
        <div class="field">
          <span class="label">You worked on it ${rows.length} times · ${U.fmtMins(total)} in total</span>
          <ul class="stints">${rows.map((e) => `<li><span>${esc(U.fmtDate(e.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span><span>${esc(e.start)}–${esc(e.end)}</span><b>${U.fmtMins(e.minutes)}</b></li>`).join('')}</ul>
          <p class="hint">Each one is saved as its own row. You can change any of them later in the Log.</p>
        </div>
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
        rows.forEach((e) => S.upsert('log', { ...base, ...e, worked: w, helpers, notes: f.notes.value.trim() }, { silent: true }));
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

  FF.actions['entry-new'] = () => FF.ui.entryForm({ mode: 'new' });

  return { title: 'Today', render };
})();
