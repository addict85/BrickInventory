/**
 * Die Merklisten-Zeile der Webapp: kein Übernahme-Knopf, dafür der Marktpreis.
 * Und der Lagerort steht im Detail der manuellen Einträge. Die Webapp läuft im
 * echten Bündel (jsdom), der Server gegen die Test-DB.
 *
 * Gegenproben (10.11.2026 gemessen, je einzeln, Bündel bzw. dist neu gebaut):
 *   A  in merkliste.js zeile() den Marktpreis weggelassen → rot: „die Webapp-Zeile …“
 *   B  dort den Papierkorb entfernt → rot: ebenda
 *   C  in parts.js den Papierkorb der manuellen Kachel entfernt → rot: „manuelle
 *      Einträge …“
 *   D  in manuell-detail.js die Lagerortzeile entfernt → rot: ebenda
 *   E  in teileListe.ts manuelleTeile `NULL::text AS storage` → rot: „die Abfrage
 *      der manuellen Teile …“
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const { oeffneOberflaeche, reiter, warte } = require('./helpers/oberflaeche');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { haeltTeil } = require('./helpers/bestand');
test.after(() =>
  testDaten()
    .pool.end()
    .catch(() => {}),
);

test('die Webapp-Zeile zeigt Marktpreis und Papierkorb, keinen Übernahme-Knopf', async () => {
  const o = await oeffneOberflaeche({
    '/v1/wanted': {
      success: true,
      merkposten: [
        { set_number: '10305-1', condition: 'N', user_id: 1, name: 'Burg', marktpreis: 349.99, waehrung: 'EUR' },
      ],
    },
  });
  try {
    await reiter(o.w, 'wanted');
    assert.ok(await warte(() => o.d.querySelector('#mk-list .mk-zeile')), 'keine Zeile');
    const z = o.d.querySelector('#mk-list .mk-zeile');
    assert.match(z.querySelector('.mk-preis')?.textContent ?? '', /349[.,]99/, 'kein Marktpreis');
    assert.ok(z.querySelector('.delbtn[data-click="merkpostenLoeschenStop"]'), 'kein Papierkorb');
    assert.equal(z.querySelector('[data-click="merkpostenUebernehmen"]'), null, 'die Zeile übernimmt wieder');
    assert.equal(z.dataset.click, 'oeffneMerkpostenDetail', 'die Zeile öffnet nicht das Detail');
  } finally {
    o.w.close();
  }
});

test('manuelle Einträge: Papierkorb auf der Kachel, Lagerort und Löschen im Detail', async () => {
  const o = await oeffneOberflaeche({
    '/v1/parts/manual': {
      success: true,
      parts: [{ part_number: '3001', color_id: 4, quantity: 3, user_id: 1, part_name: 'Stein', storage: 'Kiste 3' }],
      total: 1,
      page: 1,
      page_size: 50,
    },
  });
  try {
    await reiter(o.w, 'parts');
    assert.ok(await warte(() => o.d.querySelector('#manual-parts-list .man-tile')), 'keine manuelle Kachel');
    const kachel = o.d.querySelector('#manual-parts-list .man-tile');
    assert.ok(kachel.querySelector('.delbtn[data-click="deleteManualPartStop"]'), 'kein Papierkorb auf der Kachel');
    kachel.click();
    assert.ok(await warte(() => o.d.getElementById('man-storage')), 'das Detail hat keine Lagerortzeile');
    assert.ok(o.d.getElementById('man-detail-modal').classList.contains('open'));
    for (const id of ['btn-md', 'mk-m-del', 'man-detail-del'])
      assert.ok(o.d.getElementById(id), `der Papierkorb im Detail fehlt (${id})`);
  } finally {
    o.w.close();
  }
});

test('die Abfrage der manuellen Teile liefert den Lagerort', async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const U = 990900 + (process.pid % 90);
  const weg = async () => {
    await db.run('DELETE FROM parts WHERE user_id=$1', [U]).catch(() => {});
    await db.run('DELETE FROM storage_locations WHERE user_id=$1', [U]).catch(() => {});
    await db.run('DELETE FROM users WHERE id=$1', [U]).catch(() => {});
  };
  await weg();
  t.after(weg);
  await db.run("INSERT INTO users (id,username,password_hash) VALUES ($1,$2,'x')", [U, `mz${U}`]);
  const ort = (await db.get("INSERT INTO storage_locations (user_id,name) VALUES ($1,'Kiste 3') RETURNING id", [U])).id;
  await haeltTeil(db, U, `mz-${U}`, { colorId: 4, menge: 2, storageId: ort });
  const teile = await require('./helpers/sources').handlerModul(_req).manuelleTeileListe([U], U);
  assert.deepEqual(
    teile.map(p => [p.part_number, p.storage]),
    [[`mz-${U}`, 'Kiste 3']],
  );
});
