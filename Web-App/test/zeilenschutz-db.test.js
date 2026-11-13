/**
 * Zeilenschutz (Migration 0110): Vergisst eine Abfrage den Filter auf
 * user_id, liefert und ändert die Datenbank trotzdem nur Zeilen des Kontos der
 * Anfrage und seiner direkten Unterkonten. Ohne Konto und ohne Systemrahmen
 * gibt es keine Zeile; Aufträge laufen im Systemrahmen.
 *
 * Geprüft über einen Zugang aus erzeugeDb() als eigene Rolle ohne Eigentum
 * und ohne BYPASSRLS, wie die Laufzeitrolle im Betrieb: Der Testbenutzer ist
 * Superuser und sähe sonst alles.
 *
 * Gegenproben (am 13.11.2026 gemessen, je einzeln):
 *   A  vor den Tests `ALTER TABLE sets DISABLE ROW LEVEL SECURITY` → rot:
 *      „mit Konto A …“, „ein Unterkonto …“, „ohne Konto …“, „fremde user_id …“,
 *      „der Rahmen folgt …“, „ein Signal-Handler …“, „eine Anfrage erbt …“;
 *      nur die Policy entfernt (RLS an) → dieselben und „ein Auftrag …“ (0 Zeilen)
 *   B  in kontextSql() (db/database.ts) immer '' → rot: alle Teiltests
 *   C  set_config(…, false) statt true für app.konto → rot: „ohne Konto …“ (die
 *      Verbindung trägt Konto A weiter) und „im Systemrahmen …“
 *   D  zeilenschutz_konten() ohne die Unterkonten → rot: „mit Konto A …“,
 *      „ohne Konto …“, „fremde user_id …“, „ein Signal-Handler …“
 *   E  im Auftrags-Worker imSystemkontext() weggelassen → rot: „ein Auftrag …“
 *   F  nach ROLLBACK TO SAVEPOINT stand.kontext nicht zurückgesetzt → rot:
 *      „der Rahmen folgt … Sicherungspunkt“
 *   G  in Benachrichtigung.listen() AsyncResource.bind weggelassen → rot: „ein
 *      Signal-Handler …“ (er fragt im Rahmen von C)
 *   H  alsAnfrage() ohne Leeren des Systemrahmens → rot: „eine Anfrage erbt …“
 *   I  in einladungEinloesen() die Währungen ohne imSystemkontext() gelesen →
 *      rot: „wer einem Haushalt beitritt …“ (das Hauptkonto liest sich als EUR)
 *   J  in setzeHaushaltswaehrung() ohne imSystemkontext() → rot: „ein
 *      Währungswechsel erreicht …“ (row-level security beim Enkelkonto)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL mit Superuser (legt eine Rolle an).
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
const als = (uid, f) => imNamenVon({ apiUser: { user_id: uid } }, f);
const ids = zeilen => [...new Set(zeilen.map(z => Number(z.user_id)))].sort((x, y) => x - y);

test('Zeilenschutz der Kontotabellen', { concurrency: 1 }, async t => {
  const su = await zugangOderSkip(t, _req);
  if (!su) return;
  if (!(await su.alsSuperuserVerbunden())) return fehltVoraussetzung(t, 'kein Superuser');
  await raeumeReste(su.pool, 'zeilen');
  await su.exec(`DROP ROLE IF EXISTS ${id(ROLLE)}`);
  await su.exec(`CREATE ROLE ${id(ROLLE)} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  await su.exec(`GRANT USAGE ON SCHEMA public TO ${id(ROLLE)};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${id(ROLLE)};
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${id(ROLLE)}`);
  // Eine Verbindung: So zeigt sich, ob ein Konto an ihr hängen bleibt.
  const k = dbKonfigAusUmgebung();
  const app = erzeugeDb({
    verbindung: k.verbindung,
    pool: { ...k.pool, max: 1, options: `${k.pool.options} -c role=${ROLLE}` },
  });
  t.after(async () => {
    await app.benachrichtigung.close();
    await app.pool.end().catch(() => {});
    await su.exec(`DROP OWNED BY ${id(ROLLE)}; DROP ROLE IF EXISTS ${id(ROLLE)}`).catch(() => {});
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
    const bestand = _req('src/bestand/bereich.js').erzeugeBestand({ db: app });
    assert.equal(await bestand.papierkorb.entferneAeltere(30), 0);
    assert.equal(await imSystemkontext('test', () => bestand.papierkorb.entferneAeltere(30)), 3);
    assert.deepEqual(await su.all('SELECT id FROM papierkorb'), []);
  });

  await t.test('ein Auftrag läuft im Systemrahmen', async () => {
    const A_ = _req('src/auftraege/dienst.js');
    const { erzeugeWorker } = _req('jobs/auftragsWorker.js');
    await su.run("DELETE FROM auftraege WHERE art = 'wechselkurse'");
    let gesehen = null;
    const w = erzeugeWorker({ wechselkurse: { ausfuehren: async () => (gesehen = ids(await alleSets())) } });
    await A_.stelleAuftragEin('wechselkurse', {}, { schluessel: `zeilen-${process.pid}` });
    assert.equal(await w.verarbeiteEinen(), true);
    assert.deepEqual(gesehen, [A, B, C]);
  });

  await t.test(
    'der Rahmen folgt imSystemkontext mitten in der Transaktion, auch nach einem Sicherungspunkt',
    async () => {
      const n = async d => (await d.all('SELECT user_id FROM sets')).length;
      const stand = await als(B, () =>
        app.transaction(async tx => {
          const vorher = await n(tx);
          const drinnen = await imSystemkontext('test', async () => {
            await app
              .transaction(async inner => {
                await n(inner);
                throw new Error('zurück');
              })
              .catch(() => {});
            return n(app);
          });
          return [vorher, drinnen, await n(tx)];
        }),
      );
      assert.deepEqual(stand, [1, 3, 1]);
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
    for (const [b, B] of [
      ['haushalt', 'Haushalt'],
      ['einstellungen', 'Einstellungen'],
    ])
      _req(`src/${b}/prozess.js`)[`verdrahte${B}`](() => _req(`src/${b}/bereich.js`)[`erzeuge${B}`]({ db: app }));
    const { haushaltBereich } = _req('src/haushalt/prozess.js');
    const D = await konto('neu');
    await su.run(`INSERT INTO user_settings (user_id, key, value) VALUES ($1, 'currency', 'EUR')`, [D]);
    await su.run(`UPDATE user_settings SET value = 'USD' WHERE user_id = $1 AND key = 'currency'`, [A]);
    const { code } = await als(A, () => haushaltBereich().haushalt.einladungAnlegen(A));
    const r = await als(D, () => haushaltBereich().haushalt.einladungEinloesen(D, code));
    assert.deepEqual(r, { fehler: 'waehrung_ungleich', vars: { haupt: 'USD', unter: 'EUR' } });
  });

  await t.test('ein Währungswechsel erreicht auch das Unterkonto des Unterkontos', async () => {
    _req('src/konto/prozess.js').verdrahteKonto(() => _req('src/konto/bereich.js').erzeugeKonto({ db: app }));
    const E = await konto('enkel');
    await su.run('INSERT INTO account_links (main_user_id, sub_user_id) VALUES ($1, $2)', [B, E]);
    await als(A, () => _req('src/konto/nutzerEinstellung.js').setUserSetting(A, 'currency', 'CHF'));
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
});
