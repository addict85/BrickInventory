/**
 * Row security (migrations 0111, 0112): without a filter on user_id a query sees and
 * changes only rows of its account and of its direct sub-accounts,
 * without an account none. The system context is carried by a role with BYPASSRLS, not by a
 * setting of the session. Checked with two roles without ownership via
 * createDb(), as in production (the test user is a superuser).
 *
 * Counter-checks system role (measured on 13.11.2026, each on its own):
 *   K  policy again with `current_setting('app.system') = 'an' OR …` (0112
 *      changed, database rebuilt) → red: “no session switch …”
 *   L  the system pool left out in createDb() (always pool) → red: “no
 *      … switch …”, “in the system context …”, “a job …”,
 *      “whoever joins a household …”, “a currency change …”, “jobs and …”,
 *      “login …”
 *   M  jobs deleted from the list in 0112 → red: “jobs and
 *      credentials …”
 *   N  in createAccount() zugaenge again with bindeZugang → red: “login
 *      finds the token …” (token invalid, revocation deletes nothing)
 *   O  the check of the pool deleted in txStand() → red: „inSystemContext
 *      mitten in der Transaktion …“ (ran inside it, without an error)
 *   P  the worker as before (whole run in inJobFrame(), inNamesOfJob()
 *      with imNamenVon) → red: “a job runs in the system context only if …”
 *      (without marker [A,B,C], account [A,B,C])
 *   Q  only inNamesOfJob() with imNamenVon instead of asRequest → red: the same
 *      (account [A,B,C]: the caller's system context stays)
 *
 * Counter-checks system context per function (measured 14.11.2026, each on its own):
 *   R  in src/account/context.ts passkeys.desKontos and konten.accessesOfAccount again
 *      in the list of the system context → red: “an account reads its passkeys and
 *      tokens …” (account A saw the passkey and the token of C)
 *   S  pdfJobs again entirely with bindeImSystemrahmen and without `AND user_id = $2`
 *      in pdfAuftragZeile → red: “a PDF job of a foreign account …”
 *
 * Counter-check credentials only of the own account (migration 0114, measured 14.11.2026):
 *   T  in 0114 again `user_id = ANY (zeilenschutz_konten())` instead of `= zeilenschutz_konto()`
 *      → red: “credentials of the sub-account stay …” (A saw the passkey of B)
 *   U  (migration 0118) `vouchers` deleted from the list in 0118 → red: “… vouchers and
 *      idempotency entries of the sub-account” (A saw the voucher of B); likewise with `idempotency`
 *
 * Counter-checks row security (13.11.2026, before the system role):
 * Counter-checks (measured on 13.11.2026, each on its own):
 *   A  before the tests `ALTER TABLE sets DISABLE ROW LEVEL SECURITY` → red:
 *      “with account A …”, “a sub-account …”, „ohne Konto …“, “foreign user_id …”,
 *      „inSystemContext mitten …“, “a signal handler …”, “a request inherits …”;
 *      only the policy removed (RLS on) → the same and “a job …” (0 rows)
 *   B  in contextSql() (db/database.ts) always '' → red: all subtests
 *   C  set_config(…, false) instead of true for app.konto → red: „ohne Konto …“ (the
 *      connection carries account A on) and “in the system context …”
 *   D  zeilenschutz_konten() without the sub-accounts → red: “with account A …”,
 *      „ohne Konto …“, “foreign user_id …”, “a signal handler …”
 *   E  in inJobFrame() the marker KONTOUEBERGREIFEND not respected → red: “a job …”
 *   F  after ROLLBACK TO SAVEPOINT stand.kontext not reset → red:
 *      „inSystemContext mitten … Sicherungspunkt“ (account A saw only B)
 *   G  AsyncResource.bind left out in Benachrichtigung.listen() → red: “a
 *      signal handler …” (it queries in the context of C)
 *   H  asRequest() without clearing the system context → red: “a request inherits …”
 *   I  in redeemInvitation() the currencies read without inSystemContext() →
 *      red: “whoever joins a household …” (the main account reads itself as EUR)
 *   J  in setzeHaushaltswaehrung() without inSystemContext() → red: “a
 *      currency change also reaches …” (row-level security at the grandchild account)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL with superuser (creates a role).
 *
 * @superuser (ratchet in test/roles-separation-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { accessOrSkip, missingPrecondition } = require('./helpers/db');
const { testName, cleanRemainder, id } = require('./helpers/test-names');
const { createDb, dbConfigFromEnvironment } = require(path.join(q.DIST, 'db', 'database.js'));
const { inSystemContext, asRequest } = _req('src/infra/accountContext.js');

const ROLLE = testName('rows');
const SYSTEM = testName('zeilsys');
const als = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
const ids = rows => [...new Set(rows.map(z => Number(z.user_id)))].sort((x, y) => x - y);

/** All areas via one access, as startup/wiring.ts builds them, including their contexts. */
const buildWith = z => {
  const contexts = {};
  const d = _req('startup/wiring.js').buildServices(z, {
    contexts,
  });
  return { d, contexts };
};
const serviceWith = z => buildWith(z).d;

