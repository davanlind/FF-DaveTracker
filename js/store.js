/* F&F Tracker — where the data lives in the browser.
 *
 * Five "tables" (same names as the Google Sheet tabs, see apps-script/Code.gs):
 *   tasks      repeatable tasks you do often (with a default target time)
 *   plans      a week or fortnight, always starting on a Monday
 *   planItems  tasks planned inside a plan, each with a target time
 *   log        time actually worked (one row per stint of work)
 *   active     tasks currently being timed or on hold (see js/timers.js)
 *
 * Every change is saved to localStorage straight away AND added to a "queue".
 * FF.sync sends the queue to the Google Sheet when a connection is set up,
 * so the app keeps working offline and catches up later.
 */
FF.store = (() => {
  const KEYS = {
    data: 'ff.data.v1',
    queue: 'ff.queue.v1',
    settings: 'ff.settings.v1',
    oldTimer: 'ff.timer.v1', // v1.0 single timer; moved into 'active' on load
  };
  const TABLES = ['tasks', 'plans', 'planItems', 'log', 'active'];
  const PREFIX = { tasks: 'task', plans: 'plan', planItems: 'item', log: 'log', active: 'act' };

  const load = (k, fallback) => {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v ?? fallback;
    } catch (e) {
      return fallback;
    }
  };
  const save = (k, v) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {
      console.warn('Could not save to this browser', e);
    }
  };

  const emptyData = () => ({ tasks: [], plans: [], planItems: [], log: [], active: [] });

  let data = Object.assign(emptyData(), load(KEYS.data, {}));
  let queue = load(KEYS.queue, []);
  let settings = Object.assign(
    { url: '', key: '', lastSync: null, connected: false, lastWorked: 'Solo' },
    load(KEYS.settings, {})
  );

  const listeners = new Set();
  const persist = () => {
    save(KEYS.data, data);
    save(KEYS.queue, queue);
  };
  const emit = (what = 'data') => listeners.forEach((fn) => fn(what));

  /* ---------- cleaning up records (e.g. ones read back from the Sheet) ---------- */
  const str = (v) => (v == null ? '' : String(v));
  const num = (v, d = 0) => (v === '' || v == null || isNaN(Number(v)) ? d : Number(v));
  const bool = (v) => v === true || v === 'TRUE' || v === 'true' || v === 1;

  const normalize = {
    tasks: (r) => ({
      id: str(r.id), name: str(r.name), category: str(r.category),
      targetMinutes: num(r.targetMinutes), active: r.active == null || r.active === '' ? true : bool(r.active),
      notes: str(r.notes), updatedAt: str(r.updatedAt),
    }),
    plans: (r) => ({
      id: str(r.id), start: str(r.start), end: str(r.end), weeks: num(r.weeks, 1),
      notes: str(r.notes), updatedAt: str(r.updatedAt),
    }),
    planItems: (r) => ({
      id: str(r.id), planId: str(r.planId), planStart: str(r.planStart), taskId: str(r.taskId),
      task: str(r.task), type: str(r.type) || (r.taskId ? 'Repeatable' : 'One-off'),
      targetMinutes: num(r.targetMinutes), day: str(r.day), done: bool(r.done),
      notes: str(r.notes), updatedAt: str(r.updatedAt),
    }),
    active: (r) => {
      let segs = r.segments;
      if (typeof segs === 'string') {
        try { segs = JSON.parse(segs); } catch (e) { segs = []; }
      }
      return {
        id: str(r.id), task: str(r.task), type: str(r.type) || (r.taskId ? 'Repeatable' : 'One-off'),
        taskId: str(r.taskId), planItemId: str(r.planItemId), planId: str(r.planId),
        segments: (Array.isArray(segs) ? segs : []).map((g) => ({ start: str(g.start), end: str(g.end) })).filter((g) => g.start),
        updatedAt: str(r.updatedAt),
      };
    },
    log: (r) => ({
      id: str(r.id), date: str(r.date), start: str(r.start), end: str(r.end),
      minutes: num(r.minutes), hours: num(r.hours), task: str(r.task),
      type: str(r.type) || (r.taskId ? 'Repeatable' : 'One-off'),
      worked: str(r.worked) || 'Solo', helpers: str(r.helpers), notes: str(r.notes),
      planId: str(r.planId), planItemId: str(r.planItemId), taskId: str(r.taskId),
      updatedAt: str(r.updatedAt),
    }),
  };

  /* ---------- reading ---------- */
  const all = (table) => data[table];
  const get = (table, id) => data[table].find((r) => r.id === id) || null;

  /* ---------- writing ---------- */
  function upsert(table, record, { silent = false } = {}) {
    if (!record.id) record.id = FF.util.uid(PREFIX[table]);
    if (table === 'log') record.hours = Math.round((Number(record.minutes) / 60) * 100) / 100;
    const rec = normalize[table]({ ...record, updatedAt: new Date().toISOString() });
    const arr = data[table];
    const i = arr.findIndex((r) => r.id === rec.id);
    if (i >= 0) arr[i] = rec;
    else arr.push(rec);
    queue.push({ op: 'upsert', table, record: rec });
    persist();
    if (!silent) emit();
    FF.sync && FF.sync.schedule();
    return rec;
  }

  function remove(table, id, { silent = false } = {}) {
    data[table] = data[table].filter((r) => r.id !== id);
    queue.push({ op: 'delete', table, id });
    persist();
    if (!silent) emit();
    FF.sync && FF.sync.schedule();
  }

  /* ---------- the sync queue ---------- */
  const pendingCount = () => queue.length;
  /** Copy of the queue, with repeat changes to the same record squashed to the last one. */
  function queueSnapshot() {
    const n = queue.length;
    const last = new Map();
    queue.forEach((op, i) => last.set(`${op.table}:${op.op === 'delete' ? op.id : op.record.id}`, i));
    const ops = queue.filter((op, i) => last.get(`${op.table}:${op.op === 'delete' ? op.id : op.record.id}`) === i);
    return { n, ops };
  }
  /** Remove the first n queue entries after they reached the Sheet. */
  function ackQueue(n) {
    queue = queue.slice(n);
    persist();
  }
  /** Queue every local record — used the first time a device connects to a Sheet. */
  function queueEverything() {
    TABLES.forEach((t) => data[t].forEach((r) => queue.push({ op: 'upsert', table: t, record: r })));
    persist();
  }

  /** Replace local data with what the Sheet holds, then re-apply changes not yet sent. */
  function replaceAll(remote) {
    const next = emptyData();
    TABLES.forEach((t) => {
      next[t] = (remote[t] || []).map(normalize[t]).filter((r) => r.id);
    });
    queue.forEach((op) => {
      const arr = next[op.table];
      if (op.op === 'delete') {
        next[op.table] = arr.filter((r) => r.id !== op.id);
      } else {
        const i = arr.findIndex((r) => r.id === op.record.id);
        if (i >= 0) arr[i] = op.record;
        else arr.push(op.record);
      }
    });
    data = next;
    persist();
    emit();
  }

  /** Restore from a backup file. Every record is queued so the Sheet gets it too. */
  function importBackup(obj) {
    const next = emptyData();
    TABLES.forEach((t) => {
      next[t] = (obj[t] || []).map(normalize[t]).filter((r) => r.id);
    });
    data = next;
    queue = [];
    queueEverything();
    emit();
    FF.sync && FF.sync.schedule();
  }
  const exportBackup = () => ({ app: 'FF Tracker', version: FF.VERSION, exportedAt: new Date().toISOString(), ...data });

  /* ---------- settings ---------- */
  const getSettings = () => ({ ...settings });
  function setSettings(patch) {
    settings = { ...settings, ...patch };
    save(KEYS.settings, settings);
    emit('status');
  }

  /* ---------- moving a v1.0 running timer into the new 'active' table ---------- */
  (function migrateOldTimer() {
    const old = load(KEYS.oldTimer, null);
    if (!old || !old.startedAt) return;
    const rec = normalize.active({
      id: FF.util.uid('act'), task: old.task, type: old.type, taskId: old.taskId,
      planItemId: old.planItemId, planId: old.planId, segments: [{ start: old.startedAt, end: '' }],
      updatedAt: new Date().toISOString(),
    });
    data.active.push(rec);
    queue.push({ op: 'upsert', table: 'active', record: rec });
    persist();
    try { localStorage.removeItem(KEYS.oldTimer); } catch (e) { /* ignore */ }
  })();

  const subscribe = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  return {
    TABLES, all, get, upsert, remove,
    pendingCount, queueSnapshot, ackQueue, queueEverything, replaceAll,
    importBackup, exportBackup,
    settings: getSettings, setSettings,
    subscribe, emit,
  };
})();

