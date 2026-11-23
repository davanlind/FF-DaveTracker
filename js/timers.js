/* F&F Tracker — timers for tasks in progress.
 *
 * You can have several tasks open at once. At most ONE is running; the others are
 * "on hold". Each open task is a record in the 'active' table (synced to the Sheet's
 * "Active timers" tab) with a list of time segments:
 *   segments: [{ start: ISO time, end: ISO time or '' while running, location }, ...]
 * New segments take the device's current location (Today → 📍), unless the choice says otherwise.
 *
 * Starting or resuming a task pauses whatever was running (that's how you "switch").
 * Finishing a task turns each segment into its own Log row, so the Sheet shows the
 * real times you worked on it.
 */
FF.timers = (() => {
  const S = FF.store;
  const U = FF.util;
  const nowIso = () => new Date().toISOString();
  const last = (r) => r.segments[r.segments.length - 1];

  const isRunning = (r) => !!(r && r.segments.length && !last(r).end);
  const lastTouched = (r) => (last(r) ? last(r).end || last(r).start : '');

  /** Open tasks: the running one first, then the most recently paused. */
  const list = () =>
    S.all('active')
      .slice()
      .sort((a, b) => isRunning(b) - isRunning(a) || lastTouched(b).localeCompare(lastTouched(a)));
  const running = () => S.all('active').find(isRunning) || null;
  const onHold = () => list().filter((r) => !isRunning(r));

  /** Total time on this task so far, in milliseconds (includes the running segment). */
  const elapsedMs = (r, now = Date.now()) =>
    r.segments.reduce((t, g) => t + Math.max(0, (g.end ? new Date(g.end).getTime() : now) - new Date(g.start).getTime()), 0);

  /** Does this open task match what someone just picked? (so we resume instead of duplicating) */
  function same(r, c) {
    if (c.planItemId) return r.planItemId === c.planItemId;
    if (c.taskId) return r.taskId === c.taskId && !r.planItemId;
    return r.type === 'One-off' && !r.planItemId && r.task.trim().toLowerCase() === c.task.trim().toLowerCase();
  }

  /** Pause whatever is running. Returns the task that was paused, or null. */
  function pauseRunning({ silent = true } = {}) {
    const r = running();
    if (!r) return null;
    const segments = r.segments.map((g, i) => (i === r.segments.length - 1 ? { ...g, end: nowIso() } : g));
    return S.upsert('active', { ...r, segments }, { silent });
  }

  /** Start timing a task (or resume it if it's already open). Returns { rec, paused, resumed }. */
  function start(choice) {
    const existing = S.all('active').find((r) => same(r, choice));
    if (existing) {
      if (isRunning(existing)) return { rec: existing, already: true };
      return resume(existing.id);
    }
    const paused = pauseRunning();
    const rec = S.upsert('active', {
      task: choice.task, type: choice.type, taskId: choice.taskId || '',
      planItemId: choice.planItemId || '', planId: choice.planId || '',
      segments: [{ start: nowIso(), end: '', location: choice.location != null ? choice.location : S.currentLocation() }],
    });
    return { rec, paused };
  }

  function resume(id) {
    const r = S.get('active', id);
    if (!r) return { rec: null };
    if (isRunning(r)) return { rec: r, already: true };
    const paused = pauseRunning();
    const fresh = S.get('active', id);
    const rec = S.upsert('active', { ...fresh, segments: [...fresh.segments, { start: nowIso(), end: '', location: S.currentLocation() }] });
    return { rec, paused, resumed: true };
  }

  function pause(id) {
    const r = S.get('active', id);
    if (isRunning(r)) pauseRunning({ silent: false });
  }

  /**
   * You moved somewhere else while a task is running: time so far stays at the old place,
   * time from now on counts at the new one. (A segment under a minute is just relabelled.)
   */
  function relocateRunning(location) {
    const r = running();
    if (!r) return;
    const g = last(r);
    if (g.location === location) return;
    if (Date.now() - new Date(g.start).getTime() < 60000) {
      S.upsert('active', { ...r, segments: r.segments.map((x, i) => (i === r.segments.length - 1 ? { ...x, location } : x)) });
      return;
    }
    const now = nowIso();
    const segments = r.segments.map((x, i) => (i === r.segments.length - 1 ? { ...x, end: now } : x));
    segments.push({ start: now, end: '', location });
    S.upsert('active', { ...r, segments });
  }

  /** Move the start of the current segment (forgot to press start). Returns an error message or ''. */
  function setCurrentStart(id, when) {
    const r = S.get('active', id);
    if (!isRunning(r)) return 'This task is not running.';
    if (when.getTime() > Date.now()) return "That's in the future. Pick a time before now.";
    const prev = r.segments[r.segments.length - 2];
    if (prev && prev.end && when.getTime() < new Date(prev.end).getTime()) {
      return `That's before you last paused this task (${U.hm(new Date(prev.end))}).`;
    }
    const segments = r.segments.map((g, i) => (i === r.segments.length - 1 ? { ...g, start: when.toISOString() } : g));
    S.upsert('active', { ...r, segments });
    return '';
  }

  /**
   * The Log rows this task would become if finished now: one per segment,
   * skipping accidental stints under a minute (but always at least one row).
   */
  function toEntries(r, now = Date.now()) {
    const rows = r.segments.map((g) => {
      const a = new Date(g.start);
      const b = g.end ? new Date(g.end) : new Date(now);
      const minutes = Math.round((b - a) / 60000);
      return { date: U.ymd(a), start: U.hm(a), end: U.fromMins(U.toMins(U.hm(a)) + minutes), minutes, location: g.location || '' };
    });
    const kept = rows.filter((e) => e.minutes >= 1);
    if (kept.length) return kept;
    const first = rows[0] || { date: U.today(), start: U.nowHm() };
    return [{ ...first, minutes: 1, end: U.fromMins(U.toMins(first.start) + 1) }];
  }

  return { list, running, onHold, isRunning, elapsedMs, start, resume, pause, relocateRunning, setCurrentStart, toEntries, last };
})();
