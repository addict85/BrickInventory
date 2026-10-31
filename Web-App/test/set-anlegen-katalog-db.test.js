/**
 * Ein Platzhalter-Name überschreibt nie den echten Namen eines Sets, und eine
 * Eingabe, die keine Setnummer sein kann, wird nicht angelegt.
 *
 * Fehlerbild: „Titanic" hiess nach erneutem Erfassen „Set 10294-1". Die
 * BrickLink-Typprüfung legt in catalog_cache „Set <Nummer>" an; getSetInfo()
 * gab das als Treffer zurück, und addSet() schrieb es über den Katalognamen.
 *
 * Gegenproben (am 28.10.2026 gemessen):
 *   A  in getSetInfo die Platzhalter-Bedingung entfernt (wieder
 *      `if (cached?.name) return cached`) → rot: „getSetInfo gibt den
 *      Platzhalter nicht als Treffer zurück"
 *   B  in addSetIntern wieder `name = EXCLUDED.name` → rot: „erneutes
 *      Erfassen ohne Quellen lässt den Katalognamen stehen"
 *   C  die Prüfung moeglicheSetNummer() in addSetIntern entfernt → rot:
 *      „eine Eingabe ohne Ziffer wird nicht als Set angelegt" ("abc-1" im Bestand)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne API-Schlüssel, damit
 * keine Quelle antwortet.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const Module = require('node:module');
const _echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = _echtesRequire.apply(this, arguments);
  // Kein Bildabruf und kein Nachzug: Der Test prüft den Katalog, nicht das Netz.
  if (typeof name === 'string' && /jobs[/\\]nachErfassung(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => (k === 'zieheNach' || k === 'zieheNachNeuanlage') ? () => {} : t[k] });
  if (typeof name === 'string' && /[/\\]images(\.js)?$/.test(name))
    return new Proxy(m, { get: (t, k) => k === 'downloadSetImage' ? async () => null : t[k] });
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

test('Katalogname bleibt bei fehlenden Quellen', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const SN = `9${process.pid % 10000}-1`;
  const NAME = `kat-name-${process.pid}`;
  const schluessel = ['rebrickable_api_key', 'brickset_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [schluessel]);
  await db.run('DELETE FROM users WHERE username=$1', [NAME]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  await db.run(`INSERT INTO set_catalog (set_number, name, year) VALUES ($1, 'Titanic', 2021)
                ON CONFLICT (set_number) DO UPDATE SET name='Titanic', year=2021`, [SN]);
  await db.run(`INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1, $2, 'NONE', 0)
                ON CONFLICT (set_number) DO UPDATE SET name=$2, fetched_at=NOW()`, [SN, `Set ${SN}`]);

  try {
    await t.test('getSetInfo gibt den Platzhalter nicht als Treffer zurück', async () => {
      const info = await _req('src/katalog/rebrickableKatalog.js').getSetInfo(SN);
      assert.equal(info, null);
    });

    await t.test('erneutes Erfassen ohne Quellen lässt den Katalognamen stehen', async () => {
      const r = await _req('src/sets/setService.js').addSet(SN, 1, uid, null, 10, 'N');
      assert.equal(r.action, 'added');
      const kat = await db.get('SELECT name, year FROM set_catalog WHERE set_number=$1', [SN]);
      assert.equal(kat.name, 'Titanic');
      assert.equal(kat.year, 2021);
    });

    await t.test('eine Eingabe ohne Ziffer wird nicht als Set angelegt', async () => {
      const { addSet } = _req('src/sets/setService.js');
      await assert.rejects(addSet('abc', 1, uid, null, null, 'N'),
        (e) => e.status === 400 && e.code === 'setnummer_ungueltig');
      assert.equal(await db.get(`SELECT 1 FROM sets WHERE user_id=$1 AND set_number='abc-1'`, [uid]), undefined);
      const { moeglicheSetNummer } = _req('src/sets/setNummer.js');
      for (const gut of ['10294-1', '928-1', 'comcon001-1', 'llca37-1', '5005358-2'])
        assert.ok(moeglicheSetNummer(gut), gut);
      for (const schlecht of ['abc-1', '-1', 'x'.repeat(21) + '1-1', '10294'])
        assert.ok(!moeglicheSetNummer(schlecht), schlecht);
    });
  } finally {
    await db.run('DELETE FROM users WHERE id=$1', [uid]);
    await db.run('DELETE FROM set_catalog WHERE set_number=$1', [SN]);
    await db.run('DELETE FROM catalog_cache WHERE set_number=$1', [SN]);
    for (const { key, value } of vorher)
      await db.run('INSERT INTO global_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [key, value]);
    await db.pool.end().catch(() => {});
  }
});
