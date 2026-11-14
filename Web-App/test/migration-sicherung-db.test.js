/**
 * Vor offenen Migrationen: Nutzerdaten sichern, ohne Zeitgrenze migrieren.
 * @einzeln: legt eine Probe-Migration in dist/db/migrations, die jede parallel
 * startende Datei beim Migrieren sähe.
 *
 * Eine Probe-Migration in dist/db/migrations bricht ab, wenn
 * statement_timeout nicht 0 ist; der Pool setzt 30 s für jede Verbindung.
 *
 * Gegenproben (am 27.10. gemessen):
 *   A  `SET LOCAL statement_timeout = 0` entfernt → rot: „offene Migration:
 *      erst gesichert, dann ohne Zeitgrenze angewandt"
 *   B  in runMigrations den Aufruf von sichereNutzerdaten entfernt → rot:
 *      dieselbe Prüfung (keine Sicherung)
 *   C  OFFSET der Aufräumabfrage entfernt (alle löschen) → rot: „die drei
 *      jüngsten Sicherungen bleiben"
 *   D  (28.10.) die UNION über Fremdschlüssel auf users entfernt → rot:
 *      „offene Migration …" (account_links fehlt)
 *   E  (12.11.2026) in runMigrations wieder `SET LOCAL lock_timeout = 0` → rot:
 *      „eine gehaltene Sperre: Frist, Wiederholung, klare Meldung“ (Zeitüberschreitung)
 *   F  (12.11.2026) in mitSperrfrist() ohne Wiederholung (sofort weiterwerfen)
 *      → rot: dieselbe Prüfung (eine Warnung erwartet, keine gesehen)
 *   G  (12.11.2026) in sichereNutzerdaten wieder `lock_timeout = 0` → rot:
 *      „auch die Sicherung wartet nicht ewig“ (Zeitüberschreitung)
 *   H  (14.11.2026) in sichereNutzerdaten das `ENABLE ROW LEVEL SECURITY` gestrichen
 *      → rot: „offene Migration …“ (Kopien ohne Zeilenschutz: users, api_tokens, …)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const _req = require('./helpers/sources').buildAndRequire();
const { datenOderSkip } = require('./helpers/db');
const { DIST, testDaten } = require('./helpers/sources');
const db = testDaten();
const { runMigrations, sichereNutzerdaten } = _req('db/migrate.js');
const NAME = `migsich_${process.pid}`,
  ZWEIT = `migsich2_${process.pid}`;
const PROBE = `9999-probe-${process.pid}.sql`;

const sicherungen = async () =>
  (await db.all(`SELECT nspname FROM pg_namespace WHERE nspname ~ '^vor_migration_[0-9]+$' ORDER BY nspname`)).map(
    r => r.nspname,
  );

test('Migrationen: Sicherung und Zeitgrenze', { concurrency: 1 }, async t => {
  if (!(await datenOderSkip(t, _req, { migrieren: false }))) return;
  const client = await db.pool.connect();
  await runMigrations(client);
  const vorher = new Set(await sicherungen());
  const probe = path.join(DIST, 'db/migrations', PROBE);

  await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, ZWEIT]]);
  const anlegen = async n =>
    (
      await db.get(
        `INSERT INTO users (username, password_hash, is_active, email_verified) VALUES ($1, 'x', true, true) RETURNING id`,
        [n],
      )
    ).id;
  const haupt = await anlegen(NAME),
    kind = await anlegen(ZWEIT);
  // Eine Haushaltsverknüpfung: Die Tabelle hat keine Spalte user_id, nur Fremdschlüssel auf users.
  await db.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [haupt, kind]);
  t.after(async () => {
    fs.rmSync(probe, { force: true });
    await db.run('DELETE FROM schema_migrations WHERE name = $1', [PROBE]).catch(() => {});
    for (const s of await sicherungen()) if (!vorher.has(s)) await db.run(`DROP SCHEMA ${s} CASCADE`).catch(() => {});
    await db.run('DELETE FROM users WHERE username = ANY($1)', [[NAME, ZWEIT]]).catch(() => {});
    client.release();
    await db.pool.end().catch(() => {});
  });

  await t.test('ohne offene Migration keine Sicherung', async () => {
    await runMigrations(client, { sichern: true });
    assert.deepEqual(new Set(await sicherungen()), vorher);
  });

  await t.test('offene Migration: erst gesichert, dann ohne Zeitgrenze angewandt', async () => {
    fs.writeFileSync(
      probe,
      `DO $$ BEGIN
      IF current_setting('statement_timeout') <> '0' THEN
        RAISE EXCEPTION 'statement_timeout ist %', current_setting('statement_timeout');
      END IF; END $$;`,
    );
    assert.notEqual(
      (await client.query('SHOW statement_timeout')).rows[0].statement_timeout,
      '0',
      'Die Verbindung hat keine Zeitgrenze — dann prüft die Probe nichts',
    );
    const angewandt = await runMigrations(client, { sichern: true });
    assert.deepEqual(angewandt, [PROBE]);
    const neu = (await sicherungen()).filter(s => !vorher.has(s));
    assert.equal(neu.length, 1, 'keine Sicherung vor der Migration');
    const kopie = await db.get(`SELECT username FROM ${neu[0]}.users WHERE username = $1`, [NAME]);
    assert.ok(kopie, 'Die Sicherung enthält die Konten nicht');
    const tabellen = (
      await db.all(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1`, [neu[0]])
    ).map(r => r.table_name);
    assert.ok(tabellen.includes('set_acquisitions'), `Tabellen mit user_id fehlen: ${tabellen.join(', ')}`);
    assert.ok(!tabellen.includes('set_catalog'), 'Der Katalog gehört nicht in die Sicherung');
    for (const n of ['account_links', 'account_link_invites', 'household_former_links', 'verwaltungsprotokoll'])
      assert.ok(tabellen.includes(n), `${n} fehlt in der Sicherung`);
    assert.ok(
      await db.get(`SELECT 1 FROM ${neu[0]}.account_links WHERE main_user_id = $1 AND sub_user_id = $2`, [haupt, kind]),
      'Die Haushaltsverknüpfung fehlt in der Sicherung',
    );
    // Die Kopie trägt keine Policy: Ohne RLS läse die Laufzeitrolle Hashes und Tokens aller Konten.
    const offen = await db.all(
      `SELECT relname FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind = 'r' AND NOT relrowsecurity`,
      [neu[0]],
    );
    assert.deepEqual(offen, [], 'Kopien ohne Zeilenschutz');
  });

  const KURZ = { fristMs: 200, versuche: 2 };
  const SPERRPROBE = `9998-sperre-${process.pid}.sql`,
    TABELLE = `migsperre_${process.pid}`;
  /** Eine zweite Verbindung hält `tabelle` exklusiv, bis `frei()` gerufen wird –
   * spätestens nach 4 s, damit eine Fassung ohne Frist rot wird statt zu hängen. */
  const halteSperre = async tabelle => {
    const c2 = await db.pool.connect();
    await c2.query('BEGIN');
    await c2.query(`LOCK TABLE ${tabelle} IN ACCESS EXCLUSIVE MODE`);
    let offen = true;
    const frei = async () => {
      if (!offen) return;
      offen = false;
      clearTimeout(notfall);
      await c2.query('ROLLBACK');
      c2.release();
    };
    const notfall = setTimeout(frei, 4000);
    return frei;
  };
  /** console.warn mitschreiben, solange `f` läuft. */
  const mitWarnungen = async f => {
    const echt = console.warn,
      gesehen = [];
    console.warn = (...a) => gesehen.push(a.join(' '));
    try {
      return { ergebnis: await f().catch(e => e), gesehen };
    } finally {
      console.warn = echt;
    }
  };

  await t.test('eine gehaltene Sperre: Frist, Wiederholung, klare Meldung', { timeout: 15_000 }, async () => {
    const datei = path.join(DIST, 'db/migrations', SPERRPROBE);
    await db.run(`CREATE TABLE IF NOT EXISTS ${TABELLE} (x int)`);
    t.after(async () => {
      fs.rmSync(datei, { force: true });
      await db.run('DELETE FROM schema_migrations WHERE name = $1', [SPERRPROBE]).catch(() => {});
      await db.run(`DROP TABLE IF EXISTS ${TABELLE}`).catch(() => {});
    });
    fs.writeFileSync(datei, `SELECT count(*) FROM ${TABELLE};`);
    const frei = await halteSperre(TABELLE);
    const { ergebnis, gesehen } = await mitWarnungen(() => runMigrations(client, { sperre: KURZ }));
    await frei();
    assert.ok(ergebnis instanceof Error, `ohne Fehler zurück: ${ergebnis}`);
    assert.match(
      ergebnis.message,
      new RegExp(
        `Migration ${SPERRPROBE} fehlgeschlagen: .*nach 0.2 s keine Sperre erhalten.*Aufgegeben nach 2 Versuchen`,
      ),
    );
    assert.equal(gesehen.filter(w => w.includes('Versuch 2/2')).length, 1, gesehen.join('\n'));
    assert.equal(await db.get('SELECT 1 FROM schema_migrations WHERE name = $1', [SPERRPROBE]), undefined);
    assert.deepEqual(await runMigrations(client, { sperre: KURZ }), [SPERRPROBE], 'ohne Sperre läuft sie durch');
  });

  await t.test('auch die Sicherung wartet nicht ewig', { timeout: 15_000 }, async () => {
    const frei = await halteSperre('users');
    const { ergebnis } = await mitWarnungen(() => sichereNutzerdaten(client, ['probe'], { fristMs: 200, versuche: 1 }));
    await frei();
    assert.ok(ergebnis instanceof Error, `ohne Fehler zurück: ${ergebnis}`);
    assert.match(ergebnis.message, /Sicherung vor den Migrationen fehlgeschlagen: .*keine Sperre erhalten/);
  });

  await t.test('die drei jüngsten Sicherungen bleiben', async () => {
    for (let i = 0; i < 4; i++) {
      await sichereNutzerdaten(client, ['probe']);
      await new Promise(r => setTimeout(r, 5));
    }
    assert.equal((await sicherungen()).length, 3);
  });
});
