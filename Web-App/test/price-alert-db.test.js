/**
 * Preisalarm gegen eine echte Datenbank.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { keineDb } = require('./helpers/db');
const db = testData();

const U = {};
const SN = '10179-1';

async function seed() {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const client = await db.pool.connect();
  try {
    await _req('db/migrate.js').runMigrations(client);
  } finally {
    client.release();
  }
  for (const [name, mail] of [
    ['ich', 'ich@example.test'],
    ['ohnemail', null],
  ]) {
    await db.run(`INSERT INTO users (username, email, password_hash) VALUES ($1,$2,'x')`, [name, mail]);
    U[name] = (await db.get('SELECT id FROM users WHERE username=$1', [name])).id;
  }
}

/** Den Marktpreis setzen — das, was der Preislauf sonst aus BrickLink holt. */
async function setPrice(preis, condition = 'N', waehrung = 'EUR') {
  await db.run(
    `INSERT INTO price_cache (set_number, condition, currency_code, avg_price, fetched_at)
     VALUES ($1,$2,$3,$4,NOW())
     ON CONFLICT (set_number, currency_code, condition)
       DO UPDATE SET avg_price = $4, fetched_at = NOW()`,
    [SN, condition, waehrung, preis],
  );
}

async function dbReachable() {
  try {
    await db.get('SELECT 1 AS ok');
    return true;
  } catch {
    return false;
  }
}

