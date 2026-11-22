/**
 * Moving a set serializes on the SOURCE ACCOUNT — checked via
 * the real route, not on the source text.
 *
 * Counter-checks (measured):
 *   a) withInventoryLock → db.transaction (lock gone)  → A red, B+C green
 *   b) fromId → toId                                    → A+C red, B green
 *   c) key 'alle' instead of sn                         → A red, B+C green
 *   d) key fixed '75192-1' instead of sn                → B red, A+C green
 *   e) lock on BOTH accounts (fromId and toId)          → C red, A+B green
 *
 * Prerequisite: test DB via TEST_DATABASE_URL. Without DB: skip, unless
 * REQUIRE_DB=1.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();
const { testServer } = require('./helpers/server');
const { holdsSet, catalogSet } = require('./helpers/inventory');

test.after(async () => {
  await db.pool.end().catch(() => {});
});

let MAIN = 0,
  KIND = 0;
// Three sets, because every case needs its own, not yet moved capture:
// a successful move uses it up.
const SN_A = '75192-1',
  SN_B = '10179-1',
  SN_C = '21309-1';

/**
 * The lock as db/txLock.ts sets it — holder or waiter.
 *
 * The same SQL as there, deliberately literal: if a different key formation
 * stood here, this test would check a lock that does not exist
 * like this.
 */
const LOCK_SQL = 'SELECT pg_advisory_xact_lock($1, hashtext($2))';
const { LOCKS } = _req('src/infra/lockNamespaces.js');
const schluessel = (userId, scopeKey) => [LOCKS.INVENTORY, `${userId}|${scopeKey}`];

async function lockRows(userId, scopeKey, granted) {
  const z = await db.get(
    `SELECT COUNT(*)::int AS c FROM pg_locks
      WHERE locktype = 'advisory' AND classid = $1::oid
        AND objid = hashtext($2)::oid AND objsubid = 2
        AND granted = $3
        -- pg_locks gilt für den ganzen Server; parallele Testdateien halten in
        -- ihrer eigenen Datenbank dieselben Schlüssel.
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
    [...schluessel(userId, scopeKey), granted],
  );
  return Number(z.c);
}

/**
 * Waits until a waiter stands on exactly this key — or until the
 * route is done.
 */
async function findingWarter(userId, scopeKey, isDone, limitMs = 5000) {
  const bis = Date.now() + limitMs;
  for (;;) {
    if (isDone()) return 'fertig';
    if ((await lockRows(userId, scopeKey, false)) > 0) return 'wartet';
    if (Date.now() > bis) return 'nichts';
    await new Promise(r => setTimeout(r, 20));
  }
}

/** The move, with a limit, so that a hang becomes a message. */
function move(base, sn, acqIds, limitMs = 10000) {
  const lauf = fetch(`${base}/api/v2/sets/${sn}/move`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to_user_id: KIND, acquisition_ids: acqIds }),
  });
  const condition = { fertig: false };
  const tracked = lauf.then(
    r => {
      condition.fertig = true;
      return r;
    },
    e => {
      condition.fertig = true;
      throw e;
    },
  );
  condition.response = tracked;
  // The alarm is CLEARED as soon as the response is there. Without that an
  // open ten-second timer remains, keeps the process alive and
  // pushes the end of the file back — in a run with eighty
  // files that is not nothing.
  let alarm;
  condition.withLimit = Promise.race([
    tracked,
    new Promise((_, ab) => {
      alarm = setTimeout(
        () =>
          ab(
            new Error(
              `Die Verschiebung von ${sn} war nach ${limitMs} ms nicht fertig — ` +
                'sie hängt an einer Sperre, die sie nicht nehmen dürfte',
            ),
          ),
        limitMs,
      );
    }),
  ]).finally(() => clearTimeout(alarm));
  return condition;
}

async function erfassungsIds(userId, sn) {
  const z = await db.all('SELECT id FROM set_acquisitions WHERE user_id=$1 AND set_number=$2 ORDER BY id', [
    userId,
    sn,
  ]);
  return z.map(r => r.id);
}

async function setup() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(c);
  } finally {
    c.release();
  }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('kind','x')`);
  const id = async n => (await db.get(`SELECT id FROM users WHERE username=$1`, [n])).id;
  MAIN = await id('haupt');
  KIND = await id('kind');
  await db.run(`INSERT INTO account_links (main_user_id,sub_user_id) VALUES ($1,$2)`, [MAIN, KIND]);
  for (const sn of [SN_A, SN_B, SN_C]) {
    await catalogSet(db, sn, { name: sn });
    await holdsSet(db, MAIN, sn, 1, { preis: 100 });
  }
}

