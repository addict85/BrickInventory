/**
 * Farbfilter und Kategoriefilter zaehlen dasselbe Blickfeld.
 *
 * ── Der Befund (Nachtrag 134) ───────────────────────────────────────────────
 *
 * Der Teile-Reiter hat zwei Filterlisten uebereinander, beide mit Zaehlwerten,
 * beide ueber DERSELBEN Liste:
 *
 *     /api/v1/parts/colors      → utils/handlers/parts.ts, getPartsColors
 *     /api/v1/parts/categories  → routes/parts.ts, inline
 *
 * Die erste las das Blickfeld (`accounts` → scopeIds), die zweite die eigene
 * Konto-ID. Im Haushalt zaehlte die Farbliste also die Teile ALLER Konten, die
 * Kategorienliste nur die eigenen — und wer nach einer Kategorie filterte,
 * bekam eine Liste, die zu keiner der beiden Zahlen darueber passte.
 *
 * Aufgefallen ist es beim Bauen der Filter fuer die Android-App: Sie ruft
 * beide Adressen mit demselben `accounts`, und dabei war nachzusehen, was der
 * Server damit macht.
 *
 * ── Warum verglichen und nicht festgeschrieben ──────────────────────────────
 *
 * Eine feste Erwartung („3 Teile") waere beim naechsten Umbau der Gruppierung
 * genauso falsch wie die alte Zahl. Verglichen wird deshalb, was beide Listen
 * ueber DENSELBEN Bestand sagen: Die Summe der Teile ueber alle Farben muss
 * die Summe ueber alle Kategorien sein — es sind dieselben Teile, zweimal
 * gruppiert.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test.after(async () => { await db.pool.end().catch(() => {}); });

test('Farb- und Kategorienliste sehen im Haushalt denselben Bestand',
  { concurrency: 1 }, async (t) => {

  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }

  const hauptName = `tfhaupt-${process.pid}`, kindName = `tfkind-${process.pid}`;
  for (const n of [hauptName, kindName])
    await db.run('DELETE FROM users WHERE username = $1', [n]).catch(() => {});
  const haupt = (await db.get(
    'INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [hauptName, 'x'])).id;
  const kind = (await db.get(
    'INSERT INTO users (username, password_hash) VALUES ($1,$2) RETURNING id', [kindName, 'x'])).id;

  try {
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [haupt, kind]);

    // Das Set traegt die Teile — beide Listen schliessen `source='manual'` aus.
    await db.run(`INSERT INTO sets (user_id,set_number,name,quantity) VALUES
        ($1,'0001-1','Haupt',1), ($2,'0002-1','Kind',1)`, [haupt, kind]);
    // Je Konto ein Teil, VERSCHIEDENE Farben: Waere die Farbe gleich, faenden
    // beide Zaehlungen zufaellig dieselbe Zahl und der Test pruefte nichts.
    await db.run(`INSERT INTO parts
        (user_id, set_number, part_number, part_name, color_id, color_name, category_name, quantity, source)
        VALUES ($1,'0001-1','3001','Stein',4,'Rot','Bricks',2,'set'),
               ($2,'0002-1','3002','Platte',1,'Blau','Plates',5,'set')`, [haupt, kind]);

    const { base } = testServer(_req, {
      sitzung: { userId: haupt },
      apiNutzer: { user_id: haupt, is_admin: 0 },
      routen: { '/api/v1/parts': 'routes/parts.js', '/api/v1': 'routes/api_v1/index.js' },
      t,
    });
    const hole = async (pfad) => (await fetch(base + pfad)).json();

    for (const modus of ['all', 'own']) {
      const farben = await hole(`/api/v1/parts/colors?accounts=${modus}`);
      const kats   = await hole(`/api/v1/parts/categories?accounts=${modus}`);
      assert.ok(farben.success, `Farben (${modus}): ${JSON.stringify(farben)}`);
      assert.ok(kats.success,   `Kategorien (${modus}): ${JSON.stringify(kats)}`);

      const summe = (l, f) => l.reduce((a, x) => a + Number(x[f] || 0), 0);
      assert.equal(summe(kats.categories, 'unique_parts'), summe(farben.colors, 'unique_parts'),
        `${modus}: Farb- und Kategorienliste zaehlen verschieden viele Teile — ` +
        `sie lesen dann verschiedene Blickfelder.\n` +
        `Farben: ${JSON.stringify(farben.colors)}\n` +
        `Kategorien: ${JSON.stringify(kats.categories)}`);
    }

    // Und der Unterschied zwischen den Modi muss ueberhaupt da sein — sonst
    // waere die Gleichheit oben zweimal dieselbe Aussage.
    const alle = await hole('/api/v1/parts/categories?accounts=all');
    const eigen = await hole('/api/v1/parts/categories?accounts=own');
    assert.ok(alle.categories.length > eigen.categories.length,
      'Mit dem Haushalt muessen mehr Kategorien da sein als ohne — sonst greift ' +
      '`accounts` gar nicht und der Vergleich darueber ist wertlos');
  } finally {
    await db.run('DELETE FROM parts WHERE user_id = ANY($1)', [[haupt, kind]]).catch(() => {});
    await db.run('DELETE FROM sets WHERE user_id = ANY($1)', [[haupt, kind]]).catch(() => {});
    await db.run('DELETE FROM account_links WHERE main_user_id = $1', [haupt]).catch(() => {});
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[haupt, kind]]).catch(() => {});
  }
});
