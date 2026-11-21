/**
 * Resetting the password and “end other accesses” write several times;
 * if the last step fails, everything stays as it was. The error is forced
 * by a statement trigger on the table emptied last.
 *
 * Counter-checks (measured on 11.11.2026):
 *   A  withAccessEnd() without db.transaction (fn called directly) → red:
 *      “reset: password and token stay” and “other accesses …”
 *   B  beendeAndereZugaenge() calls the body directly instead of via withAccessEnd()
 *      → red: “other accesses: the token stays”
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

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
async function withBrake(fn) {
  await schalte(true);
  try {
    return await fn();
  } finally {
    await schalte(false);
  }
}

test('accesses end completely or not at all', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req, { migrieren: false }))) return;
  t.after(() => db.pool.end().catch(() => {}));
  const uid = await seed();
  const K = _req('src/account/accounts.js');
  const A = _req('src/account/deviceToken.js');
  const zugangsende = _req('src/account/accessEnd.js');
  const tokens = async () =>
    (await db.all('SELECT token FROM api_tokens WHERE user_id=$1 ORDER BY token', [uid])).map(z => z.token);
  const stand = () => db.get('SELECT password_hash, session_version FROM users WHERE id=$1', [uid]);
  await db.run(`INSERT INTO api_tokens (token, user_id) VALUES ('t1', $1), ('t2', $1)`, [uid]);
  const link = A.tokenDigest('ruecksetz-link');
  await db.run(`UPDATE users SET reset_token = $1, reset_token_expires = NOW() + interval '1 hour' WHERE id = $2`, [
    link,
    uid,
  ]);

  await t.test('reset: password and token stay', async () => {
    const vorher = await stand();
    await withBrake(() => assert.rejects(K.setPasswordBack(link, 'ein-neues-langes-Passwort'), /erzwungen/));
    assert.deepEqual(
      await stand(),
      vorher,
      'Passwort oder Sitzungsversion geändert, obwohl der letzte Schritt scheiterte',
    );
    assert.deepEqual(await tokens(), ['t1', 't2']);
    const z = await db.get('SELECT reset_token FROM users WHERE id=$1', [uid]);
    assert.equal(z.reset_token, link, 'der Link ist verbraucht, obwohl nichts galt');
  });

  await t.test('other accesses: the token stays', async () => {
    await withBrake(() =>
      assert.rejects(zugangsende.endOther(uid, { sitzung: null, token: null, zugaenge: true }), /erzwungen/),
    );
    assert.deepEqual(await tokens(), ['t1', 't2']);
  });

  await t.test('without errors: everything applies', async () => {
    const vorher = await stand();
    assert.equal(await K.setPasswordBack(link, 'ein-neues-langes-Passwort'), uid);
    const nachher = await stand();
    assert.notEqual(nachher.password_hash, 'alt');
    assert.ok(nachher.session_version > vorher.session_version);
    assert.deepEqual(await tokens(), []);
  });
});
