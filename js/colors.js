/* F&F Tracker — a colour for every task.
 *
 * Each task name gets a colour the first time it shows up in a chart, and keeps it.
 * Colours are saved in the 'colors' table (Sheet tab "Colours"), so the phone and the
 * website match. Tap a colour swatch in the Today charts to change one.
 *
 * PALETTE is a colour-blind-checked set (validated with the dataviz skill's
 * validate_palette.js: CVD ΔE ≥ 9.1, normal-vision ΔE ≥ 19.6 for neighbours, light mode).
 * Some are light on white, so charts always show task names as text too.
 */
FF.colors = (() => {
  const S = FF.store;

  // Automatic colours, used in this order.
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  // Extra choices in the colour picker (not used automatically).
  const EXTRA = ['#0f8a8a', '#8c5a3c', '#b03aa8', '#5d6b78', '#9aa63a', '#24302a'];

  const key = (name) => String(name || '').trim().toLowerCase();
  const idFor = (name) => `color:${key(name)}`;
  const isHex = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ''));

  const stored = (name) => {
    const r = S.get('colors', idFor(name));
    return r && isHex(r.color) ? r.color : null;
  };

  /**
   * Give every name in `names` a colour (saving new ones). Names in the same list are
   * kept apart where possible; otherwise the least-used palette colour is chosen.
   */
  function ensure(names) {
    const list = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
    const inContext = new Set(list.map(stored).filter(Boolean));
    const globalCount = {};
    S.all('colors').forEach((r) => (globalCount[r.color] = (globalCount[r.color] || 0) + 1));
    let added = false;
    list.forEach((name) => {
      if (stored(name)) return;
      let best = PALETTE[0];
      let bestScore = Infinity;
      PALETTE.forEach((c, i) => {
        const score = (inContext.has(c) ? 1000 : 0) + (globalCount[c] || 0) * 10 + i * 0.01;
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      });
      S.upsert('colors', { id: idFor(name), name, color: best, auto: true }, { silent: true });
      inContext.add(best);
      globalCount[best] = (globalCount[best] || 0) + 1;
      added = true;
    });
    return added;
  }

  /** The colour for a task name (assigns one if it doesn't have one yet). */
  function colorFor(name) {
    const c = stored(name);
    if (c) return c;
    ensure([name]);
    return stored(name) || PALETTE[0];
  }

  /** Set a task's colour. Pass '' to go back to an automatic colour. */
  function setColor(name, color) {
    if (!color) {
      if (S.get('colors', idFor(name))) S.remove('colors', idFor(name));
      return;
    }
    if (!isHex(color)) return;
    S.upsert('colors', { id: idFor(name), name: String(name).trim(), color: color.toLowerCase(), auto: false });
  }

  /** Pop-up to choose a colour for one task. */
  function picker(name) {
    const esc = FF.util.esc;
    const current = colorFor(name);
    const swatch = (c) => `
      <label class="swatch-choice" title="${esc(c)}">
        <input type="radio" name="color" value="${esc(c)}" ${c === current ? 'checked' : ''}>
        <span style="background:${esc(c)}"></span>
      </label>`;
    const isCustom = !PALETTE.includes(current) && !EXTRA.includes(current);
    FF.ui.modal({
      title: 'Task colour',
      body: `
        <p><span class="dot big" style="background:${esc(current)}"></span> <b>${esc(name)}</b></p>
        <div class="swatch-grid">${PALETTE.map(swatch).join('')}${EXTRA.map(swatch).join('')}</div>
        <div class="field custom-color">
          <label class="check"><input type="radio" name="color" value="custom" ${isCustom ? 'checked' : ''}>
            <span>Any colour:</span></label>
          <input type="color" name="custom" value="${esc(current)}" aria-label="Pick any colour">
        </div>
        <p class="hint">The colour is used in the charts and next to this task in your log, on every device.</p>`,
      submitLabel: 'Use this colour',
      extraButtons: [{
        label: 'Automatic', cls: 'ghost',
        onClick: () => {
          setColor(name, '');
          FF.ui.toast('Back to an automatic colour');
        },
      }],
      onOpen: (form) => {
        form.elements.custom.addEventListener('input', () => {
          form.querySelector('input[name=color][value=custom]').checked = true;
        });
      },
      onSubmit: (form) => {
        const v = form.elements.color.value;
        setColor(name, v === 'custom' ? form.elements.custom.value : v);
        FF.ui.toast('Colour changed', 'ok');
      },
    });
  }

  return { PALETTE, EXTRA, colorFor, ensure, setColor, picker };
})();
