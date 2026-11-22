/**
 * Purchase prices in the UI (UI check 17: H3, H4, M6, M7, M21;
 * accessibility M5), real bundle in jsdom:
 *   - The purchase price dialog names the currency per row, shows the server's
 *     sum in account currency and updates it after saving.
 *   - Escape in the purchase price dialog returns the focus to „Kaufpreise bearbeiten“
 *     in the rebuilt set dialog.
 *   - A USD purchase shows „USD“ and the converted amount in the set detail.
 *   - An estimated purchase price carries „≈“ with a title in the finances, and the
 *     hint below the metrics counts it.
 *   - „Set hinzufügen“ has currency and purchase date and sends both; all
 *     three entry dialogs have a date field, „Anzahl“ is called Anzahl.
 *
 * Counter-checks (measured 05.11.2026, each on its own, bundle rebuilt):
 *   A  refreshSum(sn) removed in acqSave() → red: “purchase price dialog:
 *      currency per row, the sum follows”
 *   B  the renewed focus() removed in closeAcqModal → red: “Escape returns
 *      focus to the trigger”
 *   C  in einstandZelle again only einstandBetrag() → red: “finances: ≈ and
 *      number of estimates”
 *   D  currency/date not in the body of add-stream → red: “adding a set
 *      sends currency and date”
 *   E  label for="ap-qty-inline" again on „Farbe“ → red: “entry dialogs
 *      consistent”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte, takt, reiter } = require('./helpers/ui');

const SN = '10326-1';
/** Text with simple spaces: Intl puts narrow no-break spaces before the currency sign. */
const text = s => String(s || '').replace(/\s+/g, ' ');
const ACQUISITIONS = [
  {
    id: 1,
    quantity: 3,
    condition: 'N',
    purchase_price: 260.66,
    currency: 'USD',
    account_price: 208.528,
    price_estimated: false,
    created_at: '2019-03-04T12:00:00Z',
  },
  {
    id: 2,
    quantity: 2,
    condition: 'N',
    purchase_price: 354.5,
    currency: 'EUR',
    account_price: 354.5,
    price_estimated: false,
    created_at: '2019-03-05T12:00:00Z',
  },
];

/** Set detail and acquisitions; the sum changes after the first PUT. */
function antworten(state) {
  return {
    [`/v2/sets/${SN}`]: {
      success: true,
      set: { set_number: SN, name: 'Natural History Museum', quantity: 5, conditions: ['N'], instructions: [] },
    },
    [`/v2/sets/${SN}/acquisitions`]: () => ({
      success: true,
      owner_user_id: 1,
      acquisitions: ACQUISITIONS,
      totals: { quantity: 5, amount: state.betrag, priced_rows: 2, currency: 'EUR', without_rate: 0 },
    }),
    [`/v2/sets/${SN}/acquisitions/2`]: () => {
      state.betrag = 1309.58;
      return { success: true };
    },
  };
}

async function openSet(o) {
  const knopf = o.d.createElement('button');
  knopf.dataset.click = 'openModal';
  knopf.dataset.arg = SN;
  o.d.body.append(knopf);
  knopf.click();
  await warte(() => o.d.querySelector('#set-modal [data-click="openAcqModal"]'), 4000);
}

test('purchase price dialog: currency per row, the sum follows', async () => {
  const state = { betrag: 1334.58 };
  const o = await openUi(antworten(state), { browserLanguage: 'de-DE' });
  try {
    await openSet(o);
    o.d.querySelector('#set-modal [data-click="openAcqModal"]').click();
    await warte(() => o.d.getElementById('acq-price-2'));
    const row = id => text(o.d.getElementById(`acq-row-${id}`).textContent);
    assert.match(row(1), /USD/);
    assert.match(row(1), /≈ 208,53 €/);
    assert.match(row(2), /EUR/);
    assert.equal(text(o.d.getElementById('acq-total-price').textContent), '1.334,58 €');
    const field = o.d.getElementById('acq-price-2');
    field.value = '342,04';
    field.dispatchEvent(new o.w.FocusEvent('blur'));
    assert.ok(
      await warte(() => text(o.d.getElementById('acq-total-price').textContent) === '1.309,58 €', 1500),
      `Summe: ${o.d.getElementById('acq-total-price').textContent}`,
    );
  } finally {
    o.w.close();
  }
});

