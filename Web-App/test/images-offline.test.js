/**
 * The images of the tables are there even without network.
 *
 * Counter-checks (measured 10.11.2026, each alone, reverted):
 *   A  in deliverImage() `private, max-age=0` → `private, no-cache` → red: “… may offline …”
 *   B  the same → `max-age=0` (without private) → red: “… may offline …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');

test("the tables' images may come from the cache offline", { concurrency: 1 }, async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const NAME = `offline_${process.pid}`;
  await db.run('DELETE FROM users WHERE username = $1', [NAME]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1,'x',true,true) RETURNING id`,
      [NAME],
    )
  ).id;
  // Part images are catalog: every logged-in account gets them.
  const datei = path.join(__dirname, '..', 'data', 'images', 'parts', `OFF${process.pid}_0.png`);
  fs.mkdirSync(path.dirname(datei), { recursive: true });
  fs.writeFileSync(datei, 'Bild');
  t.after(async () => {
    fs.rmSync(datei, { force: true });
    await db.run('DELETE FROM users WHERE id = $1', [uid]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const { base } = testServer(_req, { sitzung: { userId: uid }, t });
  const r = await fetch(`${base}/images/parts/${path.basename(datei)}`);
  assert.equal([r.status, await r.text()].join(' '), '200 Bild');
  const kopf = String(r.headers.get('cache-control'));
  // no-cache, must-revalidate and no-store forbid the old copy that the app's offline fallback lives on.
  assert.doesNotMatch(kopf, /no-cache|must-revalidate|no-store/, kopf);
  // max-age=0: online it still asks every time, a replaced image applies immediately.
  assert.match(kopf, /max-age=0/, kopf);
  // private: a reverse proxy must not cache images behind a login.
  assert.match(kopf, /private/, kopf);
});
