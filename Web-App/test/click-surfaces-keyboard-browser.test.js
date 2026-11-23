/**
 * Every click surface is operable by keyboard (WCAG 2.1.1, level A): on
 * all main pages, in card and table view and in the household, every
 * visible element with data-click that is not a button, link or field has
 * tabindex="0" and a role; a table row carries a row button for it
 * (.row-open) with the same action. Excepted …
 *
 * Counter-checks (measured 04.11.2026, each alone, bundle rebuilt):
 *   A  minifigure tile from sets again without tabindex and role (minifigs.js) →
 *      red: “every click surface is operable” (minifigures: DIV.part-card
 *      openSetItemDetail) and “minifigure from set via keyboard”
 *   B  finance row of parts and minifigures again without tabindex (finanzen.js)
 *      → red: “every click surface is operable” (finances: TR openManDetail)
 *   C  table row of the minifigures again without tabindex → red: “every click surface
 *      is operable” (minifigures table: TR openSetItemDetail)
 *   D  (05.11.2026) row button of the minifigure table replaced by plain text
 *      → red: “every click surface is operable” (minifigures table: TR
 *      openSetItemDetail) and “minifigure from set via keyboard” (table)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternHousehold } = require('./helpers/inventory');

const klick = sel => `document.querySelector(${JSON.stringify(sel)})?.click(); true`;
const switchTab = r => klick(`.ntab[data-tab="${r}"]`);
const view = s => klick(`.umenu-item[data-arg="${s}"]`);
const viewName = (id, value) => klick(`[data-click="chooseView"][data-arg="${id}"][data-arg2="${value}"]`);

const PAGES = [
  ['Sammlung', [switchTab('gallery')]],
  ['Sammlung Tabelle', [switchTab('gallery'), klick('#vl')]],
  ['Teile', [switchTab('parts'), klick('#vg')]],
  ['Teile Tabelle', [switchTab('parts'), viewName('parts-view', 'table')]],
  ['Minifiguren', [switchTab('minifigs'), viewName('parts-view', 'grid')]],
  ['Minifiguren Tabelle', [switchTab('minifigs'), viewName('figs-view', 'table')]],
  ['Bauliste', [switchTab('partslist'), viewName('figs-view', 'grid')]],
  ['Finanzen', [switchTab('finance')]],
  ['Merkliste', [switchTab('wanted')]],
  ['Katalog', [switchTab('catalog')]],
  ['Hintergrundarbeiten', [switchTab('monitor')]],
  [
    'Einstellungen',
    [
      switchTab('settings'),
      `document.querySelectorAll('#global-settings-grid > .ssec').forEach(a => a.classList.add('settings-active')); true`,
    ],
  ],
  ...['profile', 'vouchers', 'alerts', 'locations', 'household', 'data', 'app'].map(s => [`Sicht ${s}`, [view(s)]]),
  ['Set-Detail', [switchTab('gallery'), klick('#gallery [data-click="openModal"]')]],
];

/** Click surfaces without a keyboard path; one line per kind so that the message stays short. */
const UNBEDIENBAR = `(() => {
  const NATIV = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'OPTION']);
  const operable = (el) => NATIV.has(el.tagName) || (el.tabIndex >= 0 && el.hasAttribute('tabindex') && !!el.getAttribute('role'))
    || (el.tagName === 'TR' && !!el.querySelector('.row-open[data-click="' + el.dataset.click + '"]'));
  const findings = new Set();
  for (const el of document.querySelectorAll('[data-click]')) {
    if (!el.checkVisibility() || operable(el) || el.dataset.click === 'stopEvent') continue;
    const shell = el.parentElement?.closest('[data-click], button, a');
    if (el.getAttribute('aria-hidden') === 'true' && shell && operable(shell)) continue;
    findings.add(el.tagName + '.' + [...el.classList].join('.') + ' ' + el.dataset.click);
  }
  return [...findings]; })()`;

test('click areas with the keyboard', { timeout: 280_000 }, async t => {
  const app = await startApp(t, { name: `kft_${process.pid}`, holding: patternHousehold });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, until, settle } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await settle();
  const rest = () => b.evaluate(`new Promise(r => setTimeout(() => requestAnimationFrame(() => r(true)), 700))`);

  await t.test('every click area is operable', async () => {
    const findings = [];
    let checked = 0;
    for (const [page, steps] of PAGES) {
      await b.evaluate(`document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); true`);
      for (const s of steps) {
        await b.evaluate(s);
        await rest();
      }
      checked += await b.evaluate(
        `[...document.querySelectorAll('[data-click]')].filter(e => e.checkVisibility()).length`,
      );
      for (const f of await b.evaluate(UNBEDIENBAR)) findings.push(`${page}: ${f}`);
    }
    assert.ok(checked > 200, `only ${checked} click surfaces seen — does the test still check anything?`);
    assert.deepEqual(findings, []);
  });

  await t.test('figure from set via keyboard', async () => {
    await b.evaluate(`document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); true`);
    await b.evaluate(switchTab('minifigs'));
    for (const [value, sel] of [
      ['grid', '#figs-list .part-card[data-click="openSetItemDetail"]'],
      ['table', '#figs-list tr .row-open[data-click="openSetItemDetail"]'],
    ]) {
      await b.evaluate(viewName('figs-view', value));
      await until(`!!document.querySelector(${JSON.stringify(sel)})`, `Minifig from set (${value})`);
      // Get there with Tab, not with focus(): the finding was that the tab order skipped them.
      await b.evaluate(`document.activeElement?.blur(); document.getElementById('fig-search').focus(); true`);
      let reached = false;
      for (let i = 0; i < 60 && !reached; i++) {
        await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        reached = await b.evaluate(`document.activeElement === document.querySelector(${JSON.stringify(sel)})`);
      }
      assert.ok(reached, `${value}: Tab does not reach the minifig from the set`);
      await b.tab('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        text: '\r',
      });
      await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await until(
        `document.getElementById('setitem-modal')?.classList.contains('open')`,
        `${value}: input opens the dialog`,
      );
      await until(
        `/Marty McFly/.test(document.getElementById('setitem-modal').textContent)`,
        `${value}: dialog of the minifig`,
      );
      await b.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
      await until(`!document.getElementById('setitem-modal').classList.contains('open')`, 'Dialog zu');
    }
    await b.evaluate(viewName('figs-view', 'grid'));
  });
});
