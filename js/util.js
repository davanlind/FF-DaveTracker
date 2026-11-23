/* F&F Tracker — small helpers shared by every file.
 * Dates are handled as plain 'YYYY-MM-DD' strings in the device's local time,
 * and clock times as 'HH:MM' strings. This avoids time-zone surprises. */
window.FF = window.FF || {};

FF.VERSION = '1.7.0';

/** True when running inside the Android app (android/ folder), false on the website. */
FF.isApp = !!window.FFAndroid;
FF.APK_URL = 'https://github.com/davanlind/FF-DaveTracker/releases/latest/download/FF-Tracker.apk';
FF.WATCH_APK_URL = 'https://github.com/davanlind/FF-DaveTracker/releases/latest/download/FF-Tracker-Watch.apk';
FF.WATCH_GUIDE_URL = 'https://github.com/davanlind/FF-DaveTracker/blob/main/docs/WATCH_APP.md';

FF.util = (() => {
  const pad = (n) => String(n).padStart(2, '0');

  /** Unique id like "log_lx9k2a8f3q1". The prefix makes the Sheet easier to read. */
  const uid = (prefix) =>
    `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseYmd = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const today = () => ymd(new Date());
  const addDays = (s, n) => {
    const d = parseYmd(s);
    d.setDate(d.getDate() + n);
    return ymd(d);
  };
  /** The Monday on or before the given date (weeks start on Monday). */
  const mondayOf = (s) => {
    const d = parseYmd(s);
    const daysSinceMonday = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - daysSinceMonday);
    return ymd(d);
  };
  /** Every date from start to end inclusive. */
  const dateRange = (start, end) => {
    const out = [];
    for (let s = start; s <= end; s = addDays(s, 1)) out.push(s);
    return out;
  };

  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const nowHm = () => hm(new Date());
  const toMins = (hhmm) => {
    const [h, m] = String(hhmm || '0:0').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const fromMins = (mins) => {
    const m = ((Math.round(mins) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  };
  /** Minutes from start to end; if end is earlier it is treated as after midnight. */
  const minutesBetween = (start, end) => {
    let m = toMins(end) - toMins(start);
    if (m < 0) m += 1440;
    return m;
  };

  const fmtDate = (s, opts) =>
    parseYmd(s).toLocaleDateString('en-AU', opts || { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtDateLong = (s) =>
    fmtDate(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  /** 95 -> "1h 35m", 60 -> "1h", 20 -> "20m", -15 -> "-15m" */
  const fmtMins = (mins) => {
    let m = Math.round(Number(mins) || 0);
    const neg = m < 0;
    m = Math.abs(m);
    const h = Math.floor(m / 60);
    const r = m % 60;
    const s = h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
    return (neg ? '-' : '') + s;
  };

  /** Stopwatch style for the running timer: "1:05:09" */
  const fmtClock = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return `${h}:${pad(m)}:${pad(s)}`;
  };

  /**
   * Turns what someone types into minutes. Accepts:
   *   "90" (minutes), "1:30", "1.5h", "1h30", "1h 30m", "45m", "2 hours"
   * Returns null if it can't understand it.
   */
  const parseDuration = (input) => {
    if (input == null) return null;
    const s = String(input).trim().toLowerCase().replace(/\s+/g, '');
    if (!s) return null;
    let m = s.match(/^(\d+):(\d{1,2})$/);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    m = s.match(/^\d+(\.\d+)?$/);
    if (m) return Math.round(parseFloat(s));
    m = s.match(/^(?:(\d+(?:\.\d+)?)h(?:ours?|rs?)?)?(?:(\d+)(?:m(?:ins?|inutes?)?)?)?$/);
    if (m && (m[1] || m[2])) return Math.round(parseFloat(m[1] || 0) * 60 + parseInt(m[2] || 0, 10));
    return null;
  };

  /** Escape text before putting it into HTML. Use for EVERYTHING the user typed. */
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const sum = (arr, fn) => arr.reduce((t, x) => t + (Number(fn ? fn(x) : x) || 0), 0);

  const groupBy = (arr, fn) => {
    const map = new Map();
    arr.forEach((x) => {
      const k = fn(x);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    });
    return map;
  };

  const download = (filename, text, type = 'text/plain') => {
    // In the Android app, the app itself saves the file into Downloads.
    if (window.FFAndroid && window.FFAndroid.saveFile) {
      window.FFAndroid.saveFile(filename, type, text);
      return;
    }
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  };

  const csvCell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

  return {
    pad, uid, ymd, parseYmd, today, addDays, mondayOf, dateRange,
    hm, nowHm, toMins, fromMins, minutesBetween,
    fmtDate, fmtDateLong, fmtMins, fmtClock, parseDuration,
    esc, sum, groupBy, download, toCsv,
  };
})();
