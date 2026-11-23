/**
 * F&F Tracker — Google Sheet connector (Google Apps Script)
 * ---------------------------------------------------------
 * This turns your Google Sheet into the tracker's database.
 * Paste this whole file into Extensions → Apps Script in your Sheet,
 * change SECRET_KEY below, then Deploy → New deployment → Web app.
 * Full steps: docs/GOOGLE_SHEET_SETUP.md
 *
 * It creates (and keeps up to date) seven tabs:
 *   Log, Plan Items, Plans, Tasks, Active timers, Colours, Pinned
 * Columns are matched by their HEADER NAME, so you can reorder columns,
 * and you can add your own extra columns (e.g. formulas) to the right.
 * Don't rename the existing headers or the ID column.
 */

// ⚠️ CHANGE THIS to a long password only you know. Type the same thing into the
// tracker's Settings → Secret key. Anyone with the web app link AND this key
// can read and change your tracker data.
const SECRET_KEY = 'CHANGE-ME';

// Optional: a SECOND password that can only LOOK. Put it in a view-only link
// (tracker Settings → Share a view-only link) so someone can see your tracker
// without being able to change anything. Leave it as '' to turn this off.
const VIEW_KEY = '';

/**
 * What goes in each tab. [field in the app, column header in the Sheet, kind, number format]
 * kinds: text | date | number | bool | json (a list stored as text)
 */
const SCHEMA = {
  log: {
    sheet: 'Log',
    columns: [
      ['date', 'Date', 'date'],
      ['start', 'Start', 'text'],
      ['end', 'End', 'text'],
      ['minutes', 'Minutes', 'number', '0'],
      ['hours', 'Hours', 'number', '0.00'],
      ['task', 'Task', 'text'],
      ['location', 'Location', 'text'],
      ['type', 'Type', 'text'],
      ['worked', 'Worked', 'text'],
      ['helpers', 'Helpers', 'text'],
      ['notes', 'Notes', 'text'],
      ['planId', 'Plan ID', 'text'],
      ['planItemId', 'Plan item ID', 'text'],
      ['taskId', 'Task ID', 'text'],
      ['id', 'ID', 'text'],
      ['updatedAt', 'Updated', 'text'],
    ],
  },
  planItems: {
    sheet: 'Plan Items',
    columns: [
      ['planStart', 'Plan start', 'date'],
      ['task', 'Task', 'text'],
      ['type', 'Type', 'text'],
      ['targetMinutes', 'Target minutes', 'number', '0'],
      ['day', 'Day', 'date'],
      ['done', 'Finished', 'bool'],
      ['notes', 'Notes', 'text'],
      ['planId', 'Plan ID', 'text'],
      ['taskId', 'Task ID', 'text'],
      ['id', 'ID', 'text'],
      ['updatedAt', 'Updated', 'text'],
    ],
  },
  plans: {
    sheet: 'Plans',
    columns: [
      ['start', 'Start (Monday)', 'date'],
      ['end', 'End', 'date'],
      ['weeks', 'Weeks', 'number', '0'],
      ['notes', 'Notes', 'text'],
      ['id', 'ID', 'text'],
      ['updatedAt', 'Updated', 'text'],
    ],
  },
  // Tasks being timed or on hold right now, so the phone and website show the same timers.
  // Rows disappear when a task is finished (it becomes rows in Log).
  active: {
    sheet: 'Active timers',
    columns: [
      ['task', 'Task', 'text'],
      ['type', 'Type', 'text'],
      ['segments', 'Time segments (JSON)', 'json'],
      ['planId', 'Plan ID', 'text'],
      ['planItemId', 'Plan item ID', 'text'],
      ['taskId', 'Task ID', 'text'],
      ['id', 'ID', 'text'],
      ['updatedAt', 'Updated', 'text'],
    ],
  },
  // Tasks and locations pinned to the top of pick lists.
  pins: {
    sheet: 'Pinned',
    columns: [
      ['kind', 'Kind', 'text'],
      ['name', 'Name', 'text'],
      ['id', 'ID', 'text'],
      ['updatedAt', 'Updated', 'text'],
    ],
  },
  // The colour shown for each task in the charts.
  colors: {
    sheet: 'Colours',
    columns: [
      ['name', 'Task', 'text'],
      ['color', 'Colour', 'text'],
      ['auto', 'Picked automatically', 'bool'],
      ['id', 'ID', 'text'],
      ['updatedAt', 'Updated', 'text'],
    ],
  },
  tasks: {
    sheet: 'Tasks',
    columns: [
      ['name', 'Task', 'text'],
      ['category', 'Category', 'text'],
      ['targetMinutes', 'Usual target minutes', 'number', '0'],
      ['active', 'Active', 'bool'],
      ['notes', 'Notes', 'text'],
      ['id', 'ID', 'text'],
      ['updatedAt', 'Updated', 'text'],
    ],
  },
};

