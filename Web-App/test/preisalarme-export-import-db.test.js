/**
 * Preisalarme gehen als CSV hinaus und kommen als Preisalarme zurueck.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Preisalarme sollen in den bestehenden Exporten und Importen ergänzt
 *    werden (in allen)."
 *
 * ── Was „in allen" heisst, und warum nicht wörtlich alle ────────────────────
 *
 * GEMESSEN: Der Baum hat drei Exportwege.
 *
 *   /api/v1/settings/export/data       ZIP mit den Bestandsdaten   ← hier
 *   /api/v1/settings/export            Konfiguration als JSON
 *   /api/v1/sets/export/rebrickable    Listenformat einer fremden Firma
 *
 * Die Alarme liegen im ZIP. Der Konfigurations-Export trägt Einstellungswerte
 * und importiert über eine Whitelist von Schlüsselnamen — eine Tabelle passt
 * dort nicht hinein, und ein Alarm ist keine Einstellung. Der
 * Rebrickable-Export schreibt „Set Number,Quantity" für den Importer einer
 * fremden Firma; eine zusätzliche Spalte macht die Datei dort unbrauchbar.
 * Fall 7 unten hält genau das fest, damit die Entscheidung nicht später als
 * Versäumnis gelesen wird.
 *
 * ── Die Währung ist der Kern dieses Tests ───────────────────────────────────
 *
 * Der Baum hat eine ausdrückliche Regel, an PUT /sets/:setNumber/alert:
 *
 *     „Die Waehrung kommt aus den Einstellungen, NICHT aus der Anfrage: Eine
 *      vom Klienten geschickte Waehrung waere eine zweite Quelle fuer dieselbe
 *      Angabe, und die beiden liefen beim naechsten Wechsel auseinander."
 *
 * Eine Importdatei IST der Klient. Also gilt die Kontowährung — auch wenn in
 * der Datei eine andere steht. Nur bedeutet dieselbe Zahl dann etwas anderes
 * („unter 200" in CHF ist eine andere Frage als in EUR), und das darf nicht
 * im Erfolgston untergehen. Fall 5 prüft beides: die Währung des KONTOS
 * gewinnt, UND die Abweichung wird gemeldet.
 *
 * ── Gegenproben (durchgeführt, Befunde GEMESSEN) ────────────────────────────
 *
 *   a) preisalarme.csv aus dem ZIP entfernt      → 1, 2, 3, 4 rot
 *   b) Währung aus der DATEI statt den Einstell. → 5 rot
 *   c) `ausgeloest` mit exportiert               → 3 rot
 *   d) setzeAlarm durch ein rohes INSERT ersetzt → 6 und 6b rot
 *   e) `WHERE user_id` aus dem Export entfernt   → 2 und 4 rot
 *
 * Drei Dinge daran sind nicht so ausgegangen, wie ich sie vorher aufgeschrieben
 * hatte, und alle drei stehen hier, weil sie etwas über den Test sagen:
 *
 * (d) machte im ERSTEN Versuch GAR NICHTS rot. Fall 6 behauptete, er prüfe,
 * dass die Route setzeAlarm() benutzt — tat er nicht: Die Tabelle hat eigene
 * CHECK-Bedingungen auf `richtung` und `schwelle` (nachgemessen), die fingen
 * das rohe INSERT genauso. Fall 6 trägt jetzt den Zustand „X", auf den es
 * KEINE CHECK gibt, und 6b das Zurücksetzen von `ausgeloest`, das die Tabelle
 * auch nicht erzwingt. Erst damit trennt der Test die beiden Fassungen.
 *
 * (e) deckte beim DURCHDENKEN eine Lücke auf, bevor er lief: Der Aufbau hatte
 * nur ein Konto, und ohne ein zweites sieht ein Export über ALLE Konten
 * genauso aus wie der richtige. Seitdem gibt es `FREMDER_ALARM` — und das ist
 * kein Schönheitsfehler gewesen, sondern ein Leck: Ein Alarm löst eine MAIL an
 * die Adresse seines Kontos aus.
 *
 * Gemessen wurde dann 2 UND 4 rot, vorhergesagt hatte ich nur 2. Auch richtig:
 * Steht der fremde Alarm in der Datei, legt ihn der Import im eigenen Konto an,
 * und die Zahl stimmt nicht mehr. Die Vorhersage war zu eng, nicht der Befund
 * falsch.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL. Ohne DB: skip, ausser
 * REQUIRE_DB=1.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const { testServer } = require('./helpers/server');

test.after(async () => { await db.pool.end().catch(() => {}); });

let HAUPT = 0, FREMD = 0;

/**
 * Der Alarm eines FREMDEN Kontos. Er steht hier, weil ein Export ohne
 * `WHERE user_id` sonst nicht auffiele: Mit nur einem Konto im Aufbau sieht
 * eine Abfrage über ALLE Konten genauso aus wie die richtige. Das ist beim
 * Durchdenken der Gegenproben aufgefallen — Fall „user_id weggelassen" hätte
 * nichts rot gemacht.
 *
 * Und es ist nicht bloss Weite, sondern ein Leck: Ein Alarm löst eine MAIL an
 * die Adresse seines Kontos aus (die Begründung steht an GET
 * /sets/:setNumber/alert). Fremde Alarme im eigenen Export landeten beim
 * Import im eigenen Konto — also Mails über die Wünsche anderer.
 */
