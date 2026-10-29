/**
 * Eine Datenbank von vor dem 28.10.2026 kommt beim Start ohne Zwischenschritt
 * auf den aktuellen Stand: Die früheren Startstufen laufen einmal nach, samt
 * ihrer Datenschritte, dann alle Migrationen. Das Ergebnis gleicht im Schema
 * einer frischen Installation, und die Daten des Kontos sind noch da.
 *
 * Ausgangslage ist test/fixtures/altbestand-0046.sql (aus den echten alten
 * Ständen erzeugt): 0046, ohne parts_version_user — dieselbe Lage, an der ein
 * Server mit „Migration 0047 … parts_version_user does not exist“ stand.
 *
 * Gegenproben (am 29.10.2026 gemessen):
 *   A  in initSchemaOnce() ruesteAltbestandAuf() nicht aufgerufen → rot:
 *      „der Start bringt die Datenbank auf den aktuellen Stand“ (0047
 *      scheitert an parts_version_user)
 *   B  in ruesteAltbestandAuf() abgeloestesEntfernen() weggelassen → rot:
 *      „das Schema gleicht einer frischen Installation“ (Spalten, die
 *      Migrationen schon gelöscht hatten, stehen wieder da)
 *   C  in db/altbestand/startstufen.sql Etappe 1 entfernt → rot: „die
 *      Datenschritte der Startstufen sind gelaufen“ (zwei Preise am Tag)
 *      und „das Schema gleicht …“ (der Tagesindex fehlt)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL, deren Benutzer Datenbanken
 * anlegen darf.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BASIS = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const NAME = `altbestand_${process.pid}`, REF = `altbestand_ref_${process.pid}`;
const url = (db) => { const u = new URL(BASIS); u.pathname = '/' + db; return u.toString(); };
process.env.DATABASE_URL = url(NAME);
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));

/** Schema als Menge von Zeilen — unabhängig von der Spaltenreihenfolge. */
async function schemaBild(c) {
  const abfragen = [
    `SELECT 'spalte ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || COALESCE(column_default, '')
       FROM information_schema.columns WHERE table_schema = 'public'`,
    `SELECT 'index ' || indexdef FROM pg_indexes WHERE schemaname = 'public'`,
    // Ohne NOT-NULL-Regeln (contype 'n', ab PostgreSQL 18): Ihr Name folgt dem
    // Tabellennamen bei der Anlage und bleibt beim Umbenennen (0062) stehen;
    // ob eine Spalte NOT NULL ist, steht schon in der Spaltenzeile.
    `SELECT 'regel ' || r.relname || ' ' || k.conname || ' ' || pg_get_constraintdef(k.oid)
       FROM pg_constraint k JOIN pg_class r ON r.oid = k.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = 'public' AND k.contype <> 'n'`,
    `SELECT 'trigger ' || pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class r ON r.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
    `SELECT 'funktion ' || p.proname || ' ' || md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')`,
    `SELECT 'view ' || viewname || ' ' || md5(definition) FROM pg_views WHERE schemaname = 'public'`,
  ];
  const zeilen = [];
  for (const q of abfragen) zeilen.push(...(await c.query(q)).rows.map(r => Object.values(r)[0]));
  return zeilen.sort();
}