test('row security of the account tables', { concurrency: 1 }, async t => {
  const su = await accessOrSkip(t, _req);
  if (!su) return;
  if (!(await su.asSuperuserConnected())) return missingPrecondition(t, 'kein Superuser');
  await cleanRemainder(su.pool, 'rows');
  // Otherwise the system context would also see accounts of an aborted run (zs_…).
  await su.run("DELETE FROM users WHERE username LIKE 'zs\\_%'");
  for (const [r, rls] of [
    [ROLLE, 'NOBYPASSRLS'],
    [SYSTEM, 'BYPASSRLS'],
  ]) {
    await su.exec(`DROP OWNED BY ${id(r)}`).catch(() => {});
    await su.exec(`DROP ROLE IF EXISTS ${id(r)}`);
    await su.exec(`CREATE ROLE ${id(r)} NOLOGIN NOSUPERUSER ${rls}`);
    await su.exec(`GRANT USAGE ON SCHEMA public TO ${id(r)};
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${id(r)};
      GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${id(r)}`);
  }
  // One connection: this way it shows whether an account sticks to it.
  const k = dbConfigFromEnvironment();
  const app = createDb({
    verbindung: k.verbindung,
    pool: { ...k.pool, max: 1, options: `${k.pool.options} -c role=${ROLLE}` },
    system: { ...k.verbindung, options: `${k.pool.options} -c role=${SYSTEM}` },
  });
  t.after(async () => {
    await app.notification.close();
    await app.pool.end().catch(() => {});
    for (const r of [ROLLE, SYSTEM])
      await su.exec(`DROP OWNED BY ${id(r)}; DROP ROLE IF EXISTS ${id(r)}`).catch(() => {});
    await su.pool.end().catch(() => {});
  });

  const konto = async name =>
    (
      await su.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
        `zs_${name}_${process.pid}`,
      ])
    ).id;
  const A = await konto('haupt'),
    B = await konto('unter'),
    C = await konto('fremd');
  await su.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [A, B]);
  for (const u of [A, B, C]) {
    await su.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1')`, [u]);
    await su.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')`, [u]);
    await su.run(
      `INSERT INTO trash (user_id, type, number, rows, deleted_at) VALUES ($1, 'set', '10001-1', '[]', NOW() - INTERVAL '90 days')`,
      [u],
    );
  }
  const allSets = () => app.all('SELECT user_id FROM sets');

  await t.test('with account A a query without a filter sees A and its sub-account B, not C', async () => {
    assert.deepEqual(ids(await als(A, allSets)), [A, B]);
    assert.deepEqual(ids(await als(A, () => app.all('SELECT user_id FROM user_settings'))), [A, B]);
    assert.deepEqual(ids(await als(A, () => app.transaction(tx => tx.all('SELECT user_id FROM sets')))), [A, B]);
  });

  await t.test('a sub-account sees only itself, not its main account', async () => {
    assert.deepEqual(ids(await als(B, allSets)), [B]);
    assert.equal(await als(B, () => app.get('SELECT 1 AS da FROM sets WHERE user_id = $1', [A])), undefined);
  });

  await t.test('no session switch lifts the row security of the runtime role', async () => {
    const schalter = `SELECT set_config('app.system', 'an', true), set_config('app.rolle', 'system', true),
                             set_config('app.bypass', 'on', true)`;
    const afterToggle = (vorher, sql) =>
      app.transaction(async tx => {
        await tx.exec(vorher);
        return tx.all(sql);
      });
    assert.deepEqual(await afterToggle(schalter, 'SELECT user_id FROM sets'), []);
    assert.deepEqual(ids(await als(A, () => afterToggle(schalter, 'SELECT user_id FROM sets'))), [A, B]);
    await assert.rejects(
      als(A, () =>
        app.transaction(async tx => {
          await tx.exec(schalter);
          await tx.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10003-1')`, [C]);
        }),
      ),
      /row-level security/,
    );
    // row_security = off turns the silent filter into an error, not a blank check.
    await assert.rejects(afterToggle('SET LOCAL row_security = off', 'SELECT user_id FROM sets'), /row-level security/);
    assert.deepEqual(ids(await inSystemContext('test', allSets)), [A, B, C]);
  });

  await t.test(
    'without an account and without a system context no row, even after a request with an account',
    async () => {
      assert.deepEqual(ids(await als(A, allSets)), [A, B]);
      assert.deepEqual(await allSets(), []);
      await als(A, () => app.transaction(tx => tx.all('SELECT 1')));
      assert.deepEqual(await app.all('SELECT user_id FROM trash'), []);
      assert.equal((await app.run('DELETE FROM sets')).changes, 0);
    },
  );

  await t.test('foreign user_id rejected on write', async () => {
    const rls = /row-level security/;
    await assert.rejects(
      als(A, () => app.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [C])),
      rls,
    );
    await assert.rejects(
      als(B, () => app.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [A])),
      rls,
    );
    await assert.rejects(
      als(A, () => app.run('UPDATE sets SET user_id = $1 WHERE user_id = $2', [C, A])),
      rls,
    );
    // The main account may write for the sub-account; an UPDATE without a filter only hits the household.
    await als(A, () => app.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [B]));
    assert.equal((await als(A, () => app.run('UPDATE sets SET updated_at = NOW()'))).changes, 3);
    assert.equal((await als(C, () => app.run('DELETE FROM sets'))).changes, 1);
    assert.deepEqual(ids(await su.all('SELECT user_id FROM sets')), [A, B]);
    await su.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1')`, [C]);
    await su.run("DELETE FROM sets WHERE set_number = '10002-1'");
  });

  await t.test('in the system context the cleanup sees all accounts', async () => {
    const { trash: papierkorb } = buildWith(app).contexts.inventory;
    assert.equal(await papierkorb.removeOlder(30), 0);
    assert.equal(await inSystemContext('test', () => papierkorb.removeOlder(30)), 3);
    assert.deepEqual(await su.all('SELECT id FROM trash'), []);
  });

  await t.test('a job runs in the system context only if its kind is cross-account', async st => {
    const leeren = () => su.run("DELETE FROM jobs WHERE type IN ('wechselkurse', 'nacharbeit', 'preise')");
    st.after(leeren);
    const A_ = _req('src/jobQueue/service.js');
    const { createWorker } = _req('jobs/jobWorker.js');
    await leeren();
    const gesehen = {};
    const see = name => async () => {
      gesehen[name] = ids(await allSets());
    };
    const w = createWorker(require('./helpers/sources').testServices().jobQueue, {
      wechselkurse: { ausfuehren: see('ohne Marke') },
      nacharbeit: {
        ausfuehren: async () => {
          await see('Konto')();
          throw new Error('gescheitert');
        },
        givenUp: see('Konto aufgegeben'),
      },
      preise: { ausfuehren: (_n, _k, a) => see(a.user_id ? 'markiert mit Konto' : 'markiert')() },
    });
    await A_.placeJobOne('wechselkurse', {}, { schluessel: `rows-${process.pid}` });
    assert.equal(await w.processOne(), true);
    // Also from within a system context (server.ts starts the jobs in one).
    await A_.placeJobOne('nacharbeit', { set_number: '10001-1', user_id: A }, { userId: A, maxAttempts: 1 });
    assert.equal(await inSystemContext('test', () => w.processOne()), true);
    await A_.placeJobOne('preise', {}, { schluessel: `rows-${process.pid}` });
    assert.equal(await w.processOne(), true);
    // With an account the account counts, even for a marked kind.
    await A_.placeJobOne('preise', {}, { userId: A, schluessel: `rows-a-${process.pid}` });
    assert.equal(await w.processOne(), true);
    assert.deepEqual(gesehen, {
      'ohne Marke': [],
      Konto: [A, B],
      'Konto aufgegeben': [A, B],
      markiert: [A, B, C],
      'markiert mit Konto': [A, B],
    });
  });

  // In the middle of an account transaction the system context asked via the system role next to it: rejected.
  await t.test(
    'inSystemContext in the middle of the transaction is rejected; an account switch follows even after a savepoint',
    async () => {
      const n = async d => (await d.all('SELECT user_id FROM sets')).length;
      const stand = await als(B, () =>
        app.transaction(async tx => {
          const vorher = await n(tx);
          const neben = await inSystemContext('test', () => n(app)).then(
            () => 'lief neben der Transaktion',
            e => e.constructor.name,
          );
          // Via the access of the transaction (tx.db), otherwise UnboundQuery.
          await als(A, () =>
            tx.db.transaction(async inner => {
              await n(inner);
              throw new Error('zurück');
            }),
          ).catch(() => {});
          return [vorher, neben, await als(A, () => n(tx.db)), await n(tx)];
        }),
      );
      assert.deepEqual(stand, [1, 'BesideTheTransaction', 2, 1]);
    },
  );

  await t.test('a signal handler queries in the context in which it registered', async () => {
    const kanal = `zeilen_${process.pid}`;
    // The listening connection arises in the context of C; the handler of A must not inherit it.
    await new Promise(fertig => als(C, () => app.notification.listen(kanal, () => fertig(null))));
    const gesehen = new Promise(fertig =>
      als(A, () =>
        app.notification.listen(kanal, async payload => {
          if (payload === 'los') fertig(ids(await allSets()));
        }),
      ),
    );
    await su.run('SELECT pg_notify($1, $2)', [kanal, 'los']);
    assert.deepEqual(await gesehen, [A, B]);
  });

  await t.test("whoever joins a household compares with the main account's currency", async () => {
    // The services via the access with row security, as in production.
    const haushalt = serviceWith(app).household;
    const D = await konto('neu');
    await su.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')`, [D]);
    await su.run(`UPDATE user_settings SET value = 'USD' WHERE user_id = $1 AND key = 'currency'`, [A]);
    const { code } = await als(A, () => haushalt.createInvitation(A));
    await assert.rejects(
      als(D, () => haushalt.redeemInvitation(D, code)),
      {
        code: 'waehrung_ungleich',
        vars: { haupt: 'USD', unter: 'EUR' },
      },
    );
  });

  await t.test("a currency change also reaches the sub-account's sub-account", async () => {
    const einstellungen = serviceWith(app).settings;
    const E = await konto('enkel');
    await su.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [B, E]);
    await als(A, () => einstellungen.setUserSetting(A, 'currency', 'CHF'));
    const w = await su.all(`SELECT user_id, value FROM user_settings WHERE key = 'currency' AND user_id = ANY($1)`, [
      [A, B, E],
    ]);
    assert.deepEqual(
      ids(w.filter(z => z.value === 'CHF')),
      [A, B, E].sort((x, y) => x - y),
    );
  });

  await t.test('a request inherits no system context', async () => {
    assert.deepEqual(ids(await inSystemContext('test', () => asRequest({ apiUser: { user_id: C } }, allSets))), [C]);
  });
  await t.test('jobs and credentials of other accounts stay hidden from the runtime role', async () => {
    await su.run("DELETE FROM jobs WHERE type = 'wechselkurse'");
    await su.run(`INSERT INTO jobs (type, payload, dedupe_key) VALUES ('wechselkurse', '{}', $1)`, [
      `rows-sys-${process.pid}`,
    ]);
    await su.run(`INSERT INTO jobs (type, payload, user_id, dedupe_key) VALUES ('wechselkurse', '{}', $1, $2)`, [
      C,
      `rows-c-${process.pid}`,
    ]);
    await su.run(`INSERT INTO api_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      `rows-${process.pid}`,
      C,
    ]);
    for (const tabelle of ['jobs', 'api_tokens']) {
      assert.deepEqual(await als(A, () => app.all(`SELECT user_id FROM ${tabelle}`)), [], tabelle);
      assert.deepEqual(ids(await als(C, () => app.all(`SELECT user_id FROM ${tabelle}`))), [C], tabelle);
    }
    assert.equal(
      (await inSystemContext('test', () => app.all("SELECT 1 FROM jobs WHERE type = 'wechselkurse'"))).length,
      2,
    );
    await su.run("DELETE FROM jobs WHERE type = 'wechselkurse'");
    await su.run('DELETE FROM api_tokens WHERE user_id = $1', [C]);
  });

  await t.test('login finds the token without an account, revocation deletes it', async () => {
    const { d, contexts } = buildWith(app);
    const K = _req('src/account/index.js');
    const token = `rows-token-${process.pid}`;
    await su.run(`INSERT INTO api_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      K.tokenDigest(token),
      C,
    ]);
    assert.equal((await d.account.userForToken(token))?.user_id, C);
    await require(path.join(q.DIST, 'src/account/deviceToken.js')).revokeAllTokens(contexts.account, C);
    assert.deepEqual(await su.all('SELECT 1 FROM api_tokens WHERE user_id = $1', [C]), []);
  });

  await t.test('an account reads its passkeys and tokens under row security, foreign ones not', async st => {
    const d = serviceWith(app);
    await su.run(
      `INSERT INTO passkeys (user_id, credential_id, public_key, name) VALUES ($1, $2, '\\x00', 'eigen'), ($3, $4, '\\x00', 'fremd')`,
      [A, `pk-a-${process.pid}`, C, `pk-c-${process.pid}`],
    );
    await su.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1, $2, 'eigen', NOW() + INTERVAL '1 day'),
              ($3, $4, 'fremd', NOW() + INTERVAL '1 day')`,
      [`zt-a-${process.pid}`, A, `zt-c-${process.pid}`, C],
    );
    st.after(() => su.run('DELETE FROM passkeys WHERE user_id = ANY($1)', [[A, C]]));
    st.after(() => su.run('DELETE FROM api_tokens WHERE user_id = ANY($1)', [[A, C]]));
    const request = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
    // The own account: visible, without system context.
    assert.deepEqual(
      (await request(A, () => d.factors.accountPasskeys(A))).map(p => p.name),
      ['eigen'],
    );
    assert.deepEqual(
      (await request(A, () => d.account.sitzungen.accessesList(A))).map(z => z.label),
      ['eigen'],
    );
    // A foreign account, even asked with its ID: nothing, and nothing to delete.
    assert.deepEqual(await request(A, () => d.factors.accountPasskeys(C)), []);
    assert.deepEqual(await request(A, () => d.account.sitzungen.accessesList(C)), []);
    const pkC = await su.get('SELECT id FROM passkeys WHERE user_id = $1', [C]);
    assert.equal(await request(A, () => d.factors.deletePasskey(C, pkC.id)), false);
    assert.equal((await su.all('SELECT 1 FROM passkeys WHERE user_id = $1', [C])).length, 1);
  });

  await t.test('credentials of the sub-account stay hidden from the main account, reading and writing', async st => {
    const d = serviceWith(app);
    const pid = process.pid;
    await su.run(`INSERT INTO passkeys (user_id, credential_id, public_key, name) VALUES ($1, $2, '\\x00', 'unter')`, [
      B,
      `pk-b-${pid}`,
    ]);
    await su.run(`INSERT INTO second_factor (user_id, secret, active) VALUES ($1, 'geheim', true)`, [B]);
    await su.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1, $2, 'unter', NOW() + INTERVAL '1 day')`,
      [`zt-b-${pid}`, B],
    );
    st.after(async () => {
      for (const tab of ['passkeys', 'second_factor', 'api_tokens'])
        await su.run(`DELETE FROM ${tab} WHERE user_id = ANY($1)`, [[A, B]]);
    });
    // Without a filter and with the ID of the sub-account: nothing. The inventory of the sub-account stays visible.
    for (const sql of [
      'SELECT user_id FROM passkeys',
      'SELECT user_id FROM second_factor',
      'SELECT user_id FROM api_tokens',
    ])
      assert.deepEqual(await als(A, () => app.all(`${sql} WHERE user_id = $1`, [B])), [], sql);
    assert.deepEqual(ids(await als(A, allSets)), [A, B]);
    const request = f => asRequest({ apiUser: { user_id: A } }, f);
    assert.deepEqual(await request(() => d.factors.accountPasskeys(B)), []);
    assert.deepEqual(await request(() => d.account.sitzungen.accessesList(B)), []);
    // Creating for the sub-account: rejected, even where the row security of the inventories allows it.
    const rls = /row-level security/;
    for (const sql of [
      `INSERT INTO passkeys (user_id, credential_id, public_key) VALUES ($1, 'pk-fremd-${pid}', '\\x00')`,
      `INSERT INTO second_factor (user_id, secret) VALUES ($1, 'x') ON CONFLICT DO NOTHING`,
      `INSERT INTO api_tokens (token, user_id) VALUES ('zt-fremd-${pid}', $1)`,
      `INSERT INTO second_factor_codes (user_id, code_hash) VALUES ($1, 'h')`,
    ])
      await assert.rejects(
        als(A, () => app.run(sql, [B])),
        rls,
        sql,
      );
    assert.equal((await als(A, () => app.run('DELETE FROM api_tokens WHERE user_id = $1', [B]))).changes, 0);
    // The sub-account itself still sees and changes its credentials.
    assert.deepEqual(ids(await als(B, () => app.all('SELECT user_id FROM passkeys'))), [B]);
    await als(B, () => app.run(`INSERT INTO api_tokens (token, user_id) VALUES ($1, $2)`, [`zt-b2-${pid}`, B]));
  });

  await t.test('the main account does not see vouchers and idempotency entries of the sub-account', async st => {
    const pid = process.pid;
    await su.run(
      `INSERT INTO vouchers (user_id, number, number_search, amount, currency) VALUES ($1, 'v2:x', $2, 10, 'EUR')`,
      [B, `zs-gs-${pid}`],
    );
    await su.run(`INSERT INTO idempotency (user_id, key, request) VALUES ($1, $2, 'POST /x')`, [B, `zs-${pid}`]);
    st.after(async () => {
      for (const tab of ['vouchers', 'idempotency'])
        await su.run(`DELETE FROM ${tab} WHERE user_id = ANY($1)`, [[A, B]]);
    });
    for (const tab of ['vouchers', 'idempotency']) {
      assert.deepEqual(await als(A, () => app.all(`SELECT user_id FROM ${tab} WHERE user_id = $1`, [B])), [], tab);
      assert.equal((await als(A, () => app.run(`DELETE FROM ${tab} WHERE user_id = $1`, [B]))).changes, 0, tab);
      assert.deepEqual(ids(await als(B, () => app.all(`SELECT user_id FROM ${tab}`))), [B], `${tab}: das Konto selbst`);
    }
    await assert.rejects(
      als(A, () => app.run(`INSERT INTO idempotency (user_id, key, request) VALUES ($1, 'fremd', 'x')`, [B])),
      /row-level security/,
    );
  });

  await t.test('a PDF job of a foreign account is none for the request', async st => {
    const d = serviceWith(app);
    const kennung = `zs${process.pid}`;
    await su.run(
      `INSERT INTO jobs (type, payload, user_id, dedupe_key, status) VALUES ('pdf', '{}', $1, $2, 'offen')`,
      [C, `pdf:${kennung}`],
    );
    st.after(() => su.run('DELETE FROM jobs WHERE dedupe_key = $1', [`pdf:${kennung}`]));
    const request = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
    assert.equal((await request(C, () => d.catalog.pdf.lies(kennung, C)))?.user_id, C);
    // Asked with the own ID (like the route): none; with the foreign one: the row security hides it.
    assert.equal(await request(A, () => d.catalog.pdf.lies(kennung, A)), null);
    assert.equal(await request(A, () => d.catalog.pdf.lies(kennung, C)), null);
    await request(A, () => d.catalog.pdf.remove(kennung, C));
    assert.equal((await su.all('SELECT 1 FROM jobs WHERE dedupe_key = $1', [`pdf:${kennung}`])).length, 1);
  });
});
