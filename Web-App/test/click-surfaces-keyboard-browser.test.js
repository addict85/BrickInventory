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
const reiter = r => klick(`.ntab[data-tab="${r}"]`);
const sicht = s => klick(`.umenu-item[data-arg="${s}"]`);
const ansicht = (id, wert) => klick(`[data-click="chooseView"][data-arg="${id}"][data-arg2="${wert}"]`);

const SEITEN = [
  ['Sammlung', [reiter('gallery')]],
  ['Sammlung Tabelle', [reiter('gallery'), klick('#vl')]],
  ['Teile', [reiter('parts'), klick('#vg')]],
  ['Teile Tabelle', [reiter('parts'), ansicht('parts-view', 'table')]],
  ['Minifiguren', [reiter('minifigs'), ansicht('parts-view', 'grid')]],
  ['Minifiguren Tabelle', [reiter('minifigs'), ansicht('figs-view', 'table')]],
  ['Bauliste', [reiter('partslist'), ansicht('figs-view', 'grid')]],
  ['Finanzen', [reiter('finance')]],
  ['Merkliste', [reiter('wanted')]],
  ['Katalog', [reiter('catalog')]],
  ['Hintergrundarbeiten', [reiter('monitor')]],
  [
    'Einstellungen',
    [
      reiter('settings'),
      `document.querySelectorAll('#global-settings-grid > .ssec').forEach(a => a.classList.add('settings-active')); true`,
    ],
  ],
  ...['profile', 'vouchers', 'alerts', 'locations', 'household', 'data', 'app'].map(s => [`Sicht ${s}`, [sicht(s)]]),
  ['Set-Detail', [reiter('gallery'), klick('#gallery [data-click="openModal"]')]],
];

/** Click surfaces without a keyboard path; one line per kind so that the message stays short. */
const UNBEDIENBAR = `(() => {
  const NATIV = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'LABEL', 'OPTION']);
  const bedienbar = (el) => NATIV.has(el.tagName) || (el.tabIndex >= 0 && el.hasAttribute('tabindex') && !!el.getAttribute('role'))
    || (el.tagName === 'TR' && !!el.querySelector('.row-open[data-click="' + el.dataset.click + '"]'));
  const funde = new Set();
  for (const el of document.querySelectorAll('[data-click]')) {
    if (!el.checkVisibility() || bedienbar(el) || el.dataset.click === 'stopEvent') continue;
    const huelle = el.parentElement?.closest('[data-click], button, a');
    if (el.getAttribute('aria-hidden') === 'true' && huelle && bedienbar(huelle)) continue;
    funde.add(el.tagName + '.' + [...el.classList].join('.') + ' ' + el.dataset.click);
  }
  return [...funde]; })()`;

test('click areas with the keyboard', { timeout: 280_000 }, async t => {
  const app = await startApp(t, { name: `kft_${process.pid}`, holding: patternHousehold });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  const rest = () => b.auswerten(`new Promise(r => setTimeout(() => requestAnimationFrame(() => r(true)), 700))`);

  await t.test('every click area is operable', async () => {
    const funde = [];
    let geprueft = 0;
    for (const [seite, steps] of SEITEN) {
      await b.auswerten(`document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); true`);
      for (const s of steps) {
        await b.auswerten(s);
        await rest();
      }
      geprueft += await b.auswerten(
        `[...document.querySelectorAll('[data-click]')].filter(e => e.checkVisibility()).length`,
      );
      for (const f of await b.auswerten(UNBEDIENBAR)) funde.push(`${seite}: ${f}`);
    }
    assert.ok(geprueft > 200, `only ${geprueft} click surfaces seen — does the test still check anything?`);
    assert.deepEqual(funde, []);
  });

  await t.test('figure from set via keyboard', async () => {
    await b.auswerten(`document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open')); true`);
    await b.auswerten(reiter('minifigs'));
    for (const [wert, sel] of [
      ['grid', '#figs-list .part-card[data-click="openSetItemDetail"]'],
      ['table', '#figs-list tr .row-open[data-click="openSetItemDetail"]'],
    ]) {
      await b.auswerten(ansicht('figs-view', wert));
      await bis(`!!document.querySelector(${JSON.stringify(sel)})`, `Minifig from set (${wert})`);
      // Get there with Tab, not with focus(): the finding was that the tab order skipped them.
      await b.auswerten(`document.activeElement?.blur(); document.getElementById('fig-search').focus(); true`);
      let erreicht = false;
      for (let i = 0; i < 60 && !erreicht; i++) {
        await b.tab('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
        erreicht = await b.auswerten(`document.activeElement === document.querySelector(${JSON.stringify(sel)})`);
      }
      assert.ok(erreicht, `${wert}: Tab does not reach the minifig from the set`);
      await b.tab('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        text: '\r',
      });
      await b.tab('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await bis(
        `document.getElementById('setitem-modal')?.classList.contains('open')`,
        `${wert}: input opens the dialog`,
      );
      await bis(
        `/Marty McFly/.test(document.getElementById('setitem-modal').textContent)`,
        `${wert}: dialog of the minifig`,
      );
      await b.auswerten(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
      await bis(`!document.getElementById('setitem-modal').classList.contains('open')`, 'Dialog zu');
    }
    await b.auswerten(ansicht('figs-view', 'grid'));
  });
});
