/**
 * Quantity and purchase date when adding: what is not an item count from 1 to 10,000 or lies in the future
 * is reported by the field and does not go to the server. Previously 0, empty and 1.5 silently became 1,
 * −3 and 99999 only came back as a toast, a date from 2099 was accepted.
 * Checked on the real bundle in jsdom via the requests the UI sends.
 *
 * Counter-checks (measured 08.11.2026, each alone):
 *   A  in doAddSet() back to parseInt(...)||1 instead of quantityFromField() → red: “add set: quantity” and
 *      “English” (0 and 1.5 went out as 1, no hint at the field)
 *   B  in quantityFromField() the upper limit removed → red: “add set: quantity” and “purchase price dialog”
 *      (99999 sent)
 *   C  purchaseDateValid() never reports → red: “bought on”, “part and minifigure” and “purchase price dialog”
 *      (2099 sent)
 *   E  in acqSave() the quantity clamped again via Math.max(1, …) → red: “purchase price dialog”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, takt, warte } = require('./helpers/ui');

const errorAt = (d, id) => {
  const e = d.getElementById(id + '-error');
  return e && !e.hidden ? e.textContent : '';
};

async function setErfassen(o, { qty, datum = null }) {
  const { d, aufrufe } = o;
  d.querySelector('[data-click="openCapture"][data-arg="set"]').click();
  await takt(10);
  d.getElementById('add-num').value = '10294-1';
  d.getElementById('add-qty').value = qty;
  if (datum) d.getElementById('add-date').value = datum;
  const vorher = aufrufe.length;
  d.getElementById('btn-add').click();
  await takt(30);
  const a = aufrufe.slice(vorher).find(x => x.url.includes('/sets/add-stream'));
  return {
    gesendet: a ? JSON.parse(a.body) : null,
    qtyError: errorAt(d, 'add-qty'),
    dateError: errorAt(d, 'add-date'),
  };
}

test('add set: quantity only whole from 1 to 10,000, otherwise a hint at the field', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    for (const roh of ['0', '', '1.5', '-3', '99999', '10001', 'abc']) {
      const r = await setErfassen(o, { qty: roh });
      assert.equal(r.gesendet, null, `„${roh}“ ging an den Server`);
      assert.match(r.qtyError, /ganze Zahl von 1 bis 10\.000/, `„${roh}“: kein Hinweis am Feld`);
      assert.equal(o.d.getElementById('add-qty').getAttribute('aria-invalid'), 'true');
    }
    for (const [roh, soll] of [
      ['1', 1],
      ['7', 7],
      ['10000', 10000],
    ]) {
      const r = await setErfassen(o, { qty: roh });
      assert.equal(r.qtyError, '', `„${roh}“ gemeldet`);
      assert.equal(r.gesendet?.quantity, soll);
    }
  } finally {
    o.w.close();
  }
});

test('add set: hint in English', async () => {
  const o = await openUi({}, { sprache: 'en', browserLanguage: 'en-GB' });
  try {
    const r = await setErfassen(o, { qty: '0' });
    assert.equal(r.qtyError, 'The quantity must be a whole number from 1 to 10,000.');
  } finally {
    o.w.close();
  }
});

test('add set: "bought on" not in the future', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    const r = await setErfassen(o, { qty: '1', datum: '2099-01-01' });
    assert.equal(r.gesendet, null, 'Zukunftsdatum ging an den Server');
    assert.match(r.dateError, /Zukunft/);
    const heute = new Date();
    const iso = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
    assert.equal(o.d.getElementById('add-date').max, iso, 'max steht nicht auf heute');
    const ok = await setErfassen(o, { qty: '1', datum: iso });
    assert.equal(ok.dateError, '');
    assert.equal(ok.gesendet?.date, iso);
  } finally {
    o.w.close();
  }
});

test('add part and figure: invalid quantity and future date do not go out', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    const { d, aufrufe } = o;
    for (const [art, nr, knopf, post] of [
      ['part', 'ap', 'btn-add-part', '/parts'],
      ['fig', 'af', 'btn-add-fig', '/minifigs'],
    ]) {
      d.querySelector(`[data-click="openCapture"][data-arg="${art}"]`).click();
      await takt(10);
      d.getElementById(nr + '-num-inline').value = art === 'part' ? '3001' : 'fig-001';
      for (const [qty, datum, errorId] of [
        ['0', null, nr + '-qty-inline'],
        ['1', '2099-01-01', nr + '-date'],
      ]) {
        d.getElementById(nr + '-qty-inline').value = qty;
        if (datum) d.getElementById(nr + '-date').value = datum;
        const vorher = aufrufe.length;
        d.getElementById(knopf).click();
        await takt(30);
        assert.equal(
          aufrufe.slice(vorher).filter(a => a.method === 'POST' && a.url.endsWith(post)).length,
          0,
          `${art}: ${qty}/${datum} ging hinaus`,
        );
        assert.notEqual(errorAt(d, errorId), '', `${art}: kein Hinweis an ${errorId}`);
      }
    }
  } finally {
    o.w.close();
  }
});

async function purchasePriceDialog(puts) {
  const o = await openUi(
    {
      '/v1/sets/10294-1/acquisitions': () => ({
        success: true,
        acquisitions: [
          { id: 7, quantity: 2, condition: 'N', purchase_price: 129.99, created_at: '2026-06-01T10:00:00Z' },
        ],
        totals: { quantity: 2, amount: 259.98 },
      }),
      '/v1/sets/10294-1/acquisitions/7': (_url, opt) => {
        puts.push(JSON.parse(opt.body));
        return { success: true };
      },
    },
    { browserLanguage: 'de-DE' },
  );
  const knopf = o.d.createElement('button');
  knopf.dataset.click = 'openAcqModal';
  knopf.dataset.arg = '10294-1';
  o.d.body.append(knopf);
  knopf.click();
  await warte(() => o.d.getElementById('acq-quantity-7'));
  return o;
}

test('purchase price dialog: quantity and date report at the field, valid ones go out', async () => {
  const puts = [];
  const o = await purchasePriceDialog(puts);
  try {
    const { d, w } = o;
    const menge = d.getElementById('acq-quantity-7');
    for (const roh of ['0', '', '-1', '10001']) {
      menge.value = roh;
      menge.dispatchEvent(new w.FocusEvent('blur'));
      await takt(30);
      assert.equal(puts.length, 0, `Anzahl „${roh}“ ging hinaus`);
      assert.match(errorAt(d, 'acq-quantity-7'), /ganze Zahl/, `Anzahl „${roh}“ ohne Hinweis`);
    }
    menge.value = '3';
    menge.dispatchEvent(new w.FocusEvent('blur'));
    await warte(() => puts.length);
    assert.deepEqual(puts[0], { quantity: 3 });

    d.activeElement?.blur();
    await o.ruhig();
    puts.length = 0;
    const datum = d.getElementById('acq-date-field-7');
    assert.ok(datum.max, 'Datumsfeld ohne max');
    datum.value = '2099-01-01';
    datum.dispatchEvent(new w.Event('change', { bubbles: true }));
    await takt(30);
    assert.equal(puts.filter(p => 'date' in p).length, 0, 'Zukunftsdatum ging hinaus');
    assert.match(errorAt(d, 'acq-date-field-7'), /Zukunft/);
  } finally {
    o.w.close();
  }
});