/* ---------- questions the screens ask about the data ---------- */
FF.model = (() => {
  const U = FF.util;
  const S = FF.store;

  const activeTasks = () =>
    S.all('tasks').filter((t) => t.active).sort((a, b) => a.name.localeCompare(b.name));

  const plansSorted = () => S.all('plans').slice().sort((a, b) => b.start.localeCompare(a.start));

  /** The plan whose dates include this day, if any. */
  const planFor = (date) => S.all('plans').find((p) => p.start <= date && date <= p.end) || null;

  const planDays = (plan) => U.dateRange(plan.start, plan.end);

  const itemsFor = (planId) =>
    S.all('planItems')
      .filter((i) => i.planId === planId)
      .sort((a, b) => (a.day || '0').localeCompare(b.day || '0') || a.task.localeCompare(b.task));

  const logFor = (planItemId) => S.all('log').filter((e) => e.planItemId === planItemId);
  const actualFor = (planItemId) => U.sum(logFor(planItemId), (e) => e.minutes);

  const logBetween = (start, end) =>
    S.all('log')
      .filter((e) => e.date >= start && e.date <= end)
      .sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start));

  /** How a planned task is going against its target. */
  function statusOf(item) {
    const actual = actualFor(item.id);
    const target = item.targetMinutes || 0;
    const diff = actual - target;
    let key, label;
    if (item.done && target && actual <= target) { key = 'hit'; label = 'Hit target'; }
    else if (item.done && target && actual > target) { key = 'over'; label = `Over by ${U.fmtMins(diff)}`; }
    else if (item.done) { key = 'hit'; label = 'Finished'; }
    else if (target && actual > target) { key = 'over'; label = `Over by ${U.fmtMins(diff)}`; }
    else if (actual > 0) { key = 'progress'; label = 'In progress'; }
    else { key = 'todo'; label = 'Not started'; }
    return { key, label, actual, target, diff };
  }

  /**
   * Which planned item should a new log entry count towards?
   * Prefers an unfinished item for the same repeatable task on that day, then any day.
   */
  function matchPlanItem(taskId, date) {
    if (!taskId) return null;
    const plan = planFor(date);
    if (!plan) return null;
    const items = itemsFor(plan.id).filter((i) => i.taskId === taskId);
    return (
      items.find((i) => !i.done && i.day === date) ||
      items.find((i) => !i.done && !i.day) ||
      items.find((i) => !i.done) ||
      items[0] ||
      null
    );
  }

  const soloHelpSplit = (entries) => ({
    solo: U.sum(entries.filter((e) => e.worked !== 'With help'), (e) => e.minutes),
    help: U.sum(entries.filter((e) => e.worked === 'With help'), (e) => e.minutes),
  });

  return {
    activeTasks, plansSorted, planFor, planDays, itemsFor, logFor, actualFor,
    logBetween, statusOf, matchPlanItem, soloHelpSplit,
  };
})();
