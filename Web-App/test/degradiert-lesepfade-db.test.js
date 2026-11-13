/**
 * Ein Lesefehler sieht nicht aus wie „leer“: Entweder trägt die Antwort ihn
 * in `degradiert`, oder er geht als Fehler weiter. Erzwungen wird er, indem
 * der Test eine Tabelle seiner eigenen Datenbank kurz umbenennt.
 *
 * Gegenproben (10.11.2026 gemessen):
 * - src/teile/abfragen.ts: Marktpreise wieder mit
 *   `.catch(meldeUndLiefere('teile:marktpreise', new Map()))` statt `ab.oder` → rot:
 *   „ohne Preise sagt die Liste warum“ (kein `degradiert`).
 * - src/einstellungen/settings.ts: getGlobalSetting wieder mit
 *   `.catch(meldeUndLiefere(…, null))` → rot: „eine Einstellung, die sich nicht
 *   lesen lässt, ist keine Vorgabe“ (lieferte '24').
 * - Gegenrichtung „mit Preisen bleibt `degradiert` weg“ war in beiden grün.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();
const { getGlobalSetting } = _req('src/einstellungen/settings.js');

const NAME = `degradiert_${process.pid}`,
  TEIL = '3001dg';

test('Lesefehler: `degradiert` oder Fehler, nie still leer', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified)
                             VALUES ($1, 'x', true, true) RETURNING id`,
      [NAME],
    )
  ).id;
  await db.run(`INSERT INTO parts (user_id, part_number, color_id, source) VALUES ($1, $2, 5, 'manual')`, [uid, TEIL]);
  await db.run(`INSERT INTO part_acquisitions (user_id, part_number, color_id, quantity) VALUES ($1, $2, 5, 2)`, [
    uid,
    TEIL,
  ]);
  // Die Tabelle kommt im finally zurück, auch wenn eine Zusicherung scheitert.
  const weg = async (/** @type {string} */ tabelle) => {
    await db.run(`ALTER TABLE ${tabelle} RENAME TO ${tabelle}_weg`);
    return () => db.run(`ALTER TABLE IF EXISTS ${tabelle}_weg RENAME TO ${tabelle}`);
  };
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, {
    sitzung: { userId: uid },
    apiNutzer: { user_id: uid, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const manuelle = async () => {
    const r = await fetch(`${base}/api/v1/parts/manual`);
    assert.equal(r.status, 200);
    return r.json();
  };

  await t.test('mit Preisen bleibt `degradiert` weg', async () => {
    const j = await manuelle();
    assert.deepEqual(
      j.parts.map((/** @type {any} */ p) => p.part_number),
      [TEIL],
    );
    assert.equal(j.degradiert, undefined);
  });

  await t.test('ohne Preise sagt die Liste warum', async () => {
    const zurueck = await weg('part_price_cache');
    try {
      const j = await manuelle();
      assert.deepEqual(
        j.parts.map((/** @type {any} */ p) => p.part_number),
        [TEIL],
        'die Liste bleibt',
      );
      assert.equal(j.parts[0].avg_price, null);
      assert.deepEqual(j.degradiert, ['marktpreise']);
    } finally {
      await zurueck();
    }
  });

  await t.test('eine Einstellung, die sich nicht lesen lässt, ist keine Vorgabe', async () => {
    assert.equal(
      await getGlobalSetting(`fehlt_${process.pid}`, '24'),
      '24',
      'Vorbedingung: Vorgabe für „nicht gesetzt“',
    );
    const zurueck = await weg('global_settings');
    try {
      await assert.rejects(getGlobalSetting('price_cache_ttl', '24'), (/** @type {any} */ e) => e.code === '42P01');
    } finally {
      await zurueck();
    }
  });
});
