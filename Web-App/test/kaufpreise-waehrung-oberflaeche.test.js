/**
 * Kaufpreise in der Oberfläche (UI-Prüfung 17: H3, H4, M6, M7, M21;
 * Barrierefreiheit M5), echtes Bündel in jsdom:
 *   - Der Kaufpreis-Dialog nennt je Zeile die Währung, zeigt die Summe des
 *     Servers in Kontowährung und zieht sie nach dem Speichern nach.
 *   - Escape im Kaufpreis-Dialog gibt den Fokus an „Kaufpreise bearbeiten“
 *     im neu aufgebauten Set-Dialog zurück.
 *   - Ein USD-Kauf zeigt im Set-Detail „USD“ und den umgerechneten Betrag.
 *   - Ein geschätzter Kaufpreis trägt in den Finanzen „≈“ mit Titel, und der
 *     Hinweis unter den Kennzahlen zählt ihn.
 *   - „Set hinzufügen“ hat Währung und Kaufdatum und schickt beides; alle
 *     drei Erfassen-Dialoge haben ein Datumsfeld, „Anzahl“ heisst Anzahl.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln, Bündel neu gebaut):
 *   A  aktualisiereSumme(sn) in acqSave() entfernt → rot: „Kaufpreis-Dialog:
 *      Währung je Zeile, Summe zieht nach“
 *   B  in closeAcqModal das erneute focus() entfernt → rot: „Escape gibt den
 *      Fokus an den Auslöser zurück“
 *   C  in einstandZelle wieder nur einstandBetrag() → rot: „Finanzen: ≈ und
 *      Zahl der Schätzungen“
 *   D  currency/date nicht in den Rumpf von add-stream → rot: „Set
 *      hinzufügen schickt Währung und Datum“
 *   E  label for="ap-qty-inline" wieder an „Farbe“ → rot: „Erfassen-Dialoge
 *      einheitlich“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte, takt, reiter } = require('./helpers/oberflaeche');

const SN = '10326-1';
/** Text mit einfachen Leerzeichen: Intl setzt schmale geschützte Leerzeichen vor das Währungszeichen. */
const text = (s) => String(s || '').replace(/\s+/g, ' ');
const ERFASSUNGEN = [
  { id: 1, quantity: 3, condition: 'N', purchase_price: 260.66, currency: 'USD', preis_konto: 208.528, price_estimated: false, created_at: '2019-03-04T12:00:00Z' },
  { id: 2, quantity: 2, condition: 'N', purchase_price: 354.5, currency: 'EUR', preis_konto: 354.5, price_estimated: false, created_at: '2019-03-05T12:00:00Z' },
];

/** Set-Detail und Erfassungen; die Summe wechselt nach dem ersten PUT. */
function antworten(stand) {
  return {
    [`/v1/sets/${SN}`]: { success: true, set: { set_number: SN, name: 'Natural History Museum', quantity: 5, conditions: ['N'], instructions: [] } },
    [`/v1/sets/${SN}/acquisitions`]: () => ({ success: true, owner_user_id: 1, acquisitions: ERFASSUNGEN,
      totals: { quantity: 5, amount: stand.betrag, priced_rows: 2, currency: 'EUR', ohne_kurs: 0 } }),
    [`/v1/sets/${SN}/acquisitions/2`]: () => { stand.betrag = 1309.58; return { success: true }; },
  };
}

async function oeffneSet(o) {
  const knopf = o.d.createElement('button');
  knopf.dataset.click = 'openModal'; knopf.dataset.arg = SN;
  o.d.body.append(knopf); knopf.click();
  await warte(() => o.d.querySelector('#set-modal [data-click="openAcqModal"]'), 4000);
}

test('Kaufpreis-Dialog: Währung je Zeile, Summe zieht nach', async () => {
  const stand = { betrag: 1334.58 };
  const o = await oeffneOberflaeche(antworten(stand), { browserSprache: 'de-DE' });
  try {
    await oeffneSet(o);
    o.d.querySelector('#set-modal [data-click="openAcqModal"]').click();
    await warte(() => o.d.getElementById('acq-preis-2'));
    const zeile = (id) => text(o.d.getElementById(`acq-row-${id}`).textContent);
    assert.match(zeile(1), /USD/);
    assert.match(zeile(1), /≈ 208,53 €/);
    assert.match(zeile(2), /EUR/);
    assert.equal(text(o.d.getElementById('acq-total-price').textContent), '1.334,58 €');
    const feld = o.d.getElementById('acq-preis-2');
    feld.value = '342,04';
    feld.dispatchEvent(new o.w.FocusEvent('blur'));
    assert.ok(await warte(() => text(o.d.getElementById('acq-total-price').textContent) === '1.309,58 €', 1500),
      `Summe: ${o.d.getElementById('acq-total-price').textContent}`);
  } finally { o.w.close(); }
});

