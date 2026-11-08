/**
 * Die Summenzeile der Erfassungen rechnet der SERVER — einmal.
 * Ausführlich: docs/begruendungen/test/acquisition-totals.test.js.md#kopf
 *
 * Gegenprobe (08.11.2026 gemessen): acqSummary() liest totals.quantity nicht
 * (`const menge = 0`) bzw. summenText() rechnet nicht mit totals.amount → rot:
 * „keine Oberfläche rechnet die Summe noch einmal“.
 * Gegenprobe (durchgeführt): `amount` in acquisitionTotals() auf 0 statt null
 * bei fehlenden Preisen → der Randfall-Teilschritt wird rot. Und ein
 * eingefügtes `acqs.reduce(...)` in 07-admin.js → der Regel-Teilschritt.
 * Am 30.10.2026 gemessen: `totals` aus der Teile-Antwort in
 * routes/api_v1/acquisitions.ts entfernt → rot: „parts“ im Routen-Teilschritt.
 * Seit 05.11.2026 fehlt `amount` ohne bekannten Preis (Geld hat einen Typ);
 * gemessen: die Route ohne das Weglassen → rot: „minifigs“ (amount: null
 * verletzt den Vertrag, die Antwort hat keine Erfassungen).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');
const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { acquisitionTotals } = _req('src/bestand/acquisitions.js');

// ── Teil 1: die Rechnung ────────────────────────────────────────────────────

test('Menge und Betrag: mengengewichtet über alle Zeilen', () => {
  const t = acquisitionTotals([
    { quantity: 2, purchase_price: '7.41' },   // aus Postgres kommen NUMERIC als Text
    { quantity: 1, purchase_price: 9.48 },
  ]);
  assert.equal(t.quantity, 3);
  assert.equal(t.amount, 24.3);               // 2×7.41 + 1×9.48
  assert.equal(t.priced_rows, 2);
});

test('unit_price zählt genauso wie purchase_price', () => {
  // Manuelle Teile und Minifiguren führen den Preis in unit_price. Die
  // Rückfallregel steht deshalb HIER und nicht in einem der Clients.
  assert.equal(acquisitionTotals([{ quantity: 3, unit_price: 0.6 }]).amount, 1.8);
});

test('ohne Preis ist der Betrag null — nicht 0', () => {
  // „Nichts erfasst" ist etwas anderes als „für null Franken gekauft". Nur mit
  // null kann die Oberfläche den Gedankenstrich zeigen, ohne selbst zu raten;
  // mit 0 müsste jede Ansicht dieselbe Auslegung noch einmal treffen.
  const t = acquisitionTotals([{ quantity: 2 }, { quantity: 1, purchase_price: null }]);
  assert.equal(t.quantity, 3, 'die Stücke sind da, auch ohne Preis');
  assert.equal(t.amount, null);
  assert.equal(t.priced_rows, 0);
});

test('eine Zeile mit Preis 0 ist erfasst und ergibt 0', () => {
  // Abgrenzung zum Fall darüber: 0 ist ein Preis, kein fehlender Wert —
  // sonst verschwände ein geschenktes Set aus der Zählung.
  const t = acquisitionTotals([{ quantity: 1, purchase_price: 0 }]);
  assert.equal(t.amount, 0);
  assert.equal(t.priced_rows, 1);
});

test('gemischt: Zeilen mit und ohne Preis', () => {
  const t = acquisitionTotals([
    { quantity: 2, purchase_price: 10 },
    { quantity: 5 },
  ]);
  assert.equal(t.quantity, 7, 'die preislose Zeile zählt bei der MENGE mit');
  assert.equal(t.amount, 20, 'beim BETRAG nicht — sie hat keinen');
});

test('der Betrag ist auf zwei Stellen gerundet', () => {
  // 3 × 11.326666 ergibt sonst 33.980000000000004 auf dem Schirm.
  const t = acquisitionTotals([{ quantity: 3, purchase_price: 11.326666 }]);
  assert.equal(String(t.amount).split('.')[1]?.length <= 2, true, `war: ${t.amount}`);
});

test('leere Liste', () => {
  assert.deepEqual(acquisitionTotals([]), { quantity: 0, amount: null, priced_rows: 0 });
  assert.deepEqual(acquisitionTotals(null), { quantity: 0, amount: null, priced_rows: 0 });
});

// ── Teil 2: die Regel ───────────────────────────────────────────────────────

test('alle drei Erfassungs-Routen liefern die Summe mit', { concurrency: 1 }, async (t) => {
  const db = _req('db/database.js');
  if (!await dbOderSkip(t, _req)) return;
  const P = process.pid, NAME = `summen-${P}`, SN = `${P}7-1`, PN = `su${P}`, FN = `fig-su${P}`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => { await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {}); await db.pool.end().catch(() => {}); });
  // Die Kontowährung ist die der Käufe: So bleibt die Summe ohne Umrechnung nachrechenbar.
  await db.run("INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'CHF')", [uid]);
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1,$2)', [uid, SN]);
  await db.run(`INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition, currency, created_at)
                VALUES ($1,$2,2,7.41,'N','CHF','2026-01-01'), ($1,$2,1,9.48,'N','CHF','2026-01-02')`, [uid, SN]);
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1,$2,4,'manual')`, [uid, PN]);
  await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency)
                VALUES ($1,$2,4,3,0.6,'N','CHF')`, [uid, PN]);
  await db.run(`INSERT INTO minifigs (user_id, fig_number, source) VALUES ($1,$2,'manual')`, [uid, FN]);
  await db.run(`INSERT INTO minifig_acquisitions (user_id, fig_number, quantity, unit_price, condition, currency)
                VALUES ($1,$2,2,NULL,'U','CHF')`, [uid, FN]);

  const { base } = testServer(_req, { sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
                                     routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  for (const [art, pfad, erwartet] of [
    ['sets', `sets/${SN}/acquisitions`, { quantity: 3, amount: 24.3, priced_rows: 2, currency: 'CHF', ohne_kurs: 0 }],
    ['parts', `parts/${PN}/4/acquisitions`, { quantity: 3, amount: 1.8, priced_rows: 1, currency: 'CHF', ohne_kurs: 0 }],
    ['minifigs', `minifigs/${FN}/acquisitions`, { quantity: 2, priced_rows: 0, currency: 'CHF', ohne_kurs: 0 }],
  ]) {
    const r = await (await fetch(`${base}/api/v1/${pfad}`)).json();
    assert.equal(r.acquisitions?.length > 0, true, `${art}: keine Erfassungen in der Antwort`);
    assert.deepEqual(r.totals, erwartet, art);
  }
});

test('keine Oberfläche rechnet die Summe noch einmal', async () => {
  // Der Server schickt die Summenzeile als `totals`; hier bewusst NICHT die Summe der Zeilen
  // (10 + 20 bei Menge 2): Was die Oberfläche zeigt, muss vom Server stammen.
  const SET = { set_number: '10294-1', name: 'Titanic', year: 2021, quantity: 2 };
  const zeile = (id, preis) => ({ id, quantity: 1, purchase_price: preis, condition: 'N', currency: 'EUR',
    created_at: '2026-10-01T10:00:00Z', user_id: 1 });
  const { d } = await oeffneOberflaeche({
    '/v1/sets': { success: true, total: 1, themes: [], sets: [SET] },
    '/v1/sets/10294-1': { success: true, set: SET },
    '/v1/sets/10294-1/acquisitions': { success: true, acquisitions: [zeile(1, 10), zeile(2, 20)],
      totals: { quantity: 5, amount: 99, currency: 'EUR' } },
  }).then(async (o) => {
    assert.ok(await warte(() => o.d.querySelector('#gallery [data-click="openModal"]')));
    o.d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => o.d.querySelector('[data-click="openAcqModal"]')), 'Kein Knopf zu den Kaufpreisen');
    o.d.querySelector('[data-click="openAcqModal"]').click();
    assert.ok(await warte(() => o.d.getElementById('acq-total-price')), 'Keine Summenzeile');
    return o;
  });
  try {
    assert.equal(d.getElementById('acq-total-qty').textContent.trim(), '5');
    assert.match(d.getElementById('acq-total-price').textContent, /99[.,]00/);
  } finally { d.defaultView.close(); }
});
