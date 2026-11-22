/* A tiny fake of Google Sheets + Apps Script, just enough to run apps-script/Code.gs
 * in Node for tests. It is NOT a full emulator. Cells formatted 'yyyy-mm-dd' turn
 * typed 'YYYY-MM-DD' strings into Date objects, like real Sheets does. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEFAULT_FORMAT = '0.###############';

function makeSheet(name) {
  const sh = {
    name, cells: [], formats: [], maxRows: 1000,
    getName: () => name,
    getMaxRows: () => sh.maxRows,
    getLastRow: () => {
      for (let r = sh.cells.length - 1; r >= 0; r--) if ((sh.cells[r] || []).some((v) => v !== '' && v != null)) return r + 1;
      return 0;
    },
    getLastColumn: () => Math.max(0, ...sh.cells.map((row) => {
      for (let c = (row || []).length - 1; c >= 0; c--) if (row[c] !== '' && row[c] != null) return c + 1;
      return 0;
    })),
    getRange: (r, c, nr = 1, nc = 1) => {
      if (r < 1 || c < 1 || r + nr - 1 > sh.maxRows) throw new Error(`Range out of bounds (${r},${c},${nr},${nc}) max ${sh.maxRows}`);
      return makeRange(sh, r, c, nr, nc);
    },
    insertRowsAfter: (after, n) => { sh.maxRows += n; },
    deleteRow: (r) => { sh.cells.splice(r - 1, 1); sh.formats.splice(r - 1, 1); sh.maxRows -= 1; },
    setFrozenRows: () => {},
  };
  return sh;
}

function makeRange(sh, r, c, nr, nc) {
  const each = (fn) => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => fn(r - 1 + i, c - 1 + j)));
  const set = (grid, store) => {
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
      const R = r - 1 + i, C = c - 1 + j;
      store[R] = store[R] || [];
      store[R][C] = grid[i][j];
    }
  };
  const fmtAt = (R, C) => (sh.formats[R] && sh.formats[R][C]) || DEFAULT_FORMAT;
  const range = {
    getValues: () => each((R, C) => (sh.cells[R] && sh.cells[R][C] != null ? sh.cells[R][C] : '')),
    setValues: (grid) => {
      if (grid.length !== nr || grid[0].length !== nc) throw new Error('setValues size mismatch');
      const parsed = grid.map((row, i) => row.map((v, j) => {
        const f = fmtAt(r - 1 + i, c - 1 + j);
        if (typeof v === 'string' && f !== '@') {
          const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
          if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
          if (/^\d{1,2}:\d{2}$/.test(v)) return new Date(1899, 11, 30, ...v.split(':').map(Number));
        }
        return v;
      }));
      set(parsed, sh.cells);
      return range;
    },
    getNumberFormats: () => each(fmtAt),
    setNumberFormats: (grid) => { set(grid, sh.formats); return range; },
    setNumberFormat: (f) => { set(Array.from({ length: nr }, () => Array(nc).fill(f)), sh.formats); return range; },
    getFormulas: () => each(() => ''),
    setFontWeight: () => range,
    setBackground: () => range,
    createTextFinder: (text) => ({
      matchEntireCell() { return this; },
      findNext() {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
          const v = sh.cells[r - 1 + i] && sh.cells[r - 1 + i][c - 1 + j];
          if (String(v ?? '') === text) return { getRow: () => r + i };
        }
        return null;
      },
    }),
  };
  return range;
}

function makeSpreadsheet() {
  const sheets = [makeSheet('Sheet1')];
  return {
    sheets,
    getName: () => 'Test Tracker Sheet',
    getSpreadsheetTimeZone: () => 'Australia/Melbourne',
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); sheets.push(s); return s; },
    deleteSheet: (s) => sheets.splice(sheets.indexOf(s), 1),
  };
}

/** Load Code.gs with a fresh fake spreadsheet. Returns { doGet, doPost, ss, call } */
function loadScript(secret = 'test-key') {
  const ss = makeSpreadsheet();
  const pad = (n) => String(n).padStart(2, '0');
  const context = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, flush: () => {} },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ setMimeType() { return this; }, getContent: () => s }),
    },
    Utilities: {
      formatDate: (d, tz, pattern) => pattern
        .replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
        .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds()))
        .replace(/'/g, ''),
    },
  };
  vm.createContext(context);
  let code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
  code = code.replace("const SECRET_KEY = 'CHANGE-ME';", `const SECRET_KEY = ${JSON.stringify(secret)};`);
  vm.runInContext(code, context);
  const call = {
    get: (params) => JSON.parse(context.doGet({ parameter: params }).getContent()),
    post: (body) => JSON.parse(context.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
  };
  return { context, ss, call };
}

module.exports = { loadScript };