/* ======================= web app entry points ======================= */

/** GET ?action=ping|all|summary&key=...   (summary: like all, but the log only from &since=YYYY-MM-DD; used by the watch) */
function doGet(e) {
  return respond_(() => {
    const p = (e && e.parameter) || {};
    const role = checkKey_(p.key, true);
    if (p.action === 'ping') {
      return { ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName(), role };
    }
    if (p.action === 'all') return { ok: true, data: readAll_() };
    if (p.action === 'summary') {
      const data = readAll_();
      const since = String(p.since || '');
      if (since) data.log = data.log.filter((r) => String(r.date) >= since);
      return { ok: true, data };
    }
    throw new Error('Unknown action');
  });
}

/** POST body (text/plain JSON): { key, action: 'apply', ops: [{op:'upsert', table, record} | {op:'delete', table, id}] } */
function doPost(e) {
  return respond_(() => {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey_(body.key, false);
    if (body.action !== 'apply') throw new Error('Unknown action');
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      ops.forEach(applyOp_);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }
    return { ok: true, applied: ops.length };
  });
}

/** Run this once from the editor (▶ Run) to create the tabs and give permission. */
function setup() {
  Object.keys(SCHEMA).forEach((t) => sheetFor_(t));
  const first = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1) {
    SpreadsheetApp.getActiveSpreadsheet().deleteSheet(first);
  }
  Logger.log('F&F Tracker tabs are ready.');
}

/* ============================ internals ============================ */

