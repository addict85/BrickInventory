/**
 * The date field in the purchase price dialog shows the date in the language of the
 * browser. Only if it differs from the app's does it stand below once more
 * in the app's form; otherwise the same date would stand there twice.
 *
 * Counter-check (07.11.2026): the query browserWritesDateHowApp() deleted in dateField()
 * → red: “German browser, German app: the date appears once”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { openUi, warte } = require('./helpers/ui');

const erfassungen = {
  '/v1/sets/10294-1/acquisitions': () => ({
    success: true,
    acquisitions: [{ id: 7, quantity: 1, condition: 'N', purchase_price: 129.99, created_at: '2026-06-01T10:00:00Z' }],
    totals: { quantity: 1, amount: 129.99 },
  }),
};

async function dialog(browserLanguage) {
  const o = await openUi(erfassungen, { sprache: 'de', browserLanguage });
  const knopf = o.d.createElement('button');
  knopf.dataset.click = 'openAcqModal';
  knopf.dataset.arg = '10294-1';
  o.d.body.append(knopf);
  knopf.click();
  await warte(() => o.d.getElementById('acq-price-7'));
  return o;
}

test('German browser, German app: the date appears once', async () => {
  const o = await dialog('de-DE');
  try {
    assert.equal(o.d.getElementById('acq-date-7'), null, 'das Datum steht unter dem Feld noch einmal');
  } finally {
    o.w.close();
  }
});

test('English browser, German app: the date appears below in German', async () => {
  const o = await dialog('en-US');
  try {
    assert.match(o.d.getElementById('acq-date-7')?.textContent ?? '', /1\. Juni 2026/);
  } finally {
    o.w.close();
  }
});
