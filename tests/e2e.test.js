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

  const steps = [];
  const step = async (label, fn) => {
    await fn();
    steps.push(label);
    console.log('  ✓', label);
  };

  console.log('App in a browser');
  const a = await device('phone');

  await step('Today screen loads with no errors', async () => {
    await a.waitForSelector('#startPick');
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

  await step('timer: start a planned task, stop it, mark had help + finished', async () => {
    await a.click('a[href="#today"]');
    const id = await a.evaluate(() => FF.store.all('planItems').find((i) => i.task === 'Showroom store run').id);
    await a.click(`[data-action="timer-start-item"][data-id="${id}"]`);
    await a.waitForSelector('.timer.running');
    // pretend it started 80 minutes ago
    await a.evaluate(() => {
      const t = FF.store.timer();
      FF.store.setTimer({ ...t, startedAt: new Date(Date.now() - 80 * 60000).toISOString() });
    });
    await a.waitForTimeout(1100);
    const clock = await a.textContent('.clock');
    assert.match(clock, /^1:2\d:\d\d$/);
    await a.shot('04-timer-running');
    await a.click('[data-action="timer-stop"]');
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
    assert.strictEqual(await a.evaluate(() => FF.store.timer()), null);
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
    await a.click('a[href="#log"]');
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
    await a.click('a[href="#log"]');
    await a.waitForSelector('.entry');
    assert.strictEqual(await a.$$eval('.entry', (els) => els.length), 3);
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('[data-action="log-csv"]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert.match(csv.split('\n')[0], /^Date,Start,End,Minutes,Hours,Task,Type,Worked,Helpers/);
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
    await a.goto(base + '#log');
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

  await step('move a running timer\'s start time back', async () => {
    await a.goto(base + '#today');
    await a.selectOption('#startPick', '__oneoff');
    await a.fill('#startOneOff', 'Late start');
    await a.click('form[data-form="timer-start"] button[type=submit]');
    await a.click('[data-action="timer-adjust"]');
    const earlier = await a.evaluate(() => FF.util.fromMins(FF.util.toMins(FF.util.nowHm()) - 30));
    const onDate = await a.evaluate(() => { const d = new Date(Date.now() - 30 * 60000); return FF.util.ymd(d); });
    await a.fill('#ta-date', onDate);
    await a.fill('#ta-time', earlier);
    await a.click('#modal button[type=submit]');
    const mins = await a.evaluate(() => (Date.now() - new Date(FF.store.timer().startedAt).getTime()) / 60000);
    assert.ok(mins >= 29 && mins < 32, `timer moved back ~30 min (got ${mins})`);
    // future times are refused
    await a.click('[data-action="timer-adjust"]');
    await a.fill('#ta-date', await a.evaluate(() => FF.util.today()));
    await a.fill('#ta-time', '23:59');
    await a.click('#modal button[type=submit]');
    if (await a.evaluate(() => FF.util.nowHm() < '23:59')) {
      assert.match(await a.textContent('#modal .field-error'), /future/);
    }
    await a.evaluate(() => document.getElementById('modal').open && document.getElementById('modal').close());
    await a.evaluate(() => FF.store.setTimer(null));
  });

  await step('timer survives a page reload', async () => {
    await a.goto(base + '#today');
    await a.selectOption('#startPick', '__oneoff');
    await a.fill('#startOneOff', 'Quick tidy');
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
    await ctx.addInitScript(() => {
      window.__saved = [];
      window.FFAndroid = {
        saveFile: (name, type, text) => { window.__saved.push({ name, type, text }); return true; },
        appVersion: () => '1.0.7',
      };
    });
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base + '#log');
    assert.strictEqual(await p.evaluate(() => document.documentElement.classList.contains('in-app')), true);
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
