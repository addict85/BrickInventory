/**
 * Zeilenschutz (Migrationen 0111, 0112): Ohne Filter auf user_id sieht und
 * ändert eine Anfrage nur Zeilen ihres Kontos und seiner direkten Unterkonten,
 * ohne Konto keine. Den Systemrahmen trägt eine Rolle mit BYPASSRLS, keine
 * Einstellung der Sitzung. Geprüft mit zwei Rollen ohne Eigentum über
 * createDb(), wie im Betrieb (der Testbenutzer ist Superuser).
 *
 * Gegenproben Systemrolle (am 13.11.2026 gemessen, je einzeln):
 *   K  Policy wieder mit `current_setting('app.system') = 'an' OR …` (0112
 *      geändert, Datenbank neu) → rot: „kein Schalter der Sitzung …“
 *   L  in createDb() den Systempool weggelassen (immer pool) → rot: „kein
 *      Schalter …“, „im Systemrahmen …“, „ein Auftrag …“,
 *      „wer einem Haushalt …“, „ein Währungswechsel …“, „Aufträge und …“,
 *      „die Anmeldung …“
 *   M  jobs aus der Liste in 0112 gestrichen → rot: „Aufträge und
 *      Zugangsdaten …“
 *   N  in createAccount() zugaenge wieder mit bindeZugang → rot: „die Anmeldung
 *      findet den Token …“ (Token ungültig, Widerruf löscht nichts)
 *   O  in txStand() die Prüfung des Pools gestrichen → rot: „inSystemContext
 *      mitten in der Transaktion …“ (lief in ihr, ohne Fehler)
 *   P  der Worker wie vorher (ganzer Lauf in imAuftragsrahmen(), inNamesOfJob()
 *      mit imNamenVon) → rot: „ein Auftrag läuft im Systemrahmen nur, wenn …“
 *      (ohne Marke [A,B,C], Konto [A,B,C])
 *   Q  nur inNamesOfJob() mit imNamenVon statt asRequest → rot: dasselbe
 *      (Konto [A,B,C]: der Systemrahmen des Aufrufers bleibt)
 *
 * Gegenproben Systemrahmen je Funktion (14.11.2026 gemessen, je einzeln):
 *   R  in src/account/context.ts passkeys.desKontos und konten.accessesOfAccount wieder
 *      in die Liste des Systemrahmens → rot: „ein Konto liest seine Passkeys und
 *      Tokens …“ (Konto A sah den Passkey und den Token von C)
 *   S  pdfAuftraege wieder ganz mit bindeImSystemrahmen und ohne `AND user_id = $2`
 *      in pdfAuftragZeile → rot: „ein PDF-Auftrag eines fremden Kontos …“
 *
 * Gegenprobe Zugangsdaten nur des eigenen Kontos (Migration 0114, 14.11.2026 gemessen):
 *   T  in 0114 wieder `user_id = ANY (zeilenschutz_konten())` statt `= zeilenschutz_konto()`
 *      → rot: „Zugangsdaten des Unterkontos bleiben …“ (A sah den Passkey von B)
 *   U  (Migration 0118) in 0118 `vouchers` aus der Liste gestrichen → rot: „Gutscheine und
 *      Idempotenzeinträge des Unterkontos …“ (A sah den Gutschein von B); ebenso mit `idempotency`
 *
 * Gegenproben Zeilenschutz (13.11.2026, vor der Systemrolle):
 * Gegenproben (am 13.11.2026 gemessen, je einzeln):
 *   A  vor den Tests `ALTER TABLE sets DISABLE ROW LEVEL SECURITY` → rot:
 *      „mit Konto A …“, „ein Unterkonto …“, „ohne Konto …“, „fremde user_id …“,
 *      „inSystemContext mitten …“, „ein Signal-Handler …“, „eine Anfrage erbt …“;
 *      nur die Policy entfernt (RLS an) → dieselben und „ein Auftrag …“ (0 Zeilen)
 *   B  in contextSql() (db/database.ts) immer '' → rot: alle Teiltests
 *   C  set_config(…, false) statt true für app.konto → rot: „ohne Konto …“ (die
 *      Verbindung trägt Konto A weiter) und „im Systemrahmen …“
 *   D  zeilenschutz_konten() ohne die Unterkonten → rot: „mit Konto A …“,
 *      „ohne Konto …“, „fremde user_id …“, „ein Signal-Handler …“
 *   E  in imAuftragsrahmen() die Marke KONTOUEBERGREIFEND nicht beachtet → rot: „ein Auftrag …“
 *   F  nach ROLLBACK TO SAVEPOINT stand.kontext nicht zurückgesetzt → rot:
 *      „inSystemContext mitten … Sicherungspunkt“ (Konto A sah nur B)
 *   G  in Benachrichtigung.listen() AsyncResource.bind weggelassen → rot: „ein
 *      Signal-Handler …“ (er fragt im Rahmen von C)
 *   H  asRequest() ohne Leeren des Systemrahmens → rot: „eine Anfrage erbt …“
 *   I  in redeemInvitation() die Währungen ohne inSystemContext() gelesen →
 *      rot: „wer einem Haushalt beitritt …“ (das Hauptkonto liest sich als EUR)
 *   J  in setzeHaushaltswaehrung() ohne inSystemContext() → rot: „ein
 *      Währungswechsel erreicht …“ (row-level security beim Enkelkonto)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL mit Superuser (legt eine Rolle an).
 *
 * @superuser (Ratsche in test/rollen-trennung-db.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const q = require('./helpers/sources');
const _req = q.buildAndRequire();
const { accessOrSkip, missingPrecondition } = require('./helpers/db');
const { testName, cleanRemainder, id } = require('./helpers/testnamen');
const { createDb, dbKonfigFromEnvironment } = require(path.join(q.DIST, 'db', 'database.js'));
const { inSystemContext, asRequest } = _req('src/infra/kontoKontext.js');

const ROLLE = testName('rows');
const SYSTEM = testName('zeilsys');
const als = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
const ids = rows => [...new Set(rows.map(z => Number(z.user_id)))].sort((x, y) => x - y);

/** Alle Bereiche über einen Zugang, wie startup/verdrahtung.ts sie baut, samt ihren Kontexten. */
const buildWith = z => {
  const contexts = {};
  const d = _req('startup/verdrahtung.js').buildServices(z, {
    contexts,
  });
  return { d, contexts };
};
const serviceWith = z => buildWith(z).d;

