/**
 * Passwort zurücksetzen und „andere Zugänge beenden“ schreiben mehrfach;
 * scheitert der letzte Schritt, bleibt alles beim Alten. Den Fehler erzwingt
 * ein Anweisungs-Trigger auf der zuletzt geleerten Tabelle.
 *
 * Gegenproben (am 11.11.2026 gemessen):
 *   A  mitZugangsende() ohne db.transaction (fn direkt aufgerufen) → rot:
 *      „Rücksetzen: Passwort und Token bleiben“ und „andere Zugänge …“
 *   B  beendeAndereZugaenge() ruft den Rumpf direkt statt über mitZugangsende()
 *      → rot: „andere Zugänge: der Token bleibt“
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  const { id } = await db.get(`INSERT INTO users (username, password_hash) VALUES ('kim', 'alt') RETURNING id`);
  await db.exec(`CREATE FUNCTION bremse_an() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION bremse() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF bremse_an() THEN RAISE EXCEPTION 'erzwungen'; END IF;
      RETURN NULL;
    END $$;
    CREATE TRIGGER bremse BEFORE DELETE ON passkeys FOR EACH STATEMENT EXECUTE FUNCTION bremse();
    CREATE TRIGGER bremse BEFORE DELETE ON user_sessions FOR EACH STATEMENT EXECUTE FUNCTION bremse();`);
  return id;
}

const schalte = an =>
  db.exec(`CREATE OR REPLACE FUNCTION bremse_an() RETURNS boolean LANGUAGE sql AS $$ SELECT ${an} $$`);
async function mitBremse(fn) {
  await schalte(true);
  try {
    return await fn();
  } finally {
    await schalte(false);
  }
}

test('Zugänge enden ganz oder gar nicht', { concurrency: 1 }, async t => {
  if (!(await dbOderSkip(t, _req, { migrieren: false }))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const uid = await seed();
  const K = _req('src/konto/konten.js');
  const A = _req('src/konto/auth.js');
  const tokens = async () =>
    (await db.all('SELECT token FROM api_tokens WHERE user_id=$1 ORDER BY token', [uid])).map(z => z.token);
  const stand = () => db.get('SELECT password_hash, sitzungs_version FROM users WHERE id=$1', [uid]);
  await db.run(`INSERT INTO api_tokens (token, user_id) VALUES ('t1', $1), ('t2', $1)`, [uid]);

  await t.test('Rücksetzen: Passwort und Token bleiben', async () => {
    const vorher = await stand();
    await mitBremse(() => assert.rejects(K.setzePasswortZurueck(uid, 'ein-neues-langes-Passwort'), /erzwungen/));
    assert.deepEqual(
      await stand(),
      vorher,
      'Passwort oder Sitzungsversion geändert, obwohl der letzte Schritt scheiterte',
    );
    assert.deepEqual(await tokens(), ['t1', 't2']);
  });

  await t.test('andere Zugänge: der Token bleibt', async () => {
    await mitBremse(() => assert.rejects(A.beendeAndereZugaenge(uid, null, null), /erzwungen/));
    assert.deepEqual(await tokens(), ['t1', 't2']);
  });

  await t.test('ohne Fehler: alles gilt', async () => {
    const vorher = await stand();
    await K.setzePasswortZurueck(uid, 'ein-neues-langes-Passwort');
    const nachher = await stand();
    assert.notEqual(nachher.password_hash, 'alt');
    assert.ok(nachher.sitzungs_version > vorher.sitzungs_version);
    assert.deepEqual(await tokens(), []);
  });
});