const FREMDER_ALARM = { sn: '31203-1', c: 'N', r: 'unter', s: 77, w: 'CHF' };

/**
 * Vier Alarme. Der dritte sitzt auf einem Set, das das Konto NICHT besitzt —
 * genau der Fall, der als Spalte an sets.csv herausgefallen wäre.
 */
const ALARME = [
  { sn: '75192-1', c: 'N', r: 'unter', s: 600,   w: 'CHF', besitzt: true  },
  { sn: '75192-1', c: 'U', r: 'ueber', s: 420.5, w: 'CHF', besitzt: true  },
  { sn: '10179-1', c: 'N', r: 'unter', s: 1200,  w: 'CHF', besitzt: false },
  { sn: '21309-1', c: 'U', r: 'ueber', s: 24.9,  w: 'CHF', besitzt: false },
];

async function aufbau(kontoWaehrung = 'CHF') {
  await db.run('DROP SCHEMA public CASCADE');
  await db.run('CREATE SCHEMA public');
  await db.initSchema();
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }
  await db.run(`INSERT INTO users (username,password_hash) VALUES ('haupt','x'),('fremd','x')`);
  HAUPT = (await db.get(`SELECT id FROM users WHERE username='haupt'`)).id;
  FREMD = (await db.get(`SELECT id FROM users WHERE username='fremd'`)).id;
  // KEINE Kontoverknuepfung: 'fremd' ist kein Unterkonto. Selbst mit einer
  // waere es falsch — ein Alarm kennt kein Blickfeld.
  await db.run(`INSERT INTO set_catalog (set_number,name) VALUES ($1,$1)
                ON CONFLICT (set_number) DO NOTHING`, [FREMDER_ALARM.sn]);
  await db.run(`INSERT INTO price_alerts (user_id,set_number,condition,richtung,schwelle,currency_code)
                VALUES ($1,$2,$3,$4,$5,$6)`,
    [FREMD, FREMDER_ALARM.sn, FREMDER_ALARM.c, FREMDER_ALARM.r, FREMDER_ALARM.s, FREMDER_ALARM.w]);
  await db.run(`INSERT INTO user_settings (user_id,key,value) VALUES ($1,'currency',$2)
                ON CONFLICT (user_id,key) DO UPDATE SET value=$2`, [HAUPT, kontoWaehrung]);
  // Der Bestand gehoert je SET, der Alarm je (Set, Zustand): 75192-1 traegt
  // beide Zustaende. Zwei Erfassungen fuer dasselbe Set am selben TAG verletzt
  // idx_set_acq_tag_zustand (Migration 0008) — genau daran ist der erste Lauf dieses
  // Tests gescheitert. Deshalb die Bestandszeile nur einmal je Nummer.
  const gelegt = new Set();
  for (const a of ALARME) {
    await db.run(`INSERT INTO set_catalog (set_number,name) VALUES ($1,$1)
                  ON CONFLICT (set_number) DO NOTHING`, [a.sn]);
    if (a.besitzt && !gelegt.has(a.sn)) {
      gelegt.add(a.sn);
      await db.run(`INSERT INTO sets (user_id,set_number) VALUES ($1,$2)
                    ON CONFLICT (user_id,set_number) DO NOTHING`, [HAUPT, a.sn]);
      await db.run(`INSERT INTO set_acquisitions (user_id,set_number,quantity,condition)
                    VALUES ($1,$2,1,'N')`, [HAUPT, a.sn]);
    }
    await db.run(`INSERT INTO price_alerts (user_id,set_number,condition,richtung,schwelle,currency_code)
                  VALUES ($1,$2,$3,$4,$5,$6)`, [HAUPT, a.sn, a.c, a.r, a.s, a.w]);
  }
}