function respond_(fn) {
  let out;
  try {
    out = fn();
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Returns 'edit' for the main password, 'view' for the look-only one (when allowed). */
function checkKey_(key, viewAllowed) {
  if (SECRET_KEY === 'CHANGE-ME') throw new Error('Set SECRET_KEY in the Apps Script first, then deploy a new version.');
  const k = String(key || '');
  if (k === SECRET_KEY) return 'edit';
  if (VIEW_KEY && VIEW_KEY !== SECRET_KEY && k === VIEW_KEY) {
    if (viewAllowed) return 'view';
    throw new Error('This link is view-only, so it can\'t change anything.');
  }
  throw new Error('Wrong secret key.');
}

function schemaFor_(table) {
  const s = SCHEMA[table];
  if (!s) throw new Error('Unknown table: ' + table);
  return s;
}

/** Get (or create) the tab for a table, making sure every header exists. */
function sheetFor_(table) {
  const s = schemaFor_(table);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(s.sheet);
  if (!sh) {
    sh = ss.insertSheet(s.sheet);
  }
  const lastCol = sh.getLastColumn();
  const headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
  const missing = s.columns.filter((c) => headers.indexOf(c[1]) === -1);
  if (missing.length) {
    const startCol = headers.length + 1;
    sh.getRange(1, startCol, 1, missing.length).setValues([missing.map((c) => c[1])]);
    missing.forEach((c, i) => {
      const fmt = formatFor_(c);
      if (fmt) sh.getRange(1, startCol + i, sh.getMaxRows(), 1).setNumberFormat(fmt);
    });
    sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#f1ede6');
    sh.setFrozenRows(1);
  }
  return sh;
}

function formatFor_(col) {
  if (col[2] === 'date') return 'yyyy-mm-dd';
  if (col[2] === 'number') return col[3] || '0';
  if (col[2] === 'bool') return null; // leave as is (TRUE / FALSE)
  return '@'; // plain text, so times like 09:15 stay as typed
}

/** { 'Header': columnNumber } */
function headerMap_(sh) {
  const lastCol = sh.getLastColumn();
  const map = {};
  if (!lastCol) return map;
  sh.getRange(1, 1, 1, lastCol).getValues()[0].forEach((h, i) => {
    if (h !== '' && map[h] === undefined) map[String(h)] = i + 1;
  });
  return map;
}

function findRow_(sh, idCol, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return -1;
  const hit = sh.getRange(2, idCol, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : -1;
}

function toCell_(col, v) {
  const kind = col[2];
  if (v === undefined || v === null) return '';
  if (kind === 'bool') return v === true || v === 'TRUE' || v === 'true';
  if (kind === 'number') return v === '' || isNaN(Number(v)) ? '' : Number(v);
  if (kind === 'date') return v ? String(v) : '';
  if (kind === 'json') return typeof v === 'string' ? v : JSON.stringify(v);
  return String(v);
}

function fromCell_(col, v, tz) {
  const kind = col[2];
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (kind === 'date') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    if (col[0] === 'start' || col[0] === 'end') return Utilities.formatDate(v, tz, 'HH:mm');
    return Utilities.formatDate(v, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }
  if (kind === 'bool') return v === true || String(v).toUpperCase() === 'TRUE';
  if (kind === 'number') return v === '' ? null : Number(v);
  if (kind === 'json') {
    try {
      return v === '' || v == null ? [] : JSON.parse(String(v));
    } catch (e) {
      return [];
    }
  }
  return v === null || v === undefined ? '' : String(v);
}

function applyOp_(op) {
  const s = schemaFor_(op.table);
  const sh = sheetFor_(op.table);
  const map = headerMap_(sh);
  const idCol = map['ID'];
  if (op.op === 'delete') {
    const r = findRow_(sh, idCol, op.id);
    if (r > 0) sh.deleteRow(r);
    return;
  }
  if (op.op !== 'upsert' || !op.record || !op.record.id) throw new Error('Bad change: ' + JSON.stringify(op).slice(0, 120));

  const width = sh.getLastColumn();
  let row = findRow_(sh, idCol, op.record.id);
  if (row < 0) {
    row = Math.max(sh.getLastRow(), 1) + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 50);
  }
  const range = sh.getRange(row, 1, 1, width);
  const values = range.getValues()[0]; // keeps any extra columns you added yourself
  const formats = range.getNumberFormats()[0];
  s.columns.forEach((c) => {
    const col = map[c[1]];
    if (!col) return;
    values[col - 1] = toCell_(c, op.record[c[0]]);
    const fmt = formatFor_(c);
    if (fmt) formats[col - 1] = fmt;
  });
  // formulas in your own extra columns are kept as formulas
  const formulas = range.getFormulas()[0];
  formulas.forEach((f, i) => {
    if (f) values[i] = f;
  });
  range.setNumberFormats([formats]); // formats first so text stays text
  range.setValues([values]);
}

function readAll_() {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const out = {};
  Object.keys(SCHEMA).forEach((table) => {
    const s = SCHEMA[table];
    const sh = sheetFor_(table);
    const map = headerMap_(sh);
    const last = sh.getLastRow();
    out[table] = [];
    if (last < 2) return;
    const values = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
    values.forEach((r) => {
      const rec = {};
      s.columns.forEach((c) => {
        const col = map[c[1]];
        rec[c[0]] = col ? fromCell_(c, r[col - 1], tz) : '';
      });
      if (rec.id) out[table].push(rec);
    });
  });
  return out;
}
