/**
 * Rückmeldungen in Formularen (UI-Prüfung 17, Abläufe M8–M13, M15, N14,
 * N19), echtes Bündel in jsdom:
 *   - Set-Detail: „abc“ als Alarmschwelle ist ein Fehler am Feld, kein
 *     stilles Löschen; ein nur gebraucht vorhandenes Set wählt „Gebraucht“
 *     vor, und das Feld nennt die Währung.
 *   - Preisalarme: Löschen fragt im eigenen Dialog und bietet Rückgängig.
 *   - Lagerorte: belegte Orte sind nicht löschbar (mit Grund), Umbenennen
 *     meldet Erfolg, ein leerer Name einen Fehler; ab zehn Zeichen vor der
 *     Grenze zählt das Feld mit.
 *   - Gutscheine: die Summe steht je Währung.
 *   - Konto anlegen: Name- und Passwortregel stehen am Feld, bevor die
 *     Passwortabfrage kommt.
 *   - Dunkelmodus „Immer dunkel“ wirkt auch bei hellem System.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  in sendeAlarm die Zeile mit feldFehler entfernt → rot: „Alarm im
 *      Set-Detail“ (DELETE statt Fehlermeldung)
 *   B  in loescheAlarm wieder confirm() → rot: „Alarm löschen mit Dialog
 *      und Rückgängig“
 *   C  in 05-lagerorte `belegt ? ' disabled'` entfernt → rot: „Lagerorte“
 *   D  im Zähler-Listener (01-formular) sofort return → rot: „Lagerorte“
 *   E  in ladeGutscheine wieder eine Summe über alle Währungen → rot:
 *      „Gutscheinsumme je Währung“
 *   F  in 05-nutzerverwaltung die Namensprüfung entfernt → rot: „Konto
 *      anlegen“
 *   G  in 00-theme-boot `w === 'immer' ||` entfernt → rot: „Immer dunkel“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt, sicht } = require('./helpers/oberflaeche');

const SN = '10305-1';
const loeschen = (o, pfad) => o.aufrufe.filter(a => a.method === 'DELETE' && a.url.includes(pfad));

test('Alarm im Set-Detail', async () => {
  const o = await oeffneOberflaeche(
    {
      [`/v1/sets/${SN}`]: {
        success: true,
        set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['U'], instructions: [] },
      },
      [`/v1/sets/${SN}/alert`]: { success: true, alerts: [] },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    const knopf = o.d.createElement('button');
    knopf.dataset.click = 'openModal';
    knopf.dataset.arg = SN;
    o.d.body.append(knopf);
    knopf.click();
    await warte(() => o.d.getElementById('m-alert-val'), 4000);
    assert.equal(o.d.getElementById('m-alert-cond').value, 'U', 'gebrauchtes Set: Gebraucht vorgewählt');
    assert.match(o.d.getElementById('m-alert-val').getAttribute('aria-label'), /EUR/);
    const feld = o.d.getElementById('m-alert-val');
    feld.value = 'abc';
    feld.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await takt(30);
    assert.equal(loeschen(o, '/alert').length, 0, 'abc löschte den Alarm');
    const fehler = o.d.getElementById('m-alert-val-fehler');
    assert.ok(fehler && !fehler.hidden && fehler.textContent.trim(), 'kein Fehler am Feld');
  } finally {
    o.w.close();
  }
});

test('Alarm löschen mit Dialog und Rückgängig', async () => {
  const alarm = {
    set_number: SN,
    name: 'Burg',
    condition: 'N',
    richtung: 'unter',
    schwelle: 249,
    currency_code: 'EUR',
  };
  const o = await oeffneOberflaeche(
    {
      '/v1/alerts': { success: true, alerts: [alarm] },
      [`/v1/sets/${SN}/alert`]: { success: true, alerts: [alarm] },
    },
    { browserSprache: 'de-DE' },
  );
  let browserConfirm = 0;
  o.w.confirm = () => {
    browserConfirm++;
    return true;
  };
  try {
    await sicht(o.w, 'alarme');
    await warte(() => o.d.querySelector('#alerts-list [data-click="loescheAlarm"]'));
    o.d.querySelector('#alerts-list [data-click="loescheAlarm"]').click();
    assert.ok(
      await warte(() => o.d.getElementById('confirm-modal').style.display === 'flex', 1500),
      'kein eigener Dialog',
    );
    assert.equal(browserConfirm, 0);
    o.d.getElementById('cd-confirm').click();
    assert.ok(await warte(() => loeschen(o, `/sets/${SN}/alert`).length === 1));
    const rueck = await warte(
      () => [...o.d.querySelectorAll('#toasts button')].some(b => /Rückgängig/.test(b.textContent)),
      1500,
    );
    assert.ok(rueck, 'kein Rückgängig');
    [...o.d.querySelectorAll('#toasts button')].find(b => /Rückgängig/.test(b.textContent)).click();
    assert.ok(await warte(() => o.aufrufe.some(a => a.method === 'PUT' && a.url.includes(`/sets/${SN}/alert`))));
    const rumpf = JSON.parse(o.aufrufe.find(a => a.method === 'PUT').body);
    assert.deepEqual(rumpf, { richtung: 'unter', schwelle: 249, condition: 'N' });
  } finally {
    o.w.close();
  }
});

test('Lagerorte', async () => {
  const o = await oeffneOberflaeche(
    {
      '/v1/storage/locations': {
        success: true,
        orte: [
          { id: 1, name: 'Regal A' },
          { id: 2, name: 'Kiste B' },
        ],
        vorgabe: null,
      },
      '/v1/storage': { success: true, orte: [{ ort: 'Regal A', sets: 2, teile: 0, figuren: 0 }] },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    await sicht(o.w, 'lagerorte');
    await warte(() => o.d.querySelectorAll('#storage-list [data-click="loescheLagerort"]').length === 2);
    const [regal, kiste] = o.d.querySelectorAll('#storage-list [data-click="loescheLagerort"]');
    assert.equal(regal.disabled, true, 'belegter Ort löschbar');
    assert.match(regal.getAttribute('title'), /2 Sets/);
    assert.equal(kiste.disabled, false);

    const name = o.d.querySelector('#storage-list [data-change="benenneLagerortUm"][data-arg="2"]');
    name.value = 'Kiste C';
    name.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => /Kiste C/.test(o.d.getElementById('toasts').textContent)), 'keine Erfolgsmeldung');
    const nochmal = o.d.querySelector('#storage-list [data-change="benenneLagerortUm"][data-arg="2"]');
    nochmal.value = '  ';
    nochmal.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    assert.ok(
      await warte(() => o.d.querySelector('#toasts .toast.error, #toasts .toast-error, #toasts [class*="error"]')),
      'leerer Name ohne Fehler',
    );

    const neu = o.d.getElementById('storage-new');
    neu.value = 'x'.repeat(55);
    neu.dispatchEvent(new o.w.Event('input', { bubbles: true }));
    const zaehler = neu.nextElementSibling;
    assert.ok(zaehler?.classList.contains('zeichen-zaehler') && !zaehler.hidden, 'kein Zähler');
    assert.match(zaehler.textContent, /55.*60/);
  } finally {
    o.w.close();
  }
});

test('Gutscheinsumme je Währung', async () => {
  const o = await oeffneOberflaeche(
    {
      '/v1/vouchers': {
        success: true,
        vouchers: [
          { id: 1, number: '1111222233334444', amount: 50, currency: 'EUR' },
          { id: 2, number: '5555666677778888', amount: 20, currency: 'EUR' },
          { id: 3, number: '9999000011112222', amount: 30, currency: 'CHF' },
        ],
      },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    await sicht(o.w, 'gutscheine');
    await warte(() => o.d.getElementById('vouchers-total')?.textContent.trim());
    const summe = o.d.getElementById('vouchers-total').textContent.replace(/\s+/g, ' ');
    assert.match(summe, /70,00 € · .*30,00/);
    assert.match(summe, /CHF/);
  } finally {
    o.w.close();
  }
});

test('Konto anlegen: Regeln am Feld vor der Passwortabfrage', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    o.d.getElementById('nu-n').value = 'Bert Müller';
    o.d.getElementById('nu-p').value = 'Lang-genug-Passwort-1';
    o.d.getElementById('btn-cu').click();
    await takt(30);
    assert.ok(
      !o.d.getElementById('nu-n-fehler')?.hidden && o.d.getElementById('nu-n-fehler')?.textContent.trim(),
      'Name ohne Fehler am Feld',
    );
    assert.notEqual(o.d.getElementById('confirm-modal').style.display, 'flex', 'Passwortabfrage trotz falschem Namen');
    o.d.getElementById('nu-n').value = 'bert';
    o.d.getElementById('nu-p').value = 'kurz';
    o.d.getElementById('btn-cu').click();
    await takt(30);
    assert.ok(
      !o.d.getElementById('nu-p-fehler')?.hidden && o.d.getElementById('nu-p-fehler')?.textContent.trim(),
      'Passwort ohne Fehler am Feld',
    );
    assert.match(
      o.d.getElementById('nu-p').getAttribute('aria-describedby'),
      /nu-p-regel/,
      'Regelhinweis bleibt verknüpft',
    );
    assert.ok(!o.aufrufe.some(a => a.method === 'POST' && a.url.includes('/auth/users')));
  } finally {
    o.w.close();
  }
});

test('Immer dunkel', async () => {
  const o = await oeffneOberflaeche(
    {},
    {
      browserSprache: 'de-DE',
      // Das Boot-Skript steht in index.html im <head>, nicht im Bündel; hier läuft es wie dort vor allem anderen.
      vorher: w => {
        w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        w.document.documentElement.setAttribute('data-theme', 'classic');
        w.eval(
          require('node:fs').readFileSync(
            require('node:path').join(__dirname, '..', 'public', 'js', '00-theme-boot.js'),
            'utf8',
          ),
        );
      },
    },
  );
  try {
    const wahl = o.d.getElementById('dunkel-wahl');
    assert.ok(
      [...wahl.options].some(x => x.value === 'immer'),
      'keine Wahl „Immer dunkel“',
    );
    wahl.value = 'immer';
    wahl.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await takt(10);
    assert.ok(o.d.documentElement.hasAttribute('data-dunkel'), 'helles System, trotzdem nicht dunkel');
    wahl.value = 'server';
    wahl.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await takt(10);
    assert.ok(!o.d.documentElement.hasAttribute('data-dunkel'));
  } finally {
    o.w.close();
  }
});
