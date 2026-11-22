/**
 * Feedback in forms (UI review 17, flows M8–M13, M15, N14,
 * N19), real bundle in jsdom:
 *   - Set detail: “abc” as alert threshold is an error at the field, not a
 *     silent deletion; a set only present as used preselects “used”,
 *     and the field names the currency.
 *   - Price alerts: deleting goes without a question and offers undo (restorable, js/deletion.js).
 *   - Storage locations: occupied locations cannot be deleted (with reason), renaming
 *     reports success, an empty name an error; from ten characters before the
 *     limit the field counts along.
 *   - Vouchers: the sum stands per currency.
 *   - Create account: name and password rule stand at the field before the
 *     password prompt comes.
 *   - Dark mode “always dark” also works with a light system.
 *
 * Counter-checks (measured 05.11.2026, each alone, bundle rebuilt):
 *   A  in sendAlert the line with fieldError removed → red: “alert in the
 *      set detail” (DELETE instead of error message)
 *   B  in deleteAlert again confirm() → red: “delete alert without question,
 *      with undo”
 *   B2 (22.11.2026, rule of js/deletion.js) deleteAlert again with confirmDelete before →
 *      red: “delete alert without question, with undo” (question opened)
 *   C  in lagerorte `used ? ' disabled'` removed → red: “storage locations”
 *   D  in the counter listener (formular) return immediately → red: “storage locations”
 *   E  in loadVouchers again one sum over all currencies → red:
 *      “voucher sum per currency”
 *   F  in nutzerverwaltung the name check removed → red: “create
 *      account”
 *   G  in theme-boot `w === 'always' ||` removed → red: “always dark”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt, sicht } = require('./helpers/ui');

const SN = '10305-1';
const loeschen = (o, path) => o.aufrufe.filter(a => a.method === 'DELETE' && a.url.includes(path));

test('alert in the set detail', async () => {
  const o = await openUi(
    {
      [`/v2/sets/${SN}`]: {
        success: true,
        set: { set_number: SN, name: 'Burg', quantity: 1, conditions: ['U'], instructions: [] },
      },
      [`/v2/sets/${SN}/alert`]: { success: true, alerts: [] },
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
    const field = o.d.getElementById('m-alert-val');
    field.value = 'abc';
    field.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await takt(30);
    assert.equal(loeschen(o, '/alert').length, 0, 'abc löschte den Alarm');
    const error = o.d.getElementById('m-alert-val-error');
    assert.ok(error && !error.hidden && error.textContent.trim(), 'kein Fehler am Feld');
  } finally {
    o.w.close();
  }
});

test('delete alert without question, with undo', async () => {
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
      '/v2/alerts': { success: true, alerts: [alarm] },
      [`/v2/sets/${SN}/alert`]: { success: true, alerts: [alarm] },
    },
    { browserLanguage: 'de-DE' },
  );
  let browserConfirm = 0;
  o.w.confirm = () => {
    browserConfirm++;
    return true;
  };
  try {
    await sicht(o.w, 'alerts');
    await warte(() => o.d.querySelector('#alerts-list [data-click="deleteAlert"]'));
    o.d.querySelector('#alerts-list [data-click="deleteAlert"]').click();
    assert.ok(await warte(() => loeschen(o, `/sets/${SN}/alert`).length === 1));
    assert.equal(browserConfirm, 0);
    assert.notEqual(o.d.getElementById('confirm-modal').style.display, 'flex', 'Rückfrage vor Wiederherstellbarem');
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
      '/v2/storage/locations': {
        success: true,
        locations: [
          { id: 1, name: 'Regal A' },
          { id: 2, name: 'Kiste B' },
        ],
        preset: null,
      },
      '/v2/storage': { success: true, locations: [{ location: 'Regal A', sets: 2, parts: 0, minifigs: 0 }] },
    },
    { browserLanguage: 'de-DE' },
  );
  try {
    await sicht(o.w, 'locations');
    await warte(() => o.d.querySelectorAll('#storage-list [data-click="deleteLocation"]').length === 2);
    const [regal, kiste] = o.d.querySelectorAll('#storage-list [data-click="deleteLocation"]');
    assert.equal(regal.disabled, true, 'belegter Ort löschbar');
    assert.match(regal.getAttribute('title'), /2 Sets/);
    assert.equal(kiste.disabled, false);

    const name = o.d.querySelector('#storage-list [data-change="renameLocation"][data-arg="2"]');
    name.value = 'Kiste C';
    name.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => /Kiste C/.test(o.d.getElementById('toasts').textContent)), 'keine Erfolgsmeldung');
    const nochmal = o.d.querySelector('#storage-list [data-change="renameLocation"][data-arg="2"]');
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
    assert.ok(zaehler?.classList.contains('char-counter') && !zaehler.hidden, 'kein Zähler');
    assert.match(zaehler.textContent, /55.*60/);
  } finally {
    o.w.close();
  }
});

test('voucher sum per currency', async () => {
  const o = await openUi(
    {
      '/v2/vouchers': {
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
    await sicht(o.w, 'vouchers');
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
      !o.d.getElementById('nu-n-error')?.hidden && o.d.getElementById('nu-n-error')?.textContent.trim(),
      'Name ohne Fehler am Feld',
    );
    assert.notEqual(o.d.getElementById('confirm-modal').style.display, 'flex', 'Passwortabfrage trotz falschem Namen');
    o.d.getElementById('nu-n').value = 'bert';
    o.d.getElementById('nu-p').value = 'short';
    o.d.getElementById('btn-cu').click();
    await takt(30);
    assert.ok(
      !o.d.getElementById('nu-p-error')?.hidden && o.d.getElementById('nu-p-error')?.textContent.trim(),
      'Passwort ohne Fehler am Feld',
    );
    assert.match(
      o.d.getElementById('nu-p').getAttribute('aria-describedby'),
      /nu-p-rule/,
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
      before: w => {
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
    const wahl = o.d.getElementById('dark-choice');
    assert.ok(
      [...wahl.options].some(x => x.value === 'always'),
      'keine Wahl „Immer dunkel“',
    );
    wahl.value = 'always';
    wahl.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await takt(10);
    assert.ok(o.d.documentElement.hasAttribute('data-dark'), 'helles System, trotzdem nicht dunkel');
    wahl.value = 'server';
    wahl.dispatchEvent(new o.w.Event('change', { bubbles: true }));
    await takt(10);
    assert.ok(!o.d.documentElement.hasAttribute('data-dark'));
  } finally {
    o.w.close();
  }
});
