/**
 * A transaction that runs into a deadlock (40P01) or serialization failure
 * (40001) restarts up to twice with the option repeatAtConflict;
 * without the option the error stays. The move and backfill paths
 * set it because they lock rows of two accounts in changing order.
 *
 * Counter-checks (measured on 07.11.2026, each on its own):
 *   A  the retry loop removed in transaction() → red: “a real
 *      deadlock is retried with the option”, “serialization failure …”,
 *      “the aborted attempt leaves nothing behind”, plus the three callers
 *   B  40001 removed from TX_CONFLICT → red: “serialization failure …” and
 *      “the aborted attempt leaves nothing behind”
 *   C  the option removed from verschiebeSet() → red: “moveSet
 *      retries on conflict”; from setEstimatedPrice() → red:
 *      “setEstimatedPrice retries on conflict”
 *      (the move path in changeAcquisition() needs a household account and
 *      is not covered here; it shares k.transact with locks with verschiebeSet.)
 *   D  mitInventarSperre() does not pass the option to transaction() → red:
 *      “mitInventarSperre passes the option on”, „moveSet …“
 *      (14.11.2026, now k.transact with `sperren`: in buildContext() the options
 *      not passed to transaction() → red: “k.transact with locks …”,
 *      „moveSet …“, „setEstimatedPrice …“)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData, testContext } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();

const TABLE_NAME = `tx_wiederholung_${process.pid}`;
const MIT = { repeatAtConflict: true };

/** An error as reported by PostgreSQL: only the code counts. */
const pgError = code => Object.assign(new Error(`simuliert ${code}`), { code });

