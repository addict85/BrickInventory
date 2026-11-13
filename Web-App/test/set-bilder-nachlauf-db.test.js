/**
 * Der Set-Bilder-Nachlauf lädt nur Bilder zu Sets mit Bezug und fragt ein
 * bildloses Set (404) nicht bei jedem Start erneut.
 *
 * Gegenproben (durchgeführt):
 * - Bezug-Bedingung aus setBilderOhneDatei entfernt → „nur Katalog“ steht in der
 *   Auswahl, Teil 1 rot.
 * - merkeFehlend im Nachlauf entfernt → der 404-Satz steht im zweiten Lauf wieder
 *   in der Auswahl, Teil 2 rot.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

/** Abgefangener Download: Statuscode je Set, kein Netz. */
const antworten = new Map();
const angefragt = [];

const { buildAndRequire, testDaten, testBildwerk } = require('./helpers/sources');
const _req = buildAndRequire();
testBildwerk(null, {
  setBildLaden: async (_url, sn, info) => {
    angefragt.push(sn);
    const status = antworten.get(sn);
    if (status && info) info.status = status;
    return null;
  },
});
const { datenOderSkip } = require('./helpers/db');
const { haeltSet, katalogSet } = require('./helpers/bestand');
const db = testDaten();

test('Set-Bilder-Nachlauf: nur Sets mit Bezug, 404 ruht', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const repo = _req('src/katalog/repository/bildlage.js');
  const { setBilderNachladen } = _req('src/katalog/bildlage.js');
  const IM = _req('src/katalog/bilder/imageMisses.js');

  const P = `zzbn${process.pid}`;
  const gehalten = `${P}a-1`;
  const nurKatalog = `${P}b-1`;
  const gemerkt = `${P}c-1`;
  const bildlos = `${P}d-1`;
  const alle = [gehalten, nurKatalog, gemerkt, bildlos];

  const USER = `bildnachlauf-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [USER]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [USER])).id;
  for (const sn of alle) await katalogSet(db, sn, { image_url: `https://cdn.example/${sn}.jpg` });
  await haeltSet(db, uid, gehalten, 1);
  await haeltSet(db, uid, bildlos, 1);
  await db.run(`INSERT INTO wanted (user_id, set_number, condition) VALUES ($1,$2,'N')`, [uid, gemerkt]);
  await db.run(
    `INSERT INTO image_misses (cache_key, checked_at, reason) VALUES ($1, NOW(), 'HTTP 404 vom CDN')
     ON CONFLICT (cache_key) DO UPDATE SET checked_at = NOW()`,
    ['set:' + gemerkt],
  );
  const eigene = async () => (await repo.setBilderOhneDatei(db)).map(r => r.set_number).filter(sn => sn.startsWith(P));

  try {
    await t.test('Auswahl: gehaltene Sets ja, reine Katalogsätze und frische 404 nein', async () => {
      assert.deepEqual(await eigene(), [gehalten, bildlos]);
    });

    await t.test('ein 404 wird vermerkt und fehlt im nächsten Lauf', async () => {
      IM._leereVordergrund();
      antworten.set(bildlos, 404);
      angefragt.length = 0;
      await setBilderNachladen();
      await IM._schreibePuffer();
      assert.deepEqual(
        angefragt.filter(sn => sn.startsWith(P)),
        [gehalten, bildlos],
      );
      const m = await db.get(`SELECT reason FROM image_misses WHERE cache_key = $1`, ['set:' + bildlos]);
      assert.match(m?.reason ?? '', /404/);
      // Ohne Statuscode (Netzaussetzer) bleibt das Set in der Auswahl.
      assert.deepEqual(await eigene(), [gehalten]);
    });
  } finally {
    await db.run(`DELETE FROM image_misses WHERE cache_key = ANY($1::text[])`, [alle.map(sn => 'set:' + sn)]);
    await db.run(`DELETE FROM users WHERE id=$1`, [uid]);
    await db.run(`DELETE FROM rb_sets WHERE set_num = ANY($1::text[])`, [alle]);
    await db.pool.end().catch(() => {});
  }
});
