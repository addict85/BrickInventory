/**
 * Die Web-Systemrolle (Migration 0119): Den Systemrahmen einer HTTP-Anfrage trägt eine Rolle, die
 * am Zeilenschutz vorbei nur Zugang, Verwaltung, Kontoeinstellungen, Aufträge und Tabellen ohne
 * Kontobezug erreicht; Gutscheine, Sammlung, Finanzen und Kopien vor Migrationen bleiben bei jobs.
 * Hier die Liste und der echte Web-Prozess mit ihr allein; testServer nimmt sie überall.
 *
 * Gegenproben (15.11.2026 gemessen, je einzeln):
 *   A  in 0119 'vouchers' in die Liste `account_id` → rot: „genau diese Tabellenrechte“ und
 *      „… bleiben Gutscheine zu“ (die Abfrage gelingt)
 *   B  in db/database.ts poolOfFrame() ohne `web` (immer systemPool) → rot: „Anfragen
 *      nehmen …“ (current_user ist die Systemrolle), „… bleiben Gutscheine zu“ und „… aus
 *      den Kopien …“ (die Kopie ist lesbar)
 *   C  in db/migrate.ts removeAccountFromBackups() wieder mit DELETE je Kopie → rot:
 *      „ein Konto verschwindet auch aus den Kopien …“ (0 statt 2: Die Web-Rolle sieht die
 *      Kopien im Katalog nicht und löscht still nichts)
 *   D  in startup/database.ts prepareDatabaseBefore() ohne den Zweig `jobs === false` → rot:
 *      „der Web-Prozess startet …“ (permission denied for table vouchers, kein Start)
 *   E  waitOnLegacyStock() kehrt sofort zurück → rot: „… waiting auf die Umschlüsselung“
 *   F  in src/parts/summary.ts catalogFollowUpOnce() ohne den Zweig für `web` →
 *      rot: „eine Anfrage zieht den Katalog nicht selbst nach …“
 *   G  in 0120 die Schleife mit REVOKE gestrichen → rot: „jede Sicht liest …“ (die neue Sicht
 *      steht mit `web` in der Liste)
 *   H  in 0120 `security_invoker = true` gestrichen → rot im selben Test (alle drei Sichten
 *      „ohne security_invoker“; ohne den Listenvergleich: „durch die Sicht nur das eigene
 *      Konto“, a sah auch b)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { keineDb } = require('./helpers/db');
const { warte } = require('./helpers/time');
const { portOf } = require('./helpers/server');
const db = quellen.testData();
const { asRequest, asWebRequest, inSystemContext } = _req('src/infra/accountContext.js');

const WEB = process.env.PGSYSTEM_WEB_USER;
const FULL = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].join(', ');
const WITH_ALL_RIGHT = [
  // Zugang, Haushalt, Verwaltung, Kontoeinstellungen und Aufträge
  ...['account_link_invites', 'account_links', 'api_tokens', 'api_tokens_consumed', 'jobs'],
  ...['device_nonces', 'device_keys', 'global_settings', 'household_former_links', 'passkeys'],
  ...['qr_login_tokens', 'rate_limit_attempts', 'step_up_challenges', 'step_up_approvals', 'user_sessions'],
  ...['user_settings', 'users', 'admin_takeovers', 'webauthn_challenges', 'second_factor'],
  'second_factor_codes',
  // ohne Kontobezug: Katalog, Preis- und Bildspeicher, Laufzustand
  ...['api_calls', 'api_cadence', 'app_logs', 'job_exclusive_locks', 'job_pauses', 'job_types'],
  ...['bl_mapping', 'catalog_cache', 'image_misses', 'image_wanted', 'run_state', 'minifig_parts_cache'],
  ...['minifig_price_cache', 'minifig_price_history', 'minifigs_catalog', 'part_catalog', 'part_color_catalog'],
  ...['part_price_cache', 'part_price_history', 'parts_catalog_pending', 'price_cache', 'price_history'],
  ...['rb_colors', 'rb_inventories', 'rb_inventory_minifigs', 'rb_inventory_parts', 'rb_part_categories'],
  ...['rb_parts', 'rb_sets', 'rb_themes', 'set_catalog', 'set_minifigs', 'set_parts', 'shared_instructions'],
  ...['subsets_cache', 'exchange_rates'],
];
const SOLL = {
  ...Object.fromEntries(WITH_ALL_RIGHT.map(t => [t, FULL])),
  admin_log: 'SELECT, INSERT',
  parts_version_user: 'SELECT, INSERT, UPDATE',
  set_minifigs_catalog: 'SELECT',
  set_parts_catalog: 'SELECT',
  minifigs: '(fig_number)',
  parts: '(part_number, source)',
  sets: '(set_number)',
};

const freePort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, () => {
      const p = portOf(s);
      s.close(() => r(p));
    });
  });

test('Web-Systemrolle', { concurrency: 1, timeout: 180_000 }, async t => {
  try {
    await db.get('SELECT 1');
  } catch (e) {
    keineDb(t, e);
    return;
  }
  if (!WEB) {
    keineDb(t, new Error('ohne Testlauf (scripts/test-run.js) keine Web-Systemrolle'));
    return;
  }
  const zugang = quellen.testAccess();
  t.after(() => db.pool.end().catch(() => {}));
  const imWeb = f => asWebRequest({}, () => inSystemContext('Test', f));

  await t.test('die Web-Systemrolle hat genau diese Tabellenrechte', async () => {
    const zeilen = await db.all(
      `SELECT c.relname AS t, COALESCE(NULLIF(concat_ws(', ',
                CASE WHEN has_table_privilege($1, c.oid, 'SELECT') THEN 'SELECT' END,
                CASE WHEN has_table_privilege($1, c.oid, 'INSERT') THEN 'INSERT' END,
                CASE WHEN has_table_privilege($1, c.oid, 'UPDATE') THEN 'UPDATE' END,
                CASE WHEN has_table_privilege($1, c.oid, 'DELETE') THEN 'DELETE' END), ''),
              '(' || (SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                         AND has_column_privilege($1, c.oid, a.attnum, 'SELECT')) || ')') AS r
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v')`,
      [WEB],
    );
    assert.ok(zeilen.length > 70, `nur ${zeilen.length} Tabellen`);
    const ist = Object.fromEntries(zeilen.filter(z => z.r !== null).map(z => [z.t, z.r]));
    assert.deepEqual(ist, SOLL);
    const fn = await db.get(
      `SELECT has_function_privilege($1, 'konto_aus_sicherungen_loeschen(integer)', 'EXECUTE') AS kopien,
              has_function_privilege($1, 'konten_mit_set(text)', 'EXECUTE') AS zahl,
              has_function_privilege($1, 'verwaltungsprotokoll_aufraeumen()', 'EXECUTE') AS aufraeumen,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = $1) AS bypass`,
      [WEB],
    );
    assert.deepEqual(fn, { kopien: true, zahl: true, aufraeumen: false, bypass: true });
  });

  await t.test('jede Sicht liest mit den Rechten der Abfragenden, die Web-Rolle nur die genannten', async tt => {
    const name = `sicht_test_${process.pid}`;
    const a = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name])).id;
    const b = (await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${name}b`]))
      .id;
    tt.after(async () => {
      await db.run(`DROP VIEW IF EXISTS ${name}`);
      await db.run('DELETE FROM users WHERE id = ANY($1)', [[a, b]]);
    });
    await db.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1'), ($2, '10002-1')`, [a, b]);
    // Eine neue Sicht über eine Kontotabelle, danach 0119 erneut (UPGRADE.md, Abschnitt 65) und 0120.
    await db.run(`CREATE VIEW ${name} AS SELECT user_id, set_number FROM sets`);
    // 0119 ist Geschichte und nennt Tabelle und Spalte noch unter ihrem alten
    // Namen (auftrags_arten.art); 0124 (längst angewandt) hätte sie sonst
    // gleich danach umbenannt, wie bei einer echten Reihenfolge der Migrationen.
    await db.run('ALTER TABLE job_types RENAME COLUMN type TO art');
    await db.run('ALTER TABLE job_types RENAME TO auftrags_arten');
    await db.run(fs.readFileSync(path.join(ROOT, 'db/migrations/0119-systemrolle-web.sql'), 'utf8'));
    await db.run('ALTER TABLE auftrags_arten RENAME TO job_types');
    await db.run('ALTER TABLE job_types RENAME COLUMN art TO type');
    await db.run(
      fs.readFileSync(path.join(ROOT, 'db/migrations/0120-sichten-mit-rechten-der-abfragenden.sql'), 'utf8'),
    );
    const views = await db.all(
      `SELECT c.relname AS v, coalesce('security_invoker=true' = ANY (c.reloptions), false) AS invoker,
              has_table_privilege($1, c.oid, 'SELECT') AS web
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v' ORDER BY c.relname::text COLLATE "C"`,
      [WEB],
    );
    assert.deepEqual(
      views.map(s => `${s.v}${s.invoker ? '' : ' ohne security_invoker'}${s.web ? ' web' : ''}`),
      ['set_minifigs_catalog web', 'set_parts_catalog web', name],
    );
    const sieht = await asRequest({ session: { userId: a } }, () =>
      zugang.all(`SELECT DISTINCT user_id FROM ${name} WHERE user_id = ANY($1)`, [[a, b]]),
    );
    assert.deepEqual(
      sieht.map(z => z.user_id),
      [a],
      'durch die Sicht nur das eigene Konto',
    );
  });

  await t.test('Anfragen nehmen im Systemrahmen die Web-Systemrolle, sonst die Systemrolle', async () => {
    assert.equal((await imWeb(() => zugang.get('SELECT current_user AS u'))).u, WEB);
    const ohne = await inSystemContext('Test', () => zugang.get('SELECT current_user AS u'));
    assert.equal(ohne.u, process.env.PGSYSTEM_USER);
  });

  await t.test('im Systemrahmen einer Anfrage bleiben Gutscheine zu, Konten offen', async () => {
    await assert.rejects(
      imWeb(() => zugang.get('SELECT count(*) FROM vouchers')),
      /permission denied for table vouchers/,
    );
    await assert.rejects(
      imWeb(() => zugang.get('SELECT user_id FROM sets LIMIT 1')),
      /permission denied/,
    );
    assert.ok(await imWeb(() => zugang.get('SELECT count(*)::int AS n FROM users')));
  });

  await t.test('ein Konto verschwindet auch aus den Kopien, ohne dass die Web-Rolle sie liest', async tt => {
    const uid = 987_001;
    await db.run('DROP SCHEMA IF EXISTS vor_migration_1 CASCADE');
    await db.run('CREATE SCHEMA vor_migration_1');
    tt.after(() => db.run('DROP SCHEMA IF EXISTS vor_migration_1 CASCADE'));
    await db.run('CREATE TABLE vor_migration_1.users (id integer, username text)');
    await db.run('CREATE TABLE vor_migration_1.sets (user_id integer, set_number text)');
    await db.run("INSERT INTO vor_migration_1.users VALUES ($1, 'kopie'), ($1 + 1, 'bleibt')", [uid]);
    await db.run("INSERT INTO vor_migration_1.sets VALUES ($1, '10001-1')", [uid]);
    await assert.rejects(
      imWeb(() => zugang.get('SELECT * FROM vor_migration_1.users')),
      /permission denied/,
    );
    const n = await imWeb(() => _req('db/migrate.js').removeAccountFromBackups(zugang, uid));
    assert.equal(n, 2);
    assert.deepEqual(
      (await db.all('SELECT id FROM vor_migration_1.users')).map(z => z.id),
      [uid + 1],
    );
  });

  await t.test('eine Anfrage zieht den Katalog nicht selbst nach, sie stellt den Auftrag ein', async () => {
    const uid = (
      await db.get(`INSERT INTO users (username, password_hash) VALUES ('systemweb-teile', 'x') RETURNING id`)
    ).id;
    await db.run(`DELETE FROM jobs WHERE type = 'katalog_nachzug'`);
    await db.run(`INSERT INTO parts_catalog_pending (number) VALUES ('3001')`);
    const { summaryFresh } = _req('src/parts/summary.js');
    await asWebRequest({ session: { userId: uid } }, () => summaryFresh(uid));
    const offen = async () => (await db.get('SELECT count(*)::int AS n FROM parts_catalog_pending')).n;
    assert.equal(await offen(), 1, 'die Anfrage hat die Warteschlange geleert');
    assert.ok(await db.get(`SELECT 1 FROM jobs WHERE type = 'katalog_nachzug' AND status = 'offen'`));
    const followUp = quellen
      .testServices()
      .jobQueue.signedInKinds()
      .find(a => a.art === 'katalog_nachzug');
    await inSystemContext('Test', () => followUp.ausfuehren({}, {}));
    assert.equal(await offen(), 0, 'der Auftrag leert sie');
  });

  await t.test('der Web-Prozess startet mit der Web-Systemrolle und waiting auf die Umschlüsselung', async tt => {
    await db.run(`DELETE FROM run_state WHERE key = 'altbestand_v2'`);
    const port = await freePort();
    const { PGSYSTEM_WEB_USER: _u, PGSYSTEM_WEB_PASSWORD: _p, ...withoutWeb } = process.env;
    const env = {
      ...withoutWeb,
      SESSION_SECRET: 'systemrolle-web-test-geheimnis-lang-genug-1234',
      PORT: String(port),
      TRUST_PROXY: 'false',
      ROLLE: 'web',
      PGSYSTEM_USER: WEB,
      PGSYSTEM_PASSWORD: process.env.PGSYSTEM_WEB_PASSWORD,
    };
    const srv = spawn(process.execPath, [path.join(ROOT, 'dist', 'server.js')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
    let log = '';
    srv.stdout.on('data', d => {
      log += d;
    });
    srv.stderr.on('data', d => {
      log += d;
    });
    tt.after(async () => {
      srv.kill('SIGTERM');
      for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await warte(100);
      if (srv.exitCode === null && srv.signalCode === null) srv.kill('SIGKILL');
    });
    const bereit = () =>
      fetch(`http://127.0.0.1:${port}/api/v1/health/ready`).then(
        r => r.status,
        () => null,
      );
    for (let i = 0; i < 80 && !/warte, bis der Dienst jobs/.test(log) && srv.exitCode === null; i++) await warte(250);
    assert.match(log, /warte, bis der Dienst jobs/, log.slice(-1500));
    assert.equal(await bereit(), null, 'ohne Marke nimmt der Web-Prozess keine Anfrage an');
    await db.run(`INSERT INTO run_state (key, value) VALUES ('altbestand_v2', 'Test')`);
    let status = null;
    for (let i = 0; i < 120 && status !== 200 && srv.exitCode === null; i++) {
      status = await bereit();
      if (status !== 200) await warte(250);
    }
    assert.equal(status, 200, log.slice(-1500));
    const anmeldung = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'niemand-systemrolle-web', password: 'falsch-falsch-falsch' }),
    });
    assert.equal(anmeldung.status, 401, log.slice(-1500));
    assert.doesNotMatch(log, /permission denied/);
  });
});
