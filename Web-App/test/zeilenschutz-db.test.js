/**
 * Zeilenschutz (Migrationen 0111, 0112): Ohne Filter auf user_id sieht und
 * ändert eine Anfrage nur Zeilen ihres Kontos und seiner direkten Unterkonten,
 * ohne Konto keine. Den Systemrahmen trägt eine Rolle mit BYPASSRLS, keine
 * Einstellung der Sitzung. Geprüft mit zwei Rollen ohne Eigentum über
 * erzeugeDb(), wie im Betrieb (der Testbenutzer ist Superuser).
 *
 * Gegenproben Systemrolle (am 13.11.2026 gemessen, je einzeln):
 *   K  Policy wieder mit `current_setting('app.system') = 'an' OR …` (0112
 *      geändert, Datenbank neu) → rot: „kein Schalter der Sitzung …“
 *   L  in erzeugeDb() den Systempool weggelassen (immer pool) → rot: „kein
 *      Schalter …“, „im Systemrahmen …“, „ein Auftrag …“,
 *      „wer einem Haushalt …“, „ein Währungswechsel …“, „Aufträge und …“,
 *      „die Anmeldung …“
 *   M  auftraege aus der Liste in 0112 gestrichen → rot: „Aufträge und
 *      Zugangsdaten …“
 *   N  in erzeugeKonto() zugaenge wieder mit bindeZugang → rot: „die Anmeldung
 *      findet den Token …“ (Token ungültig, Widerruf löscht nichts)
 *   O  in txStand() die Prüfung des Pools gestrichen → rot: „imSystemkontext
 *      mitten in der Transaktion …“ (lief in ihr, ohne Fehler)
 *   P  der Worker wie vorher (ganzer Lauf in imAuftragsrahmen(), imNamenDesAuftrags()
 *      mit imNamenVon) → rot: „ein Auftrag läuft im Systemrahmen nur, wenn …“
 *      (ohne Marke [A,B,C], Konto [A,B,C])
 *   Q  nur imNamenDesAuftrags() mit imNamenVon statt alsAnfrage → rot: dasselbe
 *      (Konto [A,B,C]: der Systemrahmen des Aufrufers bleibt)
 *
 * Gegenproben Systemrahmen je Funktion (14.11.2026 gemessen, je einzeln):
 *   R  in src/konto/kontext.ts passkeys.desKontos und konten.zugaengeDesKontos wieder
 *      in die Liste des Systemrahmens → rot: „ein Konto liest seine Passkeys und
 *      Tokens …“ (Konto A sah den Passkey und den Token von C)
 *   S  pdfAuftraege wieder ganz mit bindeImSystemrahmen und ohne `AND user_id = $2`
 *      in pdfAuftragZeile → rot: „ein PDF-Auftrag eines fremden Kontos …“
 *
 * Gegenprobe Zugangsdaten nur des eigenen Kontos (Migration 0114, 14.11.2026 gemessen):
 *   T  in 0114 wieder `user_id = ANY (zeilenschutz_konten())` statt `= zeilenschutz_konto()`
 *      → rot: „Zugangsdaten des Unterkontos bleiben …“ (A sah den Passkey von B)
 *
 * Gegenproben Zeilenschutz (13.11.2026, vor der Systemrolle):
 * Gegenproben (am 13.11.2026 gemessen, je einzeln):
 *   A  vor den Tests `ALTER TABLE sets DISABLE ROW LEVEL SECURITY` → rot:
 *      „mit Konto A …“, „ein Unterkonto …“, „ohne Konto …“, „fremde user_id …“,
 *      „imSystemkontext mitten …“, „ein Signal-Handler …“, „eine Anfrage erbt …“;
 *      nur die Policy entfernt (RLS an) → dieselben und „ein Auftrag …“ (0 Zeilen)
 *   B  in kontextSql() (db/database.ts) immer '' → rot: alle Teiltests
 *   C  set_config(…, false) statt true für app.konto → rot: „ohne Konto …“ (die
 *      Verbindung trägt Konto A weiter) und „im Systemrahmen …“
 *   D  zeilenschutz_konten() ohne die Unterkonten → rot: „mit Konto A …“,
 *      „ohne Konto …“, „fremde user_id …“, „ein Signal-Handler …“
 *   E  in imAuftragsrahmen() die Marke KONTOUEBERGREIFEND nicht beachtet → rot: „ein Auftrag …“
 *   F  nach ROLLBACK TO SAVEPOINT stand.kontext nicht zurückgesetzt → rot:
 *      „imSystemkontext mitten … Sicherungspunkt“ (Konto A sah nur B)
 *   G  in Benachrichtigung.listen() AsyncResource.bind weggelassen → rot: „ein
 *      Signal-Handler …“ (er fragt im Rahmen von C)
 *   H  alsAnfrage() ohne Leeren des Systemrahmens → rot: „eine Anfrage erbt …“
 *   I  in einladungEinloesen() die Währungen ohne imSystemkontext() gelesen →
 *      rot: „wer einem Haushalt beitritt …“ (das Hauptkonto liest sich als EUR)
 *   J  in setzeHaushaltswaehrung() ohne imSystemkontext() → rot: „ein
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
const { zugangOderSkip, fehltVoraussetzung } = require('./helpers/db');
const { testName, raeumeReste, id } = require('./helpers/testnamen');
const { erzeugeDb, dbKonfigAusUmgebung } = require(path.join(q.DIST, 'db', 'database.js'));
const { imNamenVon, imSystemkontext, alsAnfrage } = _req('src/infra/kontoKontext.js');

const ROLLE = testName('zeilen');
const SYSTEM = testName('zeilsys');
const als = (uid, f) => imNamenVon({ apiUser: { user_id: uid } }, f);
const ids = zeilen => [...new Set(zeilen.map(z => Number(z.user_id)))].sort((x, y) => x - y);

/** Alle Bereiche über einen Zugang, wie startup/verdrahtung.ts sie baut, samt ihren Kontexten. */
const bauMit = z => {
  const kontexte = {};
  const d = _req('startup/verdrahtung.js').baueDienste(z, {
    nacharbeit: _req('src/auftraege/nacharbeit.js').OHNE_NACHARBEIT,
    kontexte,
  });
  return { d, kontexte };
};
const dienstMit = z => bauMit(z).d;