test('the move locks on (source account, set)', { concurrency: 1 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  await setup();

  const srv = testServer(_req, { sitzung: { userId: MAIN }, t });

  /**
   * Takes the lock on an own connection, runs `fn`, releases it.
   *
   * The own connection is the core: via `db.run()` this would run on a
   * connection from the pool that goes back immediately afterwards — and a
   * transaction lock ends with the transaction. It would be gone before the
   * route could notice it.
   */
  async function withLock(userId, scopeKey, fn) {
    const halter = await db.pool.connect();
    try {
      await halter.query('BEGIN');
      await halter.query(LOCK_SQL, schluessel(userId, scopeKey));
      assert.equal(
        await lockRows(userId, scopeKey, true),
        1,
        `Vorbedingung: der Halter hat die Sperre (${userId}, ${scopeKey}) nicht bekommen — ` +
          'dann sagt dieser Fall nichts über die Route',
      );
      return await fn(() => halter.query('COMMIT'));
    } finally {
      // ROLLBACK also after a COMMIT: then an ineffective notice, but
      // after a failed assertion the only place that cleans up the
      // open transaction (and with it the lock) again.
      await halter.query('ROLLBACK').catch(() => {});
      halter.release();
    }
  }

  await t.test('A. lock on (source account, set) — the move waits', async () => {
    const acq = await erfassungsIds(MAIN, SN_A);
    assert.equal(acq.length, 1, `Vorbedingung: eine Erfassung für ${SN_A}`);

    await withLock(MAIN, SN_A, async freigeben => {
      const v = move(srv.base, SN_A, acq);
      const befund = await findingWarter(MAIN, SN_A, () => v.fertig);

      assert.equal(
        befund,
        'wartet',
        {
          fertig:
            `Die Verschiebung lief DURCH, während die Sperre auf (${MAIN}, ${SN_A}) ` +
            'gehalten wurde. Dann nimmt die Route die Sperre nicht — zwei gleichzeitige ' +
            'Verschiebungen desselben Sets lesen denselben Stand, und die zweite ' +
            'schreibt die erste tot.',
          nichts:
            `Es erschien kein Warter auf (${MAIN}, ${SN_A}), und fertig wurde die ` +
            'Verschiebung auch nicht. Sie hängt also an etwas anderem — nicht an der ' +
            'Sperre, um die es hier geht.',
        }[befund],
      );

      // ── And the opposite direction: after releasing it must go through ────
      //
      // Without this part „waits" would also be fulfilled by a route that
      // hangs permanently. A lock that never opens is no progress.
      await freigeben();
      const r = await v.withLimit;
      assert.equal(
        r.status,
        200,
        `Nach dem Freigeben kam ${r.status} statt 200 — die Verschiebung lief in die ` +
          'Sperre und kam nicht wieder heraus',
      );
      assert.equal(
        (await db.get(`SELECT COUNT(*)::int c FROM set_acquisitions WHERE user_id=$1 AND set_number=$2`, [KIND, SN_A]))
          .c,
        1,
        'Die Antwort war 200, aber beim Kind liegt keine Erfassung — dann hat die ' +
          'Verschiebung nur quittiert, nicht verschoben',
      );
    });
  });

  await t.test('B. lock on ANOTHER set — it does not wait', async () => {
    // The key of the route must depend on WHICH set moves.
    // MEASURED: if a fixed set number stands in the route instead of sn,
    // this move waits along, and only this case turns red — A stays green.
    // Without B all moves of an account would queue up one after another, even
    // the completely uninvolved ones, and nothing would say so.
    const acq = await erfassungsIds(MAIN, SN_B);
    assert.equal(acq.length, 1, `Vorbedingung: eine Erfassung für ${SN_B}`);

    await withLock(MAIN, SN_A, async () => {
      const v = move(srv.base, SN_B, acq);
      const r = await v.withLimit; // throws if it hangs after all
      assert.equal(
        r.status,
        200,
        `Die Verschiebung von ${SN_B} kam mit ${r.status} zurück, während die Sperre auf ` +
          `(${MAIN}, ${SN_A}) lag — ein anderes Set darf davon nicht betroffen sein`,
      );
      assert.equal(
        await lockRows(MAIN, SN_A, false),
        0,
        `Es stand ein Warter auf (${MAIN}, ${SN_A}) — dann sperrt die Route auf dem ` +
          'Konto und nicht auf (Konto, Set), und zwei fremde Sets blockieren sich',
      );
    });
  });

  await t.test('C. lock on the TARGET account — it does not wait', async () => {
    // That is the actual content of `fromId`: serialization happens on the
    // account from which something goes AWAY — there it is read, calculated and
    // deleted. MEASURED: if `toId` stands in the route, A AND this case turn
    // red. And on its own this case catches a lock on BOTH accounts: also …
    const acq = await erfassungsIds(MAIN, SN_C);
    assert.equal(acq.length, 1, `Vorbedingung: eine Erfassung für ${SN_C}`);

    await withLock(KIND, SN_C, async () => {
      const v = move(srv.base, SN_C, acq);
      const r = await v.withLimit;
      assert.equal(
        r.status,
        200,
        `Die Verschiebung kam mit ${r.status} zurück, während die Sperre auf dem ZIELkonto ` +
          `(${KIND}, ${SN_C}) lag. Die Route sperrt dann über das falsche Konto.`,
      );
      assert.equal(
        await lockRows(KIND, SN_C, false),
        0,
        `Es stand ein Warter auf (${KIND}, ${SN_C}) — die Route sperrt über das Zielkonto`,
      );
    });
  });
});
