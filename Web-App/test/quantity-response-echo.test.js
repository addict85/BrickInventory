/**
 * Beide Oberflächen übernehmen die Menge aus der SERVERANTWORT.
 *
 * Gegenprobe (durchgeführt): in gallery.js `const echt = qty` gesetzt →
 * der Webapp-Teilschritt wird rot. Am 30.10.2026 gemessen: in
 * routes/api_v1/sets.ts `...(r || {})` aus der PUT-Antwort entfernt → rot:
 * „die Route liefert die Menge“ (undefined statt 3). Am 08.11.2026
 * gemessen: in autosaveSet `const echt = qty` → rot: „die Webapp übernimmt
 * die Menge aus der Antwort“ (Feld bleibt auf 1). Am 12.11.2026 gemessen (das
 * Detail liest nach dem Speichern neu): in frischeDetailAuf das Setzen von
 * m-qty aus d.set.quantity entfernt → rot: ebenda (Feld leer).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { oeffneOberflaeche, warte } = require('./helpers/oberflaeche');
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');

test('die Route liefert die Menge überhaupt mit', { concurrency: 1 }, async t => {
  // Ohne das Feld fielen beide Clients still auf ihre eigene Annahme zurück —
  // der Rückfall ist absichtlich lautlos. Die Menge kommt aus updateSet(),
  // summiert über das Blickfeld.
  const db = testDaten();
  if (!(await datenOderSkip(t, _req))) return;
  const NAME = `mengenecho-${process.pid}`,
    SN = `${process.pid}5-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  await haeltSet(db, uid, SN, 2);
  const { base } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const setze = async quantity =>
    (
      await fetch(`${base}/api/v1/sets/${SN}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity }),
      })
    ).json();
  assert.equal((await setze(3)).quantity, 3, 'die Route liefert die Menge');
  assert.equal((await setze(1)).quantity, 1, 'auch nach dem Verringern');
});

test('die Webapp übernimmt die Menge aus der Antwort', async () => {
  // Der Server deckelt das Verringern (Erfassungen anderer Konten im Haushalt): Er schreibt 2, nicht 1.
  // Danach liest das Detail das Set neu; der Server nennt dort dieselbe Menge.
  const SET = { set_number: '10294-1', name: 'Titanic', year: 2021, quantity: 3 };
  const { w, d, aufrufe } = await oeffneOberflaeche({
    '/v1/sets': { success: true, total: 1, themes: [], sets: [SET] },
    '/v1/sets/10294-1': (_url, o) => {
      if (o?.method === 'PUT') SET.quantity = 2;
      return o?.method === 'PUT' ? { success: true, quantity: 2 } : { success: true, set: { ...SET } };
    },
    '/v1/sets/10294-1/acquisitions': { success: true, acquisitions: [] },
  });
  try {
    assert.ok(await warte(() => d.querySelector('#gallery [data-click="openModal"]')));
    d.querySelector('#gallery [data-click="openModal"]').click();
    assert.ok(await warte(() => d.getElementById('m-qty')?.value === '3'), 'Das Detail zeigt die Menge nicht');
    d.getElementById('m-qty').value = '1';
    d.getElementById('m-qty').dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.ok(await warte(() => aufrufe.some(a => a.method === 'PUT')), 'Die Menge wird nicht gespeichert');
    assert.ok(
      await warte(() => d.getElementById('m-qty').value === '2'),
      `Das Feld behält die eigene Annahme: ${d.getElementById('m-qty').value}`,
    );
  } finally {
    w.close();
  }
});
