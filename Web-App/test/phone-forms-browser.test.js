/**
 * Forms and filters on the phone (390 px), measured in Chrome on the real app:
 * dialog „Set hinzufügen“, catalog filters and the section bar of the settings.
 *
 * Counter-checks (measured 08.11.2026, each on its own):
 *   A  the rule `.capture-grid > .fg:has(> .price-with-currency)` removed in mobile.css
 *      → red: “add set: purchase price placeholder fully visible” („Platzhalter braucht 65 px,
 *      das Feld hat 58 px“)
 *   B  (14.11.2026, round 24: filters behind the button) the rule
 *      `#tab-catalog .filter-bar.open > :is(#cat-year-from, #cat-year-to)` removed in mobile.css
 *      → red: “catalog: filters in four rows, nothing cut off” („stehen in 5 Zeilen“)
 *   C  in styles.css the arrow rules of the section bar (`.settings-nav[data-more*="r"]::after`)
 *      reset to the old character without a button (width:2rem, border:0)
 *      → red: “settings: arrow as a button while there are sections to the right”
 *   D  the line `nav.dataset.more = …` removed in mobile.js → red: “settings: arrow as a
 *      button …” and “… switches the page at the end” (no data-more)
 *
 * Without Chrome (CHROME_BIN, google-chrome, chromium) it is skipped.
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');

/**
 * Width of the longest text of a field against the inner width: a placeholder or an entry of the
 * selection that does not fit in is cut off. Measured with the font of the field itself.
 */
const TEXT_WIDTH = `(el, texts) => { const cs = getComputedStyle(el), c = document.createElement('canvas').getContext('2d');
  c.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
  const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const breit = Math.max(...texts.map(x => c.measureText(x).width));
  return { id: el.id, inner: Math.round(inner), breit: Math.round(breit), fits: breit <= inner }; }`;

