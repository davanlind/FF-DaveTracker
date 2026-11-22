/* Today screen: start/stop the timer, quick-start planned tasks, see today's log. */
FF.views = FF.views || {};
FF.actions = FF.actions || {};
FF.forms = FF.forms || {};
FF.changes = FF.changes || {};

FF.views.today = (() => {
  const U = FF.util;
  const S = FF.store;
  const M = FF.model;
  const esc = U.esc;

  function timerCard() {
    const t = S.timer();
    if (t) {
      const started = new Date(t.startedAt);
      const item = t.planItemId ? S.get('planItems', t.planItemId) : null;
      return `
        <section class="card timer running">
          <div class="eyebrow">Working on</div>
          <div class="timer-task">${esc(t.task)} ${t.type === 'One-off' ? '<span class="badge">One-off</span>' : ''}</div>
          <div class="clock" data-elapsed="${esc(t.startedAt)}">${U.fmtClock(Date.now() - started.getTime())}</div>
          <div class="muted small">Started ${U.hm(started)}${item ? ` · target ${U.fmtMins(item.targetMinutes)}, ${U.fmtMins(M.actualFor(item.id))} logged before this` : ''}</div>
          <div class="btn-row">
            <button class="btn primary big" data-action="timer-stop">■ Stop &amp; save</button>
          </div>
        </section>`;
    }
    return `
      <section class="card timer">
        <form data-form="timer-start" class="start-form" autocomplete="off">
          <label for="startPick" class="eyebrow">Start a task</label>
          <select id="startPick" name="pick" data-change="start-pick">${FF.ui.taskOptions(U.today(), '')}</select>
          <div class="oneoff-field" id="startOneOffBox" hidden>
            <input id="startOneOff" name="oneoff" placeholder="One-off task name">
          </div>
          <button class="btn primary big" type="submit">▶ Start timer</button>
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
    const running = S.timer();
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
          ${running ? '' : `<button class="icon-btn play" data-action="timer-start-item" data-id="${esc(i.id)}" aria-label="Start ${esc(i.task)}">▶</button>`}
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
      ${timerCard()}
      ${planCard()}
      ${logCard()}`;
  }

  /* ---------- actions ---------- */
  function startTimer(choice) {
    S.setTimer({ ...choice, startedAt: new Date().toISOString() });
    FF.ui.toast(`Timer started: ${choice.task}`, 'ok');
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
    startTimer(choice);
  };

  FF.actions['timer-start-item'] = (el) => {
    const item = S.get('planItems', el.dataset.id);
    if (item) startTimer({ task: item.task, type: item.type, taskId: item.taskId, planItemId: item.id, planId: item.planId });
  };

  FF.actions['timer-stop'] = () => {
    const t = S.timer();
    if (!t) return;
    const started = new Date(t.startedAt);
    const minutes = Math.max(1, Math.round((Date.now() - started.getTime()) / 60000));
    FF.ui.entryForm({
      mode: 'stop',
      entry: {
        task: t.task, type: t.type, taskId: t.taskId, planItemId: t.planItemId, planId: t.planId,
        date: U.ymd(started), start: U.hm(started), end: U.fromMins(U.toMins(U.hm(started)) + minutes), minutes,
      },
    });
  };

  FF.actions['entry-new'] = () => FF.ui.entryForm({ mode: 'new' });

  return { title: 'Today', render };
})();
