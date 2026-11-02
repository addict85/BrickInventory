/**
 * Dialoge bei 200 % Browser-Schrift (Page.setFontSizes 32 px) auf 320 und
 * 390 px: Das Benutzermenü bleibt im Bildschirm, die Knöpfe des Bestätigens
 * überlappen nicht, Felder im Erfassen- und Kaufpreis-Dialog sind hoch genug
 * für ihre Schrift und ragen nicht hinaus. Dazu der Weg einer Geldeingabe bis
 * in die Datenbank: „149,95“ im Kaufpreis-Dialog wird 149.95 gespeichert.
 * Zuletzt die Anmeldemaske: Was der Server nicht kann, steht nicht da.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  .umenu-pop wieder min-width:14rem ohne max-width → rot: „Benutzermenü“
 *      (Klappe ragt links hinaus, beide Breiten)
 *   B  .knopf-reihe-mitte ohne flex-wrap und ohne flex-Basis der Knöpfe → rot:
 *      „320 px: Bestätigen“ (390 px bleibt grün: dort passen beide Knöpfe)
 *   C  .fg input/select height:38px statt max(38px,2.6em) → rot: „Set erfassen“ bei 320
 *      und 390 px (Feld zu niedrig für seine Schrift)
 *   D  in acqSave() wieder parseFloat(value) → rot: „149,95 wird 149.95
 *      gespeichert“ (149)
 *   E  #login-screen [hidden]-Regel entfernt → rot: „Anmeldemaske ohne
 *      Passkey …“ (a[href] und .btn hoben hidden auf)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteApp, warte } = require('./helpers/app-browser');
const { musterSammlung } = require('./helpers/bestand');

/** Was ein Prüfer sieht: über den Rand, überlappend, abgeschnitten, zu niedrig. */
const MESSEN = (wurzelSel) => `(() => {
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
  const imBild = (e) => { const b = e.getBoundingClientRect();
    for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) {
      if (!/auto|scroll/.test(getComputedStyle(x).overflowY)) continue;
      const k = x.getBoundingClientRect(); if (b.top < k.top - 1 || b.bottom > k.bottom + 1) return false; }
    return true; };
  const ganz = bedien.filter(imBild);
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

test('Dialoge bei 200 % Schrift auf 320 und 390 px', { timeout: 240_000 }, async (t) => {
  const app = await starteApp(t, { name: `dlg_${process.pid}`, bestand: musterSammlung, telefon: true });
  if (app.grund) { t.skip(app.grund); return; }
  const { b, bis } = app;
  await warte(800);
  await b.auswerten(`document.querySelector('#einrichtung-modal.open [data-click="einrichtungSpaeter"]')?.click(); true`);
  const zu = () => b.auswerten(`document.querySelectorAll('.ovl.open').forEach(o => o.classList.remove('open'));
    document.getElementById('confirm-modal').style.display = 'none';
    if (document.getElementById('btn-umenu').getAttribute('aria-expanded') === 'true') document.getElementById('btn-umenu').click(); true`);

  for (const breite of [320, 390]) {
    await b.tab('Emulation.setDeviceMetricsOverride', { width: breite, height: 700, deviceScaleFactor: 1, mobile: true });
    await b.tab('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
    await warte(300);
    await b.auswerten(`document.querySelector('.ntab[data-tab="gallery"]').click(); true`);
    await bis(`document.querySelectorAll('#gallery .sc').length >= 4`, 'Kacheln');

    await t.test(`${breite} px: Benutzermenü`, async () => {
      await b.auswerten(`document.getElementById('btn-umenu').click(); true`);
      await warte(200);
      assert.deepEqual(await b.auswerten(MESSEN('#umenu-pop')), []);
      await zu();
    });

    await t.test(`${breite} px: Bestätigen`, async () => {
      await b.auswerten(`document.querySelector('#gallery .delbtn').click(); true`);
      await bis(`getComputedStyle(document.getElementById('confirm-modal')).display !== 'none'`, 'Bestätigungsdialog');
      await warte(200);
      assert.deepEqual(await b.auswerten(MESSEN('#confirm-modal .modal')), []);
      await b.auswerten(`document.getElementById('cd-cancel').click(); true`);
      await warte(200);
      await zu();
    });

    await t.test(`${breite} px: Set erfassen`, async () => {
      await b.auswerten(`document.querySelector('[data-click="oeffneErfassen"][data-arg="set"]').click(); true`);
      await warte(300);
      assert.deepEqual(await b.auswerten(MESSEN('#add-set-modal .modal')), []);
      await zu();
    });

    await t.test(`${breite} px: Kaufpreis`, async () => {
      await b.auswerten(`document.querySelector('#gallery [data-click="openModal"]').click(); true`);
      await bis(`document.getElementById('set-modal').classList.contains('open') && document.querySelector('#set-modal [data-click="openAcqModal"]')`, 'Set-Detail');
      await b.auswerten(`document.querySelector('#set-modal [data-click="openAcqModal"]').click(); true`);
      await bis(`document.querySelector('#acq-modal .acq-preis')`, 'Kaufpreis-Dialog');
      assert.deepEqual(await b.auswerten(MESSEN('#acq-modal .modal')), []);
      await zu();
    });
  }

  await t.test('149,95 wird 149.95 gespeichert', async () => {
    const sn = await b.auswerten(`(document.querySelector('#gallery [data-click="openModal"]').dataset.arg)`);
    await b.auswerten(`document.querySelector('#gallery [data-click="openModal"]').click(); true`);
    await bis(`document.querySelector('#set-modal [data-click="openAcqModal"]')`, 'Set-Detail');
    await b.auswerten(`document.querySelector('#set-modal [data-click="openAcqModal"]').click(); true`);
    await bis(`document.querySelector('#acq-modal .acq-preis')`, 'Kaufpreis-Dialog');
    const id = await b.auswerten(`(() => { const f = document.querySelector('#acq-modal .acq-preis'); f.focus(); f.select(); return f.id.replace('acq-preis-', ''); })()`);
    await b.tab('Input.insertText', { text: '149,95' });
    await b.auswerten(`document.querySelector('#acq-modal .acq-preis').blur(); true`);
    await bis(`!document.getElementById('acq-ok-${id}')?.hidden`, 'Marke „Gespeichert“');
    const zeile = await app.db.get('SELECT set_number, purchase_price FROM set_acquisitions WHERE id = $1', [id]);
    assert.equal(zeile.set_number, sn);
    assert.equal(Number(zeile.purchase_price), 149.95);
    // Angezeigt in der Form der Sprache: de-DE „149,95“, de-CH „149.95“.
    assert.match(await b.auswerten(`document.getElementById('acq-preis-${id}').value`), /^149[.,]95$/);
  });

  // Der Testserver hat weder APP_BASE_URL noch SMTP: Beide Wege fehlen auf der Maske.
  await t.test('Anmeldemaske ohne Passkey und „Passwort vergessen?“', async () => {
    await zu();
    await b.auswerten(`document.getElementById('btn-logout').click(); true`);
    await bis(`getComputedStyle(document.getElementById('login-screen')).display !== 'none' && document.getElementById('link-forgot').hidden`, 'Anmeldemaske');
    assert.deepEqual(await b.auswerten(`['btn-passkey', 'link-forgot'].map(id => document.getElementById(id).getClientRects().length)`), [0, 0]);
  });
});
