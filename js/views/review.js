/* Review screen: did you hit the targets for a plan? */
FF.views.review = (() => {
  const U = FF.util;
  const S = FF.store;
  const M = FF.model;
  const esc = U.esc;

  let planId = null; // null = the current plan (or most recent)

  function pickPlan() {
    const plans = M.plansSorted();
    if (planId && S.get('plans', planId)) return S.get('plans', planId);
    return M.planFor(U.today()) || plans.find((p) => p.start <= U.today()) || plans[0] || null;
  }

  function render() {
    const plans = M.plansSorted();
    const plan = pickPlan();
    if (!plan) {
      return `
        <div class="page-head"><h1>Review</h1></div>
        <section class="card empty"><h3>Nothing to review yet</h3>
          <p class="muted">Make a plan with target times first, then log your work against it.</p>
          <a class="btn primary" href="#plan">Make a plan</a></section>`;
    }
    const items = M.itemsFor(plan.id);
    const statuses = items.map((i) => ({ item: i, st: M.statusOf(i) }));
    const target = U.sum(statuses, (x) => x.st.target);
    const actualPlanned = U.sum(statuses, (x) => x.st.actual);
    const finished = statuses.filter((x) => x.item.done);
    const hit = finished.filter((x) => x.st.key === 'hit').length;
    const periodLog = M.logBetween(plan.start, plan.end);
    const unplanned = periodLog.filter((e) => !e.planItemId);
    const split = M.soloHelpSplit(periodLog);
    const diff = actualPlanned - target;

    const planLabel = (p) => `${U.fmtDate(p.start, { day: 'numeric', month: 'short' })} – ${U.fmtDate(p.end, { day: 'numeric', month: 'short', year: 'numeric' })}${p.weeks === 2 ? ' (fortnight)' : ''}`;

    const rows = statuses
      .slice()
      .sort((a, b) => ['over', 'progress', 'todo', 'hit'].indexOf(a.st.key) - ['over', 'progress', 'todo', 'hit'].indexOf(b.st.key))
      .map(({ item, st }) => {
        const pct = st.target ? Math.min(100, (st.actual / st.target) * 100) : 0;
        const s = M.soloHelpSplit(M.logFor(item.id));
        return `
        <li class="review-row">
          <div class="review-top">
            <button class="as-btn item-name" data-action="plan-item-edit" data-id="${esc(item.id)}">${esc(item.task)}</button>
            <span class="status-pill ${st.key}">${esc(st.label)}</span>
          </div>
          <div class="bar ${st.key}"><span style="width:${pct}%"></span></div>
          <div class="review-nums small">
            <span>Target <b>${U.fmtMins(st.target)}</b></span>
            <span>Actual <b>${U.fmtMins(st.actual)}</b></span>
            <span class="${st.diff > 0 ? 'neg' : 'pos'}">${st.diff > 0 ? '+' : ''}${U.fmtMins(st.diff)}</span>
          </div>
          ${st.actual ? `<div class="muted small">Solo ${U.fmtMins(s.solo)} · With help ${U.fmtMins(s.help)}</div>` : ''}
        </li>`;
      })
      .join('');

    const unplannedGroups = [...U.groupBy(unplanned, (e) => e.task).entries()]
      .map(([name, list]) => ({ name, mins: U.sum(list, (e) => e.minutes), n: list.length }))
      .sort((a, b) => b.mins - a.mins);

    const days = M.planDays(plan);
    const perDay = days.map((d) => ({ d, mins: U.sum(periodLog.filter((e) => e.date === d), (e) => e.minutes) }));
    const maxDay = Math.max(60, ...perDay.map((x) => x.mins));

    return `
      <div class="page-head"><h1>Review</h1></div>
      <div class="toolbar">
        <select data-change="review-plan" aria-label="Plan">
          ${plans.map((p) => `<option value="${esc(p.id)}" ${p.id === plan.id ? 'selected' : ''}>${esc(planLabel(p))}</option>`).join('')}
        </select>
      </div>
      <section class="stats">
        <div class="stat"><span class="stat-num">${U.fmtMins(target)}</span><span class="stat-label">Target</span></div>
        <div class="stat"><span class="stat-num">${U.fmtMins(actualPlanned)}</span><span class="stat-label">Actual</span></div>
        <div class="stat ${diff > 0 ? 'neg' : 'pos'}"><span class="stat-num">${diff > 0 ? '+' : ''}${U.fmtMins(diff)}</span><span class="stat-label">${diff > 0 ? 'Over target' : 'Under target'}</span></div>
        <div class="stat"><span class="stat-num">${hit}/${finished.length}</span><span class="stat-label">Finished on target</span></div>
      </section>

      <section class="card">
        <div class="card-head"><h3>Planned tasks</h3><span class="small">${finished.length}/${items.length} finished</span></div>
        ${items.length ? `<ul class="review-list">${rows}</ul>` : '<p class="muted">No tasks in this plan.</p>'}
        <p class="hint">“Hit target” means it's marked finished and took no longer than the target.</p>
      </section>

      <section class="card">
        <div class="card-head"><h3>Each day</h3><span class="small">${U.fmtMins(U.sum(perDay, (x) => x.mins))} total</span></div>
        <ul class="day-bars">
          ${perDay.map((x) => `<li><button class="as-btn day-label day-link" data-action="open-day" data-date="${esc(x.d)}">${esc(U.fmtDate(x.d, { weekday: 'short', day: 'numeric' }))}</button><span class="day-bar"><span style="width:${(x.mins / maxDay) * 100}%"></span></span><span class="day-val">${x.mins ? U.fmtMins(x.mins) : '–'}</span></li>`).join('')}
        </ul>
        <p class="muted small">Solo ${U.fmtMins(split.solo)} · With help ${U.fmtMins(split.help)}</p>
      </section>

      <section class="card">
        <div class="card-head"><h3>Unplanned work</h3><span class="small">${U.fmtMins(U.sum(unplanned, (e) => e.minutes))}</span></div>
        ${unplannedGroups.length
          ? `<ul class="simple-list">${unplannedGroups.map((g) => `<li><span>${esc(g.name)} <span class="muted small">×${g.n}</span></span><b>${U.fmtMins(g.mins)}</b></li>`).join('')}</ul>`
          : '<p class="muted">Everything logged in this period was planned.</p>'}
      </section>`;
  }

  FF.changes['review-plan'] = (el) => {
    planId = el.value;
    FF.app.render();
  };

  return { title: 'Review', render };
})();
