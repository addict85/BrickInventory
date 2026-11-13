/**
 * Der Namensabruf /sets/info/:setNumber steht in routes/api_v1/sets.ts vor
 * /sets/:setNumber/…: Sonst landet eine Nummer, die wie ein Pfadwort der ersten aussieht, landete dort:
 * GET /api/v1/sets/info/price-history traf /sets/:setNumber/price-history mit …
 *
 * Gegenprobe (am 29.10.2026 gemessen): die Route /sets/info/:setNumber hinter
 * die Routen /sets/:setNumber/… gestellt → rot:
 * „ein Pfadwort als Setnummer“ (die Antwort kam vom Preisverlauf).
 *
 * Ein Platzhalter („Set <Nummer>“ ohne Jahr, Thema, Teile), den addSet ohne
 * Katalogtreffer anlegt, verrät nur, dass irgendein Konto die Nummer hat
 * (Sicherheitsprüfung Runde 13, H3). Gegenproben (04.11.2026 gemessen):
 *   A  in GET /sets/info die Absage für `platzhalter` gestrichen → rot: „ein
 *      fremder Platzhalter …“
 *   B  setStamm() liefert `platzhalter` immer wahr → rot: „eine gewöhnliche
 *      Nummer“, „ein Pfadwort …“ (der Katalogeintrag gilt nicht mehr)
 *   C  die Absage ohne Blickfeld (jeder Platzhalter gilt als fremd) → rot: „ein
 *      eigener Platzhalter …“
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testDaten } = require('./helpers/sources');
const _req = buildAndRequire();
const { katalogSet } = require('./helpers/bestand');
const { datenOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = testDaten();

test('der Namensabruf unter /api/v1/sets ist eindeutig', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req))) return;
  const NAME = `setinfo-${process.pid}`;
  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, `${NAME}-f`]]);
  const uid = (await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [NAME])).id;
  const fremdId = (
    await db.get(`INSERT INTO users (username,password_hash) VALUES ($1,'x') RETURNING id`, [`${NAME}-f`])
  ).id;
  const [fremd, eigen, nie] = [`${process.pid}7-1`, `${process.pid}8-1`, `${process.pid}9-1`];
  const nummern = ['price-history-1', `${process.pid}-1`, fremd, eigen];
  for (const [i, name] of ['Pfadwort', 'Gewöhnlich', null, null].entries())
    await katalogSet(db, nummern[i], { name: name ?? `Set ${nummern[i]}` });
  await db.run('INSERT INTO sets (user_id, set_number) VALUES ($1, $2), ($3, $4)', [fremdId, fremd, uid, eigen]);
  const { base } = testServer(_req, { sitzung: { userId: uid, username: NAME, isAdmin: false }, t });

  try {
    await t.test('eine gewöhnliche Nummer', async () => {
      const r = await (await fetch(`${base}/api/v1/sets/info/${process.pid}-1`)).json();
      assert.equal(r.name, 'Gewöhnlich');
    });
    await t.test('ein Pfadwort als Setnummer', async () => {
      const r = await (await fetch(`${base}/api/v1/sets/info/price-history`)).json();
      assert.equal(r.set_number, 'price-history-1', JSON.stringify(r));
      assert.equal(r.name, 'Pfadwort');
    });
    const info = async sn => (await fetch(`${base}/api/v1/sets/info/${sn}`)).json();
    await t.test('ein fremder Platzhalter antwortet wie eine nie erfasste Nummer', async () => {
      assert.deepEqual(await info(nie), { success: true, set_number: nie, name: nie, im_katalog: false });
      assert.deepEqual(await info(fremd), { success: true, set_number: fremd, name: fremd, im_katalog: false });
    });
    await t.test('ein eigener Platzhalter und ein Katalogeintrag gelten', async () => {
      const e = await info(eigen);
      assert.deepEqual([e.name, e.im_katalog], [`Set ${eigen}`, true], 'ein eigener Platzhalter …');
      const k = await info(`${process.pid}-1`);
      assert.deepEqual([k.name, k.im_katalog, 'platzhalter' in k], ['Gewöhnlich', true, false], 'ein Katalogeintrag …');
    });
  } finally {
    await db.run('DELETE FROM sets WHERE set_number = ANY($1)', [nummern]);
    await db.run('DELETE FROM set_catalog WHERE set_number = ANY($1)', [nummern]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [[uid, fremdId]]);
    await db.pool.end().catch(() => {});
  }
});
