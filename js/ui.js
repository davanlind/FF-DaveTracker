/* F&F Tracker — shared bits of screen: pop-up forms (modals), toasts,
 * and the forms used by more than one screen (log entry, plan item). */
FF.ui = (() => {
  const U = FF.util;
  const S = FF.store;
  const M = FF.model;
  const esc = U.esc;

  /* ---------- toast (little message at the bottom) ---------- */
  let toastTimer = null;
  function toast(msg, kind = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = 'toast'), 2800);
  }

  /* ---------- modal ---------- */
  /**
   * modal({ title, body, submitLabel, onSubmit(form), extraButtons:[{label, cls, onClick}], onOpen(form) })
   * onSubmit returns false to keep the modal open (e.g. when something is missing).
   */
  function modal({ title, body, submitLabel = 'Save', onSubmit, extraButtons = [], onOpen, cancelLabel = 'Cancel', dialogId = 'modal' }) {
    const dlg = document.getElementById(dialogId);
    if (dlg.open) dlg.close();
    dlg.innerHTML = `
      <form class="modal-form" novalidate>
        <div class="modal-head">
          <h2>${esc(title)}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">✕</button>
        </div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">
          ${extraButtons.map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-extra="${i}">${esc(b.label)}</button>`).join('')}
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-close>${esc(cancelLabel)}</button>
          ${onSubmit ? `<button type="submit" class="btn primary">${esc(submitLabel)}</button>` : ''}
        </div>
      </form>`;
    const form = dlg.querySelector('form');
    const close = () => dlg.open && dlg.close();
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    extraButtons.forEach((b, i) =>
      dlg.querySelector(`[data-extra="${i}"]`).addEventListener('click', async () => {
        const keepOpen = (await b.onClick(form)) === false;
        if (!keepOpen) close();
      })
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!onSubmit) return close();
      const keepOpen = (await onSubmit(form)) === false;
      if (!keepOpen) close();
    });
    dlg.onclick = (e) => {
      if (e.target === dlg) close(); // tap outside to close
    };
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    if (onOpen) onOpen(form);
    const first = form.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), select, textarea');
    if (first && window.matchMedia('(min-width: 700px)').matches) first.focus();
    return { form, close };
  }

  function confirm(title, message, okLabel = 'Delete') {
    return new Promise((resolve) => {
      let answered = false;
      const dlg = document.getElementById('confirm-modal');
      dlg.addEventListener('close', () => !answered && resolve(false), { once: true });
      modal({
        dialogId: 'confirm-modal',
        title,
        body: `<p>${esc(message)}</p>`,
        submitLabel: okLabel,
        onSubmit: () => {
          answered = true;
          resolve(true);
        },
      });
    });
  }

  /** Show a field error and keep the modal open. */
  function invalid(form, name, msg) {
    const input = form.elements[name];
    const field = input && (input.closest ? input.closest('.field') : input[0]?.closest('.field'));
    form.querySelectorAll('.field-error').forEach((n) => n.remove());
    if (field) {
      field.insertAdjacentHTML('beforeend', `<div class="field-error">${esc(msg)}</div>`);
      field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else toast(msg, 'error');
    return false;
  }

  /* ---------- the "which task?" dropdown ---------- */
  /**
   * Options for picking a task. Values:
   *   "p:<planItemId>"  a task planned in the plan that covers `date`
   *   "t:<taskId>"      a repeatable task
   *   "__oneoff"        type a new one-off task name
   */
  function taskOptions(date, selected = '', { includePlan = true } = {}) {
    const plan = includePlan ? M.planFor(date) : null;
    const planned = plan ? M.itemsFor(plan.id).filter((i) => !i.done || `p:${i.id}` === selected) : [];
    const tasks = M.activeTasks();
    const opt = (v, label) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(label)}</option>`;
    let html = `<option value="" ${selected ? '' : 'selected'} disabled>Choose a task…</option>`;
    if (planned.length) {
      html += `<optgroup label="Planned ${plan.weeks === 2 ? 'this fortnight' : 'this week'}">`;
      html += planned
        .map((i) => opt(`p:${i.id}`, `${i.task}${i.day ? ` · ${U.fmtDate(i.day, { weekday: 'short' })}` : ''} (target ${U.fmtMins(i.targetMinutes)})`))
        .join('');
      html += `</optgroup>`;
    }
    if (tasks.length) {
      html += `<optgroup label="Repeatable tasks">${tasks.map((t) => opt(`t:${t.id}`, t.name)).join('')}</optgroup>`;
    }
    html += `<optgroup label="Something else">${opt('__oneoff', '＋ One-off task (type a name)')}</optgroup>`;
    return html;
  }

  /** Turn a dropdown value into { task, type, taskId, planItemId, planId }. */
  function resolveTaskChoice(value, oneOffName, date) {
    if (value && value.startsWith('p:')) {
      const item = S.get('planItems', value.slice(2));
      if (item) return { task: item.task, type: item.type, taskId: item.taskId, planItemId: item.id, planId: item.planId };
    }
    if (value && value.startsWith('t:')) {
      const t = S.get('tasks', value.slice(2));
      if (t) {
        const item = M.matchPlanItem(t.id, date);
        return { task: t.name, type: 'Repeatable', taskId: t.id, planItemId: item ? item.id : '', planId: item ? item.planId : '' };
      }
    }
    if (value === '__oneoff' && oneOffName.trim()) {
      return { task: oneOffName.trim(), type: 'One-off', taskId: '', planItemId: '', planId: '' };
    }
    return null;
  }

  /** Show/hide the one-off name box when the dropdown changes. */
  function wireOneOff(form, selectName = 'pick', boxSelector = '.oneoff-field') {
    const sel = form.elements[selectName];
    const box = form.querySelector(boxSelector);
    const sync = () => {
      const show = sel.value === '__oneoff';
      box.hidden = !show;
      if (show) box.querySelector('input').focus();
    };
    sel.addEventListener('change', sync);
    box.hidden = sel.value !== '__oneoff';
  }

  /* ---------- solo / with help ---------- */
  function workedField(worked = 'Solo', helpers = '') {
    return `
      <div class="field">
        <span class="label">Did you work solo or have help?</span>
        <div class="segmented" role="radiogroup">
          <label><input type="radio" name="worked" value="Solo" ${worked !== 'With help' ? 'checked' : ''}><span>Solo</span></label>
          <label><input type="radio" name="worked" value="With help" ${worked === 'With help' ? 'checked' : ''}><span>Had help</span></label>
        </div>
      </div>
      <div class="field helpers-field" ${worked === 'With help' ? '' : 'hidden'}>
        <label for="f-helpers">Who helped? <span class="muted">(optional)</span></label>
        <input id="f-helpers" name="helpers" value="${esc(helpers)}" placeholder="e.g. Sam, Priya" autocomplete="off">
      </div>`;
  }
  function wireWorked(form) {
    const box = form.querySelector('.helpers-field');
    form.querySelectorAll('input[name=worked]').forEach((r) =>
      r.addEventListener('change', () => (box.hidden = form.elements.worked.value !== 'With help'))
    );
  }

  /* ---------- log entry form (used by timer stop, add entry, edit entry) ---------- */
  /**
   * entryForm({ entry, mode })
   *   mode 'stop' – finishing a timed task (entry.activeId = the open task in FF.timers)
   *   mode 'new'  – logging time by hand
   *   mode 'edit' – changing an existing log entry
   */
  function entryForm({ entry = {}, mode = 'new' } = {}) {
    const isStop = mode === 'stop';
    const date = entry.date || U.today();
    const end = entry.end || U.nowHm();
    const minutes = entry.minutes != null ? entry.minutes : 30;
    const start = entry.start || U.fromMins(U.toMins(end) - minutes);
    const selected = entry.planItemId ? `p:${entry.planItemId}` : entry.taskId ? `t:${entry.taskId}` : entry.task ? '__oneoff' : '';
    const linkedItem = entry.planItemId ? S.get('planItems', entry.planItemId) : null;
    const settings = S.settings();
    const worked = entry.worked || settings.lastWorked || 'Solo';

    const taskBlock = isStop
      ? `<div class="field"><span class="label">Task</span><div class="readonly">${esc(entry.task)}${entry.type === 'One-off' ? ' <span class="badge">One-off</span>' : ''}</div></div>`
      : `<div class="field">
           <label for="f-pick">Task</label>
           <select id="f-pick" name="pick" required>${taskOptions(date, selected)}</select>
         </div>
         <div class="field oneoff-field" hidden>
           <label for="f-oneoff">One-off task name</label>
           <input id="f-oneoff" name="oneoff" value="${esc(selected === '__oneoff' ? entry.task : '')}" placeholder="e.g. Unload surprise delivery" autocomplete="off">
         </div>`;

    const body = `
      ${taskBlock}
      <div class="field">
        <label for="f-date">Date</label>
        <input id="f-date" type="date" name="date" value="${esc(date)}" required>
      </div>
      <div class="row3">
        <div class="field"><label for="f-start">Start</label><input id="f-start" type="time" name="start" value="${esc(start)}" required></div>
        <div class="field"><label for="f-end">Finish</label><input id="f-end" type="time" name="end" value="${esc(end)}" required></div>
        <div class="field"><label for="f-dur">How long</label><input id="f-dur" name="duration" value="${esc(U.fmtMins(minutes))}" inputmode="text" autocomplete="off"></div>
      </div>
      <p class="hint">Change Start/Finish, or type how long (like <b>90</b>, <b>1h 30m</b> or <b>1.5h</b>).</p>
      ${workedField(worked, entry.helpers)}
      <div class="field done-field" ${linkedItem ? '' : 'hidden'}>
        <label class="check"><input type="checkbox" name="done" ${linkedItem && linkedItem.done ? 'checked' : ''}>
          <span>This planned task is now <b>finished</b></span></label>
        <div class="hint plan-link-hint">${linkedItem ? `Counts towards: ${esc(linkedItem.task)} (target ${U.fmtMins(linkedItem.targetMinutes)})` : ''}</div>
      </div>
      <div class="field">
        <label for="f-notes">Notes <span class="muted">(optional)</span></label>
        <textarea id="f-notes" name="notes" rows="2" placeholder="Anything worth remembering">${esc(entry.notes)}</textarea>
      </div>`;

    const extra = [];
    if (mode === 'edit') {
      extra.push({
        label: 'Delete', cls: 'danger',
        onClick: async () => {
          const ok = await confirm('Delete this entry?', `${entry.task} on ${U.fmtDate(entry.date)} (${U.fmtMins(entry.minutes)}) will be removed.`);
          if (!ok) return false;
          S.remove('log', entry.id);
          toast('Entry deleted');
        },
      });
    }
    if (isStop) {
      extra.push({
        label: 'Discard', cls: 'danger ghost',
        onClick: async () => {
          const ok = await confirm('Throw away this timer?', 'The time will not be logged.', 'Discard');
          if (!ok) return false;
          if (entry.activeId) S.remove('active', entry.activeId);
          toast('Timer discarded');
        },
      });
    }

    modal({
      title: isStop ? 'Save this time' : mode === 'edit' ? 'Edit entry' : 'Log time',
      body,
      submitLabel: isStop ? 'Save' : mode === 'edit' ? 'Save changes' : 'Add entry',
      extraButtons: extra,
      cancelLabel: isStop ? 'Not yet' : 'Cancel',
      onOpen: (form) => {
        wireWorked(form);
        const f = form.elements;
        if (!isStop) {
          wireOneOff(form);
          const refreshLink = () => {
            const choice = resolveTaskChoice(f.pick.value, f.oneoff.value, f.date.value);
            const item = choice && choice.planItemId ? S.get('planItems', choice.planItemId) : null;
            form.querySelector('.done-field').hidden = !item;
            form.querySelector('.plan-link-hint').textContent = item ? `Counts towards: ${item.task} (target ${U.fmtMins(item.targetMinutes)})` : '';
            if (item) f.done.checked = item.done;
          };
          f.pick.addEventListener('change', refreshLink);
          f.date.addEventListener('change', () => {
            const keep = f.pick.value;
            f.pick.innerHTML = taskOptions(f.date.value, keep);
            if (!f.pick.value && keep.startsWith('t:')) f.pick.value = keep;
            refreshLink();
          });
        }
        const updateDur = () => (f.duration.value = U.fmtMins(U.minutesBetween(f.start.value, f.end.value)));
        f.start.addEventListener('change', updateDur);
        f.end.addEventListener('change', updateDur);
        f.duration.addEventListener('change', () => {
          const m = U.parseDuration(f.duration.value);
          if (m != null) {
            f.end.value = U.fromMins(U.toMins(f.start.value) + m);
            f.duration.value = U.fmtMins(m);
          }
        });
      },
      onSubmit: (form) => {
        const f = form.elements;
        let choice;
        if (isStop) {
          choice = { task: entry.task, type: entry.type, taskId: entry.taskId, planItemId: entry.planItemId, planId: entry.planId };
        } else {
          if (!f.pick.value) return invalid(form, 'pick', 'Choose a task first.');
          choice = resolveTaskChoice(f.pick.value, f.oneoff.value, f.date.value);
          if (!choice) return invalid(form, 'oneoff', 'Type a name for the one-off task.');
        }
        if (!f.date.value) return invalid(form, 'date', 'Pick a date.');
        const typed = U.parseDuration(f.duration.value);
        const fromTimes = U.minutesBetween(f.start.value, f.end.value);
        const minutes = typed != null && typed !== fromTimes ? typed : fromTimes;
        if (!minutes || minutes <= 0) return invalid(form, 'duration', 'How long did it take? It needs to be more than 0 minutes.');
        const end = U.fromMins(U.toMins(f.start.value) + minutes);
        const worked = f.worked.value || 'Solo';

        S.upsert('log', {
          ...entry,
          ...choice,
          date: f.date.value,
          start: f.start.value,
          end,
          minutes,
          worked,
          helpers: worked === 'With help' ? f.helpers.value.trim() : '',
          notes: f.notes.value.trim(),
        });
        if (choice.planItemId) {
          const item = S.get('planItems', choice.planItemId);
          if (item && item.done !== f.done.checked) S.upsert('planItems', { ...item, done: f.done.checked });
        }
        S.setSettings({ lastWorked: worked });
        if (isStop && entry.activeId) S.remove('active', entry.activeId);
        toast(isStop ? `Logged ${U.fmtMins(minutes)} on ${choice.task}` : mode === 'edit' ? 'Entry updated' : 'Entry added', 'ok');
      },
    });
  }

  /* ---------- plan item form ---------- */
  function planItemForm(plan, item = null) {
    const isEdit = !!item;
    item = item || { planId: plan.id, targetMinutes: '', day: '', done: false, notes: '' };
    const selected = item.taskId ? `t:${item.taskId}` : item.task ? '__oneoff' : '';
    const days = M.planDays(plan);
    const body = `
      <div class="field">
        <label for="p-pick">Task</label>
        <select id="p-pick" name="pick" required>${taskOptions(plan.start, selected, { includePlan: false })}</select>
      </div>
      <div class="field oneoff-field" hidden>
        <label for="p-oneoff">One-off task name</label>
        <input id="p-oneoff" name="oneoff" value="${esc(selected === '__oneoff' ? item.task : '')}" placeholder="e.g. Christmas window shoot" autocomplete="off">
      </div>
      <div class="row2">
        <div class="field">
          <label for="p-target">Target time</label>
          <input id="p-target" name="target" value="${item.targetMinutes ? esc(U.fmtMins(item.targetMinutes)) : ''}" placeholder="e.g. 2h" autocomplete="off" required>
        </div>
        <div class="field">
          <label for="p-day">Day</label>
          <select id="p-day" name="day">
            <option value="">Any day</option>
            ${days.map((d) => `<option value="${d}" ${d === item.day ? 'selected' : ''}>${esc(U.fmtDate(d))}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="hint">Target = how long this is expected to take. Type <b>90</b>, <b>1h 30m</b> or <b>1.5h</b>.</p>
      ${isEdit ? `<div class="field"><label class="check"><input type="checkbox" name="done" ${item.done ? 'checked' : ''}><span>Finished</span></label></div>` : ''}
      <div class="field">
        <label for="p-notes">Notes <span class="muted">(optional)</span></label>
        <textarea id="p-notes" name="notes" rows="2">${esc(item.notes)}</textarea>
      </div>`;

    modal({
      title: isEdit ? 'Edit planned task' : 'Add to plan',
      body,
      submitLabel: isEdit ? 'Save changes' : 'Add',
      extraButtons: isEdit
        ? [{
            label: 'Remove', cls: 'danger',
            onClick: async () => {
              const logged = M.logFor(item.id).length;
              const ok = await confirm('Remove from plan?', logged
                ? `${item.task} has ${logged} log entr${logged === 1 ? 'y' : 'ies'}. They stay in your log but won't count towards this plan.`
                : `${item.task} will be removed from this plan.`, 'Remove');
              if (!ok) return false;
              M.logFor(item.id).forEach((e) => S.upsert('log', { ...e, planItemId: '', planId: '' }, { silent: true }));
              S.remove('planItems', item.id);
              toast('Removed from plan');
            },
          }]
        : [],
      onOpen: (form) => {
        wireOneOff(form);
        form.elements.pick.addEventListener('change', () => {
          const v = form.elements.pick.value;
          if (v.startsWith('t:')) {
            const t = S.get('tasks', v.slice(2));
            if (t && t.targetMinutes && !form.elements.target.value) form.elements.target.value = U.fmtMins(t.targetMinutes);
            if (t && t.targetMinutes && !isEdit) form.elements.target.value = U.fmtMins(t.targetMinutes);
          }
        });
      },
      onSubmit: (form) => {
        const f = form.elements;
        if (!f.pick.value) return invalid(form, 'pick', 'Choose a task first.');
        let task, type, taskId;
        if (f.pick.value.startsWith('t:')) {
          const t = S.get('tasks', f.pick.value.slice(2));
          task = t.name; type = 'Repeatable'; taskId = t.id;
        } else {
          if (!f.oneoff.value.trim()) return invalid(form, 'oneoff', 'Type a name for the one-off task.');
          task = f.oneoff.value.trim(); type = 'One-off'; taskId = '';
        }
        const target = U.parseDuration(f.target.value);
        if (!target) return invalid(form, 'target', "Couldn't read that time. Try 90, 1h 30m or 1.5h.");
        const saved = S.upsert('planItems', {
          ...item, planId: plan.id, planStart: plan.start, task, type, taskId,
          targetMinutes: target, day: f.day.value, notes: f.notes.value.trim(),
          done: isEdit ? f.done.checked : false,
        });
        // keep the task name on old log entries in step if it changed
        if (isEdit) M.logFor(saved.id).forEach((e) => e.task !== task && S.upsert('log', { ...e, task, type, taskId }, { silent: true }));
        toast(isEdit ? 'Plan updated' : `Added ${task}`, 'ok');
      },
    });
  }

  return { toast, modal, confirm, invalid, taskOptions, resolveTaskChoice, wireOneOff, workedField, wireWorked, entryForm, planItemForm };
})();
