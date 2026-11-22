/**
 * Every writing route checks the type of its input: with its own schema from
 * the contract, otherwise with FLAT_INPUT (only simple values and lists of them).
 * An object instead of a text ({"$ne":1}) is 400 before the route runs.
 *
 * Counter-checks (measured on 03.11.2026):
 *   A  in checkInput() without fallback to FLAT_INPUT (routes without
 *      schema pass) → red: both tests
 *   B  FLAT_INPUT as z.record(z.string(), z.unknown()) → red: both tests
 *   C  (05.11.2026) input schema of PUT /api/v2/sets/:setNumber removed
 *      → red: “every writing route has an input schema"
 *   E  (05.11.2026) in alsSchema (validate.ts) the object check deleted
 *      → red: “every writing route rejects an object …" (wanted …/uebernehmen:
 *      quantity {"$ne":1} counted as “missing" and became 1)
 *   D  (05.11.2026) WITHOUT_BODY as z.looseObject({}) → red: “every writing
 *      route rejects an object …" for all routes without body
 *   F  (05.11.2026) the schema of POST /api/v2/sets/add-stream removed → red:
 *      “every writing route has an input schema"
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { noDb } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();
const { CONTRACT } = _req('src/contract/index.js');

test('nested values on writing routes', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    noDb(t, e);
    return;
  }
  {
    const c = await db.pool.connect();
    try {
      await _req('db/migrate.js').runMigrations(c);
    } finally {
      c.release();
    }
  }
  const NAME = `flach_${process.pid}`;
  const uid = (
    await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', true) RETURNING id`, [NAME])
  ).id;
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });
  await adminWithFactor(_req, uid);
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME, isAdmin: true }, t });
  const sende = async (methode, path, rumpf) => {
    const r = await fetch(base + path, {
      method: methode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rumpf),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, code: j.code ?? null };
  };

  await t.test('an object instead of a storage location name is not saved', async () => {
    assert.deepEqual(await sende('POST', '/api/v2/storage/locations', { name: { $ne: 1 } }), {
      status: 400,
      code: 'input_invalid',
    });
    assert.equal((await db.get('SELECT count(*)::int AS n FROM storage_locations WHERE user_id = $1', [uid])).n, 0);
    assert.equal(
      (await sende('POST', '/api/v2/storage/locations', { name: 'Kiste 1' })).status,
      200,
      'Testdaten: ein Text geht',
    );
  });

  await t.test('every writing route has an input schema', () => {
    const withoutSchema = Object.entries(CONTRACT)
      .filter(([k, r]) => !k.startsWith('GET ') && !r.input && !r.form)
      .map(([k]) => k);
    assert.deepEqual(withoutSchema, []);
  });

  await t.test('every writing route rejects an object in one of its fields', async () => {
    const routen = Object.entries(CONTRACT).filter(([k, r]) => !k.startsWith('GET ') && !r.form);
    assert.ok(routen.length >= 100, `nur ${routen.length} schreibende Routen`);
    const durch = [];
    for (const [k, r] of routen) {
      const [methode, path] = k.split(' ');
      // The first field that according to the contract takes no object (passkey: `antwort` is one).
      const form = r.input?.shape ?? {};
      const field = Object.keys(form).find(f => !form[f].safeParse({ $ne: 1 }).success) ?? 'feld';
      const a = await sende(methode, path.replace(/:\w+/g, '1'), { [field]: { $ne: 1 } });
      if (a.status !== 400) durch.push(`${k} (${field}) → ${a.status} ${a.code}`);
    }
    assert.deepEqual(durch, []);
  });
});
