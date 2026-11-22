/* Plan screen: set targets for a week or fortnight. Plans always start on a Monday. */
FF.views.plan = (() => {
  const U = FF.util;
  const S = FF.store;
  const M = FF.model;
  const esc = U.esc;

  let monday = U.mondayOf(U.today()); // the week being looked at

  const overlaps = (start, end) => S.all('plans').find((p) => p.start <= end && start <= p.end);

  function emptyState() {
    const nextFree = !overlaps(U.addDays(monday, 7), U.addDays(monday, 13));
    const prev = M.plansSorted().find((p) => p.start < monday);
    return `
      <section class="card empty">
        <h3>No plan for this week yet</h3>
        <p class="muted">Pick how far ahead to plan. Both start on Monday ${esc(U.fmtDate(monday, { day: 'numeric', month: 'short' }))}.</p>
        <div class="btn-row wrap">
          <button class="btn primary" data-action="plan-create" data-weeks="1">Plan this week</button>
          <button class="btn primary" data-action="plan-create" data-weeks="2" ${nextFree ? '' : 'disabled title="Next week already has a plan"'}>Plan a fortnight</button>
        </div>
        ${prev ? `<button class="link-btn" data-action="plan-copy" data-from="${esc(prev.id)}">or copy the plan from ${esc(U.fmtDate(prev.start, { day: 'numeric', month: 'short' }))}</button>` : ''}
      </section>`;
  }

  function planBody(plan) {
    const items = M.itemsFor(plan.id);
    const target = U.sum(items, (i) => i.targetMinutes);
    const actual = U.sum(items, (i) => M.actualFor(i.id));
    const groups = U.groupBy(items, (i) => i.day || '');
    const order = [''].concat(M.planDays(plan)).filter((d) => groups.has(d));
    const row = (i) => {
      const st = M.statusOf(i);
      const pct = st.target ? Math.min(100, (st.actual / st.target) * 100) : 0;
      return `
        <li class="item-row ${i.done ? 'is-done' : ''}">
          <label class="tick" title="Mark finished">
            <input type="checkbox" data-change="plan-item-done" data-id="${esc(i.id)}" ${i.done ? 'checked' : ''} aria-label="Finished">
          </label>
          <button class="item-main as-btn" data-action="plan-item-edit" data-id="${esc(i.id)}">
            <span class="item-name">${esc(i.task)} ${i.type === 'One-off' ? '<span class="badge">One-off</span>' : ''}</span>
            <span class="bar ${st.key}"><span style="width:${pct}%"></span></span>
            <span class="muted small">${U.fmtMins(st.actual)} of ${U.fmtMins(st.target)} · <span class="status ${st.key}">${esc(st.label)}</span></span>
          </button>
        </li>`;
    };
    return `
      <section class="stats">
        <div class="stat"><span class="stat-num">${U.fmtMins(target)}</span><span class="stat-label">Planned</span></div>
        <div class="stat"><span class="stat-num">${U.fmtMins(actual)}</span><span class="stat-label">Logged</span></div>
        <div class="stat"><span class="stat-num">${items.filter((i) => i.done).length}/${items.length}</span><span class="stat-label">Finished</span></div>
      </section>
      <div class="btn-row wrap">
        <button class="btn primary" data-action="plan-item-new" data-plan="${esc(plan.id)}">＋ Add task</button>
        <button class="btn" data-action="plan-add-all" data-plan="${esc(plan.id)}">Add all repeatable tasks</button>
      </div>
      ${items.length ? order.map((d) => `
        <section class="card">
          <div class="card-head"><h3>${d ? esc(U.fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' })) : 'Any day'}</h3>
            <span class="small">${U.fmtMins(U.sum(groups.get(d), (i) => i.targetMinutes))}</span></div>
          <ul class="items">${groups.get(d).map(row).join('')}</ul>
        </section>`).join('')
        : `<section class="card empty"><p class="muted">No tasks in this plan yet. Add your repeatable tasks in one go, or add tasks one at a time.</p></section>`}
      <div class="danger-zone">
        <button class="link-btn danger" data-action="plan-delete" data-plan="${esc(plan.id)}">Delete this plan</button>
      </div>`;
  }

  function render() {
    const plan = M.planFor(monday);
    const thisMonday = U.mondayOf(U.today());
    const title = plan
      ? `${U.fmtDate(plan.start, { weekday: 'short', day: 'numeric', month: 'short' })} – ${U.fmtDate(plan.end, { weekday: 'short', day: 'numeric', month: 'short' })}`
      : `Week of ${U.fmtDate(monday, { weekday: 'short', day: 'numeric', month: 'short' })}`;
    return `
      <div class="page-head"><h1>Plan</h1>
        ${monday !== thisMonday && !(plan && plan.start <= U.today() && U.today() <= plan.end) ? '<button class="btn ghost" data-action="plan-jump-today">This week</button>' : ''}
      </div>
      <div class="period-nav">
        <button class="icon-btn" data-action="plan-prev" aria-label="Previous week">‹</button>
        <div class="period-title">
          <strong>${esc(title)}</strong>
          <span class="muted small">${plan ? (plan.weeks === 2 ? 'Fortnight' : 'Week') : 'No plan'}${plan && plan.start <= U.today() && U.today() <= plan.end ? ' · current' : ''}</span>
        </div>
        <button class="icon-btn" data-action="plan-next" aria-label="Next week">›</button>
      </div>
      ${plan ? planBody(plan) : emptyState()}`;
  }

  /* ---------- actions ---------- */
  const step = (n) => {
    const plan = M.planFor(monday);
    if (plan && n > 0) monday = U.addDays(plan.end, 1);
    else if (plan && n < 0) monday = U.addDays(plan.start, -7);
    else monday = U.addDays(monday, 7 * n);
    const landed = M.planFor(monday);
    if (landed) monday = landed.start;
    FF.app.render();
  };
  FF.actions['plan-prev'] = () => step(-1);
  FF.actions['plan-next'] = () => step(1);
  FF.actions['plan-jump-today'] = () => {
    monday = U.mondayOf(U.today());
    const p = M.planFor(monday);
    if (p) monday = p.start;
    FF.app.render();
  };

  function createPlan(weeks) {
    const end = U.addDays(monday, weeks * 7 - 1);
    if (overlaps(monday, end)) {
      FF.ui.toast('Those dates overlap another plan', 'error');
      return null;
    }
    return S.upsert('plans', { start: monday, end, weeks, notes: '' });
  }

  FF.actions['plan-create'] = (el) => {
    const plan = createPlan(Number(el.dataset.weeks));
    if (plan) FF.ui.toast(plan.weeks === 2 ? 'Fortnight plan created' : 'Week plan created', 'ok');
  };

  FF.actions['plan-copy'] = (el) => {
    const from = S.get('plans', el.dataset.from);
    if (!from) return;
    const plan = createPlan(from.weeks);
    if (!plan) return;
    const shift = Math.round((U.parseYmd(plan.start) - U.parseYmd(from.start)) / 86400000);
    M.itemsFor(from.id).forEach((i) =>
      S.upsert('planItems', {
        planId: plan.id, planStart: plan.start, task: i.task, type: i.type, taskId: i.taskId,
        targetMinutes: i.targetMinutes, day: i.day ? U.addDays(i.day, shift) : '', done: false, notes: i.notes,
      }, { silent: true })
    );
    S.emit();
    FF.ui.toast('Plan copied. Adjust anything that\'s different.', 'ok');
  };

  FF.actions['plan-delete'] = async (el) => {
    const plan = S.get('plans', el.dataset.plan);
    if (!plan) return;
    const ok = await FF.ui.confirm('Delete this plan?', 'The planned tasks and targets go. Your logged time stays in the log.');
    if (!ok) return;
    M.itemsFor(plan.id).forEach((i) => {
      M.logFor(i.id).forEach((e) => S.upsert('log', { ...e, planItemId: '', planId: '' }, { silent: true }));
      S.remove('planItems', i.id, { silent: true });
    });
    S.remove('plans', plan.id);
    FF.ui.toast('Plan deleted');
  };

  FF.actions['plan-item-new'] = (el) => {
    const plan = S.get('plans', el.dataset.plan);
    if (!S.all('tasks').length) FF.ui.toast('Tip: set up repeatable tasks on the Tasks tab');
    if (plan) FF.ui.planItemForm(plan);
  };
  FF.actions['plan-item-edit'] = (el) => {
    const item = S.get('planItems', el.dataset.id);
    const plan = item && S.get('plans', item.planId);
    if (plan) FF.ui.planItemForm(plan, item);
  };
  FF.changes['plan-item-done'] = (el) => {
    const item = S.get('planItems', el.dataset.id);
    if (item) S.upsert('planItems', { ...item, done: el.checked });
  };

  FF.actions['plan-add-all'] = (el) => {
    const plan = S.get('plans', el.dataset.plan);
    const tasks = M.activeTasks();
    if (!tasks.length) {
      FF.ui.toast('No repeatable tasks yet. Add some on the Tasks tab.', 'error');
      return;
    }
    const have = new Set(M.itemsFor(plan.id).map((i) => i.taskId));
    const toAdd = tasks.filter((t) => !have.has(t.id));
    toAdd.forEach((t) =>
      S.upsert('planItems', {
        planId: plan.id, planStart: plan.start, task: t.name, type: 'Repeatable', taskId: t.id,
        targetMinutes: t.targetMinutes || 0, day: '', done: false, notes: '',
      }, { silent: true })
    );
    S.emit();
    FF.ui.toast(toAdd.length ? `Added ${toAdd.length} task${toAdd.length === 1 ? '' : 's'}` : 'All repeatable tasks are already in this plan', 'ok');
  };

  return { title: 'Plan', render };
})();