test('Zeilenschutz der Kontotabellen', { concurrency: 1 }, async t => {
  const su = await zugangOderSkip(t, _req);
  if (!su) return;
  if (!(await su.alsSuperuserVerbunden())) return fehltVoraussetzung(t, 'kein Superuser');
  await raeumeReste(su.pool, 'zeilen');
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
  const k = dbKonfigAusUmgebung();
  const app = erzeugeDb({
    verbindung: k.verbindung,
    pool: { ...k.pool, max: 1, options: `${k.pool.options} -c role=${ROLLE}` },
    system: { ...k.verbindung, options: `${k.pool.options} -c role=${SYSTEM}` },
  });
  t.after(async () => {
    await app.benachrichtigung.close();
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
      `INSERT INTO papierkorb (user_id, art, nummer, zeilen, geloescht_am) VALUES ($1, 'set', '10001-1', '[]', NOW() - INTERVAL '90 days')`,
      [u],
    );
  }
  const alleSets = () => app.all('SELECT user_id FROM sets');

  await t.test('mit Konto A sieht eine Abfrage ohne Filter A und sein Unterkonto B, nicht C', async () => {
    assert.deepEqual(ids(await als(A, alleSets)), [A, B]);
    assert.deepEqual(ids(await als(A, () => app.all('SELECT user_id FROM user_settings'))), [A, B]);
    assert.deepEqual(ids(await als(A, () => app.transaction(tx => tx.all('SELECT user_id FROM sets')))), [A, B]);
  });

  await t.test('ein Unterkonto sieht nur sich selbst, nicht sein Hauptkonto', async () => {
    assert.deepEqual(ids(await als(B, alleSets)), [B]);
    assert.equal(await als(B, () => app.get('SELECT 1 AS da FROM sets WHERE user_id = $1', [A])), undefined);
  });

  await t.test('kein Schalter der Sitzung hebt den Zeilenschutz der Laufzeitrolle auf', async () => {
    const schalter = `SELECT set_config('app.system', 'an', true), set_config('app.rolle', 'system', true),
                             set_config('app.bypass', 'on', true)`;
    const nachSchalter = (vorher, sql) =>
      app.transaction(async tx => {
        await tx.exec(vorher);
        return tx.all(sql);
      });
    assert.deepEqual(await nachSchalter(schalter, 'SELECT user_id FROM sets'), []);
    assert.deepEqual(ids(await als(A, () => nachSchalter(schalter, 'SELECT user_id FROM sets'))), [A, B]);
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
    await assert.rejects(
      nachSchalter('SET LOCAL row_security = off', 'SELECT user_id FROM sets'),
      /row-level security/,
    );
    assert.deepEqual(ids(await imSystemkontext('test', alleSets)), [A, B, C]);
  });

  await t.test('ohne Konto und ohne Systemrahmen keine Zeile, auch nach einer Anfrage mit Konto', async () => {
    assert.deepEqual(ids(await als(A, alleSets)), [A, B]);
    assert.deepEqual(await alleSets(), []);
    await als(A, () => app.transaction(tx => tx.all('SELECT 1')));
    assert.deepEqual(await app.all('SELECT user_id FROM papierkorb'), []);
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
    const { papierkorb } = bauMit(app).kontexte.bestand;
    assert.equal(await papierkorb.entferneAeltere(30), 0);
    assert.equal(await imSystemkontext('test', () => papierkorb.entferneAeltere(30)), 3);
    assert.deepEqual(await su.all('SELECT id FROM papierkorb'), []);
  });

  await t.test('ein Auftrag läuft im Systemrahmen nur, wenn seine Art kontoübergreifend ist', async st => {
    const leeren = () => su.run("DELETE FROM auftraege WHERE art IN ('wechselkurse', 'nacharbeit', 'preise')");
    st.after(leeren);
    const A_ = _req('src/auftraege/dienst.js');
    const { erzeugeWorker } = _req('jobs/auftragsWorker.js');
    await leeren();
    const gesehen = {};
    const sieh = name => async () => {
      gesehen[name] = ids(await alleSets());
    };
    const w = erzeugeWorker(require('./helpers/sources').testDienste().auftraege, {
      wechselkurse: { ausfuehren: sieh('ohne Marke') },
      nacharbeit: {
        ausfuehren: async () => {
          await sieh('Konto')();
          throw new Error('gescheitert');
        },
        aufgegeben: sieh('Konto aufgegeben'),
      },
      preise: { ausfuehren: (_n, _k, a) => sieh(a.user_id ? 'markiert mit Konto' : 'markiert')() },
    });
    await A_.stelleAuftragEin('wechselkurse', {}, { schluessel: `zeilen-${process.pid}` });
    assert.equal(await w.verarbeiteEinen(), true);
    // Auch aus einem Systemrahmen heraus (server.ts startet die Jobs in einem).
    await A_.stelleAuftragEin('nacharbeit', { set_number: '10001-1', user_id: A }, { userId: A, maxVersuche: 1 });
    assert.equal(await imSystemkontext('test', () => w.verarbeiteEinen()), true);
    await A_.stelleAuftragEin('preise', {}, { schluessel: `zeilen-${process.pid}` });
    assert.equal(await w.verarbeiteEinen(), true);
    // Mit Konto zählt das Konto, auch bei einer markierten Art.
    await A_.stelleAuftragEin('preise', {}, { userId: A, schluessel: `zeilen-a-${process.pid}` });
    assert.equal(await w.verarbeiteEinen(), true);
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
    'imSystemkontext mitten in der Transaktion wird abgewiesen; ein Kontowechsel folgt auch nach einem Sicherungspunkt',
    async () => {
      const n = async d => (await d.all('SELECT user_id FROM sets')).length;
      const stand = await als(B, () =>
        app.transaction(async tx => {
          const vorher = await n(tx);
          const neben = await imSystemkontext('test', () => n(app)).then(
            () => 'lief neben der Transaktion',
            e => e.constructor.name,
          );
          // Über den Zugang nur mit Freigabe der Transaktion (tx.gebunden), sonst UngebundeneAbfrage.
          await tx
            .gebunden(() =>
              als(A, () =>
                app.transaction(async inner => {
                  await n(inner);
                  throw new Error('zurück');
                }),
              ),
            )
            .catch(() => {});
          return [vorher, neben, await tx.gebunden(() => als(A, () => n(app))), await n(tx)];
        }),
      );
      assert.deepEqual(stand, [1, 'NebenDerTransaktion', 2, 1]);
    },
  );

  await t.test('ein Signal-Handler fragt im Rahmen, in dem er sich angemeldet hat', async () => {
    const kanal = `zeilen_${process.pid}`;
    // Die Horch-Verbindung entsteht im Rahmen von C; der Handler von A darf ihn nicht erben.
    await new Promise(fertig => als(C, () => app.benachrichtigung.listen(kanal, () => fertig(null))));
    const gesehen = new Promise(fertig =>
      als(A, () =>
        app.benachrichtigung.listen(kanal, async nutzlast => {
          if (nutzlast === 'los') fertig(ids(await alleSets()));
        }),
      ),
    );
    await su.run('SELECT pg_notify($1, $2)', [kanal, 'los']);
    assert.deepEqual(await gesehen, [A, B]);
  });

  await t.test('wer einem Haushalt beitritt, vergleicht mit der Währung des Hauptkontos', async () => {
    // Die Dienste über den Zugang mit Zeilenschutz, wie im Betrieb.
    const haushalt = dienstMit(app).haushalt;
    const D = await konto('neu');
    await su.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')`, [D]);
    await su.run(`UPDATE user_settings SET value = 'USD' WHERE user_id = $1 AND key = 'currency'`, [A]);
    const { code } = await als(A, () => haushalt.einladungAnlegen(A));
    const r = await als(D, () => haushalt.einladungEinloesen(D, code));
    assert.deepEqual(r, { fehler: 'waehrung_ungleich', vars: { haupt: 'USD', unter: 'EUR' } });
  });

  await t.test('ein Währungswechsel erreicht auch das Unterkonto des Unterkontos', async () => {
    const kontoDienste = dienstMit(app).konto;
    const E = await konto('enkel');
    await su.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [B, E]);
    await als(A, () => kontoDienste.setUserSetting(A, 'currency', 'CHF'));
    const w = await su.all(`SELECT user_id, value FROM user_settings WHERE key = 'currency' AND user_id = ANY($1)`, [
      [A, B, E],
    ]);
    assert.deepEqual(
      ids(w.filter(z => z.value === 'CHF')),
      [A, B, E].sort((x, y) => x - y),
    );
  });

  await t.test('eine Anfrage erbt keinen Systemrahmen', async () => {
    assert.deepEqual(ids(await imSystemkontext('test', () => alsAnfrage({ apiUser: { user_id: C } }, alleSets))), [C]);
  });
  await t.test('Aufträge und Zugangsdaten anderer Konten bleiben der Laufzeitrolle verborgen', async () => {
    await su.run("DELETE FROM auftraege WHERE art = 'wechselkurse'");
    await su.run(`INSERT INTO auftraege (art, nutzlast, schluessel) VALUES ('wechselkurse', '{}', $1)`, [
      `zeilen-sys-${process.pid}`,
    ]);
    await su.run(`INSERT INTO auftraege (art, nutzlast, user_id, schluessel) VALUES ('wechselkurse', '{}', $1, $2)`, [
      C,
      `zeilen-c-${process.pid}`,
    ]);
    await su.run(`INSERT INTO api_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      `zeilen-${process.pid}`,
      C,
    ]);
    for (const tabelle of ['auftraege', 'api_tokens']) {
      assert.deepEqual(await als(A, () => app.all(`SELECT user_id FROM ${tabelle}`)), [], tabelle);
      assert.deepEqual(ids(await als(C, () => app.all(`SELECT user_id FROM ${tabelle}`))), [C], tabelle);
    }
    assert.equal(
      (await imSystemkontext('test', () => app.all("SELECT 1 FROM auftraege WHERE art = 'wechselkurse'"))).length,
      2,
    );
    await su.run("DELETE FROM auftraege WHERE art = 'wechselkurse'");
    await su.run('DELETE FROM api_tokens WHERE user_id = $1', [C]);
  });

  await t.test('die Anmeldung findet den Token ohne Konto, der Widerruf löscht ihn', async () => {
    const { d, kontexte } = bauMit(app);
    const K = _req('src/konto/index.js');
    const token = `zeilen-token-${process.pid}`;
    await su.run(`INSERT INTO api_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '1 day')`, [
      K.hashToken(token),
      C,
    ]);
    assert.equal((await d.konto.validateToken(token))?.user_id, C);
    await require(path.join(q.DIST, 'src/konto/geraeteToken.js')).revokeAllTokens(kontexte.konto, C);
    assert.deepEqual(await su.all('SELECT 1 FROM api_tokens WHERE user_id = $1', [C]), []);
  });

  await t.test('ein Konto liest seine Passkeys und Tokens unter Zeilenschutz, fremde nicht', async st => {
    const d = dienstMit(app);
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
    const anfrage = (uid, f) => alsAnfrage({ apiUser: { user_id: uid } }, f);
    // Das eigene Konto: sichtbar, ohne Systemrahmen.
    assert.deepEqual(
      (await anfrage(A, () => d.konto.passkeysDesKontos(A))).map(p => p.name),
      ['eigen'],
    );
    assert.deepEqual(
      (await anfrage(A, () => d.konto.zugaengeListe(A))).map(z => z.label),
      ['eigen'],
    );
    // Ein fremdes Konto, auch mit dessen ID gefragt: nichts, und nichts zu löschen.
    assert.deepEqual(await anfrage(A, () => d.konto.passkeysDesKontos(C)), []);
    assert.deepEqual(await anfrage(A, () => d.konto.zugaengeListe(C)), []);
    const pkC = await su.get('SELECT id FROM passkeys WHERE user_id = $1', [C]);
    assert.equal(await anfrage(A, () => d.konto.loeschePasskey(C, pkC.id)), false);
    assert.equal((await su.all('SELECT 1 FROM passkeys WHERE user_id = $1', [C])).length, 1);
  });

  await t.test('Zugangsdaten des Unterkontos bleiben dem Hauptkonto verborgen, lesend und schreibend', async st => {
    const d = dienstMit(app);
    const pid = process.pid;
    await su.run(`INSERT INTO passkeys (user_id, credential_id, public_key, name) VALUES ($1, $2, '\\x00', 'unter')`, [
      B,
      `pk-b-${pid}`,
    ]);
    await su.run(`INSERT INTO zweiter_faktor (user_id, geheimnis, aktiv) VALUES ($1, 'geheim', true)`, [B]);
    await su.run(
      `INSERT INTO api_tokens (token, user_id, label, expires_at) VALUES ($1, $2, 'unter', NOW() + INTERVAL '1 day')`,
      [`zt-b-${pid}`, B],
    );
    st.after(async () => {
      for (const tab of ['passkeys', 'zweiter_faktor', 'api_tokens'])
        await su.run(`DELETE FROM ${tab} WHERE user_id = ANY($1)`, [[A, B]]);
    });
    // Ohne Filter und mit der ID des Unterkontos: nichts. Der Bestand des Unterkontos bleibt sichtbar.
    for (const sql of [
      'SELECT user_id FROM passkeys',
      'SELECT user_id FROM zweiter_faktor',
      'SELECT user_id FROM api_tokens',
    ])
      assert.deepEqual(await als(A, () => app.all(`${sql} WHERE user_id = $1`, [B])), [], sql);
    assert.deepEqual(ids(await als(A, alleSets)), [A, B]);
    const anfrage = f => alsAnfrage({ apiUser: { user_id: A } }, f);
    assert.deepEqual(await anfrage(() => d.konto.passkeysDesKontos(B)), []);
    assert.deepEqual(await anfrage(() => d.konto.zugaengeListe(B)), []);
    // Anlegen für das Unterkonto: abgewiesen, auch wo der Zeilenschutz der Bestände es erlaubt.
    const rls = /row-level security/;
    for (const sql of [
      `INSERT INTO passkeys (user_id, credential_id, public_key) VALUES ($1, 'pk-fremd-${pid}', '\\x00')`,
      `INSERT INTO zweiter_faktor (user_id, geheimnis) VALUES ($1, 'x') ON CONFLICT DO NOTHING`,
      `INSERT INTO api_tokens (token, user_id) VALUES ('zt-fremd-${pid}', $1)`,
      `INSERT INTO zweiter_faktor_codes (user_id, code_hash) VALUES ($1, 'h')`,
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

  await t.test('ein PDF-Auftrag eines fremden Kontos ist für die Anfrage keiner', async st => {
    const d = dienstMit(app);
    const kennung = `zs${process.pid}`;
    await su.run(
      `INSERT INTO auftraege (art, nutzlast, user_id, schluessel, status) VALUES ('pdf', '{}', $1, $2, 'offen')`,
      [C, `pdf:${kennung}`],
    );
    st.after(() => su.run('DELETE FROM auftraege WHERE schluessel = $1', [`pdf:${kennung}`]));
    const anfrage = (uid, f) => alsAnfrage({ apiUser: { user_id: uid } }, f);
    assert.equal((await anfrage(C, () => d.auftraege.liesAuftrag(kennung, C)))?.user_id, C);
    // Mit der eigenen ID gefragt (wie die Route): keiner; mit der fremden: der Zeilenschutz verbirgt ihn.
    assert.equal(await anfrage(A, () => d.auftraege.liesAuftrag(kennung, A)), null);
    assert.equal(await anfrage(A, () => d.auftraege.liesAuftrag(kennung, C)), null);
    await anfrage(A, () => d.auftraege.loescheAuftrag(kennung, C));
    assert.equal((await su.all('SELECT 1 FROM auftraege WHERE schluessel = $1', [`pdf:${kennung}`])).length, 1);
  });
});
