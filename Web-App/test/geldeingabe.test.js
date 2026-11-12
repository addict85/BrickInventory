/**
 * Geldfelder lesen Komma und Punkt: „149,95“ geht als 149.95 an den Server,
 * nicht als 149 (parseFloat schnitt am Komma ab). Was keine Zahl ist, meldet
 * das Feld und geht nicht hinaus. Geprüft am echten Bündel in jsdom über die
 * Anfragen, die die Oberfläche schickt.
 *
 * Gegenproben (02.11.2026 gemessen, je einzeln):
 *   A  leseBetrag() in format.js durch parseFloat(roh) ersetzt → alle fünf
 *      rot (149,95 → 149; 1,299 en → 1; „12,3,4“ gesendet; Gutschein 50)
 *   B  in betragAusFeld() die Meldung bei NaN entfernt (ok: true, wert: null)
 *      → rot: „Unsinn wird am Feld gemeldet“ (abc ging als null hinaus)
 *   C  Gruppen-Regel entfernt (einzelnes Trennzeichen immer Dezimal) → rot:
 *      „Set hinzufügen …“ (1.299 de-DE → 1.299) und „englisch …“ (1,299)
 *   D  betragFuerFeld() mit en-Format statt locale() → rot: „Kaufpreis-Dialog“
 *      (Feld zeigte 129.99 statt 129,99)
 *   E  zeigeGespeichert() in acqSave() entfernt → rot: „Kaufpreis-Dialog“
 *      (keine Marke „Gespeichert“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, sicht, takt, warte } = require('./helpers/oberflaeche');

async function setErfassen(o, preis) {
  const { d, w, aufrufe } = o;
  d.querySelector('[data-click="oeffneErfassen"][data-arg="set"]').click();
  await takt(10);
  d.getElementById('add-num').value = '10294-1';
  const feld = d.getElementById('add-price');
  feld.value = preis;
  feld.dispatchEvent(new w.Event('input', { bubbles: true }));
  const vorher = aufrufe.length;
  d.getElementById('btn-add').click();
  await takt(30);
  const a = aufrufe.slice(vorher).find(x => x.url.includes('/sets/add-stream'));
  const fehler = d.getElementById('add-price-fehler');
  return {
    gesendet: !!a,
    wert: a ? JSON.parse(a.body).purchase_price : undefined,
    fehler: fehler && !fehler.hidden ? fehler.textContent : '',
    feld,
  };
}

test('Set hinzufügen: Komma, Punkt und Tausender', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    for (const [ein, aus] of [
      ['149,95', 149.95],
      ['149.95', 149.95],
      ['1.299,00', 1299],
      ['1.299', 1299],
      ["1'299.50", 1299.5],
      ['1 299,5', 1299.5],
      ['1,299.50', 1299.5],
      ['0,5', 0.5],
      ['79', 79],
      ['', null],
      ['  ', null],
    ]) {
      const r = await setErfassen(o, ein);
      assert.equal(r.fehler, '', `„${ein}“ gemeldet: ${r.fehler}`);
      assert.equal(r.wert, aus, `„${ein}“ ging als ${r.wert} hinaus`);
    }
  } finally {
    o.w.close();
  }
});

test('englisch: Komma als Tausender, Punkt als Dezimal', async () => {
  const o = await oeffneOberflaeche({}, { sprache: 'en', browserSprache: 'en-GB' });
  try {
    for (const [ein, aus] of [
      ['1,299', 1299],
      ['149.95', 149.95],
      ['149,95', 149.95],
      ['1,299.95', 1299.95],
    ]) {
      const r = await setErfassen(o, ein);
      assert.equal(r.wert, aus, `„${ein}“ ging als ${r.wert} hinaus`);
    }
  } finally {
    o.w.close();
  }
});

test('Unsinn wird am Feld gemeldet und nicht gesendet', async () => {
  const o = await oeffneOberflaeche({}, { browserSprache: 'de-DE' });
  try {
    for (const ein of ['abc', '12,3,4', '-5', '1.29.9', '149,95€x', '1,2.3,4']) {
      const r = await setErfassen(o, ein);
      assert.equal(r.gesendet, false, `„${ein}“ ging an den Server`);
      assert.match(r.fehler, /ist kein Betrag/, `„${ein}“`);
      assert.equal(r.feld.getAttribute('aria-invalid'), 'true');
    }
  } finally {
    o.w.close();
  }
});

test('Gutschein: Betrag mit Komma', async () => {
  const o = await oeffneOberflaeche({ '/v1/vouchers': { success: true, vouchers: [] } }, { browserSprache: 'de-DE' });
  try {
    await sicht(o.w, 'gutscheine');
    o.d.getElementById('v-number').value = '6123-4567-8901';
    o.d.getElementById('v-amount').value = '50,50';
    const vorher = o.aufrufe.length;
    o.d.querySelector('[data-click="gutscheinSpeichern"]').click();
    await warte(() => o.aufrufe.slice(vorher).some(a => a.method === 'POST'));
    const a = o.aufrufe.slice(vorher).find(x => x.method === 'POST' && x.url.includes('/v1/vouchers'));
    assert.equal(JSON.parse(a.body).amount, 50.5);
  } finally {
    o.w.close();
  }
});

test('Kaufpreis-Dialog: Anzeige in Sprachform, Komma gespeichert, Marke je Zeile', async () => {
  const puts = [];
  const o = await oeffneOberflaeche(
    {
      '/v1/sets/10294-1/acquisitions': (_url, opt) => {
        if (opt.method === 'PUT') return { success: true };
        return {
          success: true,
          acquisitions: [
            { id: 7, quantity: 1, condition: 'N', purchase_price: 129.99, created_at: '2026-06-01T10:00:00Z' },
          ],
          totals: { quantity: 1, amount: 129.99 },
        };
      },
      '/v1/sets/10294-1/acquisitions/7': (_url, opt) => {
        puts.push(JSON.parse(opt.body));
        return { success: true };
      },
    },
    { browserSprache: 'de-DE' },
  );
  try {
    const knopf = o.d.createElement('button');
    knopf.dataset.click = 'openAcqModal';
    knopf.dataset.arg = '10294-1';
    o.d.body.append(knopf);
    knopf.click();
    await warte(() => o.d.getElementById('acq-preis-7'));
    const feld = o.d.getElementById('acq-preis-7');
    assert.equal(feld.value, '129,99');
    assert.equal(o.d.getElementById('acq-ok-7').hidden, true, 'Marke vor dem Speichern sichtbar');
    feld.value = '149,95';
    feld.dispatchEvent(new o.w.FocusEvent('blur'));
    await warte(() => puts.length);
    assert.deepEqual(puts[0], { purchase_price: 149.95 });
    await warte(() => o.d.getElementById('acq-ok-7')?.hidden === false);
    assert.equal(o.d.getElementById('acq-ok-7').hidden, false, 'keine Marke „Gespeichert“ nach dem Speichern');
    assert.match(o.d.getElementById('acq-ok-7').textContent, /Gespeichert/);
  } finally {
    o.w.close();
  }
});
