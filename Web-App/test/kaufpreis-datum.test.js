/**
 * Das Datumsfeld im Kaufpreis-Dialog zeigt das Datum in der Sprache des
 * Browsers. Nur wenn die von der App abweicht, steht es darunter noch einmal
 * in der Form der App; sonst stünde dasselbe Datum zweimal da.
 *
 * Gegenprobe (07.11.2026): in datumFeld() die Abfrage browserSchreibtDatumWieApp()
 * gestrichen → rot: „deutscher Browser, deutsche App: das Datum steht einmal“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');

const erfassungen = {
  '/v1/sets/10294-1/acquisitions': () => ({
    success: true,
    acquisitions: [{ id: 7, quantity: 1, condition: 'N', purchase_price: 129.99, created_at: '2026-06-01T10:00:00Z' }],
    totals: { quantity: 1, amount: 129.99 },
  }),
};

async function dialog(browserSprache) {
  const o = await oeffneOberflaeche(erfassungen, { sprache: 'de', browserSprache });
  const knopf = o.d.createElement('button');
  knopf.dataset.click = 'openAcqModal';
  knopf.dataset.arg = '10294-1';
  o.d.body.append(knopf);
  knopf.click();
  await warte(() => o.d.getElementById('acq-preis-7'));
  return o;
}

test('deutscher Browser, deutsche App: das Datum steht einmal', async () => {
  const o = await dialog('de-DE');
  try {
    assert.equal(o.d.getElementById('acq-datum-7'), null, 'das Datum steht unter dem Feld noch einmal');
  } finally {
    o.w.close();
  }
});

test('englischer Browser, deutsche App: das Datum steht darunter auf Deutsch', async () => {
  const o = await dialog('en-US');
  try {
    assert.match(o.d.getElementById('acq-datum-7')?.textContent ?? '', /1\. Juni 2026/);
  } finally {
    o.w.close();
  }
});
