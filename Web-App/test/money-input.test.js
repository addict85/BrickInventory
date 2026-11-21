/**
 * Money fields read comma and dot: „149,95“ goes to the server as 149.95,
 * not as 149 (parseFloat cut off at the comma). What is not a number is reported
 * by the field and does not go out. Checked on the real bundle in jsdom via the
 * requests the UI sends.
 *
 * Counter-checks (measured 02.11.2026, each on its own):
 *   A  readAmount() in format.js replaced by parseFloat(roh) → all five
 *      red (149,95 → 149; 1,299 en → 1; „12,3,4“ sent; voucher 50)
 *   B  in amountFromField() the message on NaN removed (ok: true, wert: null)
 *      → red: “nonsense is reported at the field” (abc went out as null)
 *   C  group rule removed (a single separator always decimal) → red:
 *      “add set …” (1.299 de-DE → 1.299) and “English …” (1,299)
 *   D  amountForField() with en format instead of locale() → red: “purchase price dialog”
 *      (field showed 129.99 instead of 129,99)
 *   E  showSaved() removed in acqSave() → red: “purchase price dialog”
 *      (no marker „Gespeichert“)
 *   F  (13.11.2026) amountFromField() without the check for a minus → red:
 *      “nonsense is reported at the field” („-5“ was called „kein Betrag“)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, sicht, takt, warte } = require('./helpers/ui');

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

test('add set: comma, dot and thousands', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
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

test('English: comma as thousands, dot as decimal', async () => {
  const o = await openUi({}, { sprache: 'en', browserLanguage: 'en-GB' });
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

test('nonsense is reported at the field and not sent', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    for (const ein of ['abc', '12,3,4', '-5', '1.29.9', '149,95€x', '1,2.3,4']) {
      const r = await setErfassen(o, ein);
      assert.equal(r.gesendet, false, `„${ein}“ ging an den Server`);
      // Readable, only negative: own text (UX check 20).
      assert.match(
        r.fehler,
        ein === '-5' ? /^Der Kaufpreis kann nicht negativ sein\.$/ : /ist kein Betrag/,
        `„${ein}“`,
      );
      assert.equal(r.feld.getAttribute('aria-invalid'), 'true');
    }
  } finally {
    o.w.close();
  }
});

test('voucher: amount with comma', async () => {
  const o = await openUi({ '/v1/vouchers': { success: true, vouchers: [] } }, { browserLanguage: 'de-DE' });
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

test("purchase price dialog: display in the language's form, comma saved, marker per row", async () => {
  const puts = [];
  const o = await openUi(
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
    { browserLanguage: 'de-DE' },
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
