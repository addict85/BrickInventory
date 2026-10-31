/**
 * „Keine Farbe“ ist 9999 wie bei Rebrickable, 0 bleibt Schwarz (Migration
 * 0071, utils/farben.ts). Geprüft werden die Migration auf Altdaten, das
 * Erfassen ohne Farbe, die Farbliste ohne Rebrickable und der Preisabruf.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in 0071 Regel 2 die Bedingung farbname_von = user_id entfernt → rot:
 *      „ein fremder Name beweist nichts“ (Bs Schwarz wurde 9999)
 *   B  V.colorId() gibt für leer wieder 0 zurück → rot: „ein Teil ohne Farbe
 *      wird nicht schwarz“
 *   C  die alte Notliste (13 = Black) zurück in farben.ts → rot: „die
 *      Notliste führt nur echte Rebrickable-IDs“
 *   D  resolveBlColorId ohne den Zweig für KEINE_FARBE → rot: „keine Farbe
 *      fragt BrickLink nach (Not Applicable)“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const MIGRATION = path.join(__dirname, '..', 'db/migrations/0071-keine-farbe.sql');

test('keine Farbe ist 9999, 0 bleibt Schwarz', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const mc = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(mc); } finally { mc.release(); }
  t.after(() => db.pool.end().catch(() => {}));

  await t.test('die Migration stellt nur um, wo die Zeile es beweist', async () => {
    const c = await db.pool.connect();
    try {
      await c.query('BEGIN');
      // Stand vor 0071: color_id darf NULL sein, der Index faltet NULL auf 0.
      await c.query(`ALTER TABLE parts ALTER COLUMN color_id DROP NOT NULL;
                     DROP INDEX idx_parts_eindeutig;
                     CREATE UNIQUE INDEX idx_parts_eindeutig ON parts (user_id, COALESCE(set_number, ''), part_number, COALESCE(color_id, 0))`);
      const konto = async (n) => (await c.query(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`farbe-${n}-${process.pid}`])).rows[0].id;
      const A = await konto('a'), B = await konto('b');
      await c.query(`INSERT INTO rb_colors (id,name,rgb) VALUES (0,'Black','05131D'),(13,'Pink','FC97AC')
                     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`);
      await c.query(`INSERT INTO sets (user_id, set_number) VALUES ($1, 'F1-1')`, [A]);
      const teil = (u, nr, farbe, satz = null) => c.query(
        `INSERT INTO parts (user_id, set_number, part_number, color_id, source) VALUES ($1,$2,$3,$4,$5)`,
        [u, satz, nr, farbe, satz ? 'set' : 'manual']);
      const kauf = (u, nr, farbe, menge, tag = '2026-01-05') => c.query(
        `INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity, unit_price, condition, currency, created_at)
         VALUES ($1,$2,$3,$4,1.5,'N','CHF',$5)`, [u, nr, farbe, menge, `${tag}T12:00:00Z`]);
      const katalog = (nr, farbe, name, hex, von) => c.query(
        `INSERT INTO part_color_catalog (part_number, color_id, color_name, color_hex, farbname_von, farbcode_von)
         VALUES ($1,$2,$3,$4,$5,$5) ON CONFLICT (part_number, color_id) DO UPDATE
         SET color_name = EXCLUDED.color_name, color_hex = EXCLUDED.color_hex,
             farbname_von = EXCLUDED.farbname_von, farbcode_von = EXCLUDED.farbcode_von`, [nr, farbe, name, hex, von]);

      await teil(A, 'KF1', null); await kauf(A, 'KF1', 0, 2);                       // Regel 1
      await teil(A, 'KF2', 0); await kauf(A, 'KF2', 0, 1);                          // Regel 2
      await katalog('KF2', 0, '[No Color/Any Color]', 'FCFCFC', A);
      await teil(B, 'KF2', 0); await kauf(B, 'KF2', 0, 4);                          // fremder Name
      await teil(A, 'KF3', 0); await katalog('KF3', 0, 'Black', '05131D', null);    // echtes Schwarz
      await teil(A, 'KF4', 13); await kauf(A, 'KF4', 13, 3);                        // Regel 3
      await katalog('KF4', 13, 'Black', '05131D', A);
      await teil(A, 'KF5', null); await kauf(A, 'KF5', 0, 2);                       // Zusammenlegen
      await teil(A, 'KF5', 9999); await kauf(A, 'KF5', 9999, 5);
      await teil(A, 'KF6', 0, 'F1-1');                                               // Set-Teil

      // Die verzögerten Fremdschlüssel der Testzeilen prüfen, sonst verweigert
      // ALTER TABLE in derselben Transaktion.
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');
      await c.query(fs.readFileSync(MIGRATION, 'utf8'));

      const farben = async (u, nr) => (await c.query(
        `SELECT p.color_id AS f, (SELECT COALESCE(json_agg(json_build_array(a.color_id, a.quantity) ORDER BY a.color_id), '[]')
                                    FROM part_acquisitions a WHERE a.user_id = p.user_id AND a.part_number = p.part_number) AS k
           FROM parts p WHERE p.user_id = $1 AND p.part_number = $2 ORDER BY p.color_id`, [u, nr])).rows;
      assert.deepEqual(await farben(A, 'KF1'), [{ f: 9999, k: [[9999, 2]] }], 'NULL wird 9999 samt Erfassungen');
      assert.deepEqual(await farben(A, 'KF2'), [{ f: 9999, k: [[9999, 1]] }], 'selbst gewähltes [No Color] wird 9999');
      assert.deepEqual(await farben(B, 'KF2'), [{ f: 0, k: [[0, 4]] }], 'ein fremder Name beweist nichts');
      assert.deepEqual(await farben(A, 'KF3'), [{ f: 0, k: [] }], 'Schwarz bleibt Schwarz');
      assert.deepEqual(await farben(A, 'KF4'), [{ f: 0, k: [[0, 3]] }], 'Notlisten-Black (13) zieht auf 0');
      assert.deepEqual(await farben(A, 'KF5'), [{ f: 9999, k: [[9999, 7]] }], 'gleiche Erfassungen werden addiert');
      assert.deepEqual(await farben(A, 'KF6'), [{ f: 0, k: [] }], 'Set-Teile bleiben');
      const spalte = (await c.query(`SELECT is_nullable, column_default FROM information_schema.columns
                                      WHERE table_name = 'parts' AND column_name = 'color_id'`)).rows[0];
      assert.deepEqual(spalte, { is_nullable: 'NO', column_default: '9999' });
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });

  await t.test('ein Teil ohne Farbe wird nicht schwarz', async () => {
    const V = _req('src/infra/validate.js');
    assert.equal(V.colorId(''), 9999);
    assert.equal(V.colorId(null), 9999);
    assert.equal(V.colorId('-1'), 9999);
    assert.equal(V.colorId('0'), 0);
    assert.equal(V.colorId(4), 4);
    const NAME = `farbe-erfassen-${process.pid}`;
    await db.run('DELETE FROM users WHERE username=$1', [NAME]);
    const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
    try {
      const { addManualPart } = _req('src/teile/manuelleTeile.js');
      await addManualPart(uid, { part_number: 'KF9', part_name: 'Probe', color_id: null, quantity: 2, unit_price: 1 });
      await addManualPart(uid, { part_number: 'KF9', part_name: 'Probe', color_id: 0, quantity: 1, unit_price: 1 });
      const zeilen = await db.all(`SELECT p.color_id, SUM(a.quantity)::int AS menge FROM parts p
        JOIN part_acquisitions a ON a.user_id = p.user_id AND a.part_number = p.part_number AND a.color_id = p.color_id
        WHERE p.user_id = $1 GROUP BY p.color_id ORDER BY p.color_id`, [uid]);
      assert.deepEqual(zeilen, [{ color_id: 0, menge: 1 }, { color_id: 9999, menge: 2 }]);
    } finally {
      await db.run('DELETE FROM users WHERE id=$1', [uid]);
    }
  });

  await t.test('die Farbliste kommt aus rb_colors, die Notliste führt nur echte Rebrickable-IDs', async () => {
    const { farbliste } = _req('utils/farben.js');
    const vorher = await db.all('SELECT id, name, rgb FROM rb_colors');
    try {
      await db.run('DELETE FROM rb_colors');
      const not = await farbliste();      // ohne Schlüssel kein Abruf
      assert.equal(not.find(f => f.id === 0)?.name, 'Black');
      assert.equal(not.find(f => f.id === 9999)?.name, '[No Color/Any Color]');
      assert.ok(!not.some(f => f.id === 13), 'die Notliste führt nur echte Rebrickable-IDs');
      await db.run(`INSERT INTO rb_colors (id,name,rgb) VALUES (0,'Black','05131D'),(13,'Pink','FC97AC'),(-1,'[Unknown]','0033B2')`);
      assert.deepEqual(await farbliste(), [{ id: 0, name: 'Black', hex: '05131D' }, { id: 13, name: 'Pink', hex: 'FC97AC' }]);
    } finally {
      await db.run('DELETE FROM rb_colors');
      for (const z of vorher) await db.run('INSERT INTO rb_colors (id,name,rgb) VALUES ($1,$2,$3)', [z.id, z.name, z.rgb]);
    }
  });

  await t.test('keine Farbe fragt BrickLink nach (Not Applicable)', async () => {
    const { resolveBlColorId } = _req('src/finanzen/rechnung/preise.js');
    assert.equal(await resolveBlColorId(9999), 0);
  });
});