test('price alert against a real database', async t => {
  if (!(await dbReachable())) {
    await db.pool.end().catch(() => {});
    keineDb(t);
    return;
  }
  await seed();

  // Der Versand wird als PARAMETER übergeben, nicht ersetzt.
  //
  // Der erste Entwurf setzte `mailer.sendMail` um. Das verpufft lautlos:
  // TypeScript übersetzt `export { sendMail }` zu einem Getter auf dem
  // Modulobjekt, und eine Zuweisung darauf tut nichts. Der Test lief gegen den
  // echten Versand, zählte null Meldungen — und die Ursache stand nirgends.
  const A = {
    ..._req('src/finances/priceAlert.js'),
    ...require('./helpers/sources').testArea('finances').preisalarm,
  };
  let sent = [];
  let sendingError = null;
  const send = async m => {
    if (sendingError) throw new Error(sendingError);
    sent.push(m);
  };
  const pruefe = sn => A.checkSet(sn, { ...require('./helpers/sources').testServices().mail, sendMail: send });

  await t.test('the direction means what it says', () => {
    // Die einzige Stelle im Modul, an der ein Vorzeichenfehler entsteht.
    assert.equal(A.reisst('unter', 199, 200), true);
    assert.equal(A.reisst('unter', 200, 200), false, 'genau auf der Schwelle ist nicht darunter');
    assert.equal(A.reisst('unter', 201, 200), false);
    assert.equal(A.reisst('ueber', 201, 200), true);
    assert.equal(A.reisst('ueber', 200, 200), false, 'genau auf der Schwelle ist nicht darüber');
    assert.equal(A.reisst('ueber', 199, 200), false);
  });

  await t.test('nonsensical input is rejected, not bent into shape', async () => {
    // Eine stillschweigend korrigierte Schwelle wäre schlimmer als eine
    // Absage: Der Alarm stünde da und meldete nie oder immer.
    for (const [feld, wert] of [
      ['direction', 'seitwärts'],
      ['threshold', 0],
      ['threshold', -5],
      ['threshold', 'abc'],
      ['condition', 'X'],
    ]) {
      const eingabe = { direction: 'unter', threshold: 200, condition: 'N', [feld]: wert };
      // Auf `code` geprüft, nicht auf die Meldung: fachfehler() setzt als
      // `message` den DEUTSCHEN Satz — ein Test darauf bräche bei jeder
      // Umformulierung, ohne dass sich das Verhalten ändert.
      await assert.rejects(
        () => A.setzeAlarm(U.ich, SN, 'EUR', eingabe),
        (/** @type {any} */ e) => String(e.code || '').startsWith('alarm_'),
        `${feld}=${wert} wurde angenommen`,
      );
    }
  });

  await t.test('the TRANSITION is reported, not the state', async () => {
    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });

    // 1. Über der Schwelle — nichts zu melden.
    await setPrice(250);
    assert.equal(await pruefe(SN), 0, 'über der Schwelle darf nichts kommen');

    // 2. Unterschreitung — eine Meldung.
    await setPrice(180);
    assert.equal(await pruefe(SN), 1, 'die Unterschreitung wurde nicht gemeldet');
    assert.match(sent.at(-1).subject, /10179-1/);

    // 3. Bleibt darunter — KEINE zweite Meldung. Ohne diesen Merker käme bei
    //    stündlichem Preislauf stündlich eine Mail.
    await setPrice(170);
    assert.equal(await pruefe(SN), 0, 'zweite Meldung ohne neuen Übergang');

    // 4. Zurück darüber — der Merker fällt.
    await setPrice(260);
    assert.equal(await pruefe(SN), 0);
    const nach = (await A.alertsFor(U.ich, SN))[0];
    assert.equal(nach.triggered, false, 'der Merker wurde nicht zurückgesetzt');

    // 5. Wieder darunter — wieder eine Meldung. Genau das verschluckt eine
    //    Sperrfrist („höchstens einmal pro Woche"), und genau das ist der
    //    Fall, der wieder interessant ist.
    await setPrice(150);
    assert.equal(await pruefe(SN), 1, 'das zweite Unterschreiten wurde verschluckt');
  });

  await t.test('a new threshold is a new question', async () => {
    // Nach Prüfung 5 steht der Merker. Wer die Schwelle ändert, will eine
    // Antwort — auch wenn die alte schon einmal gemeldet hat.
    await setPrice(150);
    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 160, condition: 'N' });
    assert.equal((await A.alertsFor(U.ich, SN))[0].triggered, false);
    assert.equal(await pruefe(SN), 1, 'nach dem Ändern wurde nicht neu gemeldet');
  });

  await t.test('the currency belongs to the threshold', async () => {
    // 200 CHF sind nicht 200 EUR. Gibt es keinen Preis in DER Währung des
    // Alarms, ist er nicht falsch — nur (noch) nicht beantwortbar.
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [U.ich]);
    await A.setzeAlarm(U.ich, SN, 'CHF', { direction: 'unter', threshold: 200, condition: 'N' });
    await setPrice(10, 'N', 'EUR'); // billig, aber in der falschen Währung
    assert.equal(await pruefe(SN), 0, 'ein Preis in fremder Währung hat ausgelöst');
    await setPrice(10, 'N', 'CHF');
    assert.equal(await pruefe(SN), 1);
  });

  await t.test('the condition separates the alerts', async () => {
    // Neu und gebraucht liegen oft um ein Vielfaches auseinander. Ein Alarm
    // auf „neu" darf von einem gebrauchten Preis nicht ausgelöst werden.
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [U.ich]);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });
    await setPrice(50, 'U');
    assert.equal(await pruefe(SN), 0, 'der gebrauchte Preis hat den Neu-Alarm ausgelöst');
    await setPrice(150, 'N');
    assert.equal(await pruefe(SN), 1);
  });

  await t.test('an account without a mail address does not block the run', async () => {
    // Der Merker wird trotzdem gesetzt — sonst liefe die Prüfung bei jedem
    // Lauf erneut durch alle Alarme dieses Kontos.
    await db.run('DELETE FROM price_alerts', []);
    await A.setzeAlarm(U.ohnemail, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });
    await setPrice(100, 'N');
    assert.equal(await pruefe(SN), 0, 'ohne Adresse darf nichts verschickt werden');
    assert.equal((await A.alertsFor(U.ohnemail, SN))[0].triggered, true, 'der Merker muss trotzdem stehen');
  });

  await t.test('a failed send leaves the flag unset', async () => {
    // Sonst wäre die Meldung verloren: Der Merker sagte „schon gemeldet",
    // obwohl nie eine Mail ankam.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });
    sendingError = 'SMTP weg';
    await setPrice(100, 'N');
    assert.equal(await pruefe(SN), 0);
    assert.equal(
      (await A.alertsFor(U.ich, SN))[0].triggered,
      false,
      'nach einem gescheiterten Versand darf der Merker nicht stehen',
    );
    sendingError = null;
    // Und beim nächsten Lauf wird es erneut versucht.
    assert.equal(await pruefe(SN), 1, 'der zweite Versuch blieb aus');
  });

  await t.test('fetch: without a marker nothing comes back, only the timestamp', async () => {
    // Das ist der erste Start eines Geräts. Käme hier alles Ausgelöste, würde
    // eine frisch eingerichtete App mit Schwellen aufschlagen, die vor Wochen
    // gerissen sind.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });
    await setPrice(100, 'N');
    assert.equal(await pruefe(SN), 1);

    for (const ohne of [undefined, null, '', '   ', 'kein Datum']) {
      const r = await A.triggeredSince(U.ich, ohne);
      assert.deepEqual(r.alerts, [], `since=${JSON.stringify(ohne)} lieferte Meldungen`);
      assert.ok(r.now instanceof Date, 'der Zeitpunkt des Servers fehlt');
    }
  });

  await t.test('fetch: the server marker fetches exactly once', async () => {
    // Der Ablauf eines Geräts: merken, abholen, wieder merken. Die zweite
    // Abholung mit der zurückgegebenen Marke muss LEER sein — sonst käme
    // dieselbe Meldung bei jedem stündlichen Lauf erneut.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    const vorher = (await A.triggeredSince(U.ich, null)).now;

    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });
    await setPrice(100, 'N');
    assert.equal(await pruefe(SN), 1);

    const erste = await A.triggeredSince(U.ich, vorher);
    // Auch hier die Zeitstempel: Ein voller CI-Lauf ist an diesem Subtest
    // einmal gescheitert, und aus dem Bericht war nicht zu erkennen, WELCHE
    // der beiden Zusicherungen gerissen ist. Beide nennen deshalb ihre Werte.
    assert.equal(
      erste.alerts.length,
      1,
      'die ausgelöste Schwelle fehlt. ' +
        `vorher=${vorher?.toISOString?.() ?? vorher}, ` +
        `last_triggered_at=${(await db.get('SELECT last_triggered_at FROM price_alerts'))?.last_triggered_at}`,
    );
    assert.equal(erste.alerts[0].set_number, SN);
    assert.equal(erste.alerts[0].direction, 'unter');
    // numeric kommt als Zeichenkette aus dem Treiber — käme sie so durch,
    // stünde in der Meldung "200.00" statt einer Zahl, und die App rechnete
    // auf einer Zeichenkette.
    assert.equal(typeof erste.alerts[0].threshold, 'number');
    assert.equal(erste.alerts[0].threshold, 200);
    assert.equal(typeof erste.alerts[0].last_price, 'number');
    assert.equal(erste.alerts[0].last_price, 100);

    const zweite = await A.triggeredSince(U.ich, erste.now);
    // Die Zeitstempel stehen in der Meldung, und das hat einen Grund: Genau
    // diese Zusicherung ist mir EINMAL in einem vollen Lauf rot geworden und
    // in vier Wiederholungen nicht mehr. Ohne die drei Werte bliebe im
    // Fehlerbericht nur „kam ein zweites Mal" — und damit wieder nichts zu …
    assert.deepEqual(
      zweite.alerts,
      [],
      'dieselbe Meldung kam ein zweites Mal. ' +
        `vorher=${vorher?.toISOString?.() ?? vorher}, ` +
        `last_triggered_at=${erste.alerts[0]?.last_triggered_at?.toISOString?.() ?? erste.alerts[0]?.last_triggered_at}, ` +
        `erste.now=${erste.now?.toISOString?.() ?? erste.now}`,
    );
  });

  await t.test('fetch: a notification from the same millisecond does NOT come twice', async () => {
    // Der Befund, und warum er zweimal die CI rot gemacht hat
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });

    const WITH_MICRO = '2026-09-19 20:29:58.527431+00';
    const NUR_MILLI = new Date('2026-09-19T20:29:58.527Z');
    await db.run(
      `UPDATE price_alerts SET triggered = TRUE, last_triggered_at = $1::timestamptz,
              last_price = 100 WHERE user_id = $2`,
      [WITH_MICRO, U.ich],
    );

    const r = await A.triggeredSince(U.ich, NUR_MILLI);
    assert.deepEqual(
      r.alerts,
      [],
      'Die Meldung kam ein zweites Mal: in der Datenbank steht ' +
        `${WITH_MICRO}, die Marke trägt ${NUR_MILLI.toISOString()}. ` +
        'Die Mikrosekunden entscheiden — sie dürfen es nicht.',
    );

    // Und die Gegenrichtung muss weiter funktionieren: Eine Meldung aus der
    // NÄCHSTEN Millisekunde ist wirklich neu und gehört geliefert.
    const r2 = await A.triggeredSince(U.ich, new Date('2026-09-19T20:29:58.526Z'));
    assert.equal(r2.alerts.length, 1, 'Eine Meldung nach der Marke wurde verschluckt — die Kürzung geht zu weit');
  });

  await t.test('fetch: every account sees only its own alerts', async () => {
    // Die Abfrage steht auf user_id, nicht auf scopeIds() — und das ist
    // Absicht: Eine Meldung gehört dem, der die Schwelle gesetzt hat. Ein
    // Hauptkonto bekäme sonst die Meldungen aller Unterkonten, ohne je einen
    // Alarm gesetzt zu haben.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    const vorher = (await A.triggeredSince(U.ich, null)).now;
    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });
    await setPrice(100, 'N');
    assert.equal(await pruefe(SN), 1);

    assert.equal((await A.triggeredSince(U.ich, vorher)).alerts.length, 1);
    assert.deepEqual((await A.triggeredSince(U.ohnemail, vorher)).alerts, [], 'ein fremdes Konto sah die Meldung');
  });

  await t.test("Marco's four steps — the APP also gets exactly one per transition", async () => {
    // Marcos Vorgabe vom 25.09.
    await db.run('DELETE FROM price_alerts', []);
    await db.run('DELETE FROM price_cache WHERE set_number=$1', [SN]);
    sent = [];

    let marke = (await A.triggeredSince(U.ich, null)).now;
    await A.setzeAlarm(U.ich, SN, 'EUR', { direction: 'unter', threshold: 200, condition: 'N' });

    /** Ein Preislauf: Preis setzen, prüfen, abholen. Gibt [Mails, Meldungen] zurück. */
    const lauf = async preis => {
      sent = [];
      await setPrice(preis);
      const mails = await pruefe(SN);
      const r = await A.triggeredSince(U.ich, marke);
      marke = r.now;
      return [mails, r.alerts.length];
    };

    // 1. Der Preis fällt unter die Schwelle.
    assert.deepEqual(await lauf(180), [1, 1], 'Schritt 1: Mail UND Meldung erwartet');

    // 2. Nächster Preislauf, immer noch darunter.
    assert.deepEqual(await lauf(170), [0, 0], 'Schritt 2: nichts erwartet — kein neuer Übergang');

    // Und auch ein dritter Lauf schweigt. Ohne diesen Schritt bliebe offen, ob
    // Schritt 2 nur an der unveränderten Zahl hing.
    assert.deepEqual(await lauf(165), [0, 0], 'Schritt 2b: auch beim dritten Lauf nichts');

    // 3. Der Preis steigt wieder darüber.
    assert.deepEqual(await lauf(260), [0, 0], 'Schritt 3: das Zurückkehren selbst meldet nichts');

    // 4. Und fällt erneut darunter — beide Wege melden wieder.
    assert.deepEqual(await lauf(150), [1, 1], 'Schritt 4: das zweite Unterschreiten wurde verschluckt');

    // Der Vollständigkeit halber: Wer NICHT abholt, verpasst nichts. Die
    // Meldung steht weiter bereit, solange die Marke älter ist — das Telefon
    // darf aus sein.
    const spaeter = await A.triggeredSince(U.ich, new Date(Date.now() - 60_000));
    assert.equal(spaeter.alerts.length, 1, 'eine Meldung verfällt, wenn die App gerade nicht abholt');
  });

  await t.test('deleting without an alert is not an error', async () => {
    assert.equal(await A.loescheAlarm(U.ich, SN, 'N'), 1);
    assert.equal(await A.loescheAlarm(U.ich, SN, 'N'), 0, 'der zweite Aufruf darf nicht werfen');
  });

  await db.pool.end().catch(() => {});
});