/** Eine Datei aus dem ZIP holen — wie in merkliste-export-import-db.test.js. */
function ausZip(buf, name) {
  const zlib = require('node:zlib');
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const methode  = buf.readUInt16LE(i + 8);
    const namLen   = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    if (buf.slice(i + 30, i + 30 + namLen).toString('utf-8') !== name) continue;
    const roh = buf.slice(i + 30 + namLen + extraLen);
    if (methode === 0) return roh.toString('utf-8');
    return zlib.inflateRawSync(roh, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('utf-8');
  }
  return null;
}

function csvZeilen(text) {
  const [kopf, ...rest] = text.replace(/^﻿/, '').trim().split(/\r?\n/);
  const spalten = kopf.split(',').map(s => s.replace(/^"|"$/g, ''));
  return rest.filter(z => z.trim()).map(z => {
    const werte = z.split(',').map(s => s.replace(/^"|"$/g, ''));
    return Object.fromEntries(spalten.map((s, i) => [s, werte[i] ?? '']));
  });
}

/** Dieselbe CSV aus ALARME gebaut — unabhängig vom Export (Lehre aus Stück 1). */
function csvAusAlarmen(waehrung) {
  return 'set_number,condition,richtung,schwelle,currency_code\n'
    + ALARME.map(a => `${a.sn},${a.c},${a.r},${a.s},${waehrung ?? a.w}`).join('\n') + '\n';
}