test('transaction: retry on deadlock and serialization failure', { concurrency: 1 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  await db.run(`CREATE TABLE ${TABLE_NAME} (id int PRIMARY KEY, n int NOT NULL DEFAULT 0)`);
  await db.run(`INSERT INTO ${TABLE_NAME} (id) VALUES (1), (2)`);
  t.after(async () => {
    await db.run(`DROP TABLE IF EXISTS ${TABLE_NAME}`).catch(() => {});
    await db.pool.end().catch(() => {});
  });

  /** Both transactions first lock "their" row, then that of the other; only when both hold the first does it continue. */
  const cross = o => {
    let angekommen = 0;
    let versuche = 0;
    /** @type {() => void} */
    let weiter = () => {};
    const bothOnes = new Promise(frei => {
      weiter = () => frei(undefined);
    });
    const lauf = async (erste, zweite) => {
      await db.transaction(async tx => {
        const versuch = ++versuche;
        await tx.run(`UPDATE ${TABLE_NAME} SET n = n + 1 WHERE id = $1`, [erste]);
        // Only the first two attempts wait for each other; the retry runs freely.
        if (versuch <= 2) {
          if (++angekommen === 2) weiter();
          await bothOnes;
        }
        await tx.run(`UPDATE ${TABLE_NAME} SET n = n + 1 WHERE id = $1`, [zweite]);
      }, o);
    };
    return { lauf, versuche: () => versuche };
  };

  await t.test('a real deadlock is retried with the option', async () => {
    await db.run(`UPDATE ${TABLE_NAME} SET n = 0`);
    const k = cross(MIT);
    await Promise.all([k.lauf(1, 2), k.lauf(2, 1)]);
    assert.equal(k.versuche(), 3, 'genau ein Gegenspieler wurde abgebrochen und lief neu');
    // Every transaction has increased both rows once; the aborted attempt does not count.
    assert.deepEqual(
      (await db.all(`SELECT n FROM ${TABLE_NAME} ORDER BY id`)).map(z => z.n),
      [2, 2],
    );
  });

  await t.test('without the option the deadlock stays an error', async () => {
    await db.run(`UPDATE ${TABLE_NAME} SET n = 0`);
    const k = cross({});
    const r = await Promise.allSettled([k.lauf(1, 2), k.lauf(2, 1)]);
    const abgelehnt = r.filter(e => e.status === 'rejected');
    assert.equal(abgelehnt.length, 1);
    assert.equal(abgelehnt[0].reason.code, '40P01');
    assert.equal(k.versuche(), 2);
  });

  await t.test('serialization failure is retried, exactly twice', async () => {
    let n = 0;
    const r = await db.transaction(async () => {
      if (++n < 3) throw pgError('40001');
      return 'fertig';
    }, MIT);
    assert.deepEqual([r, n], ['fertig', 3]);

    let m = 0;
    await assert.rejects(
      db.transaction(async () => {
        m++;
        throw pgError('40001');
      }, MIT),
      { code: '40001' },
    );
    assert.equal(m, 3, 'ein Versuch und zwei Wiederholungen');
  });

  await t.test('other errors and missing option are not retried', async () => {
    let n = 0;
    await assert.rejects(
      db.transaction(async () => {
        n++;
        throw pgError('23505');
      }, MIT),
      { code: '23505' },
    );
    assert.equal(n, 1);
    let m = 0;
    await assert.rejects(
      db.transaction(async () => {
        m++;
        throw pgError('40P01');
      }),
      { code: '40P01' },
    );
    assert.equal(m, 1);
  });

  await t.test('the aborted attempt leaves nothing behind', async () => {
    await db.run(`UPDATE ${TABLE_NAME} SET n = 0`);
    let n = 0;
    await db.transaction(async tx => {
      await tx.run(`UPDATE ${TABLE_NAME} SET n = n + 1 WHERE id = 1`);
      if (++n === 1) throw pgError('40001');
    }, MIT);
    assert.equal((await db.get(`SELECT n FROM ${TABLE_NAME} WHERE id = 1`)).n, 1);
  });

  // The callers: a trigger throws a deadlock (40P01) on the first call, which the
  // sequence does not forget even after rolling back; the second attempt goes through.
  const onceError = async (tabelle, ereignis, bedingung) => {
    const name = `tx_einmal_${tabelle}_${process.pid}`;
    await db.run(`DROP SEQUENCE IF EXISTS ${name}`);
    await db.run(`CREATE SEQUENCE ${name}`);
    await db.run(`CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF nextval('${name}') = 1 THEN RAISE EXCEPTION 'simulierter Deadlock' USING ERRCODE = '40P01'; END IF;
        RETURN NEW;
      END $f$`);
    await db.run(`DROP TRIGGER IF EXISTS ${name} ON ${tabelle}`);
    await db.run(
      `CREATE TRIGGER ${name} BEFORE ${ereignis} ON ${tabelle} FOR EACH ROW WHEN (${bedingung}) EXECUTE FUNCTION ${name}()`,
    );
    return {
      aufrufe: async () => Number((await db.get(`SELECT last_value, is_called FROM ${name}`)).last_value),
      weg: async () => {
        await db.run(`DROP TRIGGER IF EXISTS ${name} ON ${tabelle}`);
        await db.run(`DROP FUNCTION IF EXISTS ${name}()`);
        await db.run(`DROP SEQUENCE IF EXISTS ${name}`);
      },
    };
  };
  const konten = [];
  const konto = async name => {
    const id = (
      await db.get(
        `INSERT INTO users (username, email, password_hash, is_active, email_verified)
         VALUES ($1, $2, 'x', true, true) RETURNING id`,
        [`${name}_${process.pid}`, `${name}_${process.pid}@example.org`],
      )
    ).id;
    konten.push(id);
    return id;
  };
  t.after(async () => {
    await db.run('DELETE FROM users WHERE id = ANY($1)', [konten]).catch(() => {});
  });

  await t.test('k.transact with locks passes the option on', async () => {
    const k = testContext('inventory');
    const sperren = [{ konto: 1, schluessel: 'x' }];
    let n = 0;
    const r = await k.transact(
      async () => {
        if (++n < 2) throw pgError('40P01');
        return 'fertig';
      },
      { ...MIT, sperren },
    );
    assert.deepEqual([r, n], ['fertig', 2]);
    let m = 0;
    await assert.rejects(
      k.transact(
        async () => {
          m++;
          throw pgError('40P01');
        },
        { sperren },
      ),
      { code: '40P01' },
    );
    assert.equal(m, 1);
  });

  await t.test('moveSet retries on conflict', async () => {
    const { moveSet } = require('./helpers/sources').areaPage('sets');
    const { holdsSet, quantityOf } = require('./helpers/inventory');
    const von = await konto('wv_von');
    const nach = await konto('wv_nach');
    await holdsSet(db, von, '10179-1', 2);
    // Moving only happens in the household: nach is a sub-account of von.
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [von, nach]);
    const probe = await onceError('sets', 'INSERT', `NEW.user_id = ${nach}`);
    try {
      const ids = (await db.all('SELECT id FROM set_acquisitions WHERE user_id = $1', [von])).map(z => z.id);
      const r = await moveSet(von, '10179-1', von, nach, ids);
      assert.equal(r.quantity, 2);
      assert.equal(await probe.aufrufe(), 2, 'erster Anlauf scheiterte, zweiter ging durch');
      assert.equal(await quantityOf(db, nach, '10179-1'), 2);
      assert.equal(await quantityOf(db, von, '10179-1'), 0);
    } finally {
      await probe.weg();
    }
  });

  await t.test('setEstimatedPrice retries on conflict', async () => {
    const { setEstimatedPrice } = _req('src/inventory/acquisitions.js');
    const { holdsSet } = require('./helpers/inventory');
    const u = await konto('wv_preis');
    await holdsSet(db, u, '10179-1', 1);
    const id = (await db.get('SELECT id FROM set_acquisitions WHERE user_id = $1', [u])).id;
    const probe = await onceError('set_acquisitions', 'UPDATE', `NEW.user_id = ${u}`);
    try {
      assert.equal(await setEstimatedPrice('set', id, 42), true);
      assert.equal(await probe.aufrufe(), 2, 'erster Anlauf scheiterte, zweiter ging durch');
      const z = await db.get('SELECT purchase_price::float AS p, price_estimated FROM set_acquisitions WHERE id = $1', [
        id,
      ]);
      assert.deepEqual([z.p, z.price_estimated], [42, true]);
    } finally {
      await probe.weg();
    }
  });
});