test('Escape gibt den Fokus an den Auslöser zurück', async () => {
  const o = await oeffneOberflaeche(antworten({ betrag: 1334.58 }), { browserSprache: 'de-DE' });
  try {
    await oeffneSet(o);
    const ausloeser = o.d.querySelector('#set-modal [data-click="openAcqModal"]');
    ausloeser.focus();
    ausloeser.click();
    await warte(() => o.d.getElementById('acq-modal').classList.contains('open') && o.d.getElementById('acq-preis-1'));
    o.d.dispatchEvent(new o.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(await warte(() => o.d.activeElement?.matches?.('#set-modal [data-click="openAcqModal"]'), 2000),
      `Fokus auf ${o.d.activeElement?.outerHTML?.slice(0, 80)}`);
  } finally { o.w.close(); }
});

test('Set-Detail: ein USD-Kauf nennt USD und den umgerechneten Betrag', async () => {
  const o = await oeffneOberflaeche(antworten({ betrag: 1334.58 }), { browserSprache: 'de-DE' });
  try {
    await oeffneSet(o);
    await warte(() => /USD/.test(o.d.getElementById('m-acq-summary')?.textContent || ''));
    const inhalt = text(o.d.getElementById('m-acq-summary').textContent);
    assert.match(inhalt, /260,66 USD/);
    assert.match(inhalt, /≈ 208,53 €/);
  } finally { o.w.close(); }
});

test('Finanzen: ≈ und Zahl der Schätzungen', async () => {
  const kauf = (id, preis, geschaetzt) => ({ id, condition: 'N', quantity: 4, purchase_price: preis, avg_price: 310, wert_gesamt: 1240,
    pnl_prozent: 0.6, created_at: '2026-11-05T12:00:00Z', ...(geschaetzt ? { price_estimated: true } : {}) });
  const o = await oeffneOberflaeche({
    '/v1/finance/valuation': { success: true, currency: 'EUR', condition: 'N', total_value: '2480', kaufpreise_fremde_waehrung: 0,
      totals: { min: '0', avg: '2480', max: '0', qty_avg: '2480' }, sets: [
        { set_number: '10305-1', name: 'Burg', quantity: 4, avg_price: 310, wert_gesamt: 1240, from_cache: true, is_fallback: false, no_price: false, mixed: false, acquisitions: [kauf(1, 308, true)] },
        { set_number: '10294-1', name: 'Titanic', quantity: 4, avg_price: 310, wert_gesamt: 1240, from_cache: true, is_fallback: false, no_price: false, mixed: false, acquisitions: [kauf(2, 300, false)] }] },
    '/v1/finance/pnl': { success: true, currency: 'EUR', sets: [], totals: { purchase: '2432', current: '2480', kaufpreise_fremde_waehrung: 0,
      positionen: 2, positionen_bewertet: 2, positionen_ohne_marktpreis: 0, positionen_ohne_kaufpreis: 0,
      basis_einstand: '2432', basis_marktwert: '2480', basis_guv_betrag: '48', pnl_prozent: 2 } },
  }, { browserSprache: 'de-DE' });
  try {
    await reiter(o.w, 'finance');
    await warte(() => o.d.querySelectorAll('#fin-tbl tbody tr').length >= 2, 4000);
    const zeilen = [...o.d.querySelectorAll('#fin-tbl tbody tr[data-arg]')];
    const burg = zeilen.find(z => z.dataset.arg === '10305-1');
    const kaufZelle = burg.querySelectorAll('td.price-cell')[0];
    assert.match(kaufZelle.textContent, /≈/);
    assert.match(kaufZelle.querySelector('[title]').getAttribute('title'), /geschätzt/);
    const titanic = zeilen.find(z => z.dataset.arg === '10294-1');
    assert.doesNotMatch(titanic.textContent, /≈/);
    assert.match(burg.querySelector('.fin-unter').textContent, /Kaufpreis geschätzt/, 'auch in der Telefonzeile');
    assert.ok(await warte(() => !o.d.getElementById('fin-basis').hidden));
    assert.match(o.d.getElementById('fin-basis').textContent, /1 geschätzter Kaufpreis/);
  } finally { o.w.close(); }
});

test('Set hinzufügen schickt Währung und Datum', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    o.d.querySelector('[data-click="oeffneErfassen"][data-arg="set"]').click();
    await takt(10);
    assert.equal(o.d.getElementById('add-currency').value, 'EUR', 'Vorgabe ist die Kontowährung');
    assert.match(o.d.getElementById('add-date').value, /^\d{4}-\d{2}-\d{2}$/, 'Vorgabe heute');
    o.d.getElementById('add-num').value = '10326-1';
    o.d.getElementById('add-price').value = '260,66';
    o.d.getElementById('add-currency').value = 'USD';
    o.d.getElementById('add-date').value = '2019-03-04';
    o.d.getElementById('btn-add').click();
    await warte(() => o.aufrufe.some(a => a.url.includes('/sets/add-stream')));
    const rumpf = JSON.parse(o.aufrufe.find(a => a.url.includes('/sets/add-stream')).body);
    assert.deepEqual({ p: rumpf.purchase_price, c: rumpf.currency, d: rumpf.date }, { p: 260.66, c: 'USD', d: '2019-03-04' });
  } finally { o.w.close(); }
});

test('Erfassen-Dialoge einheitlich', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    assert.equal(o.d.getElementById('ap-qty-inline').labels[0].textContent.trim(), 'Anzahl');
    for (const id of ['add-set-modal', 'add-part-modal', 'add-fig-modal']) {
      const dialog = o.d.getElementById(id);
      assert.ok(dialog.querySelector('input[type=date]'), `${id}: kein Datumsfeld`);
      const sichtbar = dialog.textContent + [...dialog.querySelectorAll('[placeholder]')].map(e => e.getAttribute('placeholder')).join(' ');
      assert.doesNotMatch(sichtbar, /z\.B\.|\(opt\.\)/, id);
    }
  } finally { o.w.close(); }
});
