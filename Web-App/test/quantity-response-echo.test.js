/**
 * Beide Oberflächen übernehmen die Menge aus der SERVERANTWORT.
 *
 * ── Warum es das Feld gibt ──────────────────────────────────────────────────
 * Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz auf das
 * eigene (Nachtrag 85). Beim VERRINGERN deckelt der Server bei den eigenen
 * Exemplaren — die eines anderen Kontos lassen sich nicht wegnehmen — und
 * antwortet mit der tatsächlichen Gesamtmenge.
 *
 * Beide Regler zählen ihre Zahl vorher hoch und schicken sie dann. Ohne die
 * Übernahme stünde nach einem gedeckelten Verringern die eigene Annahme im
 * Feld, bis jemand die Ansicht neu öffnet: Der Server hat recht, der Bildschirm
 * zeigt etwas anderes, und niemand merkt es.
 *
 * ── Was hier geprüft wird ───────────────────────────────────────────────────
 * Die REGEL in beiden Clients, nicht die Zahl — die prüft
 * set-quantity-household-db gegen die echte Datenbank. Hier geht es darum, dass
 * das gelieferte Feld auch GELESEN wird. Genau diese Lücke ist in diesem
 * Projekt schon zweimal aufgefallen (die Verschiebe-Zahlen in Nachtrag 65, das
 * Zustands-Aggregat davor): Der Server liefert seit jeher etwas mit, und die
 * Oberfläche liest es nie.
 *
 * Gegenprobe (durchgeführt): in 02-gallery.js `const echt = qty` gesetzt →
 * der Webapp-Teilschritt wird rot. Am 30.10.2026 gemessen: in
 * routes/api_v1/sets.ts `...(r || {})` aus der PUT-Antwort entfernt → rot:
 * „die Route liefert die Menge“ (undefined statt 3).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const ROOT = path.join(__dirname, '..');
const { ohneKommentare } = require('./helpers/sources');
const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const { haeltSet } = require('./helpers/bestand');

test('die Webapp übernimmt die Menge aus der Antwort', () => {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'public/js/02-gallery.js'), 'utf8'));
  const fn = src.slice(src.indexOf('export function autosaveSet'),
                       src.indexOf('G(\'btn-md\').onclick'));
  assert.match(fn, /d\.quantity/,
    'autosaveSet liest die Menge der Antwort nicht — nach einem gedeckelten ' +
    'Verringern bliebe die eigene Annahme im Feld stehen');
  assert.match(fn, /G\('m-qty'\)\.value = /,
    'Das Eingabefeld wird nicht korrigiert');
  assert.doesNotMatch(fn, /curSet\.quantity = qty;/,
    'Der gemerkte Stand darf nicht die GESENDETE Zahl sein, sondern die bestätigte');
});

test('die Route liefert die Menge überhaupt mit', { concurrency: 1 }, async (t) => {
  // Ohne das Feld fielen beide Clients still auf ihre eigene Annahme zurück —
  // der Rückfall ist absichtlich lautlos. Die Menge kommt aus updateSet(),
  // summiert über das Blickfeld.
  const db = _req('db/database.js');
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  const NAME = `mengenecho-${process.pid}`, SN = `${process.pid}5-1`;
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  t.after(async () => { await db.run('DELETE FROM users WHERE id=$1', [uid]).catch(() => {}); await db.pool.end().catch(() => {}); });
  await haeltSet(db, uid, SN, 2);
  const { base } = testServer(_req, { sitzung: { userId: uid }, apiNutzer: { user_id: uid, is_admin: 0 },
                                     routen: { '/api/v1': 'routes/api_v1/index.js' }, t });
  const setze = async (quantity) => (await fetch(`${base}/api/v1/sets/${SN}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ quantity }) })).json();
  assert.equal((await setze(3)).quantity, 3, 'die Route liefert die Menge');
  assert.equal((await setze(1)).quantity, 1, 'auch nach dem Verringern');
});
