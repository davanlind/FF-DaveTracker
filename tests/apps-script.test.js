/* Run: node tests/apps-script.test.js
 * Checks the Google Sheet connector (apps-script/Code.gs) against a fake Sheet. */
const assert = require('assert');
const { loadScript } = require('./gas-mock');

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name, '\n   ', e.message);
    process.exitCode = 1;
  }
};

console.log('Apps Script connector');

test('rejects a wrong key', () => {
  const { call } = loadScript();
  assert.strictEqual(call.get({ action: 'ping', key: 'nope' }).ok, false);
  assert.match(call.get({ action: 'ping', key: 'nope' }).error, /Wrong secret key/);
});

test('refuses to run until SECRET_KEY is changed', () => {
  const { call } = loadScript('CHANGE-ME');
  assert.match(call.get({ action: 'ping', key: 'CHANGE-ME' }).error, /Set SECRET_KEY/);
});

test('ping works with the right key', () => {
  const { call } = loadScript();
  const r = call.get({ action: 'ping', key: 'test-key' });
  assert.deepStrictEqual(r, { ok: true, sheet: 'Test Tracker Sheet' });
});

test('upsert creates tabs with headers and rows; read returns the same values', () => {
  const { call, ss } = loadScript();
  const entry = {
    id: 'log_1', date: '2026-11-23', start: '09:05', end: '10:35', minutes: 90, hours: 1.5,
    task: 'Showroom store run', location: 'Warehouse', type: 'Repeatable', worked: 'With help', helpers: 'Sam',
    notes: 'Van loaded, 2 drops', planId: 'plan_1', planItemId: 'item_1', taskId: 'task_1', updatedAt: '2026-11-23T00:00:00.000Z',
  };
  const r = call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'upsert', table: 'log', record: entry }] });
  assert.strictEqual(r.ok, true, r.error);
  const sh = ss.getSheetByName('Log');
  assert.ok(sh, 'Log tab exists');
  assert.strictEqual(sh.cells[0][0], 'Date');
  assert.ok(sh.cells[1][0] instanceof Date, 'Date column holds a real date');
  assert.strictEqual(sh.cells[1][1], '09:05', 'Start stays as text');
  const all = call.get({ action: 'all', key: 'test-key' });
  assert.strictEqual(all.ok, true);
  assert.deepStrictEqual(all.data.log[0], entry);
  assert.deepStrictEqual(Object.keys(all.data).sort(), ['active', 'colors', 'log', 'pins', 'planItems', 'plans', 'tasks']);
});

test('upsert of the same id updates in place; delete removes the row', () => {
  const { call, ss } = loadScript();
  const base = { id: 'task_a', name: 'Photoshoot', category: 'Marketing', targetMinutes: 120, active: true, notes: '', updatedAt: 'x' };
  call.post({ key: 'test-key', action: 'apply', ops: [
    { op: 'upsert', table: 'tasks', record: base },
    { op: 'upsert', table: 'tasks', record: { ...base, id: 'task_b', name: 'Store run' } },
    { op: 'upsert', table: 'tasks', record: { ...base, targetMinutes: 150, active: false } },
  ] });
  let all = call.get({ action: 'all', key: 'test-key' }).data.tasks;
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].targetMinutes, 150);
  assert.strictEqual(all[0].active, false);
  call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'delete', table: 'tasks', id: 'task_a' }] });
  all = call.get({ action: 'all', key: 'test-key' }).data.tasks;
  assert.deepStrictEqual(all.map((t) => t.id), ['task_b']);
  assert.strictEqual(ss.getSheetByName('Tasks').getLastRow(), 2);
});

test('keeps columns the user added and survives reordered columns', () => {
  const { call, ss } = loadScript();
  const rec = { id: 'plan_1', start: '2026-11-23', end: '2026-12-06', weeks: 2, notes: '', updatedAt: 'x' };
  call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'upsert', table: 'plans', record: rec }] });
  const sh = ss.getSheetByName('Plans');
  // user adds own column "Manager comment" and swaps first two columns
  const width = sh.getLastColumn();
  sh.cells[0][width] = 'Manager comment';
  sh.cells[1][width] = 'Looks good';
  [sh.cells[0][0], sh.cells[0][1]] = [sh.cells[0][1], sh.cells[0][0]];
  [sh.cells[1][0], sh.cells[1][1]] = [sh.cells[1][1], sh.cells[1][0]];
  call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'upsert', table: 'plans', record: { ...rec, notes: 'Busy fortnight' } }] });
  assert.strictEqual(sh.cells[1][width], 'Looks good', 'own column kept');
  const back = call.get({ action: 'all', key: 'test-key' }).data.plans[0];
  assert.strictEqual(back.start, '2026-11-23');
  assert.strictEqual(back.end, '2026-12-06');
  assert.strictEqual(back.notes, 'Busy fortnight');
});

test('adds rows past the end of the sheet', () => {
  const { call, ss } = loadScript();
  call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'upsert', table: 'log', record: { id: 'log_0', minutes: 1 } }] });
  ss.getSheetByName('Log').maxRows = 2; // pretend the sheet is full
  const r = call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'upsert', table: 'log', record: { id: 'log_9', minutes: 5 } }] });
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(call.get({ action: 'all', key: 'test-key' }).data.log.length, 2);
});

test('active timers keep their list of time segments', () => {
  const { call, ss } = loadScript();
  const rec = { id: 'act_1', task: 'Picking - Replen', type: 'One-off', taskId: '', planItemId: '', planId: '',
    segments: [{ start: '2026-11-23T00:14:00.000Z', end: '2026-11-23T01:38:00.000Z' }, { start: '2026-11-23T02:00:00.000Z', end: '' }],
    updatedAt: 'x' };
  assert.strictEqual(call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'upsert', table: 'active', record: rec }] }).ok, true);
  assert.ok(ss.getSheetByName('Active timers'));
  const back = call.get({ action: 'all', key: 'test-key' }).data.active[0];
  assert.deepStrictEqual(back, rec);
  call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'delete', table: 'active', id: 'act_1' }] });
  assert.strictEqual(call.get({ action: 'all', key: 'test-key' }).data.active.length, 0);
});

test('summary (for the watch) only returns recent log rows', () => {
  const { call } = loadScript();
  const row = (id, date) => ({ op: 'upsert', table: 'log', record: { id, date, start: '09:00', end: '10:00', minutes: 60, task: 'X' } });
  call.post({ key: 'test-key', action: 'apply', ops: [row('log_old', '2026-08-01'), row('log_new', '2026-11-20')] });
  call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'upsert', table: 'tasks', record: { id: 'task_1', name: 'Photoshoot', active: true } }] });
  const r = call.get({ action: 'summary', since: '2026-10-01', key: 'test-key' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data.log.map((x) => x.id), ['log_new']);
  assert.strictEqual(r.data.tasks.length, 1);
  assert.strictEqual(call.get({ action: 'summary', key: 'nope' }).ok, false);
});

test('bad input gives a readable error, not a crash', () => {
  const { call } = loadScript();
  assert.strictEqual(call.post('not json').ok, false);
  assert.match(call.post({ key: 'test-key', action: 'apply', ops: [{ op: 'upsert', table: 'nope', record: { id: 1 } }] }).error, /Unknown table/);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
