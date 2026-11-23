/**
 * Dialogs at 200 % browser font (Page.setFontSizes 32 px) at 320 and
 * 390 px: the user menu stays on screen, the confirm buttons
 * do not overlap, fields in the add and purchase price dialogs are tall enough
 * for their font and do not stick out. Plus the path of a money input to …
 *
 * Counter-checks (measured 02.11.2026, each alone):
 *   A  .umenu-pop again min-width:14rem without max-width → red: “user menu”
 *      (flap sticks out on the left, both widths)
 *   B  .button-row-center without flex-wrap and without flex basis of the buttons → red:
 *      “320 px: confirm” (390 px stays green: both buttons fit there)
 *   C  .fg input/select height:38px instead of max(38px,2.6em) → red: “add set” at 320
 *      and 390 px (field too low for its font)
 *   D  in acqSave() again parseFloat(value) → red: “149,95 is saved as
 *      149.95” (149)
 *   E  #login-screen [hidden] rule removed → red: “login mask without
 *      passkey …” (a[href] and .btn lifted hidden)
 *   F  .umenu-item>span without overflow-wrap:anywhere → red: “user menu” at 320
 *      and 390 px (“Hintergrundarbeiten” sticks out of the button; 02.11.2026)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { startApp } = require('./helpers/app-browser');
const { patternCollection } = require('./helpers/inventory');

/** What a reviewer sees: over the edge, overlapping, cut off, too low. */
const MEASURE = wurzelSel => `(() => {
  const funde = [], breite = document.documentElement.clientWidth, hoehe = innerHeight;
  const wurzel = document.querySelector(${JSON.stringify(wurzelSel)});
  if (!wurzel) return ['nicht offen: ' + ${JSON.stringify(wurzelSel)}];
  const sichtbar = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden'; };
  const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + ' „' + (e.textContent || e.value || '').trim().replace(/\\s+/g, ' ').slice(0, 20) + '“';
  if (document.documentElement.scrollWidth > breite + 1) funde.push('Seite ' + document.documentElement.scrollWidth + ' px breit');
  const r = wurzel.getBoundingClientRect();
  if (r.left < -1 || r.right > breite + 1) funde.push('ragt hinaus: ' + Math.round(r.left) + '…' + Math.round(r.right));
  if (r.bottom > hoehe + 1 && getComputedStyle(wurzel).overflowY === 'visible') funde.push('unten abgeschnitten');
  const bedien = [...wurzel.querySelectorAll('button, input:not([type=hidden]), select, [role=menuitem]')].filter(sichtbar);
  for (const e of bedien) {
    const b = e.getBoundingClientRect(), s = getComputedStyle(e);
    if (b.left < -1 || b.right > breite + 1) funde.push('über den Rand: ' + name(e));
    if (e.matches('button, [role=menuitem]') && e.scrollWidth > e.clientWidth + 1) funde.push('Text ragt aus ' + name(e));
    if (e.matches('input:not([type=checkbox]):not([type=radio]), select')) {
      const innen = b.height - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom) - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth);
      if (innen < parseFloat(s.fontSize) - 0.5) funde.push('Feld zu niedrig: ' + name(e) + ' ' + Math.round(innen) + ' px für ' + s.fontSize);
    }
  }
  // Was ein rollender Bereich gerade unter seinen Rand geschoben hat, liegt nicht über anderem.
  const inImage = (e) => { const b = e.getBoundingClientRect();
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      if (!/auto|scroll/.test(getComputedStyle(x).overflowY)) continue;
      const k = x.getBoundingClientRect(); if (b.top < k.top - 1 || b.bottom > k.bottom + 1) return false; }
    return true; };
  const ganz = bedien.filter(inImage);
  // Kopf- und Fussleiste kleben; Inhalt, der unter ihnen durchrollt, überlappt nicht.
  const klebt = (e) => { for (let x = e; x; x = x.parentElement) if (getComputedStyle(x).position === 'sticky') return x; return null; };
  for (let i = 0; i < ganz.length; i++) for (let j = i + 1; j < ganz.length; j++) {
    const a = ganz[i].getBoundingClientRect(), c = ganz[j].getBoundingClientRect();
    if (ganz[i].contains(ganz[j]) || ganz[j].contains(ganz[i]) || klebt(ganz[i]) !== klebt(ganz[j])) continue;
    const x = Math.min(a.right, c.right) - Math.max(a.left, c.left), y = Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top);
    if (x > 2 && y > 2) funde.push('überlappen: ' + name(ganz[i]) + ' / ' + name(ganz[j]));
  }
  return funde;
})()`;

