/* Tasks screen: the list of repeatable tasks (things you do again and again). */
FF.views.tasks = (() => {
  const U = FF.util;
  const S = FF.store;
  const esc = U.esc;

  function render() {
    const tasks = S.all('tasks').slice().sort((a, b) => (a.category || '~').localeCompare(b.category || '~') || a.name.localeCompare(b.name));
    const active = tasks.filter((t) => t.active);
    const hidden = tasks.filter((t) => !t.active);
    const groups = U.groupBy(active, (t) => t.category || 'Other');
    const row = (t) => `
      <li><button class="task-row" data-action="task-edit" data-id="${esc(t.id)}">
        <span class="item-name">${esc(t.name)}</span>
        <span class="muted small">${t.targetMinutes ? `Target ${U.fmtMins(t.targetMinutes)}` : 'No default target'}</span>
      </button></li>`;
    return `
      <div class="page-head"><h1>Repeatable tasks</h1>
        <button class="btn primary" data-action="task-new">＋ New task</button></div>
      <p class="muted">Tasks you do often. Give each a usual target time and it fills in automatically when you plan. One-off jobs don't go here; add those straight from the timer or a plan.</p>
      ${active.length
        ? [...groups.entries()].map(([cat, list]) => `
          <section class="card"><div class="card-head"><h3>${esc(cat)}</h3></div><ul class="tasks">${list.map(row).join('')}</ul></section>`).join('')
        : `<section class="card empty"><h3>No repeatable tasks yet</h3><p class="muted">Some ideas: “Showroom store run”, “Marketing photoshoot”, “Warehouse stock check”.</p></section>`}
      ${hidden.length ? `<section class="card"><div class="card-head"><h3>Hidden</h3></div><ul class="tasks">${hidden.map(row).join('')}</ul></section>` : ''}`;
  }

  function taskForm(task = null) {
    const isEdit = !!task;
    task = task || { name: '', category: '', targetMinutes: '', active: true, notes: '' };
    const cats = [...new Set(S.all('tasks').map((t) => t.category).filter(Boolean))];
    FF.ui.modal({
      title: isEdit ? 'Edit task' : 'New repeatable task',
      body: `
        <div class="field"><label for="t-name">Task name</label>
          <input id="t-name" name="name" value="${esc(task.name)}" required placeholder="e.g. Showroom store run" autocomplete="off"></div>
        <div class="row2">
          <div class="field"><label for="t-cat">Category <span class="muted">(optional)</span></label>
            <input id="t-cat" name="category" value="${esc(task.category)}" list="t-cats" placeholder="e.g. Logistics" autocomplete="off">
            <datalist id="t-cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
          <div class="field"><label for="t-target">Usual target time</label>
            <input id="t-target" name="target" value="${task.targetMinutes ? esc(U.fmtMins(task.targetMinutes)) : ''}" placeholder="e.g. 1h 30m" autocomplete="off"></div>
        </div>
        <div class="field"><label class="check"><input type="checkbox" name="active" ${task.active ? 'checked' : ''}><span>Show this task in lists</span></label></div>
        <div class="field"><label for="t-notes">Notes <span class="muted">(optional)</span></label>
          <textarea id="t-notes" name="notes" rows="2">${esc(task.notes)}</textarea></div>`,
      submitLabel: isEdit ? 'Save changes' : 'Add task',
      extraButtons: isEdit
        ? [{
            label: 'Delete', cls: 'danger',
            onClick: async () => {
              const ok = await FF.ui.confirm('Delete this task?', 'Past log entries and plans keep the task name. If you might use it again, untick “Show this task in lists” instead.');
              if (!ok) return false;
              S.remove('tasks', task.id);
              FF.ui.toast('Task deleted');
            },
          }]
        : [],
      onSubmit: (form) => {
        const f = form.elements;
        const name = f.name.value.trim();
        if (!name) return FF.ui.invalid(form, 'name', 'Give the task a name.');
        const target = f.target.value.trim() ? U.parseDuration(f.target.value) : 0;
        if (target == null) return FF.ui.invalid(form, 'target', "Couldn't read that time. Try 90, 1h 30m or 1.5h.");
        const saved = S.upsert('tasks', { ...task, name, category: f.category.value.trim(), targetMinutes: target, active: f.active.checked, notes: f.notes.value.trim() });
        if (isEdit && task.name !== name) {
          // keep names in step on plans that haven't finished yet
          S.all('planItems').filter((i) => i.taskId === saved.id && !i.done).forEach((i) => S.upsert('planItems', { ...i, task: name }, { silent: true }));
          S.emit();
        }
        FF.ui.toast(isEdit ? 'Task updated' : `Added ${name}`, 'ok');
      },
    });
  }

  FF.actions['task-new'] = () => taskForm();
  FF.actions['task-edit'] = (el) => {
    const t = S.get('tasks', el.dataset.id);
    if (t) taskForm(t);
  };

  return { title: 'Tasks', render };
})();
