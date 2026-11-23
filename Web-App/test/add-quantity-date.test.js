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
const { openUi, tick, waitFor } = require('./helpers/ui');

const errorAt = (d, id) => {
  const e = d.getElementById(id + '-error');
  return e && !e.hidden ? e.textContent : '';
};

async function setAcquire(o, { qty, date = null }) {
  const { d, calls } = o;
  d.querySelector('[data-click="openCapture"][data-arg="set"]').click();
  await tick(10);
  d.getElementById('add-num').value = '10294-1';
  d.getElementById('add-qty').value = qty;
  if (date) d.getElementById('add-date').value = date;
  const prior = calls.length;
  d.getElementById('btn-add').click();
  await tick(30);
  const a = calls.slice(prior).find(x => x.url.includes('/sets/add-stream'));
  return {
    sent: a ? JSON.parse(a.body) : null,
    qtyError: errorAt(d, 'add-qty'),
    dateError: errorAt(d, 'add-date'),
  };
}

test('add set: quantity only whole from 1 to 10,000, otherwise a hint at the field', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    for (const raw of ['0', '', '1.5', '-3', '99999', '10001', 'abc']) {
      const r = await setAcquire(o, { qty: raw });
      assert.equal(r.sent, null, `„${raw}“ went to the server`);
      assert.match(r.qtyError, /ganze Zahl von 1 bis 10\.000/, `„${raw}“: no hint at the field`);
      assert.equal(o.d.getElementById('add-qty').getAttribute('aria-invalid'), 'true');
    }
    for (const [raw, want] of [
      ['1', 1],
      ['7', 7],
      ['10000', 10000],
    ]) {
      const r = await setAcquire(o, { qty: raw });
      assert.equal(r.qtyError, '', `„${raw}“ reported`);
      assert.equal(r.sent?.quantity, want);
    }
  } finally {
    o.w.close();
  }
});

test('add set: hint in English', async () => {
  const o = await openUi({}, { language: 'en', browserLanguage: 'en-GB' });
  try {
    const r = await setAcquire(o, { qty: '0' });
    assert.equal(r.qtyError, 'The quantity must be a whole number from 1 to 10,000.');
  } finally {
    o.w.close();
  }
});

test('add set: "bought on" not in the future', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    const r = await setAcquire(o, { qty: '1', date: '2099-01-01' });
    assert.equal(r.sent, null, 'Future date went to the server');
    assert.match(r.dateError, /Zukunft/);
    const todayDate = new Date();
    const iso = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
    assert.equal(o.d.getElementById('add-date').max, iso, 'max is not set to today');
    const ok = await setAcquire(o, { qty: '1', date: iso });
    assert.equal(ok.dateError, '');
    assert.equal(ok.sent?.date, iso);
  } finally {
    o.w.close();
  }
});

test('add part and figure: invalid quantity and future date do not go out', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    const { d, calls } = o;
    for (const [kind, nr, button, post] of [
      ['part', 'ap', 'btn-add-part', '/parts'],
      ['fig', 'af', 'btn-add-fig', '/minifigs'],
    ]) {
      d.querySelector(`[data-click="openCapture"][data-arg="${kind}"]`).click();
      await tick(10);
      d.getElementById(nr + '-num-inline').value = kind === 'part' ? '3001' : 'fig-001';
      for (const [qty, date, errorId] of [
        ['0', null, nr + '-qty-inline'],
        ['1', '2099-01-01', nr + '-date'],
      ]) {
        d.getElementById(nr + '-qty-inline').value = qty;
        if (date) d.getElementById(nr + '-date').value = date;
        const prior = calls.length;
        d.getElementById(button).click();
        await tick(30);
        assert.equal(
          calls.slice(prior).filter(a => a.method === 'POST' && a.url.endsWith(post)).length,
          0,
          `${kind}: ${qty}/${date} ging hinaus`,
        );
        assert.notEqual(errorAt(d, errorId), '', `${kind}: no hint at ${errorId}`);
      }
    }
  } finally {
    o.w.close();
  }
});

async function purchasePriceDialog(puts) {
  const o = await openUi(
    {
      '/v2/sets/10294-1/acquisitions': () => ({
        success: true,
        acquisitions: [
          { id: 7, quantity: 2, condition: 'N', purchase_price: 129.99, created_at: '2026-06-01T10:00:00Z' },
        ],
        totals: { quantity: 2, amount: 259.98 },
      }),
      '/v2/sets/10294-1/acquisitions/7': (_url, opt) => {
        puts.push(JSON.parse(opt.body));
        return { success: true };
      },
    },
    { browserLanguage: 'de-DE' },
  );
  const button = o.d.createElement('button');
  button.dataset.click = 'openAcqModal';
  button.dataset.arg = '10294-1';
  o.d.body.append(button);
  button.click();
  await waitFor(() => o.d.getElementById('acq-quantity-7'));
  return o;
}

test('purchase price dialog: quantity and date report at the field, valid ones go out', async () => {
  const puts = [];
  const o = await purchasePriceDialog(puts);
  try {
    const { d, w } = o;
    const quantity = d.getElementById('acq-quantity-7');
    for (const raw of ['0', '', '-1', '10001']) {
      quantity.value = raw;
      quantity.dispatchEvent(new w.FocusEvent('blur'));
      await tick(30);
      assert.equal(puts.length, 0, `Quantity „${raw}“ went out`);
      assert.match(errorAt(d, 'acq-quantity-7'), /ganze Zahl/, `Quantity „${raw}“ without a hint`);
    }
    quantity.value = '3';
    quantity.dispatchEvent(new w.FocusEvent('blur'));
    await waitFor(() => puts.length);
    assert.deepEqual(puts[0], { quantity: 3 });

    d.activeElement?.blur();
    await o.settle();
    puts.length = 0;
    const date = d.getElementById('acq-date-field-7');
    assert.ok(date.max, 'Date field without max');
    date.value = '2099-01-01';
    date.dispatchEvent(new w.Event('change', { bubbles: true }));
    await tick(30);
    assert.equal(puts.filter(p => 'date' in p).length, 0, 'Zukunftsdatum ging hinaus');
    assert.match(errorAt(d, 'acq-date-field-7'), /Zukunft/);
  } finally {
    o.w.close();
  }
});
