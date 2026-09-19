/**
 * Preisalarm gegen eine echte Datenbank.
 *
 * ── Warum mit DB ────────────────────────────────────────────────────────────
 *
 * Der Kern ist die HYSTERESE: gemeldet wird der Übergang, nicht der Zustand.
 * Das ist eine Aussage über eine Folge von Läufen — sie lässt sich nur prüfen,
 * indem man den Preis mehrfach ändert und jedes Mal nachsieht, ob gemeldet
 * wurde. Am Quelltext wäre nur zu sehen, DASS ein Merker existiert.
 *
 * Der Mailversand ist dabei ersetzt: Geprüft wird, WANN gemeldet wird, nicht
 * wie die Mail aussieht.
 *
 * Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const ROOT = path.join(__dirname, '..');
const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');

const U = {};
const SN = '10179-1';

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(client); }
  finally { client.release(); }
  for (const [name, mail] of [['ich', 'ich@example.test'], ['ohnemail', null]]) {
    await db.run(`INSERT INTO users (username, email, password_hash) VALUES ($1,$2,'x')`,
      [name, mail]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
}

/** Den Marktpreis setzen — das, was der Preislauf sonst aus BrickLink holt. */
async function setzePreis(preis, condition = 'N', waehrung = 'EUR') {
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, avg_price, fetched_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (set_number, currency_code, condition)
       DO UPDATE SET avg_price = $4, fetched_at = NOW()`,
    [SN, condition, waehrung, preis]);
}

async function dbReachable() {
  try { await db.get('SELECT 1 AS ok'); return true; } catch { return false; }
}

test('Preisalarm gegen echte Datenbank', async (t) => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    if (process.env.REQUIRE_DB === '1') {
      throw new Error('REQUIRE_DB=1, aber die Test-Datenbank ist nicht erreichbar.');
    }
    t.skip('Test-DB nicht erreichbar — Suite übersprungen');
    return;
  }
  await seed();

  // Der Versand wird als PARAMETER übergeben, nicht ersetzt.
  //
  // Der erste Entwurf setzte `mailer.sendMail` um. Das verpufft lautlos:
  // TypeScript übersetzt `export { sendMail }` zu einem Getter auf dem
  // Modulobjekt, und eine Zuweisung darauf tut nichts. Der Test lief gegen den
  // echten Versand, zählte null Meldungen — und die Ursache stand nirgends.
  const A = _req('utils/preisalarm.js');
  let versandt = [];
  let versandFehler = null;
  const versende = async (m) => {
    if (versandFehler) throw new Error(versandFehler);
    versandt.push(m);
  };
  const pruefe = (sn) => A.pruefeSet(sn, versende);

  await t.test('die Richtung bedeutet, was sie sagt', () => {
    // Die einzige Stelle im Modul, an der ein Vorzeichenfehler entsteht.
    assert.equal(A.reisst('unter', 199, 200), true);
    assert.equal(A.reisst('unter', 200, 200), false, 'genau auf der Schwelle ist nicht darunter');
    assert.equal(A.reisst('unter', 201, 200), false);
    assert.equal(A.reisst('ueber', 201, 200), true);
    assert.equal(A.reisst('ueber', 200, 200), false, 'genau auf der Schwelle ist nicht darüber');
    assert.equal(A.reisst('ueber', 199, 200), false);
  });

  await t.test('unsinnige Eingaben werden abgelehnt, nicht zurechtgebogen', async () => {
    // Eine stillschweigend korrigierte Schwelle wäre schlimmer als eine
    // Absage: Der Alarm stünde da und meldete nie oder immer.
    for (const [feld, wert] of [['richtung', 'seitwärts'], ['schwelle', 0],
                                ['schwelle', -5], ['schwelle', 'abc'], ['condition', 'X']]) {
      const eingabe = { richtung: 'unter', schwelle: 200, condition: 'N', [feld]: wert };
      // Auf `code` geprüft, nicht auf die Meldung: fehlerWerfen() setzt als
      // `message` den DEUTSCHEN Satz — ein Test darauf bräche bei jeder
      // Umformulierung, ohne dass sich das Verhalten ändert.
      await assert.rejects(() => A.setzeAlarm(U.ich, SN, 'EUR', eingabe),
        (e) => String(e.code || '').startsWith('alarm_'),
        `${feld}=${wert} wurde angenommen`);
    }
  });

  await t.test('gemeldet wird der ÜBERGANG, nicht der Zustand', async () => {
    await A.setzeAlarm(U.ich, SN, 'EUR', { richtung: 'unter', schwelle: 200, condition: 'N' });

    // 1. Über der Schwelle — nichts zu melden.
    await setzePreis(250);
    assert.equal(await pruefe(SN), 0, 'über der Schwelle darf nichts kommen');

    // 2. Unterschreitung — eine Meldung.
    await setzePreis(180);
    assert.equal(await pruefe(SN), 1, 'die Unterschreitung wurde nicht gemeldet');
    assert.match(versandt.at(-1).subject, /10179-1/);

    // 3. Bleibt darunter — KEINE zweite Meldung. Ohne diesen Merker käme bei
    //    stündlichem Preislauf stündlich eine Mail.
    await setzePreis(170);
    assert.equal(await pruefe(SN), 0, 'zweite Meldung ohne neuen Übergang');

    // 4. Zurück darüber — der Merker fällt.
    await setzePreis(260);
    assert.equal(await pruefe(SN), 0);
    const nach = (await A.alarmeFuer(U.ich, SN))[0];
    assert.equal(nach.ausgeloest, false, 'der Merker wurde nicht zurückgesetzt');

    // 5. Wieder darunter — wieder eine Meldung. Genau das verschluckt eine
    //    Sperrfrist („höchstens einmal pro Woche"), und genau das ist der
    //    Fall, der wieder interessant ist.
    await setzePreis(150);
    assert.equal(await pruefe(SN), 1, 'das zweite Unterschreiten wurde verschluckt');
  });

  await t.test('eine neue Schwelle ist eine neue Frage', async () => {
    // Nach Prüfung 5 steht der Merker. Wer die Schwelle ändert, will eine
    // Antwort — auch wenn die alte schon einmal gemeldet hat.
    await setzePreis(150);
    await A.setzeAlarm(U.ich, SN, 'EUR', { richtung: 'unter', schwelle: 160, condition: 'N' });
    assert.equal((await A.alarmeFuer(U.ich, SN))[0].ausgeloest, false);
    assert.equal(await pruefe(SN), 1, 'nach dem Ändern wurde nicht neu gemeldet');
  });

  await t.test('die Währung gehört zur Schwelle', async () => {
    // 200 CHF sind nicht 200 EUR. Gibt es keinen Preis in DER Währung des
    // Alarms, ist er nicht falsch — nur (noch) nicht beantwortbar.
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [U.ich]);
    await A.setzeAlarm(U.ich, SN, 'CHF', { richtung: 'unter', schwelle: 200, condition: 'N' });
    await setzePreis(10, 'N', 'EUR');       // billig, aber in der falschen Währung
    assert.equal(await pruefe(SN), 0, 'ein Preis in fremder Währung hat ausgelöst');
    await setzePreis(10, 'N', 'CHF');
    assert.equal(await pruefe(SN), 1);
  });

  await t.test('der Zustand trennt die Alarme', async () => {
    // Neu und gebraucht liegen oft um ein Vielfaches auseinander. Ein Alarm
    // auf „neu" darf von einem gebrauchten Preis nicht ausgelöst werden.
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [U.ich]);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setzeAlarm(U.ich, SN, 'EUR', { richtung: 'unter', schwelle: 200, condition: 'N' });
    await setzePreis(50, 'U');
    assert.equal(await pruefe(SN), 0, 'der gebrauchte Preis hat den Neu-Alarm ausgelöst');
    await setzePreis(150, 'N');
    assert.equal(await pruefe(SN), 1);
  });

  await t.test('ein Konto ohne Mailadresse blockiert den Lauf nicht', async () => {
    // Der Merker wird trotzdem gesetzt — sonst liefe die Prüfung bei jedem
    // Lauf erneut durch alle Alarme dieses Kontos.
    await db.run('DELETE FROM price_alerts', []);
    await A.setzeAlarm(U.ohnemail, SN, 'EUR', { richtung: 'unter', schwelle: 200, condition: 'N' });
    await setzePreis(100, 'N');
    assert.equal(await pruefe(SN), 0, 'ohne Adresse darf nichts verschickt werden');
    assert.equal((await A.alarmeFuer(U.ohnemail, SN))[0].ausgeloest, true,
      'der Merker muss trotzdem stehen');
  });

  await t.test('ein gescheiterter Versand lässt den Merker ungesetzt', async () => {
    // Sonst wäre die Meldung verloren: Der Merker sagte „schon gemeldet",
    // obwohl nie eine Mail ankam.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setzeAlarm(U.ich, SN, 'EUR', { richtung: 'unter', schwelle: 200, condition: 'N' });
    versandFehler = 'SMTP weg';
    await setzePreis(100, 'N');
    assert.equal(await pruefe(SN), 0);
    assert.equal((await A.alarmeFuer(U.ich, SN))[0].ausgeloest, false,
      'nach einem gescheiterten Versand darf der Merker nicht stehen');
    versandFehler = null;
    // Und beim nächsten Lauf wird es erneut versucht.
    assert.equal(await pruefe(SN), 1, 'der zweite Versuch blieb aus');
  });

  await t.test('Löschen ist ohne Alarm kein Fehler', async () => {
    assert.equal(await A.loescheAlarm(U.ich, SN, 'N'), 1);
    assert.equal(await A.loescheAlarm(U.ich, SN, 'N'), 0, 'der zweite Aufruf darf nicht werfen');
  });

  await db.pool.end().catch(() => {});
});