test('Zeilenschutz der Kontotabellen', { concurrency: 1 }, async t => {
  const su = await accessOrSkip(t, _req);
  if (!su) return;
  if (!(await su.asSuperuserConnected())) return missingPrecondition(t, 'kein Superuser');
  await cleanRemainder(su.pool, 'rows');
  // Konten eines abgebrochenen Laufs (zs_…) sähe der Systemrahmen sonst mit.
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
  // Eine Verbindung: So zeigt sich, ob ein Konto an ihr hängen bleibt.
  const k = dbKonfigFromEnvironment();
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

  await t.test('mit Konto A sieht eine Abfrage ohne Filter A und sein Unterkonto B, nicht C', async () => {
    assert.deepEqual(ids(await als(A, allSets)), [A, B]);
    assert.deepEqual(ids(await als(A, () => app.all('SELECT user_id FROM user_settings'))), [A, B]);
    assert.deepEqual(ids(await als(A, () => app.transaction(tx => tx.all('SELECT user_id FROM sets')))), [A, B]);
  });

  await t.test('ein Unterkonto sieht nur sich selbst, nicht sein Hauptkonto', async () => {
    assert.deepEqual(ids(await als(B, allSets)), [B]);
    assert.equal(await als(B, () => app.get('SELECT 1 AS da FROM sets WHERE user_id = $1', [A])), undefined);
  });

  await t.test('kein Schalter der Sitzung hebt den Zeilenschutz der Laufzeitrolle auf', async () => {
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
    // row_security = off macht aus dem stillen Filter einen Fehler, nicht einen Freibrief.
    await assert.rejects(afterToggle('SET LOCAL row_security = off', 'SELECT user_id FROM sets'), /row-level security/);
    assert.deepEqual(ids(await inSystemContext('test', allSets)), [A, B, C]);
  });

  await t.test('ohne Konto und ohne Systemrahmen keine Zeile, auch nach einer Anfrage mit Konto', async () => {
    assert.deepEqual(ids(await als(A, allSets)), [A, B]);
    assert.deepEqual(await allSets(), []);
    await als(A, () => app.transaction(tx => tx.all('SELECT 1')));
    assert.deepEqual(await app.all('SELECT user_id FROM trash'), []);
    assert.equal((await app.run('DELETE FROM sets')).changes, 0);
  });

  await t.test('fremde user_id beim Schreiben abgewiesen', async () => {
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
    // Für das Unterkonto darf das Hauptkonto schreiben; ein UPDATE ohne Filter trifft nur den Haushalt.
    await als(A, () => app.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10002-1')`, [B]));
    assert.equal((await als(A, () => app.run('UPDATE sets SET updated_at = NOW()'))).changes, 3);
    assert.equal((await als(C, () => app.run('DELETE FROM sets'))).changes, 1);
    assert.deepEqual(ids(await su.all('SELECT user_id FROM sets')), [A, B]);
    await su.run(`INSERT INTO sets (user_id, set_number) VALUES ($1, '10001-1')`, [C]);
    await su.run("DELETE FROM sets WHERE set_number = '10002-1'");
  });

  await t.test('im Systemrahmen sieht die Aufräumarbeit alle Konten', async () => {
    const { papierkorb } = buildWith(app).contexts.inventory;
    assert.equal(await papierkorb.removeOlder(30), 0);
    assert.equal(await inSystemContext('test', () => papierkorb.removeOlder(30)), 3);
    assert.deepEqual(await su.all('SELECT id FROM trash'), []);
  });

  await t.test('ein Auftrag läuft im Systemrahmen nur, wenn seine Art kontoübergreifend ist', async st => {
    const leeren = () => su.run("DELETE FROM jobs WHERE type IN ('wechselkurse', 'nacharbeit', 'preise')");
    st.after(leeren);
    const A_ = _req('src/auftraege/dienst.js');
    const { createWorker } = _req('jobs/auftragsWorker.js');
    await leeren();
    const gesehen = {};
    const see = name => async () => {
      gesehen[name] = ids(await allSets());
    };
    const w = createWorker(require('./helpers/sources').testServices().auftraege, {
      wechselkurse: { ausfuehren: see('ohne Marke') },
      nacharbeit: {
        ausfuehren: async () => {
          await see('Konto')();
          throw new Error('gescheitert');
        },
        aufgegeben: see('Konto aufgegeben'),
      },
      preise: { ausfuehren: (_n, _k, a) => see(a.user_id ? 'markiert mit Konto' : 'markiert')() },
    });
    await A_.placeJobOne('wechselkurse', {}, { schluessel: `rows-${process.pid}` });
    assert.equal(await w.processOne(), true);
    // Auch aus einem Systemrahmen heraus (server.ts startet die Jobs in einem).
    await A_.placeJobOne('nacharbeit', { set_number: '10001-1', user_id: A }, { userId: A, maxAttempts: 1 });
    assert.equal(await inSystemContext('test', () => w.processOne()), true);
    await A_.placeJobOne('preise', {}, { schluessel: `rows-${process.pid}` });
    assert.equal(await w.processOne(), true);
    // Mit Konto zählt das Konto, auch bei einer markierten Art.
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

  // Mitten in einer Konto-Transaktion fragte der Systemrahmen über die Systemrolle neben ihr: abgewiesen.
  await t.test(
    'inSystemContext mitten in der Transaktion wird abgewiesen; ein Kontowechsel folgt auch nach einem Sicherungspunkt',
    async () => {
      const n = async d => (await d.all('SELECT user_id FROM sets')).length;
      const stand = await als(B, () =>
        app.transaction(async tx => {
          const vorher = await n(tx);
          const neben = await inSystemContext('test', () => n(app)).then(
            () => 'lief neben der Transaktion',
            e => e.constructor.name,
          );
          // Über den Zugang der Transaktion (tx.db), sonst UnboundQuery.
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

  await t.test('ein Signal-Handler fragt im Rahmen, in dem er sich angemeldet hat', async () => {
    const kanal = `zeilen_${process.pid}`;
    // Die Horch-Verbindung entsteht im Rahmen von C; der Handler von A darf ihn nicht erben.
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

  await t.test('wer einem Haushalt beitritt, vergleicht mit der Währung des Hauptkontos', async () => {
    // Die Dienste über den Zugang mit Zeilenschutz, wie im Betrieb.
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

  await t.test('ein Währungswechsel erreicht auch das Unterkonto des Unterkontos', async () => {
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

  await t.test('eine Anfrage erbt keinen Systemrahmen', async () => {
    assert.deepEqual(ids(await inSystemContext('test', () => asRequest({ apiUser: { user_id: C } }, allSets))), [C]);
  });
  await t.test('Aufträge und Zugangsdaten anderer Konten bleiben der Laufzeitrolle verborgen', async () => {
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

  await t.test('die Anmeldung findet den Token ohne Konto, der Widerruf löscht ihn', async () => {
    const { d, contexts } = buildWith(app);
    const K = _req('src/account/index.js');
    const token = `rows-token-${process.pid}`;
    await su.run(`INSERT INTO api_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      K.tokenDigest(token),
      C,
    ]);
    assert.equal((await d.account.nutzerZumToken(token))?.user_id, C);
    await require(path.join(q.DIST, 'src/account/deviceToken.js')).revokeAllTokens(contexts.account, C);
    assert.deepEqual(await su.all('SELECT 1 FROM api_tokens WHERE user_id = $1', [C]), []);
  });

  await t.test('ein Konto liest seine Passkeys und Tokens unter Zeilenschutz, fremde nicht', async st => {
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
    // Das eigene Konto: sichtbar, ohne Systemrahmen.
    assert.deepEqual(
      (await request(A, () => d.factors.accountPasskeys(A))).map(p => p.name),
      ['eigen'],
    );
    assert.deepEqual(
      (await request(A, () => d.account.sitzungen.accessesList(A))).map(z => z.label),
      ['eigen'],
    );
    // Ein fremdes Konto, auch mit dessen ID gefragt: nichts, und nichts zu löschen.
    assert.deepEqual(await request(A, () => d.factors.accountPasskeys(C)), []);
    assert.deepEqual(await request(A, () => d.account.sitzungen.accessesList(C)), []);
    const pkC = await su.get('SELECT id FROM passkeys WHERE user_id = $1', [C]);
    assert.equal(await request(A, () => d.factors.deletePasskey(C, pkC.id)), false);
    assert.equal((await su.all('SELECT 1 FROM passkeys WHERE user_id = $1', [C])).length, 1);
  });

  await t.test('Zugangsdaten des Unterkontos bleiben dem Hauptkonto verborgen, lesend und schreibend', async st => {
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
    // Ohne Filter und mit der ID des Unterkontos: nichts. Der Bestand des Unterkontos bleibt sichtbar.
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
    // Anlegen für das Unterkonto: abgewiesen, auch wo der Zeilenschutz der Bestände es erlaubt.
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
    // Das Unterkonto selbst sieht und ändert seine Zugangsdaten weiter.
    assert.deepEqual(ids(await als(B, () => app.all('SELECT user_id FROM passkeys'))), [B]);
    await als(B, () => app.run(`INSERT INTO api_tokens (token, user_id) VALUES ($1, $2)`, [`zt-b2-${pid}`, B]));
  });

  await t.test('Gutscheine und Idempotenzeinträge des Unterkontos sieht das Hauptkonto nicht', async st => {
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

  await t.test('ein PDF-Auftrag eines fremden Kontos ist für die Anfrage keiner', async st => {
    const d = serviceWith(app);
    const kennung = `zs${process.pid}`;
    await su.run(
      `INSERT INTO jobs (type, payload, user_id, dedupe_key, status) VALUES ('pdf', '{}', $1, $2, 'offen')`,
      [C, `pdf:${kennung}`],
    );
    st.after(() => su.run('DELETE FROM jobs WHERE dedupe_key = $1', [`pdf:${kennung}`]));
    const request = (uid, f) => asRequest({ apiUser: { user_id: uid } }, f);
    assert.equal((await request(C, () => d.catalog.pdf.lies(kennung, C)))?.user_id, C);
    // Mit der eigenen ID gefragt (wie die Route): keiner; mit der fremden: der Zeilenschutz verbirgt ihn.
    assert.equal(await request(A, () => d.catalog.pdf.lies(kennung, A)), null);
    assert.equal(await request(A, () => d.catalog.pdf.lies(kennung, C)), null);
    await request(A, () => d.catalog.pdf.loesche(kennung, C));
    assert.equal((await su.all('SELECT 1 FROM jobs WHERE dedupe_key = $1', [`pdf:${kennung}`])).length, 1);
  });
});
