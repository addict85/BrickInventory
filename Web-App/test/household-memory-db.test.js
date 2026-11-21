/**
 * The view is remembered — and forgotten immediately on every change.
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const db = testData();
const hh = {
  ..._req('src/household/rules.js'),
  ..._req('src/household/household.js'),
  ...require('./helpers/sources').testArea('household'),
};

const MAIN = 990501,
  UNTER = 990502;

const gesehen = [];
let count = false;
const altQuery = db.pool.query.bind(db.pool);
db.pool.query = (text, ...rest) => {
  if (count) gesehen.push(String(typeof text === 'string' ? text : text?.text || '').replace(/\s+/g, ' '));
  return altQuery(text, ...rest);
};
const linkQueries = () => gesehen.filter(q => /account_links/.test(q)).length;

async function aufraeumen() {
  await db
    .run('DELETE FROM account_links WHERE main_user_id = ANY($1) OR sub_user_id = ANY($1)', [[MAIN, UNTER]])
    .catch(() => {});
  await db.run('DELETE FROM users WHERE id = ANY($1)', [[MAIN, UNTER]]).catch(() => {});
}

test('scope: remembered, and forgotten immediately on a change', async t => {
  try {
    await db.get('SELECT 1');
  } catch {
    return t.skip('no test database reachable');
  }

  let listener = null;
  try {
    await aufraeumen();
    await db.run("INSERT INTO users (id, username, password_hash) VALUES ($1,'hh_haupt','x'), ($2,'hh_unter','x')", [
      MAIN,
      UNTER,
    ]);
    await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1,$2)', [MAIN, UNTER]);
    hh.reportHouseholdChange();

    // ── 1. Remembered: the second and every further call no longer asks ────
    gesehen.length = 0;
    count = true;
    const erst = await hh.householdOf(MAIN);
    const afterFirst = linkQueries();
    for (let i = 0; i < 20; i++) await hh.householdOf(MAIN);
    count = false;
    assert.equal(afterFirst, 2, 'der erste Aufruf soll die beiden Abfragen machen');
    assert.equal(
      linkQueries(),
      2,
      `21 Aufrufe ergaben ${linkQueries()} Abfragen auf account_links — erwartet 2 (nur der erste)`,
    );
    assert.deepEqual(erst.memberIds, [MAIN, UNTER], 'das Unterkonto gehört ins Blickfeld');

    // ── 2. The member list is a fresh list ─────────────────────────────────
    const a = await hh.householdOf(MAIN);
    a.memberIds.push(999999);
    const b = await hh.householdOf(MAIN);
    assert.deepEqual(
      b.memberIds,
      [MAIN, UNTER],
      'wer die Mitgliederliste anfasst, darf den gemerkten Stand nicht verändern',
    );

    // ── 3. After unlinking the view is small again immediately ─────────────
    // Via unlinkAccounts(), not via a DELETE by hand: exactly this path must
    // empty the memory, and only this way is it checked.
    await hh.unlinkAccounts(MAIN, UNTER);
    const nachher = await hh.householdOf(MAIN);
    assert.deepEqual(
      nachher.memberIds,
      [MAIN],
      'nach unlinkAccounts() steht das gelöste Unterkonto noch im gemerkten Blickfeld',
    );

    // ── 4. The signal goes out to the other cluster workers ────────────────
    // Without this NOTIFY every other worker would sit on its old state until
    // the deadline expires — the user unlinks and sees it one way or the
    // other depending on the worker.
    listener = await db.ownConnection();
    await listener.query(`LISTEN ${hh.HOUSEHOLD_CHANNEL}`);
    const angekommen = new Promise((auf, ab) => {
      const uhr = setTimeout(
        () =>
          ab(
            new Error(
              `kein NOTIFY auf Kanal "${hh.HOUSEHOLD_CHANNEL}" innerhalb von 3 s — die anderen Worker erfahren nichts`,
            ),
          ),
        3000,
      );
      listener.on('notification', m => {
        if (m.channel === hh.HOUSEHOLD_CHANNEL) {
          clearTimeout(uhr);
          auf(m);
        }
      });
    });
    hh.reportHouseholdChange();
    const meldung = await angekommen;
    assert.equal(meldung.channel, hh.HOUSEHOLD_CHANNEL);

    // That every worker listens on the channel is checked by
    // signale-zwei-worker-db.test.js on the real cluster.

    // ── COUNTER-CHECK ─────────────────────────────────────────────────────
    // Does the counter see the queries at all? After clearing, the
    // next call must make both again — otherwise assertion 1 checks nothing.
    hh.reportHouseholdChange();
    gesehen.length = 0;
    count = true;
    await hh.householdOf(MAIN);
    count = false;
    assert.equal(
      linkQueries(),
      2,
      'Gegenprobe: nach reportHouseholdChange() wurde nicht neu gelesen (oder der Zähler zählt nicht mit)',
    );
  } finally {
    db.pool.query = altQuery;
    if (listener) await listener.end().catch(() => {});
    await aufraeumen();
    await db.pool.end().catch(() => {});
  }
});
