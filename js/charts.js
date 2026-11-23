/* F&F Tracker — charts for one day (Today's "Logged today" and the Log tab's Day view).
 *
 *  dayCharts(date) – everything below together; tapping a part of the timeline or the clock
 *                    highlights that stretch in both and shows what it was.
 *  dayTimeline(date) – one long bar from the first thing logged to the end of the last,
 *                    split into coloured stretches (gaps = breaks / nothing logged).
 *
 *  dayRing(date) – a 12-hour clock face. Outer ring = morning (AM), inner ring = afternoon
 *                  and evening (PM). Each coloured arc is a stretch of work at that time of day.
 *                  Faded arcs are time still open on a timer (running or on hold).
 *  dayBars(date) – a bar per task: how long it took that day, longest first.
 *
 * Both are plain SVG/HTML strings. Tapping an arc shows its details (data-action="chart-pick").
 * Tapping a colour swatch opens the colour picker (data-action="color-pick").
 */
FF.actions = FF.actions || {};

FF.charts = (() => {
  const U = FF.util;
  const S = FF.store;
  const esc = U.esc;

  /** Everything worked on `date`: [{ name, start, end (minutes from midnight), open, label }] */
  function pieces(date) {
    const out = [];
    S.all('log')
      .filter((e) => e.date === date)
      .forEach((e) => {
        const start = U.toMins(e.start);
        const end = Math.min(1440, start + (Number(e.minutes) || 0));
        out.push({ name: e.task, location: e.location, start, end, open: false, label: `${e.task} · ${e.start}–${e.end} · ${U.fmtMins(e.minutes)}${e.location ? ` · 📍 ${e.location}` : ''}` });
      });
    const dayStart = U.parseYmd(date).getTime();
    const dayEnd = dayStart + 86400000;
    const now = Date.now();
    S.all('active').forEach((r) =>
      r.segments.forEach((g) => {
        const a = Math.max(new Date(g.start).getTime(), dayStart);
        const b = Math.min(g.end ? new Date(g.end).getTime() : now, dayEnd);
        if (b <= a) return;
        const start = (a - dayStart) / 60000;
        const end = (b - dayStart) / 60000;
        out.push({
          name: r.task, location: g.location || '', start, end, open: true,
          label: `${r.task} · ${U.fromMins(start)}–${g.end ? U.fromMins(end) : 'now'} · ${U.fmtMins(end - start)}${g.location ? ` · 📍 ${g.location}` : ''} (${g.end ? 'on hold, not saved yet' : 'running'})`,
        });
      })
    );
    return out.sort((x, y) => x.start - y.start);
  }

  /* ---------- clock ring ---------- */
  const CX = 170;
  const CY = 170;
  const RINGS = { am: 146, pm: 114 }; // ring centre-line radii
  const W = 28; // ring thickness

  const point = (r, deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
  };
  const f = (n) => n.toFixed(2);
  function arc(r, a0, a1) {
    if (a1 - a0 >= 359.9) a1 = a0 + 359.9;
    const [x0, y0] = point(r, a0);
    const [x1, y1] = point(r, a1);
    return `M${f(x0)} ${f(y0)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`;
  }

  function dayRing(date) {
    const isToday = date === U.today();
    const all = pieces(date);
    FF.colors.ensure(all.map((p) => p.name));
    const logged = U.sum(all.filter((p) => !p.open), (p) => p.end - p.start);
    const open = U.sum(all.filter((p) => p.open), (p) => p.end - p.start);

    // track + hour ticks (ticks sit under the arcs, so they show only on empty time)
    let svg = '';
    ['am', 'pm'].forEach((k) => {
      svg += `<circle cx="${CX}" cy="${CY}" r="${RINGS[k]}" class="ring-track" stroke-width="${W}"/>`;
      for (let h = 0; h < 12; h++) {
        const [x0, y0] = point(RINGS[k] - W / 2, h * 30);
        const [x1, y1] = point(RINGS[k] + W / 2, h * 30);
        svg += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" class="ring-tick"/>`;
      }
    });

    // arcs, split at midday so each part lands on the right ring
    all.forEach((p, i) => {
      [['am', 0, 720], ['pm', 720, 1440]].forEach(([k, lo, hi]) => {
        const s = Math.max(p.start, lo);
        const e = Math.min(p.end, hi);
        if (e <= s) return;
        let a0 = ((s - lo) / 720) * 360;
        let a1 = ((e - lo) / 720) * 360;
        if (a1 - a0 > 2.4) {
          a0 += 0.6; // a thin gap between neighbouring stretches
          a1 -= 0.6;
        } else {
          const mid = (a0 + a1) / 2; // very short: still show a sliver
          a0 = mid - 0.7;
          a1 = mid + 0.7;
        }
        const color = FF.colors.colorFor(p.name);
        svg += `<path d="${arc(RINGS[k], a0, a1)}" stroke="${esc(color)}" stroke-width="${W}" class="ring-arc${p.open ? ' open' : ''}"
          data-action="chart-pick" data-info="${esc(p.label)}" data-i="${i}"><title>${esc(p.label)}</title></path>`;
      });
    });

    // clock numbers
    for (let h = 1; h <= 12; h++) {
      const [x, y] = point(78, h * 30);
      svg += `<text x="${f(x)}" y="${f(y)}" class="ring-num${h % 3 === 0 ? ' major' : ''}">${h}</text>`;
    }

    // the time now
    if (isToday) {
      const d = new Date();
      const m = d.getHours() * 60 + d.getMinutes();
      const k = m < 720 ? 'am' : 'pm';
      const deg = ((m % 720) / 720) * 360;
      const [x0, y0] = point(58, deg);
      const [x1, y1] = point(RINGS[k] + W / 2 + 4, deg);
      const [dx, dy] = point(RINGS[k], deg);
      svg += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" class="ring-hand"/>`;
      svg += `<circle cx="${f(dx)}" cy="${f(dy)}" r="5" class="ring-hand-dot"/>`;
    }

    // middle: total
    svg += `<text x="${CX}" y="${CY - 4}" class="ring-total">${esc(U.fmtMins(logged))}</text>`;
    svg += `<text x="${CX}" y="${CY + 18}" class="ring-sub">${isToday ? 'logged today' : 'logged'}</text>`;
    if (open >= 1) svg += `<text x="${CX}" y="${CY + 36}" class="ring-sub">+ ${esc(U.fmtMins(open))} on timers</text>`;

    const summary = `Clock of the day: ${all.length ? all.map((p) => p.label).join('; ') : 'nothing logged yet'}`;
    return `
      <figure class="day-ring">
        <svg viewBox="0 0 340 340" role="img" aria-label="${esc(summary)}">${svg}</svg>
        <figcaption>
          <div class="ring-key"><span><i class="key-ring outer"></i>Outer ring: AM</span><span><i class="key-ring inner"></i>Inner ring: PM</span>${open ? '<span><i class="key-ring faded"></i>Faded: still on a timer</span>' : ''}</div>
        </figcaption>
      </figure>`;
  }

  /* ---------- timeline: the working day as one bar ---------- */
  const hourLabel = (m) => {
    const h = Math.floor(m / 60) % 24;
    return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
  };

  /** Minutes covered by at least one piece (overlaps counted once). */
  function coveredMinutes(all) {
    const spans = all.map((p) => [p.start, p.end]).sort((a, b) => a[0] - b[0]);
    let total = 0;
    let cur = null;
    spans.forEach(([s, e]) => {
      if (!cur || s > cur[1]) {
        if (cur) total += cur[1] - cur[0];
        cur = [s, e];
      } else cur[1] = Math.max(cur[1], e);
    });
    if (cur) total += cur[1] - cur[0];
    return total;
  }

  function dayTimeline(date) {
    const all = pieces(date);
    if (!all.length) return '';
    FF.colors.ensure(all.map((p) => p.name));
    const first = Math.min(...all.map((p) => p.start));
    const lastEnd = Math.max(...all.map((p) => p.end));
    const span = Math.max(lastEnd - first, 1);
    const pct = (m) => ((m - first) / span) * 100;
    const segs = all
      .map((p, i) => {
        const left = pct(p.start);
        const width = Math.max(pct(p.end) - left, 0.8);
        return `<span class="tl-seg${p.open ? ' open' : ''}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%;background:${esc(FF.colors.colorFor(p.name))}"
          data-action="chart-pick" data-info="${esc(p.label)}" data-i="${i}" title="${esc(p.label)}"></span>`;
      })
      .join('');
    const step = span <= 6 * 60 ? 60 : span <= 12 * 60 ? 120 : 180;
    let ticks = '';
    for (let m = Math.ceil(first / step) * step; m < lastEnd; m += step) {
      const x = pct(m);
      if (x < 7 || x > 93) continue; // keep clear of the start/end labels
      ticks += `<span class="tl-tick" style="left:${x.toFixed(2)}%">${hourLabel(m)}</span>`;
    }
    const worked = coveredMinutes(all);
    const gaps = span - worked;
    return `
      <div class="timeline" role="img" aria-label="${esc(`Day from ${U.fromMins(first)} to ${U.fromMins(lastEnd)}: ${all.map((p) => p.label).join('; ')}`)}">
        <div class="tl-ends"><span>First <b>${U.fromMins(first)}</b></span><span>Last <b>${U.fromMins(lastEnd)}</b></span></div>
        <div class="tl-bar">${segs}</div>
        <div class="tl-ticks">${ticks}</div>
        <div class="tl-sum">${U.fmtMins(span)} day · ${U.fmtMins(worked)} on tasks${gaps >= 1 ? ` · ${U.fmtMins(gaps)} gaps` : ''}</div>
      </div>`;
  }

  /* ---------- time by location ---------- */
  function dayLocations(date) {
    const all = pieces(date);
    if (!all.some((p) => p.location)) return '';
    const by = new Map();
    all.forEach((p) => {
      const k = p.location || 'No location';
      by.set(k, (by.get(k) || 0) + (p.end - p.start));
    });
    const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const max = Math.max(...rows.map((r) => r[1]), 1);
    return `
      <div class="task-bars-head"><h4>Time by location</h4></div>
      <ul class="loc-bars">${rows
        .map(([name, mins]) => `
          <li><span class="tb-name">📍 ${esc(name)}</span><span class="tb-val">${esc(U.fmtMins(mins))}</span>
            <span class="tb-track"><span class="tb-fill loc" style="width:${((mins / max) * 100).toFixed(2)}%"></span></span></li>`)
        .join('')}</ul>`;
  }

  /** Timeline, clock, bars and locations for one day, linked together. */
  function dayCharts(date) {
    const any = pieces(date).length > 0;
    return `
      <div class="day-charts">
        ${dayTimeline(date)}
        <div class="chart-info" aria-live="polite">${any ? 'Tap a coloured part of the timeline or clock to see what it was.' : date === U.today() ? 'Nothing yet. Start a task and it will fill in here.' : 'Nothing was logged on this day.'}</div>
        ${dayRing(date)}
        ${dayBars(date)}
        ${dayLocations(date)}
      </div>`;
  }

  /* ---------- bars: time per task ---------- */
  function dayBars(date) {
    const all = pieces(date);
    if (!all.length) return '';
    const byName = new Map();
    all.forEach((p) => {
      const k = p.name.trim().toLowerCase();
      if (!byName.has(k)) byName.set(k, { name: p.name, logged: 0, open: 0 });
      byName.get(k)[p.open ? 'open' : 'logged'] += p.end - p.start;
    });
    const rows = [...byName.values()].sort((a, b) => b.logged + b.open - (a.logged + a.open));
    const max = Math.max(...rows.map((r) => r.logged + r.open), 1);
    return `
      <div class="task-bars-head"><h4>Time per task</h4><span class="hint">Tap a colour to change it</span></div>
      <ul class="task-bars">${rows
        .map((r) => {
          const c = FF.colors.colorFor(r.name);
          return `
          <li>
            <button class="swatch" style="background:${esc(c)}" data-action="color-pick" data-name="${esc(r.name)}" aria-label="Change colour for ${esc(r.name)}"></button>
            <span class="tb-name">${esc(r.name)}</span>
            <span class="tb-val">${esc(U.fmtMins(r.logged + r.open))}${r.open >= 1 ? `<span class="muted"> (${esc(U.fmtMins(r.open))} open)</span>` : ''}</span>
            <span class="tb-track"><span class="tb-fill" style="width:${((r.logged / max) * 100).toFixed(2)}%;background:${esc(c)}"></span><span class="tb-fill open" style="width:${((r.open / max) * 100).toFixed(2)}%;background:${esc(c)}"></span></span>
          </li>`;
        })
        .join('')}</ul>`;
  }

  FF.actions['chart-pick'] = (el) => {
    const wrap = el.closest('.day-charts') || document;
    const info = wrap.querySelector('.chart-info');
    const again = el.classList.contains('picked');
    wrap.querySelectorAll('.picked').forEach((n) => n.classList.remove('picked'));
    if (again) {
      // tap the same part again to clear
      if (wrap.classList) wrap.classList.remove('has-pick');
      if (info) info.textContent = 'Tap a coloured part of the timeline or clock to see what it was.';
      return;
    }
    if (info) info.textContent = el.dataset.info;
    if (wrap.classList) wrap.classList.add('has-pick');
    wrap.querySelectorAll(`[data-action="chart-pick"][data-i="${el.dataset.i}"]`).forEach((n) => n.classList.add('picked'));
  };
  FF.actions['color-pick'] = (el) => FF.colors.picker(el.dataset.name);

  return { pieces, dayRing, dayBars, dayTimeline, dayLocations, dayCharts };
})();