test('forms and filters on the phone', { concurrency: 1, timeout: 300_000 }, async t => {
  const app = await startApp(t, { name: `telform_${process.pid}`, phone: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  await settle();
  const switchTab = async name => {
    await b.evaluate(`document.querySelector('.ntab[data-tab="${name}"]').click(); true`);
    await until(`document.getElementById('tab-${name}').classList.contains('active')`, `Reiter ${name}`);
    await settle();
  };

  await t.test('add set: purchase price placeholder fully visible', async () => {
    await switchTab('gallery');
    await b.evaluate(`document.querySelector('button[data-click="openCapture"][data-arg="set"]').click(); true`);
    await until(`document.getElementById('add-set-modal').classList.contains('open')`, 'Dialog offen');
    await settle();
    const m = await b.evaluate(`(() => { const width = ${TEXT_WIDTH};
      const price = document.getElementById('add-price'), currency = document.getElementById('add-currency');
      const modal = document.querySelector('#add-set-modal .modal').getBoundingClientRect();
      const p = price.getBoundingClientRect(), w = currency.getBoundingClientRect();
      return { placeholder: width(price, [price.placeholder]), currency: width(currency, [...currency.options].map(o => o.text)),
               // Die Währung steht neben dem Preis, nicht darunter, und beide bleiben im Dialog.
               nebeneinander: Math.abs(p.top - w.top) < 2, inDialog: w.right <= modal.right + 0.5 && p.left >= modal.left - 0.5,
               page: document.documentElement.scrollWidth }; })()`);
    await b.evaluate(`document.querySelector('#add-set-modal [data-click="closeCapture"]').click(); true`);
    assert.ok(m.placeholder.breit > 0, 'no placeholder measured');
    assert.ok(
      m.placeholder.fits,
      `placeholder needs ${m.placeholder.breit} px, the field has ${m.placeholder.inner} px`,
    );
    assert.ok(m.currency.fits, `currency needs ${m.currency.breit} px, the field has ${m.currency.inner} px`);
    assert.equal(m.nebeneinander, true, 'currency is not next to the price');
    assert.equal(m.inDialog, true, 'price or currency sticks out of the dialog');
    assert.ok(m.page <= 390, `page ${m.page} px wide`);
  });

  await t.test('catalog: filters in four rows, nothing cut off', async () => {
    await switchTab('catalog');
    // Since round 24 behind the funnel button as in the collection; when expanded the same order applies.
    await b.evaluate(`(() => { const k = document.querySelector('#tab-catalog .filter-button');
      if (k.getAttribute('aria-expanded') !== 'true') k.click(); return true; })()`);
    const m = await b.evaluate(`(() => { const width = ${TEXT_WIDTH};
      const ids = ['cat-theme', 'cat-year-from', 'cat-year-to', 'cat-sort'], f = id => document.getElementById(id);
      const r = id => f(id).getBoundingClientRect();
      const lines = new Set(['cat-search', ...ids].map(id => Math.round(r(id).top)));
      return { lines: lines.size, fields: ids.map(id => width(f(id), [...f(id).options].map(o => o.text))),
               yearsEqual: Math.abs(r('cat-year-to').top - r('cat-year-from').top) < 2,
               themeFull: Math.abs(r('cat-theme').width - f('cat-theme').parentElement.clientWidth) < 2, page: document.documentElement.scrollWidth }; })()`);
    assert.equal(m.lines, 4, `search, theme, the years and the sorting are on ${m.lines} lines`);
    assert.equal(m.yearsEqual, true, 'year from and year to are not on one line');
    assert.equal(m.themeFull, true, 'theme is not as wide as the filter bar');
    assert.deepEqual(
      m.fields.filter(x => !x.fits),
      [],
      'abgeschnittene Auswahlfelder (id, Innenbreite, Textbreite)',
    );
    assert.ok(m.page <= 390, `page ${m.page} px wide`);
  });

  await t.test('settings: arrow as a button while there are sections to the right', async () => {
    await switchTab('settings');
    await until(
      `document.querySelector('.settings-nav')?.getClientRects().length > 0 && !!document.querySelector('.settings-nav').dataset.more`,
      'Abschnittsleiste mit Hinweis',
    );
    const m =
      await b.evaluate(`(() => { const nav = document.querySelector('.settings-nav'), s = getComputedStyle(nav, '::after');
      return { more: nav.dataset.more, content: s.content, width: parseFloat(s.width), height: parseFloat(s.height),
               rand: parseFloat(s.borderTopWidth), rund: s.borderTopLeftRadius, fuellung: s.backgroundColor,
               rollt: nav.scrollWidth > nav.clientWidth, lines: new Set([...nav.querySelectorAll('a')].map(a => Math.round(a.getBoundingClientRect().top))).size }; })()`);
    assert.equal(m.rollt, true, 'the bar does not scroll at all');
    assert.equal(m.more, 'r', 'hint only to the right as long as nothing is hidden on the left');
    assert.match(m.content, /›/);
    assert.ok(m.width >= 32 && m.height >= 32, `arrow ${m.width} × ${m.height} px`);
    assert.ok(m.rand >= 2, `arrow without border (${m.rand} px)`);
    assert.notEqual(m.rund, '0px', 'arrow not round');
    assert.notEqual(m.fuellung, 'rgba(0, 0, 0, 0)', 'arrow without a fill: text runs through behind it');
    assert.equal(m.lines, 1, 'the bar stays on one line');
  });

  await t.test('settings: arrow switches the page at the end', async () => {
    await b.evaluate(
      `(() => { const nav = document.querySelector('.settings-nav'); nav.scrollLeft = nav.scrollWidth; return true; })()`,
    );
    await until(`document.querySelector('.settings-nav').dataset.more === 'l'`, 'Hinweis nach links');
    const m = await b.evaluate(`(() => { const nav = document.querySelector('.settings-nav');
      return { front: getComputedStyle(nav, '::before').content, back: getComputedStyle(nav, '::after').content }; })()`);
    assert.match(m.front, /‹/);
    assert.equal(m.back, 'none', 'at the end nothing is left on the right');
  });
});
