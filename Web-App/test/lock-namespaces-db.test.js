/**
 * Lock namespaces against a REAL database.
 *
 * Counter-check (measured on 27.10.): txLock again with the user_id as the first
 * value → red: “an account's inventory lock does not hit a job”. Since the lock
 * is an option of k.transact (14.11.2026) again: in lockInventories()
 * (src/infra/area.ts) the account ID as class → red, the same test.
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip (unless
 * REQUIRE_DB=1).
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testContext } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const { LOCKS } = _req('src/infra/lockNamespaces.js');

async function dbReachable() {
  try {
    await db.get('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test('lock namespaces against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }

  /** Hold a lock on an own connection (not from the pool: there are more
   * namespaces than pool slots); returns the releaser. */
  async function halten(ns, zweiter = 0) {
    const c = await db.ownConnection();
    const { rows } = await c.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [ns, zweiter]);
    if (!rows[0].ok) {
      await c.end();
      throw new Error(`Namensraum ${ns} war schon belegt`);
    }
    return () => c.end();
  }

  /** Does a SECOND connection still get this lock? */
  async function stillFree(ns, zweiter = 0) {
    const c = await db.pool.connect();
    try {
      const { rows } = await c.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [ns, zweiter]);
      if (rows[0].ok) await c.query('SELECT pg_advisory_unlock($1, $2)', [ns, zweiter]);
      return rows[0].ok;
    } finally {
      c.release();
    }
  }

  await t.test('all namespaces are pairwise different', () => {
    const entries = Object.entries(LOCKS);
    assert.ok(
      entries.length >= 8,
      `Nur ${entries.length} Namensräume gefunden — ist LOCKS noch die vollständige Liste?`,
    );

    const gesehen = new Map();
    for (const [name, zahl] of entries) {
      assert.equal(typeof zahl, 'number', `${name} ist keine Zahl`);
      // Advisory locks are 64-bit; the single-value form takes bigint, the
      // two-value one two int4. All entries here are used with two values OR
      // one value — int4 is the narrower limit and therefore applies.
      assert.ok(
        Number.isInteger(zahl) && zahl > 0 && zahl <= 2147483647,
        `${name} = ${zahl} passt nicht in einen int4-Namensraum`,
      );
      if (gesehen.has(zahl)) {
        assert.fail(
          `${name} und ${gesehen.get(zahl)} teilen sich den Namensraum ${zahl} — ` +
            'die beiden Vorgänge sperren sich gegenseitig aus',
        );
      }
      gesehen.set(zahl, name);
    }
  });

  await t.test('different namespaces do not hinder each other', async () => {
    // The actual point: hold ALL at the same time. If there were a
    // duplicate anywhere, already the acquiring would fail — and with the name included.
    const freigeben = [];
    try {
      for (const [name, zahl] of Object.entries(LOCKS)) {
        try {
          freigeben.push(await halten(zahl));
        } catch (e) {
          assert.fail(`${name} (${zahl}) liess sich nicht belegen: ${e.message}`);
        }
      }
      assert.equal(freigeben.length, Object.keys(LOCKS).length);
    } finally {
      for (const f of freigeben) await f();
    }
  });

  await t.test('the same namespace really locks out', async () => {
    // Counter-check to the previous check: if pg_try_advisory_lock were always
    // successful here, „all acquirable at once" would say nothing at all.
    const frei = await halten(LOCKS.PRICE_JOB);
    try {
      assert.equal(
        await stillFree(LOCKS.PRICE_JOB),
        false,
        'Eine zweite Verbindung bekam dieselbe Sperre — dann schützt sie nichts',
      );
    } finally {
      await frei();
    }
    assert.equal(await stillFree(LOCKS.PRICE_JOB), true, 'Nach dem Freigeben muss die Sperre wieder zu haben sein');
  });

  await t.test('the second value subdivides the namespace', async () => {
    // Image download and CSV import rely on it: the same number, but
    // an own key per set or per table. Without this subdivision
    // they would run one after another instead of side by side.
    const frei = await halten(LOCKS.IMAGE_DOWNLOAD, 111);
    try {
      assert.equal(
        await stillFree(LOCKS.IMAGE_DOWNLOAD, 222),
        true,
        'Zwei verschiedene Sets müssen parallel laden dürfen',
      );
      assert.equal(
        await stillFree(LOCKS.IMAGE_DOWNLOAD, 111),
        false,
        'Dasselbe Set darf NICHT zweimal gleichzeitig laden',
      );
    } finally {
      await frei();
    }
  });

  await t.test("an account's inventory lock does not hit a job", async () => {
    // Account ID = number of a job, key = set number: with the user_id as the
    // first value this was exactly the lock of the image download for this set.
    const SET = '60511-1';
    const zweiter = (await db.get('SELECT hashtext($1) AS h', [SET])).h;
    const frei = {};
    await testContext('inventory').transact(
      async () => {
        frei.image = await stillFree(LOCKS.IMAGE_DOWNLOAD, zweiter);
        // On an own connection: db.get would run here via the transaction that already holds the lock.
        frei.selbst = await stillFree(
          LOCKS.INVENTORY,
          (await db.pool.query('SELECT hashtext($1) AS h', [`${LOCKS.IMAGE_DOWNLOAD}|${SET}`])).rows[0].h,
        );
      },
      { locks: [{ account: LOCKS.IMAGE_DOWNLOAD, key: SET }] },
    );
    assert.equal(frei.image, true, 'Die Bestandssperre von Konto 42 hält den Bild-Download des Sets auf');
    assert.equal(
      frei.selbst,
      false,
      'Die Bestandssperre liegt nicht unter LOCKS.INVENTORY — dann prüft der Fall oben nichts',
    );
  });

  await t.test('no bare number in a lock call any more', () => {
    // The only source text check that stays here — and it does not check
    // WHICH number stands somewhere, but THAT none stands there directly any more.
    // Exactly that makes the list above the only truth: a call with
    // a typed-in number would bypass it.
    const fs = require('node:fs');
    const path = require('node:path');
    const { ROOT } = require('./helpers/sources');

    const dateien = [];
    (function collect(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'dist', '.git', 'data', 'test'].includes(e.name)) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) collect(p);
        else if (e.name.endsWith('.ts')) dateien.push(p);
      }
    })(ROOT);

    const treffer = [];
    let geprueft = 0;
    for (const p of dateien) {
      if (p.endsWith(path.join('src/infra/lockNamespaces.ts'))) continue; // the list itself
      for (const row of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!/pg_(try_)?advisory(_xact)?(_)?lock|pg_advisory_unlock/.test(row)) continue;
        if (/^\s*[*/]/.test(row)) continue; // comment
        geprueft++;
        if (/advisory[a-z_]*\(\s*\d/.test(row)) {
          treffer.push(`${path.relative(ROOT, p)}: ${row.trim().slice(0, 90)}`);
        }
      }
    }
    assert.ok(geprueft >= 10, `Nur ${geprueft} Sperr-Aufrufe gefunden — greift das Suchmuster noch?`);
    assert.deepEqual(
      treffer,
      [],
      'Sperr-Namensraum als eingetippte Zahl statt aus src/infra/lockNamespaces.ts:\n  ' + treffer.join('\n  '),
    );
  });

  await db.pool.end().catch(() => {});
});