test('Altbestand aufrüsten', { concurrency: 1, timeout: 300_000 }, async (t) => {
  const admin = new Client({ connectionString: BASIS });
  try { await admin.connect(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  for (const d of [NAME, REF]) { await admin.query(`DROP DATABASE IF EXISTS ${d}`); await admin.query(`CREATE DATABASE ${d}`); }
  const db = _req('db/database.js');
  const ref = new Client({ connectionString: url(REF) });
  t.after(async () => {
    await ref.end().catch(() => {});
    await db.pool.end().catch(() => {});
    for (const d of [NAME, REF]) await admin.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  });

  // Der Altbestand, mit Daten, die die Datenschritte der Startstufen treffen.
  const alt = new Client({ connectionString: url(NAME) });
  await alt.connect();
  await alt.query(fs.readFileSync(path.join(__dirname, 'fixtures', 'altbestand-0046.sql'), 'utf8'));
  await alt.query('SET search_path TO public');
  await alt.query(`
    INSERT INTO users (id, username, password_hash, is_admin, is_active, email_verified) VALUES (4711, 'anna', 'x', 1, NULL, NULL);
    INSERT INTO sets (user_id, set_number) VALUES (4711, '10300-1');
    INSERT INTO set_acquisitions (user_id, set_number, quantity, purchase_price, condition) VALUES (4711, '10300-1', 2, 199.90, 'N');
    INSERT INTO parts (user_id, set_number, part_number, color_id, source) VALUES (4711, '10300-1', '3001', 5, 'set');
    INSERT INTO minifigs (user_id, fig_number) VALUES (4711, ' sw0001 ');
    INSERT INTO api_tokens (token, user_id) VALUES ('klartext-token', 4711), (repeat('a', 64), 4711);
    DROP INDEX idx_price_history_tag;
    INSERT INTO price_history (set_number, condition, currency_code, avg_price, recorded_at) VALUES
      ('10300-1', 'N', 'EUR', 200, '2026-10-20 08:00+00'), ('10300-1', 'N', 'EUR', 210, '2026-10-20 18:00+00'),
      ('10300-1', 'N', 'EUR', 220, '2026-10-21 08:00+00');`);
  await alt.end();

  // Der Vergleich: eine frische Installation (Basis plus Migrationen).
  await ref.connect();
  await ref.query(fs.readFileSync(path.join(ROOT, 'db', 'basis.sql'), 'utf8'));
  await ref.query('SET search_path TO public');
  await _req('db/migrate.js').runMigrations(ref);

  await t.test('der Start bringt die Datenbank auf den aktuellen Stand', async () => {
    await db.initSchemaOnce();
    const dateien = fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter(f => f.endsWith('.sql')).sort();
    const angewandt = (await db.all('SELECT name FROM schema_migrations')).map(r => r.name);
    assert.deepEqual(dateien.filter(f => !angewandt.includes(f)), []);
  });

  await t.test('das Schema gleicht einer frischen Installation', async () => {
    const c = await db.pool.connect();
    try {
      const ist = await schemaBild(c), soll = await schemaBild(ref);
      assert.deepEqual({ fehlt: soll.filter(z => !ist.includes(z)), zuviel: ist.filter(z => !soll.includes(z)) },
        { fehlt: [], zuviel: [] });
    } finally { c.release(); }
  });

  await t.test('die Datenschritte der Startstufen sind gelaufen', async () => {
    assert.deepEqual(await db.get('SELECT is_active, email_verified FROM users WHERE id = 4711'), { is_active: 1, email_verified: 1 });
    const preise = await db.all(`SELECT (recorded_at AT TIME ZONE 'UTC')::date::text AS tag, avg_price::float AS preis
      FROM price_history WHERE set_number = '10300-1' ORDER BY recorded_at`);
    assert.deepEqual(preise, [{ tag: '2026-10-20', preis: 210 }, { tag: '2026-10-21', preis: 220 }]);
    assert.deepEqual((await db.all('SELECT token FROM api_tokens WHERE user_id = 4711')).map(r => r.token), ['a'.repeat(64)]);
    assert.equal((await db.get('SELECT fig_number FROM minifigs WHERE user_id = 4711')).fig_number, 'sw0001');
  });

  await t.test('der Bestand des Kontos bleibt', async () => {
    assert.equal(Number((await db.get(`SELECT SUM(quantity) AS n FROM set_acquisitions WHERE user_id = 4711`)).n), 2);
    assert.equal(Number((await db.get(`SELECT COUNT(*) AS n FROM parts WHERE user_id = 4711`)).n), 1);
  });

  await t.test('ein zweiter Start ändert nichts mehr', async () => {
    const vorher = (await db.all('SELECT name FROM schema_migrations ORDER BY name')).map(r => r.name);
    await db.initSchemaOnce();
    assert.deepEqual((await db.all('SELECT name FROM schema_migrations ORDER BY name')).map(r => r.name), vorher);
  });
});
