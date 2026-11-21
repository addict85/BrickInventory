/**
 * Feedback in forms (UI review 17, flows M8–M13, M15, N14,
 * N19), real bundle in jsdom:
 *   - Set detail: “abc” as alert threshold is an error at the field, not a
 *     silent deletion; a set only present as used preselects “used”,
 *     and the field names the currency.
 *   - Price alerts: deleting asks in its own dialog and offers undo.
 *   - Storage locations: occupied locations cannot be deleted (with reason), renaming
 *     reports success, an empty name an error; from ten characters before the
 *     limit the field counts along.
 *   - Vouchers: the sum stands per currency.
 *   - Create account: name and password rule stand at the field before the
 *     password prompt comes.
 *   - Dark mode “always dark” also works with a light system.
 *
 * Counter-checks (measured 05.11.2026, each alone, bundle rebuilt):
 *   A  in sendAlarm the line with feldFehler removed → red: “alert in the
 *      set detail” (DELETE instead of error message)
 *   B  in loescheAlarm again confirm() → red: “delete alert with dialog
 *      and undo”
 *   C  in lagerorte `belegt ? ' disabled'` removed → red: “storage locations”
 *   D  in the counter listener (formular) return immediately → red: “storage locations”
 *   E  in ladeGutscheine again one sum over all currencies → red:
 *      “voucher sum per currency”
 *   F  in nutzerverwaltung the name check removed → red: “create
 *      account”
 *   G  in theme-boot `w === 'immer' ||` removed → red: “always dark”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt, sicht } = require('./helpers/ui');

const SN = '10305-1';
const loeschen = (o, pfad) => o.aufrufe.filter(a => a.method === 'DELETE' && a.url.includes(pfad));

test('alert in the set detail', async () => {
  const o = await openUi(
    {
      [`/v1/sets/${SN}`]: {
        success: true,
        set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['U'], instructions: [] },
      },
      [`/v1/sets/${SN}/alert`]: { success: true, alerts: [] },
    },
    { browserLanguage: 'de-DE' },
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

test('delete alert with dialog and undo', async () => {
  const alarm = {
    set_number: SN,
    name: 'Burg',
    condition: 'N',
    direction: 'unter',
    threshold: 249,
    currency_code: 'EUR',
  };
  const o = await openUi(
    {
      '/v1/alerts': { success: true, alerts: [alarm] },
      [`/v1/sets/${SN}/alert`]: { success: true, alerts: [alarm] },
    },
    { browserLanguage: 'de-DE' },
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
    assert.deepEqual(rumpf, { direction: 'unter', threshold: 249, condition: 'N' });
  } finally {
    o.w.close();
  }
});

test('storage locations', async () => {
  const o = await openUi(
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
    { browserLanguage: 'de-DE' },
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

test('voucher sum per currency', async () => {
  const o = await openUi(
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
    { browserLanguage: 'de-DE' },
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

test('create account: rules at the field before the password prompt', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
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

test('always dark', async () => {
  const o = await openUi(
    {},
    {
      browserLanguage: 'de-DE',
      // The boot script stands in index.html in the <head>, not in the bundle; here it runs as there before everything else.
      vorher: w => {
        w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
        w.document.documentElement.setAttribute('data-theme', 'classic');
        w.eval(
          require('node:fs').readFileSync(
            require('node:path').join(__dirname, '..', 'public', 'js', 'theme-boot.js'),
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