test('dialogs at 200 % font on 320 and 390 px', { timeout: 240_000 }, async t => {
  const app = await startApp(t, { name: `dlg_${process.pid}`, holding: patternCollection, telefon: true });
  if (app.reason) {
    t.skip(app.reason);
    return;
  }
  const { b, bis, ruhig } = app;
  // Startup loads settings and prices afterwards; only then is the state fixed.
  await ruhig();
  const zu = () =>
    b.auswerten(`document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open'));
    document.getElementById('confirm-modal').style.display = 'none';
    if (document.getElementById('btn-umenu').getAttribute('aria-expanded') === 'true') document.getElementById('btn-umenu').click(); true`);

  for (const breite of [320, 390]) {
    await b.tab('Emulation.setDeviceMetricsOverride', {
      width: breite,
      height: 700,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await b.tab('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    await ruhig();
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');

    await t.test(`${breite} px: user menu`, async () => {
      // Without a hyphenation dictionary (as in CI Chrome) “Hintergrundarbeiten” stays
      // one piece; hyphens: manual (CSSOM, the CSP blocks <style>) creates this worst case everywhere.
      await b.auswerten(
        `document.querySelectorAll('.umenu-item').forEach(e => e.style.setProperty('hyphens', 'manual', 'important')); true`,
      );
      await b.auswerten(`document.getElementById('btn-umenu').click(); true`);
      await ruhig();
      assert.deepEqual(await b.auswerten(MEASURE('#umenu-pop')), []);
      await zu();
    });

    await t.test(`${breite} px: confirm`, async () => {
      // Deleting a purchase is irreversible and still asks (js/deletion.js); a set goes without a question.
      await b.auswerten(`document.querySelector('#gallery [data-click="openModal"]').click(); true`);
      await bis(`!!document.querySelector('#set-modal.open [data-click="openAcqModal"]')`, 'Set-Detail');
      await b.auswerten(`document.querySelector('#set-modal [data-click="openAcqModal"]').click(); true`);
      await bis(`!!document.querySelector('#acq-modal [data-click="acqDelete"]')`, 'Purchase prices');
      await b.auswerten(`document.querySelector('#acq-modal [data-click="acqDelete"]').click(); true`);
      await bis(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, 'Confirmation dialog');
      await ruhig();
      assert.deepEqual(await b.auswerten(MEASURE('#confirm-modal .modal')), []);
      await b.auswerten(`document.getElementById('cd-cancel').click(); true`);
      await ruhig();
      await zu();
    });

    await t.test(`${breite} px: capture set`, async () => {
      await b.auswerten(`document.querySelector('[data-click="openCapture"][data-arg="set"]').click(); true`);
      await ruhig();
      assert.deepEqual(await b.auswerten(MEASURE('#add-set-modal .modal')), []);
      await zu();
    });

    await t.test(`${breite} px: purchase price`, async () => {
      await b.auswerten(`document.querySelector('#gallery [data-click="openModal"]').click(); true`);
      await bis(
        `document.getElementById('set-modal').classList.contains('open') && document.querySelector('#set-modal [data-click="openAcqModal"]')`,
        'Set-Detail',
      );
      await b.auswerten(`document.querySelector('#set-modal [data-click="openAcqModal"]').click(); true`);
      await bis(`document.querySelector('#acq-modal .acq-price')`, 'Kaufpreis-Dialog');
      assert.deepEqual(await b.auswerten(MEASURE('#acq-modal .modal')), []);
      await zu();
    });
  }

  await t.test('149,95 is saved as 149.95', async () => {
    const sn = await b.auswerten(`(document.querySelector('#gallery [data-click="openModal"]').dataset.arg)`);
    await b.auswerten(`document.querySelector('#gallery [data-click="openModal"]').click(); true`);
    await bis(`document.querySelector('#set-modal [data-click="openAcqModal"]')`, 'Set-Detail');
    await b.auswerten(`document.querySelector('#set-modal [data-click="openAcqModal"]').click(); true`);
    await bis(`document.querySelector('#acq-modal .acq-price')`, 'Kaufpreis-Dialog');
    const id = await b.auswerten(
      `(() => { const f = document.querySelector('#acq-modal .acq-price'); f.focus(); f.select(); return f.id.replace('acq-price-', ''); })()`,
    );
    await b.tab('Input.insertText', { text: '149,95' });
    await b.auswerten(`document.querySelector('#acq-modal .acq-price').blur(); true`);
    await bis(`!document.getElementById('acq-ok-${id}')?.hidden`, 'Marker „Gespeichert“');
    const row = await app.db.get('SELECT set_number, purchase_price FROM set_acquisitions WHERE id = $1', [id]);
    assert.equal(row.set_number, sn);
    assert.equal(Number(row.purchase_price), 149.95);
    // Displayed in the form of the language: de-DE “149,95”, de-CH “149.95”.
    assert.match(await b.auswerten(`document.getElementById('acq-price-${id}').value`), /^149[.,]95$/);
  });

  // The test server has neither APP_BASE_URL nor SMTP: both paths are missing on the mask.
  await t.test('login mask without passkey and "forgot password?"', async () => {
    await zu();
    await b.auswerten(`window.__alt = true; document.getElementById('btn-logout').click(); true`);
    await bis(
      `!window.__alt && getComputedStyle(document.getElementById('login-screen')).display !== 'none' && document.getElementById('link-forgot').hidden`,
      'Anmeldemaske',
    );
    assert.deepEqual(
      await b.auswerten(
        `['btn-passkey', 'link-forgot'].map(id => document.getElementById(id).getClientRects().length)`,
      ),
      [0, 0],
    );
  });
});