async function hochladen(base, text, name = 'preisalarme.csv') {
  const fd = new FormData();
  fd.append('file', new Blob([text], { type: 'text/csv' }), name);
  const r = await fetch(`${base}/api/v1/alerts/import/csv`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

test('Preisalarme: Rundlauf über die echten Adressen', { concurrency: 1 }, async (t) => {
  try { await db.get('SELECT 1'); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  await aufbau('CHF');

  const srv = testServer(_req, {
    sitzung: { userId: HAUPT }, apiNutzer: { user_id: HAUPT, is_admin: 0 },
    routen: { '/api/v1': 'routes/api_v1/index.js', '/api/v1/settings': 'routes/settings.js',
              '/api/v1/sets': 'routes/sets.js' }, t,
  });

  let csvText = '';

  await t.test('1. preisalarme.csv liegt im ZIP, neben den vier anderen', async () => {
    const r = await fetch(`${srv.base}/api/v1/settings/export/data`);
    assert.equal(r.status, 200, `Der Export antwortete mit ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    csvText = ausZip(buf, 'preisalarme.csv');
    assert.ok(csvText !== null,
      'preisalarme.csv liegt NICHT im Archiv. Marcos Vorgabe war „in allen bestehenden ' +
      'Exporten" — und das ZIP ist der Export der Bestandsdaten.');
    for (const n of ['sets.csv', 'teile.csv', 'minifiguren.csv', 'merkliste.csv']) {
      assert.ok(ausZip(buf, n) !== null, `${n} ist aus dem Archiv verschwunden`);
    }
  });

  await t.test('2. auch der Alarm auf einem NICHT besessenen Set steht drin', () => {
    const zeilen = csvZeilen(csvText);
    assert.equal(zeilen.length, ALARME.length,
      `${zeilen.length} Zeilen statt ${ALARME.length}`);
    for (const a of ALARME) {
      const z = zeilen.find(x => x.set_number === a.sn && x.condition === a.c);
      assert.ok(z, `(${a.sn}, ${a.c}) fehlt im Export`);
      assert.equal(z.richtung, a.r, `Richtung von (${a.sn}, ${a.c}) ist „${z.richtung}"`);
      assert.equal(Number(z.schwelle), a.s,
        `Schwelle von (${a.sn}, ${a.c}) kam als „${z.schwelle}" heraus, erwartet ${a.s}`);
      assert.equal(z.currency_code, a.w);
    }
    // Der Kern: Zwei der vier Alarme sitzen auf Sets ohne Bestandszeile. Als
    // Spalten an sets.csv wären sie stillschweigend herausgefallen — und genau
    // das ist der haeufige Fall (Schwelle auf ein Set, das man kaufen WILL).
    // Und NICHTS vom fremden Konto. Ohne diesen Fall waere ein Export ohne
    // `WHERE user_id` nicht zu bemerken.
    assert.ok(!zeilen.some(x => x.set_number === FREMDER_ALARM.sn),
      `Der Alarm des fremden Kontos (${FREMDER_ALARM.sn}) steht im eigenen Export. ` +
      'Ein Alarm gehoert genau EINEM Konto, weil er eine Mail an dessen Adresse ' +
      'ausloest — beim Wiedereinlesen landete er im eigenen Konto.');

    const ohneBestand = ALARME.filter(a => !a.besitzt);
    assert.equal(ohneBestand.length, 2, 'Vorbedingung: zwei Alarme ohne Bestandszeile');
    for (const a of ohneBestand) {
      assert.ok(zeilen.some(x => x.set_number === a.sn),
        `Der Alarm auf ${a.sn} fehlt — das Konto besitzt das Set nicht, und genau ` +
        'deshalb steht er in einer EIGENEN Datei und nicht als Spalte an sets.csv');
    }
  });

  await t.test('3. Laufzeitzustand steht NICHT in der Datei', () => {
    const kopf = csvText.replace(/^﻿/, '').split(/\r?\n/)[0];
    for (const spalte of ['ausgeloest', 'zuletzt_am', 'zuletzt_preis']) {
      assert.ok(!kopf.includes(spalte),
        `„${spalte}" steht im Export. Das ist Laufzeitzustand des Jobs, keine Angabe ` +
        'des Nutzers: Ein ausgeloest=true aus der Datei unterdrückte die erste Meldung ' +
        'nach dem Wiederherstellen, und ein alter zuletzt_preis stünde in der ' +
        'Übersicht als aktueller Stand.');
    }
  });

  await t.test('4. dieselbe Datei stellt die geleerte Tabelle wieder her', async () => {
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [HAUPT]);
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM price_alerts WHERE user_id=$1',
      [HAUPT])).c, 0, 'Vorbedingung: keine eigenen Alarme');

    const { status, body } = await hochladen(srv.base, csvText);
    assert.equal(status, 200, `Der Import antwortete mit ${status}: ${JSON.stringify(body)}`);
    assert.equal(body.added, ALARME.length, `${body.added} angelegt statt ${ALARME.length}`);
    assert.equal(body.errors, 0, `${body.errors} Fehler: ${JSON.stringify(body.results)}`);
    assert.equal(body.waehrung_hinweis, undefined,
      'Es kam ein Währungshinweis, obwohl Datei und Konto beide CHF tragen');

    for (const a of ALARME) {
      const z = await db.get(
        `SELECT richtung, schwelle, currency_code, ausgeloest FROM price_alerts
          WHERE user_id=$1 AND set_number=$2 AND condition=$3`, [HAUPT, a.sn, a.c]);
      assert.ok(z, `(${a.sn}, ${a.c}) kam nicht zurück`);
      assert.equal(z.richtung, a.r);
      assert.equal(Number(z.schwelle), a.s,
        `Schwelle von (${a.sn}, ${a.c}) ist ${z.schwelle}, erwartet ${a.s}`);
      assert.equal(z.currency_code, 'CHF');
      assert.equal(z.ausgeloest, false,
        'Der Merker steht auf true — ein frisch gesetzter Alarm hat noch nichts gemeldet');
    }
  });

  await t.test('5. eine Datei in fremder Währung: das KONTO gewinnt, und es wird gesagt', async () => {
    // Die Regel des Baums (PUT /sets/:setNumber/alert): Die Währung kommt aus
    // den Einstellungen, nicht aus der Anfrage. Eine Datei ist eine Anfrage.
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [HAUPT]);
    const { body } = await hochladen(srv.base, csvAusAlarmen('EUR'));

    assert.equal(body.added, ALARME.length, `${body.added} angelegt statt ${ALARME.length}`);
    const z = await db.get(
      `SELECT currency_code, schwelle FROM price_alerts
        WHERE user_id=$1 AND set_number=$2 AND condition='N'`, [HAUPT, '75192-1']);
    assert.equal(z.currency_code, 'CHF',
      `Die Währung wurde „${z.currency_code}" — aus der DATEI übernommen. Damit gibt es ` +
      'zwei Quellen für dieselbe Angabe, und beim nächsten Wechsel laufen sie ' +
      'auseinander (die Regel steht an PUT /sets/:setNumber/alert).');
    assert.equal(Number(z.schwelle), 600,
      'Die Schwelle wurde verändert — umgerechnet wird NICHT, dafür bräuchte es einen Kurs');

    // Und das Entscheidende: Es wird NICHT verschwiegen.
    assert.ok(body.waehrung_hinweis,
      'Kein Hinweis in der Antwort. Die Zahlen bedeuten jetzt etwas anderes als in der ' +
      'Datei („unter 600" in CHF statt in EUR) — stillschweigend die Zahl übernehmen UND ' +
      'die Währung wechseln ist die eine Sache, die hier niemand merken würde.');
    assert.match(String(body.waehrung_hinweis), /CHF/,
      `Der Hinweis nennt die Zielwährung nicht: „${body.waehrung_hinweis}"`);
    const markiert = (body.results || []).filter(x => x.waehrung_angepasst);
    assert.equal(markiert.length, ALARME.length,
      `${markiert.length} von ${ALARME.length} Zeilen sind als angepasst markiert`);
  });

  await t.test('6. eine unbrauchbare Zeile wird gezählt, nicht verschluckt', async () => {
    // ── Was dieser Fall WIRKLICH unterscheidet (beim Gegenprobieren gelernt)
    //
    // Erst stand hier: „setzeAlarm() bringt die Prüfung mit … geprüft wird,
    // dass die Route sie BENUTZT." Das war zu viel behauptet. Die Gegenprobe
    // „setzeAlarm durch ein rohes INSERT ersetzt" machte NICHTS rot, denn die
    // Tabelle hat eigene CHECK-Bedingungen (NACHGEMESSEN an der Test-DB):
    //
    //     price_alerts_richtung  CHECK (richtung IN ('unter','ueber'))
    //     price_alerts_schwelle  CHECK (schwelle > 0)
    //
    // Richtung und Schwelle fängt also auch die Datenbank. Zwei Dinge fängt
    // sie NICHT, und genau die stehen jetzt hier:
    //
    //   · den ZUSTAND — es gibt keine CHECK darauf, ein „X" ginge glatt durch
    //     und stünde als dritter Zustand in einer Tabelle, die zwei kennt;
    //   · das Zurücksetzen von `ausgeloest` beim Ändern, das setzeAlarm()
    //     ausdrücklich zusagt („Eine neue Schwelle ist eine neue Frage").
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [HAUPT]);
    const kaputt = 'set_number,condition,richtung,schwelle,currency_code\n'
      + '75192-1,N,seitwaerts,600,CHF\n'      // Richtung gibt es nicht
      + '10179-1,N,unter,0,CHF\n'             // Schwelle muss > 0 sein
      + '31203-1,X,unter,50,CHF\n'            // Zustand gibt es nicht — nur die Prüfung fängt das
      + '21309-1,U,ueber,24.9,CHF\n';         // die gute Zeile
    const { body } = await hochladen(srv.base, kaputt);
    assert.equal(body.errors, 3,
      `${body.errors} Fehler gemeldet statt 3: ${JSON.stringify(body.results)}`);
    assert.equal(body.added, 1, `${body.added} angelegt statt 1`);
    // Der Zustand „X" darf NICHT in der Tabelle stehen. Die Datenbank hätte
    // ihn genommen; nur pruefeEingabe() in utils/preisalarm.ts weist ihn ab.
    assert.equal((await db.get(
      `SELECT COUNT(*)::int c FROM price_alerts WHERE user_id=$1 AND condition NOT IN ('N','U')`,
      [HAUPT])).c, 0,
      'Ein Alarm mit einem anderen Zustand als N oder U ist in der Tabelle gelandet. ' +
      'Die Tabelle hat darauf KEINE CHECK — das fängt allein die Prüfung in ' +
      'utils/preisalarm.ts, und die bekommt man nur über setzeAlarm().');
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM price_alerts WHERE user_id=$1',
      [HAUPT])).c, 1, 'Eine unbrauchbare Zeile ist trotzdem in der Tabelle gelandet');
    // Und der fremde Alarm steht unberuehrt da — ein Import schreibt nur im
    // eigenen Konto.
    assert.equal((await db.get('SELECT COUNT(*)::int c FROM price_alerts WHERE user_id=$1',
      [FREMD])).c, 1, 'Der Import hat das fremde Konto angefasst');
    // Gegenrichtung: Die gute Zeile MUSS durchgehen. Ohne sie wäre die Regel
    // auch erfüllt, wenn der Import grundsätzlich alles abwiese.
    assert.ok(await db.get(
      `SELECT 1 FROM price_alerts WHERE set_number='21309-1' AND condition='U'`),
      'Auch die gültige Zeile wurde abgewiesen');
  });

  await t.test('6b. ein erneuter Import setzt den Merker zurück', async () => {
    // setzeAlarm() sagt zu: „Der Merker ausgeloest wird beim Ändern
    // ZURÜCKGESETZT: Eine neue Schwelle ist eine neue Frage, und die soll
    // beantwortet werden, auch wenn die alte schon einmal gemeldet hat."
    //
    // Die Tabelle setzt das nicht durch — ein rohes INSERT … ON CONFLICT DO
    // UPDATE ohne `ausgeloest = FALSE` liesse den Merker stehen, und der
    // wiederhergestellte Alarm meldete nie mehr. Deshalb hier und nicht im
    // Vertrauen auf die Datenbank.
    await db.run('DELETE FROM price_alerts WHERE user_id=$1', [HAUPT]);
    await db.run(`INSERT INTO price_alerts
                    (user_id,set_number,condition,richtung,schwelle,currency_code,ausgeloest)
                  VALUES ($1,'75192-1','N','unter',600,'CHF',TRUE)`, [HAUPT]);
    assert.equal((await db.get(
      `SELECT ausgeloest FROM price_alerts WHERE user_id=$1 AND set_number='75192-1'`,
      [HAUPT])).ausgeloest, true, 'Vorbedingung: der Merker steht');

    await hochladen(srv.base, csvAusAlarmen());
    assert.equal((await db.get(
      `SELECT ausgeloest FROM price_alerts WHERE user_id=$1 AND set_number='75192-1'
        AND condition='N'`, [HAUPT])).ausgeloest, false,
      'Der Merker steht noch auf true. Dann meldet der wiederhergestellte Alarm nie ' +
      'wieder — er gilt als schon beantwortet.');
  });

  await t.test('7. der Rebrickable-Export bleibt unberührt', async () => {
    // Festgehalten, damit die Entscheidung nicht später als Versäumnis
    // gelesen wird: Diese Datei geht an den Importer einer FREMDEN Firma und
    // trägt genau zwei Spalten. Eine dritte macht sie dort unbrauchbar.
    const r = await fetch(`${srv.base}/api/v1/sets/export/rebrickable`);
    assert.equal(r.status, 200, `Der Rebrickable-Export antwortete mit ${r.status}`);
    const kopf = (await r.text()).replace(/^﻿/, '').split(/\r?\n/)[0];
    assert.equal(kopf.replace(/"/g, ''), 'Set Number,Quantity',
      `Der Kopf lautet „${kopf}". Rebrickable liest „Set Number,Quantity" — eine ` +
      'zusätzliche Spalte (etwa eine Alarmschwelle) macht die Datei dort unbrauchbar.');
  });
});
