/* Run: npm install && npm test   (or: node tests/e2e.test.js)
 * Opens the real app in a headless browser and clicks through the main flows.
 * Calls to Google are answered by apps-script/Code.gs running on a fake Sheet,
 * so this also checks the app and the connector work together.
 * Set SCREENSHOTS=1 to save screenshots into tests/screenshots/. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');
const { loadScript } = require('./gas-mock');

const ROOT = path.join(__dirname, '..');
const SHEET_URL = 'https://script.google.com/macros/s/TEST/exec';
const FF_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const KEY = 'test-key';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    return chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome' });
  }
}

async function main() {
  const server = await serve();
  const base = `http://localhost:${server.address().port}/`;
  const gas = loadScript(KEY);
  const browser = await launch();
  const shotsDir = path.join(__dirname, 'screenshots');
  const shots = !!process.env.SCREENSHOTS;
  if (shots) fs.mkdirSync(shotsDir, { recursive: true });

  async function device(name) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, locale: 'en-AU', timezoneId: 'Australia/Melbourne' });
    await ctx.route('https://script.google.com/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const out = req.method() === 'POST' ? gas.call.post(req.postData()) : gas.call.get(Object.fromEntries(url.searchParams));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base);
    page.errors = errors;
    page.shot = async (n) => shots && page.screenshot({ path: path.join(shotsDir, `${name}-${n}.png`), fullPage: true });
    return page;
  }

  // the Log tab opens day by day; some checks need the list
  const logList = async (pg) => {
    await pg.goto(base + '#log');
    await pg.waitForSelector('.mode-switch');
    if (await pg.$('[data-action="log-mode"][data-mode="list"]:not(.on)')) await pg.click('[data-action="log-mode"][data-mode="list"]');
  };

  const steps = [];
  const step = async (label, fn) => {
    await fn();
    steps.push(label);
    console.log('  ✓', label);
  };

  console.log('App in a browser');
  const a = await device('phone');

  await step('Today screen loads with no errors', async () => {
    await a.waitForSelector('#startTask');
    await a.shot('01-today-empty');
    assert.deepStrictEqual(a.errors, []);
  });

  await step('add two repeatable tasks', async () => {
    await a.click('a[href="#tasks"]');
    for (const [name, cat, target] of [['Showroom store run', 'Logistics', '1h 30m'], ['Marketing photoshoot', 'Marketing', '2h']]) {
      await a.click('[data-action="task-new"]');
      await a.fill('#t-name', name);
      await a.fill('#t-cat', cat);
      await a.fill('#t-target', target);
      await a.click('#modal button[type=submit]');
    }
    await a.waitForSelector('text=Marketing photoshoot');
    const n = await a.evaluate(() => FF.store.all('tasks').length);
    assert.strictEqual(n, 2);
    const t = await a.evaluate(() => FF.store.all('tasks').find((x) => x.name === 'Showroom store run').targetMinutes);
    assert.strictEqual(t, 90);
    await a.shot('02-tasks');
  });

  await step('create a fortnight plan starting Monday, add all repeatable + a one-off', async () => {
    await a.click('a[href="#plan"]');
    await a.click('[data-action="plan-create"][data-weeks="2"]');
    const plan = await a.evaluate(() => FF.store.all('plans')[0]);
    assert.strictEqual(new Date(plan.start + 'T00:00').getDay(), 1, 'starts on Monday');
    assert.strictEqual(plan.weeks, 2);
    await a.click('[data-action="plan-add-all"]');
    await a.click('[data-action="plan-item-new"]');
    await a.selectOption('#p-pick', '__oneoff');
    await a.fill('#p-oneoff', 'Christmas window display');
    await a.fill('#p-target', '45');
    const today = await a.evaluate(() => FF.util.today());
    await a.selectOption('#p-day', today);
    await a.click('#modal button[type=submit]');
    const items = await a.evaluate(() => FF.store.all('planItems'));
    assert.strictEqual(items.length, 3);
    assert.strictEqual(items.find((i) => i.type === 'One-off').targetMinutes, 45);
    await a.shot('03-plan');
  });

  await step('timer: start a planned task, finish it, mark had help + finished', async () => {
    await a.click('a[href="#today"]');
    const id = await a.evaluate(() => FF.store.all('planItems').find((i) => i.task === 'Showroom store run').id);
    await a.click(`[data-action="timer-start-item"][data-id="${id}"]`);
    await a.waitForSelector('.timer.running');
    // pretend it started 80 minutes ago
    await a.evaluate(() => {
      const r = FF.timers.running();
      FF.store.upsert('active', { ...r, segments: [{ start: new Date(Date.now() - 80 * 60000).toISOString(), end: '' }] });
    });
    await a.waitForTimeout(1100);
    const clock = await a.textContent('.clock');
    assert.match(clock, /^1:2\d:\d\d$/);
    await a.shot('04-timer-running');
    await a.click('.timer.running [data-action="active-finish"]');
    await a.check('#modal input[name=worked][value="With help"]', { force: true });
    await a.fill('#f-helpers', 'Sam');
    await a.check('#modal input[name=done]');
    await a.fill('#f-notes', 'Two drops');
    await a.shot('05-stop-modal');
    await a.click('#modal button[type=submit]');
    const e = await a.evaluate(() => FF.store.all('log')[0]);
    assert.strictEqual(e.task, 'Showroom store run');
    assert.strictEqual(e.minutes, 80);
    assert.strictEqual(e.worked, 'With help');
    assert.strictEqual(e.helpers, 'Sam');
    assert.strictEqual(e.planItemId, id);
    assert.strictEqual(await a.evaluate((i) => FF.store.get('planItems', i).done, id), true);
    assert.strictEqual(await a.evaluate(() => FF.store.all('active').length), 0);
  });

  await step('log a one-off by hand, typing "1.5h" as the duration', async () => {
    await a.click('[data-action="entry-new"]');
    await a.selectOption('#f-pick', '__oneoff');
    await a.fill('#f-oneoff', 'Unload surprise delivery');
    await a.fill('#f-start', '13:00');
    await a.fill('#f-dur', '1.5h');
    await a.press('#f-dur', 'Tab');
    assert.strictEqual(await a.inputValue('#f-end'), '14:30');
    await a.click('#modal button[type=submit]');
    const e = await a.evaluate(() => FF.store.all('log').find((x) => x.type === 'One-off'));
    assert.strictEqual(e.minutes, 90);
    assert.strictEqual(e.worked, 'With help', 'remembers last Solo/Help choice');
    await a.shot('06-today-logged');
  });

  await step('picking a repeatable task links it to the plan automatically', async () => {
    await a.click('[data-action="entry-new"]');
    const tid = await a.evaluate(() => FF.store.all('tasks').find((t) => t.name === 'Marketing photoshoot').id);
    await a.selectOption('#f-pick', `t:${tid}`);
    await a.check('#modal input[name=worked][value="Solo"]', { force: true });
    await a.fill('#f-start', '15:00');
    await a.fill('#f-end', '17:30');
    await a.press('#f-end', 'Tab');
    await a.click('#modal button[type=submit]');
    const e = await a.evaluate((t) => FF.store.all('log').find((x) => x.taskId === t), tid);
    assert.ok(e.planItemId, 'linked to plan item');
    assert.strictEqual(e.minutes, 150);
  });

  await step('Logged today: clock ring + bars per task, each task its own colour', async () => {
    await a.goto(base + '#today');
    await a.waitForSelector('.day-ring svg');
    const expected = await a.evaluate(() => {
      const today = FF.util.today();
      const tot = {};
      FF.store.all('log').filter((e) => e.date === today).forEach((e) => (tot[e.task] = (tot[e.task] || 0) + e.minutes));
      return Object.entries(tot).sort((x, y) => y[1] - x[1]).map((x) => x[0]);
    });
    assert.ok(expected.length >= 2, 'test data has several tasks today');
    const names = await a.$$eval('.task-bars .tb-name', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(names, expected, 'bars sorted longest first');
    const arcs = await a.$$eval('.ring-arc', (els) => els.length);
    assert.ok(arcs >= expected.length, `an arc per stretch (got ${arcs})`);
    const colours = await a.$$eval('.task-bars .swatch', (els) => els.map((e) => getComputedStyle(e).backgroundColor));
    assert.strictEqual(new Set(colours).size, colours.length, 'different colour for each task today');
    // the same colour shows next to the entry in the list
    const dot = await a.$eval('.entries .dot', (e) => getComputedStyle(e).backgroundColor);
    assert.ok(colours.includes(dot));
    // timeline bar: one section per stretch, from first to last
    const pieces = await a.evaluate(() => FF.charts.pieces(FF.util.today()));
    assert.strictEqual(await a.$$eval('.tl-seg', (els) => els.length), pieces.length);
    const first = await a.evaluate(() => { const p = FF.charts.pieces(FF.util.today()); return FF.util.fromMins(Math.min(...p.map((x) => x.start))); });
    assert.match(await a.textContent('.tl-ends'), new RegExp(`First ${first}`));
    // tap an arc to see what it was; the same stretch lights up on the timeline too
    await a.click('.ring-arc >> nth=0', { force: true });
    assert.match(await a.textContent('.chart-info'), /·/);
    const i = await a.getAttribute('.ring-arc.picked', 'data-i');
    assert.strictEqual(await a.$$eval(`.tl-seg.picked[data-i="${i}"]`, (e) => e.length), 1);
    await a.click('.tl-seg >> nth=1', { force: true });
    assert.strictEqual(await a.getAttribute('.tl-seg.picked', 'data-i'), '1');
    assert.ok((await a.$$eval('.ring-arc.picked[data-i="1"]', (e) => e.length)) >= 1, 'same stretch on the clock');
    await a.click('.tl-seg >> nth=1', { force: true });
    assert.strictEqual(await a.$$eval('.picked', (e) => e.length), 0, 'tap again to clear');
    // hand for "now" is drawn
    assert.strictEqual(await a.$$eval('.ring-hand', (e) => e.length), 1);
    await a.shot('13-logged-today-charts');
  });

  await step('change a task colour from the chart', async () => {
    await a.click('.task-bars [data-action="color-pick"][data-name="Marketing photoshoot"]');
    await a.click('#modal .swatch-choice input[value="#0f8a8a"]', { force: true });
    await a.shot('14-colour-picker');
    await a.click('#modal button[type=submit]');
    const bg = await a.$eval('.task-bars [data-name="Marketing photoshoot"]', (e) => getComputedStyle(e).backgroundColor);
    assert.strictEqual(bg, 'rgb(15, 138, 138)');
    const rec = await a.evaluate(() => FF.store.get('colors', 'color:marketing photoshoot'));
    assert.deepStrictEqual([rec.color, rec.auto], ['#0f8a8a', false]);
    // custom colour
    await a.click('.task-bars [data-action="color-pick"][data-name="Marketing photoshoot"]');
    await a.$eval('#modal input[name=custom]', (el) => { el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await a.click('#modal button[type=submit]');
    assert.strictEqual(await a.evaluate(() => FF.colors.colorFor('Marketing photoshoot')), '#123456');
    // and back to automatic
    await a.click('.task-bars [data-action="color-pick"][data-name="Marketing photoshoot"]');
    await a.click('#modal [data-extra="0"]');
    const auto = await a.evaluate(() => FF.colors.colorFor('Marketing photoshoot'));
    assert.ok(FF_PALETTE.includes(auto), auto);
    await a.click('.task-bars [data-action="color-pick"][data-name="Marketing photoshoot"]');
    await a.click('#modal .swatch-choice input[value="#0f8a8a"]', { force: true });
    await a.click('#modal button[type=submit]');
  });

  await step('review shows targets vs actual', async () => {
    await a.click('a[href="#review"]');
    await a.waitForSelector('.review-list');
    const pills = await a.$$eval('.status-pill', (els) => els.map((e) => e.textContent));
    assert.ok(pills.includes('Hit target'), pills.join());
    assert.ok(pills.some((p) => p.startsWith('Over by 30m')), pills.join());
    assert.ok(pills.includes('Not started'), pills.join());
    const unplanned = await a.textContent('.simple-list');
    assert.match(unplanned, /Unload surprise delivery/);
    await a.shot('07-review');
  });

  await step('change the date and times of a logged entry', async () => {
    await logList(a);
    await a.waitForSelector('.entry');
    const id = await a.evaluate(() => FF.store.all('log').find((e) => e.task === 'Unload surprise delivery').id);
    const yesterday = await a.evaluate(() => FF.util.addDays(FF.util.today(), -1));
    await a.click(`[data-action="entry-edit"][data-id="${id}"]`);
    await a.fill('#f-date', yesterday);
    await a.fill('#f-start', '07:15');
    await a.fill('#f-end', '08:00');
    await a.press('#f-end', 'Tab');
    assert.strictEqual(await a.inputValue('#f-dur'), '45m');
    await a.click('#modal button[type=submit]');
    const e = await a.evaluate((i) => FF.store.get('log', i), id);
    assert.deepStrictEqual([e.date, e.start, e.end, e.minutes], [yesterday, '07:15', '08:00', 45]);
    // put it back on today for the later checks (yesterday may be last week, so show everything)
    await a.selectOption('#logRange', 'all');
    await a.click(`[data-action="entry-edit"][data-id="${id}"]`);
    await a.fill('#f-date', await a.evaluate(() => FF.util.today()));
    await a.fill('#f-start', '13:00');
    await a.fill('#f-end', '14:30');
    await a.press('#f-end', 'Tab');
    await a.click('#modal button[type=submit]');
    assert.strictEqual(await a.evaluate((i) => FF.store.get('log', i).minutes, id), 90);
    await a.selectOption('#logRange', 'this-week');
  });

  await step('log screen lists entries and builds a CSV', async () => {
    await logList(a);
    await a.waitForSelector('.entry');
    assert.strictEqual(await a.$$eval('.entry', (els) => els.length), 3);
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-action="log-csv"]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(csv.split('\n')[0], /^Date,Start,End,Minutes,Hours,Task,Location,Type,Worked,Helpers/);
    assert.strictEqual(csv.trim().split('\n').length, 4);
    await a.shot('08-log');
  });

  await step('connect Google Sheet: everything already logged is sent', async () => {
    await a.click('#syncPill');
    await a.fill('#s-url', SHEET_URL);
    await a.fill('#s-key', KEY);
    await a.click('form[data-form="sync-connect"] button[type=submit]');
    await a.waitForSelector('[data-action="sync-now"]');
    const all = gas.call.get({ action: 'all', key: KEY }).data;
    assert.strictEqual(all.tasks.length, 2);
    assert.strictEqual(all.plans.length, 1);
    assert.strictEqual(all.planItems.length, 3);
    assert.strictEqual(all.log.length, 3);
    assert.strictEqual(all.log.find((x) => x.task === 'Showroom store run').worked, 'With help');
    assert.strictEqual(all.colors.find((c) => c.name === 'Marketing photoshoot').color, '#0f8a8a', 'colours reach the Sheet');
    await a.shot('09-settings-connected');
  });

  await step('new changes reach the Sheet on their own', async () => {
    await a.click('a[href="#today"]');
    await a.click('[data-action="entry-new"]');
    await a.selectOption('#f-pick', '__oneoff');
    await a.fill('#f-oneoff', 'Supplier call');
    await a.fill('#f-dur', '20');
    await a.press('#f-dur', 'Tab');
    await a.click('#modal button[type=submit]');
    await a.waitForFunction(() => FF.store.pendingCount() === 0, null, { timeout: 5000 });
    assert.strictEqual(gas.call.get({ action: 'all', key: KEY }).data.log.length, 4);
    const pill = await a.textContent('#syncPill');
    assert.match(pill, /Saved to Sheet/);
  });

  const b = await device('computer');
  await step('a second device connects and sees the same data', async () => {
    await b.goto(base + '#settings');
    await b.fill('#s-url', SHEET_URL);
    await b.fill('#s-key', KEY);
    await b.click('form[data-form="sync-connect"] button[type=submit]');
    await b.waitForSelector('[data-action="sync-now"]');
    assert.strictEqual(await b.evaluate(() => FF.store.all('log').length), 4);
    assert.strictEqual(await b.evaluate(() => FF.store.all('planItems').length), 3);
    assert.strictEqual(await b.evaluate(() => FF.colors.colorFor('Marketing photoshoot')), '#0f8a8a', 'same colours on the other device');
  });

  await step('edit on one device, sync on the other', async () => {
    await b.goto(base + '#log');
    const id = await b.evaluate(() => FF.store.all('log').find((e) => e.task === 'Supplier call').id);
    await b.click(`[data-action="entry-edit"][data-id="${id}"]`);
    await b.fill('#f-notes', 'Called about late stock');
    await b.click('#modal button[type=submit]');
    await b.waitForFunction(() => FF.store.pendingCount() === 0, null, { timeout: 5000 });
    await a.goto(base + '#settings');
    await a.click('[data-action="sync-now"]');
    await a.waitForFunction((i) => FF.store.get('log', i) && FF.store.get('log', i).notes === 'Called about late stock', id, { timeout: 5000 });
  });

  await step('delete an entry and it leaves the Sheet too', async () => {
    await logList(a);
    await a.selectOption('#logRange', 'all');
    const id = await a.evaluate(() => FF.store.all('log').find((e) => e.task === 'Supplier call').id);
    await a.click(`[data-action="entry-edit"][data-id="${id}"]`);
    await a.click('#modal [data-extra="0"]');
    await a.click('#confirm-modal button[type=submit]');
    await a.waitForFunction(() => FF.store.pendingCount() === 0, null, { timeout: 5000 });
    assert.strictEqual(gas.call.get({ action: 'all', key: KEY }).data.log.length, 3);
    assert.strictEqual(await a.evaluate(() => document.getElementById('modal').open), false);
  });

  await step('cancelling a delete keeps the form open', async () => {
    const id = await a.evaluate(() => FF.store.all('log')[0].id);
    await a.click(`[data-action="entry-edit"][data-id="${id}"]`);
    await a.click('#modal [data-extra="0"]');
    await a.click('#confirm-modal [data-close].btn');
    await a.waitForTimeout(100);
    assert.strictEqual(await a.evaluate(() => document.getElementById('modal').open), true);
    assert.strictEqual(await a.evaluate(() => FF.store.all('log').length), 3);
    await a.click('#modal [data-close].btn');
  });

  await step('start box: type to filter, tap a suggestion, or type a new one-off', async () => {
    await a.goto(base + '#today');
    // empty box lists planned tasks, repeatable tasks and recent one-offs
    const groups = await a.$$eval('.suggest-group', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(groups, ['Planned', 'Your tasks', 'Used recently']);
    // typing filters
    await a.fill('#startTask', 'photo');
    let names = await a.$$eval('#startSuggest .suggest-name', (els) => els.map((e) => e.textContent));
    assert.deepStrictEqual(names, ['Marketing photoshoot', 'Start “photo”']);
    await a.shot('12-start-typing');
    // tap the suggestion: starts the planned task straight away
    await a.click('#startSuggest [data-action="start-suggest"]');
    let r = await a.evaluate(() => FF.timers.running());
    assert.strictEqual(r.task, 'Marketing photoshoot');
    assert.ok(r.planItemId, 'linked to the plan');
    assert.strictEqual(await a.inputValue('#startTask'), '');
    // a recent one-off can be picked again
    await a.fill('#startTask', 'unload');
    await a.click('#startSuggest [data-action="start-suggest"]');
    r = await a.evaluate(() => FF.timers.running());
    assert.deepStrictEqual([r.task, r.type], ['Unload surprise delivery', 'One-off']);
    // typing a task's exact name and pressing Enter uses that task, not a new one-off
    await a.fill('#startTask', 'showroom store run');
    await a.press('#startTask', 'Enter');
    r = await a.evaluate(() => FF.timers.running());
    assert.deepStrictEqual([r.task, r.type], ['Showroom store run', 'Repeatable']);
    // something brand new
    await a.fill('#startTask', 'Call courier');
    await a.click('#startSuggest [data-action="start-typed"]');
    r = await a.evaluate(() => FF.timers.running());
    assert.deepStrictEqual([r.task, r.type], ['Call courier', 'One-off']);
    // empty Start just asks for a name
    await a.click('form[data-form="timer-start"] button[type=submit]');
    assert.match(await a.textContent('#toast'), /Type what you're working on/);
    await a.evaluate(() => FF.store.all('active').slice().forEach((x) => FF.store.remove('active', x.id)));
  });

  await step('move a running timer\'s start time back', async () => {
    await a.goto(base + '#today');
    await a.fill('#startTask', 'Late start');
    await a.click('form[data-form="timer-start"] button[type=submit]');
    await a.click('[data-action="active-adjust"]');
    const when = await a.evaluate(() => { const d = new Date(Date.now() - 30 * 60000); return [FF.util.ymd(d), FF.util.hm(d)]; });
    await a.fill('#ta-date', when[0]);
    await a.fill('#ta-time', when[1]);
    await a.click('#modal button[type=submit]');
    const mins = await a.evaluate(() => FF.timers.elapsedMs(FF.timers.running()) / 60000);
    assert.ok(mins >= 29 && mins < 32, `timer moved back ~30 min (got ${mins})`);
    // future times are refused
    await a.click('[data-action="active-adjust"]');
    await a.fill('#ta-date', await a.evaluate(() => FF.util.today()));
    await a.fill('#ta-time', '23:59');
    await a.click('#modal button[type=submit]');
    if (await a.evaluate(() => FF.util.nowHm() < '23:59')) {
      assert.match(await a.textContent('#modal .field-error'), /future/);
    }
    await a.evaluate(() => document.getElementById('modal').open && document.getElementById('modal').close());
    await a.evaluate(() => FF.store.remove('active', FF.timers.running().id));
  });

  await step('switch between several tasks: pause, resume, finish with two stints', async () => {
    await a.goto(base + '#today');
    const startOneOff = async (name) => {
      await a.fill('#startTask', name);
      await a.click('form[data-form="timer-start"] button[type=submit]');
    };
    await startOneOff('Picking - Replen');
    await startOneOff('Urgent delivery');
    let st = await a.evaluate(() => ({ run: FF.timers.running().task, held: FF.timers.onHold().map((r) => r.task) }));
    assert.deepStrictEqual(st, { run: 'Urgent delivery', held: ['Picking - Replen'] });
    await a.waitForSelector('.on-hold');
    assert.match(await a.textContent('#timerBadge'), /\+1$/);
    assert.match(await a.textContent('label[for="startTask"]'), /Jump to another task/);
    // starting the same one-off again resumes it rather than making a duplicate
    await startOneOff('picking - replen');
    st = await a.evaluate(() => ({ run: FF.timers.running().task, n: FF.store.all('active').length, segs: FF.timers.running().segments.length }));
    assert.deepStrictEqual(st, { run: 'Picking - Replen', n: 2, segs: 2 });
    // resume button on the held task switches back
    const urgent = await a.evaluate(() => FF.store.all('active').find((r) => r.task === 'Urgent delivery').id);
    await a.click(`.on-hold [data-action="active-resume"][data-id="${urgent}"]`);
    assert.strictEqual(await a.evaluate(() => FF.timers.running().task), 'Urgent delivery');
    // pause: nothing running, both on hold
    await a.click('.timer.running [data-action="active-pause"]');
    assert.strictEqual(await a.evaluate(() => FF.timers.running()), null);
    assert.match(await a.textContent('#timerBadge'), /2 on hold/);
    // give the tasks realistic times, then finish them
    await a.evaluate(() => {
      const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
      const p = FF.store.all('active').find((r) => r.task === 'Picking - Replen');
      const u = FF.store.all('active').find((r) => r.task === 'Urgent delivery');
      FF.store.upsert('active', { ...p, segments: [{ start: ago(120), end: ago(80) }, { start: ago(30), end: ago(5) }] });
      FF.store.upsert('active', { ...u, segments: [{ start: ago(80), end: ago(65) }] });
    });
    await a.shot('10-on-hold');
    const pick = await a.evaluate(() => FF.store.all('active').find((r) => r.task === 'Picking - Replen').id);
    await a.click(`.on-hold [data-action="active-finish"][data-id="${pick}"]`);
    assert.strictEqual(await a.$$eval('#modal .stints li', (els) => els.length), 2);
    await a.check('#modal input[name=worked][value="With help"]', { force: true });
    await a.fill('#modal input[name=helpers]', 'Jo');
    await a.fill('#fm-notes', 'Interrupted by delivery');
    await a.shot('11-finish-two-stints');
    await a.click('#modal button[type=submit]');
    const rows = await a.evaluate(() => FF.store.all('log').filter((e) => e.task === 'Picking - Replen').map((e) => [e.minutes, e.worked, e.helpers, e.notes]).sort());
    assert.deepStrictEqual(rows, [[25, 'With help', 'Jo', 'Interrupted by delivery'], [40, 'With help', 'Jo', 'Interrupted by delivery']]);
    await a.click(`.on-hold [data-action="active-finish"][data-id="${urgent}"]`);
    await a.click('#modal button[type=submit]');
    assert.strictEqual(await a.evaluate(() => FF.store.all('log').find((e) => e.task === 'Urgent delivery').minutes), 15);
    assert.strictEqual(await a.evaluate(() => FF.store.all('active').length), 0);
    await a.waitForFunction(() => FF.store.pendingCount() === 0, null, { timeout: 5000 });
    assert.strictEqual(gas.call.get({ action: 'all', key: KEY }).data.active.length, 0);
  });

  await step('locations: set where you are, change it mid-task, saved per stretch', async () => {
    await a.goto(base + '#today');
    await a.click('[data-action="location-choose"]');
    await a.fill('#loc-search', 'Warehouse');
    await a.press('#loc-search', 'Enter');
    assert.strictEqual(await a.evaluate(() => FF.store.currentLocation()), 'Warehouse');
    assert.match(await a.textContent('.loc-chip'), /Warehouse/);
    await a.fill('#startTask', 'Pallet wrap');
    await a.press('#startTask', 'Enter');
    assert.match(await a.textContent('.timer-loc'), /Warehouse/);
    // started 10 minutes ago at the warehouse...
    await a.evaluate(() => {
      const r = FF.timers.running();
      FF.store.upsert('active', { ...r, segments: [{ ...r.segments[0], start: new Date(Date.now() - 10 * 60000).toISOString() }] });
    });
    // ...then moved to the showroom
    await a.click('[data-action="location-choose"]');
    await a.fill('#loc-search', 'Showroom');
    await a.click('#loc-list .pick-main.new');
    const segs = await a.evaluate(() => FF.timers.running().segments.map((g) => g.location));
    assert.deepStrictEqual(segs, ['Warehouse', 'Showroom']);
    await a.shot('15-location-running');
    await a.evaluate(() => {
      const r = FF.timers.running();
      const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
      FF.store.upsert('active', { ...r, segments: [{ start: ago(30), end: ago(20), location: 'Warehouse' }, { start: ago(20), end: '', location: 'Showroom' }] });
    });
    await a.click('.timer.running [data-action="active-finish"]');
    assert.match(await a.textContent('#modal .stints'), /Warehouse[\s\S]*Showroom/);
    await a.click('#modal button[type=submit]');
    const rows = await a.evaluate(() => FF.store.all('log').filter((e) => e.task === 'Pallet wrap').map((e) => [e.location, e.minutes]).sort());
    assert.deepStrictEqual(rows, [['Showroom', 20], ['Warehouse', 10]]);
    // the day charts break time down by location
    assert.match(await a.textContent('.loc-bars'), /Warehouse[\s\S]*Showroom|Showroom[\s\S]*Warehouse/);
  });

  await step('pin a location and a task; they show first', async () => {
    await a.click('[data-action="location-choose"]');
    await a.click('#loc-list .pin-btn[data-name="Warehouse"]');
    assert.strictEqual(await a.evaluate(() => FF.picks.isPinned('location', 'Warehouse')), true);
    await a.fill('#loc-search', '');
    await a.dispatchEvent('#loc-search', 'input');
    assert.strictEqual(await a.textContent('#loc-list .suggest-group'), 'Pinned');
    await a.click('#loc-list .pick-main[data-name="Warehouse"]');
    // pin a task from the start list
    await a.click('#startSuggest .pin-btn[data-name="Marketing photoshoot"]');
    const firstGroup = await a.textContent('#startSuggest .suggest-group');
    const firstTask = await a.textContent('#startSuggest .suggest-name');
    assert.deepStrictEqual([firstGroup, firstTask], ['Pinned', 'Marketing photoshoot']);
    // forms offer the pinned location as a chip
    await a.click('[data-action="entry-new"]');
    assert.strictEqual(await a.inputValue('#f-location'), 'Warehouse', 'new entries default to where you are');
    await a.fill('#f-location', '');
    await a.dispatchEvent('#f-location', 'input');
    assert.match(await a.textContent('#modal .chips'), /📌 Warehouse/);
    await a.click('#modal .chip[data-name="Showroom"]');
    assert.strictEqual(await a.inputValue('#f-location'), 'Showroom');
    await a.shot('16-entry-location');
    await a.click('#modal [data-close].btn');
    await a.waitForFunction(() => FF.store.pendingCount() === 0, null, { timeout: 5000 });
    const sheet = gas.call.get({ action: 'all', key: KEY }).data;
    assert.ok(sheet.pins.some((p) => p.kind === 'location' && p.name === 'Warehouse'));
    assert.ok(sheet.pins.some((p) => p.kind === 'task' && p.name === 'Marketing photoshoot'));
    assert.ok(sheet.log.some((e) => e.task === 'Pallet wrap' && e.location === 'Showroom'), 'location reaches the Sheet');
  });

  await step('go back through day history', async () => {
    const old = await a.evaluate(() => {
      const d = FF.util.addDays(FF.util.today(), -3);
      FF.store.upsert('log', { date: d, start: '08:00', end: '09:30', minutes: 90, task: 'Warehouse stock check', type: 'One-off', worked: 'Solo', location: 'Warehouse' });
      FF.store.upsert('log', { date: d, start: '10:00', end: '11:00', minutes: 60, task: 'Showroom store run', type: 'One-off', worked: 'Solo' });
      return d;
    });
    await a.goto(base + '#log');
    await a.click('[data-action="log-mode"][data-mode="day"]');
    await a.waitForSelector('.day-nav');
    assert.match(await a.textContent('.day-nav'), /Today/);
    assert.ok(await a.$('.day-nav [data-action="day-step"][aria-label="Next day"][disabled]'), "can't go into the future");
    await a.click('.day-nav [aria-label="Previous day"]');
    assert.strictEqual(await a.inputValue('#logDay'), await a.evaluate(() => FF.util.addDays(FF.util.today(), -1)));
    await a.click('[data-action="day-step"][title="Previous day with entries"]');
    assert.strictEqual(await a.inputValue('#logDay'), old);
    assert.strictEqual(await a.$$eval('.tl-seg', (e) => e.length), 2);
    assert.match(await a.textContent('.tl-ends'), /First 08:00[\s\S]*Last 11:00/);
    assert.match(await a.textContent('.tl-sum'), /3h day · 2h 30m on tasks · 30m gaps/);
    assert.strictEqual(await a.$$eval('.entry', (e) => e.length), 2);
    assert.strictEqual(await a.$$eval('.ring-hand', (e) => e.length), 0, 'no "now" hand on past days');
    await a.shot('17-day-history');
    // add an entry straight onto that day
    await a.click('[data-action="entry-new-day"]');
    assert.strictEqual(await a.inputValue('#f-date'), old);
    await a.click('#modal [data-close].btn');
    // the date box jumps anywhere
    await a.fill('#logDay', await a.evaluate(() => FF.util.today()));
    await a.dispatchEvent('#logDay', 'change');
    assert.match(await a.textContent('.day-nav'), /Today/);
    // Today's card links back here
    await a.goto(base + '#today');
    await a.click('[data-action="open-day"]');
    await a.waitForSelector('.day-nav');
    assert.strictEqual(await a.inputValue('#logDay'), await a.evaluate(() => FF.util.addDays(FF.util.today(), -1)));
  });

  await step('a running task shows on the other device too', async () => {
    await a.goto(base + '#today');
    await a.fill('#startTask', 'Stock count');
    await a.click('form[data-form="timer-start"] button[type=submit]');
    await a.waitForFunction(() => FF.store.pendingCount() === 0, null, { timeout: 5000 });
    await b.goto(base + '#settings');
    await b.click('[data-action="sync-now"]');
    await b.goto(base + '#today');
    await b.waitForSelector('.timer.running');
    assert.match(await b.textContent('.timer-task'), /Stock count/);
    // pause it on the computer, phone sees it on hold after syncing
    await b.click('.timer.running [data-action="active-pause"]');
    await b.waitForFunction(() => FF.store.pendingCount() === 0, null, { timeout: 5000 });
    await a.goto(base + '#settings');
    await a.click('[data-action="sync-now"]');
    await a.waitForFunction(() => !FF.timers.running() && FF.timers.onHold().length === 1, null, { timeout: 5000 });
    await a.evaluate(() => FF.store.remove('active', FF.timers.onHold()[0].id));
  });

  await step('timer survives a page reload', async () => {
    await a.goto(base + '#today');
    await a.fill('#startTask', 'Quick tidy');
    await a.click('form[data-form="timer-start"] button[type=submit]');
    await a.reload();
    await a.waitForSelector('.timer.running');
    assert.match(await a.textContent('.timer-task'), /Quick tidy/);
    assert.strictEqual(await a.isVisible('#timerBadge'), true);
  });

  await step('a wrong key shows a clear message', async () => {
    const c = await device('wrongkey');
    await c.goto(base + '#settings');
    await c.fill('#s-url', SHEET_URL);
    await c.fill('#s-key', 'oops');
    await c.click('form[data-form="sync-connect"] button[type=submit]');
    await c.waitForSelector('.toast.show.error');
    assert.match(await c.textContent('#toast'), /Wrong secret key/);
  });

  await step('website Settings offers the Android app download', async () => {
    await a.goto(base + '#settings');
    const href = await a.getAttribute('a[href$="FF-Tracker.apk"]', 'href');
    assert.match(href, /releases\/latest\/download\/FF-Tracker\.apk$/);
  });

  await step('inside the Android app: files save through the app, back button closes pop-ups', async () => {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
    await ctx.route('https://script.google.com/**', async (route) => {
      const req = route.request();
      const out = req.method() === 'POST' ? gas.call.post(req.postData()) : gas.call.get(Object.fromEntries(new URL(req.url()).searchParams));
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(out) });
    });
    await ctx.addInitScript(() => {
      window.__saved = [];
      window.__shared = [];
      window.FFAndroid = {
        saveFile: (name, type, text) => { window.__saved.push({ name, type, text }); return true; },
        appVersion: () => '1.0.7',
        shareConfig: (url, key) => window.__shared.push([url, key]),
      };
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await logList(p);
    assert.strictEqual(await p.evaluate(() => document.documentElement.classList.contains('in-app')), true);
    // not connected yet: the watch is told there's no Sheet
    assert.deepStrictEqual(await p.evaluate(() => window.__shared[0]), ['', '']);
    // connecting hands the Sheet link to the watch
    await p.goto(base + '#settings');
    await p.fill('#s-url', SHEET_URL);
    await p.fill('#s-key', KEY);
    await p.click('form[data-form="sync-connect"] button[type=submit]');
    await p.waitForSelector('[data-action="sync-now"]');
    assert.deepStrictEqual(await p.evaluate(() => window.__shared[window.__shared.length - 1]), [SHEET_URL, KEY]);
    assert.ok(await p.$('a[href$="FF-Tracker-Watch.apk"]'), 'watch app download offered');
    await logList(p);
    await p.click('[data-action="log-csv"]');
    const saved = await p.evaluate(() => window.__saved);
    assert.strictEqual(saved.length, 1);
    assert.match(saved[0].name, /\.csv$/);
    assert.match(saved[0].text, /^Date,Start,End/);
    await p.click('[data-action="entry-new"]');
    assert.strictEqual(await p.evaluate(() => FF.app.back()), true);
    assert.strictEqual(await p.evaluate(() => document.getElementById('modal').open), false);
    assert.strictEqual(await p.evaluate(() => FF.app.back()), false);
    await p.goto(base + '#settings');
    assert.strictEqual(await p.$('section a.btn[href$="FF-Tracker.apk"]'), null, 'no download button inside the app');
    assert.match(await p.textContent('#view'), /Android app 1\.0\.7/);
    assert.deepStrictEqual(errs, []);
    await ctx.close();
  });

  await step('a timer left running in version 1.0 carries over after updating', async () => {
    const ctx = await browser.newContext();
    const startedAt = new Date(Date.now() - 12 * 60000).toISOString();
    await ctx.addInitScript((t) => {
      if (!localStorage.getItem('ff.data.v1')) localStorage.setItem('ff.timer.v1', JSON.stringify({ task: 'Break', type: 'One-off', taskId: '', planItemId: '', planId: '', startedAt: t }));
    }, startedAt);
    const p = await ctx.newPage();
    await p.goto(base + '#today');
    await p.waitForSelector('.timer.running');
    assert.match(await p.textContent('.timer-task'), /Break/);
    assert.strictEqual(await p.evaluate(() => localStorage.getItem('ff.timer.v1')), null);
    await p.reload();
    assert.strictEqual(await p.evaluate(() => FF.store.all('active').length), 1, 'not duplicated on reload');
    await ctx.close();
  });

  await step('no browser errors anywhere', async () => {
    assert.deepStrictEqual(a.errors, []);
    assert.deepStrictEqual(b.errors, []);
  });

  // desktop-size screenshots for a visual check
  if (shots) {
    await b.goto(base + '#plan');
    await b.setViewportSize({ width: 1280, height: 900 });
    await b.screenshot({ path: path.join(shotsDir, 'desktop-plan.png'), fullPage: true });
    await b.goto(base + '#review');
    await b.screenshot({ path: path.join(shotsDir, 'desktop-review.png'), fullPage: true });
  }

  await browser.close();
  server.close();
  console.log(`\n${steps.length} passed`);
}

main().catch((e) => {
  console.error('  ✗', e.message);
  process.exit(1);
});
