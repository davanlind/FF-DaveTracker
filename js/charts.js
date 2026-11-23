/* F&F Tracker — charts for one day (shown under "Logged today").
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
        out.push({ name: e.task, start, end, open: false, label: `${e.task} · ${e.start}–${e.end} · ${U.fmtMins(e.minutes)}` });
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
          name: r.task, start, end, open: true,
          label: `${r.task} · ${U.fromMins(start)}–${g.end ? U.fromMins(end) : 'now'} · ${U.fmtMins(end - start)} (${g.end ? 'on hold, not saved yet' : 'running'})`,
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
          <div class="ring-info" id="ringInfo" aria-live="polite">${all.length ? 'Tap a coloured part of the clock to see what it was.' : 'Nothing yet. Start a task and it will fill in around the clock.'}</div>
        </figcaption>
      </figure>`;
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
    const info = document.getElementById('ringInfo');
    if (info) info.textContent = el.dataset.info;
    const fig = el.closest('.day-ring');
    const again = el.classList.contains('picked');
    document.querySelectorAll('.ring-arc.picked').forEach((n) => n.classList.remove('picked'));
    if (again) {
      // tap the same part again to clear
      if (fig) fig.classList.remove('has-pick');
      if (info) info.textContent = 'Tap a coloured part of the clock to see what it was.';
      return;
    }
    if (fig) fig.classList.add('has-pick');
    document.querySelectorAll(`.ring-arc[data-i="${el.dataset.i}"]`).forEach((n) => n.classList.add('picked'));
  };
  FF.actions['color-pick'] = (el) => FF.colors.picker(el.dataset.name);

  return { pieces, dayRing, dayBars };
})();