test('Escape returns focus to the trigger', async () => {
  const o = await openUi(antworten({ betrag: 1334.58 }), { browserLanguage: 'de-DE' });
  try {
    await openSet(o);
    const trigger = o.d.querySelector('#set-modal [data-click="openAcqModal"]');
    trigger.focus();
    trigger.click();
    await warte(() => o.d.getElementById('acq-modal').classList.contains('open') && o.d.getElementById('acq-price-1'));
    o.d.dispatchEvent(new o.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(
      await warte(() => o.d.activeElement?.matches?.('#set-modal [data-click="openAcqModal"]'), 2000),
      `Fokus auf ${o.d.activeElement?.outerHTML?.slice(0, 80)}`,
    );
  } finally {
    o.w.close();
  }
});

test('set detail: a USD purchase names USD and the converted amount', async () => {
  const o = await openUi(antworten({ betrag: 1334.58 }), { browserLanguage: 'de-DE' });
  try {
    await openSet(o);
    await warte(() => /USD/.test(o.d.getElementById('m-acq-summary')?.textContent || ''));
    const inhalt = text(o.d.getElementById('m-acq-summary').textContent);
    assert.match(inhalt, /260,66 USD/);
    assert.match(inhalt, /≈ 208,53 €/);
  } finally {
    o.w.close();
  }
});

test('finances: ≈ and number of estimates', async () => {
  const kauf = (id, preis, geschaetzt) => ({
    id,
    condition: 'N',
    quantity: 4,
    purchase_price: preis,
    avg_price: 310,
    value_total: 1240,
    pnl_percent: 0.6,
    created_at: '2026-11-05T12:00:00Z',
    ...(geschaetzt ? { price_estimated: true } : {}),
  });
  const o = await openUi(
    {
      '/v2/finance/valuation': {
        success: true,
        currency: 'EUR',
        condition: 'N',
        total_value: '2480',
        foreign_currency_purchases: 0,
        totals: { min: '0', avg: '2480', max: '0', qty_avg: '2480' },
        sets: [
          {
            set_number: '10305-1',
            name: 'Burg',
            quantity: 4,
            avg_price: 310,
            value_total: 1240,
            from_cache: true,
            is_fallback: false,
            no_price: false,
            mixed: false,
            acquisitions: [kauf(1, 308, true)],
          },
          {
            set_number: '10294-1',
            name: 'Titanic',
            quantity: 4,
            avg_price: 310,
            value_total: 1240,
            from_cache: true,
            is_fallback: false,
            no_price: false,
            mixed: false,
            acquisitions: [kauf(2, 300, false)],
          },
        ],
      },
      '/v2/finance/pnl': {
        success: true,
        currency: 'EUR',
        sets: [],
        totals: {
          purchase: '2432',
          current: '2480',
          foreign_currency_purchases: 0,
          positions: 2,
          positions_valued: 2,
          positions_without_market_price: 0,
          positions_without_purchase_price: 0,
          baseline_cost: '2432',
          baseline_market_value: '2480',
          baseline_pnl_amount: '48',
          pnl_percent: 2,
        },
      },
    },
    { browserLanguage: 'de-DE' },
  );
  try {
    await reiter(o.w, 'finance');
    await warte(() => o.d.querySelectorAll('#fin-tbl tbody tr').length >= 2, 4000);
    const zeilen = [...o.d.querySelectorAll('#fin-tbl tbody tr[data-arg]')];
    const burg = zeilen.find(z => z.dataset.arg === '10305-1');
    const purchaseCell = burg.querySelectorAll('td.price-cell')[0];
    assert.match(purchaseCell.textContent, /≈/);
    assert.match(purchaseCell.querySelector('[title]').getAttribute('title'), /geschätzt/);
    const titanic = zeilen.find(z => z.dataset.arg === '10294-1');
    assert.doesNotMatch(titanic.textContent, /≈/);
    assert.match(burg.querySelector('.fin-sub').textContent, /Kaufpreis geschätzt/, 'auch in der Telefonzeile');
    assert.ok(await warte(() => !o.d.getElementById('fin-basis').hidden));
    assert.match(o.d.getElementById('fin-basis').textContent, /1 geschätzter Kaufpreis/);
  } finally {
    o.w.close();
  }
});

test('adding a set sends currency and date', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    o.d.querySelector('[data-click="openCapture"][data-arg="set"]').click();
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
    assert.deepEqual(
      { p: rumpf.purchase_price, c: rumpf.currency, d: rumpf.date },
      { p: 260.66, c: 'USD', d: '2019-03-04' },
    );
  } finally {
    o.w.close();
  }
});

test('entry dialogs consistent', async () => {
  const o = await openUi({}, { browserLanguage: 'de-DE' });
  try {
    assert.equal(o.d.getElementById('ap-qty-inline').labels[0].textContent.trim(), 'Anzahl');
    for (const id of ['add-set-modal', 'add-part-modal', 'add-fig-modal']) {
      const dialog = o.d.getElementById(id);
      assert.ok(dialog.querySelector('input[type=date]'), `${id}: kein Datumsfeld`);
      const sichtbar =
        dialog.textContent +
        [...dialog.querySelectorAll('[placeholder]')].map(e => e.getAttribute('placeholder')).join(' ');
      assert.doesNotMatch(sichtbar, /z\.B\.|\(opt\.\)/, id);
    }
  } finally {
    o.w.close();
  }
});
