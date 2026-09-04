/**
 * Bilder werden im HINTERGRUND lokal abgelegt — die Anfrage rechnet nichts.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Ich fänd es sinnvoll, wenn die Bilder lokal gecached werden inkl. Thumbs.
 * Bitte aber die Bilder im Hintergrund mit dem Bilder-Download-Job
 * herunterladen und das Thumb erstellen, sobald sie einmal via Proxy geladen
 * wurden. Das sollte das gleiche Prinzip wie bei den anderen Reitern sein."
 *
 * ── Was vorher an der Anfrage hing ──────────────────────────────────────────
 * Der Proxy holte das Bild UND stiess sofort die Verkleinerung an. Bei den
 * eigenen Sets fiel das nicht auf — ein paar hundert Bilder, einmalig. Im
 * Katalog mit 25 000 fremden Sets wurde daraus eine Rechenlawine, die lange
 * nach dem Scrollen weiterlief (Marcos Messung: 329 % CPU).
 *
 * In Nachtrag 101 hatte ich die Verkleinerung im Katalog ganz abgeschaltet.
 * Das war zu grob: Wer ein Set zweimal ansieht, soll beim zweiten Mal das
 * kleine Bild bekommen.
 *
 * ── Die Aufteilung, die hier geprüft wird ───────────────────────────────────
 *   • Die Anfrage liefert sofort aus und hinterlässt nur eine NOTIZ.
 *   • Der Job arbeitet die Notizen gestapelt ab: Original ablegen, verkleinern,
 *     Notiz entfernen.
 *
 * Die Notizen stehen in der DATENBANK, nicht im Arbeitsspeicher. Sie überleben
 * den Neustart, und alle Arbeitsprozesse schreiben in dieselbe — die Lehre aus
 * den Nachträgen 98 bis 100, wo Grenzen je Prozess galten und deshalb nicht
 * wirkten.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

// Herunterladen und Verkleinern abfangen — hier zählt, WANN sie aufgerufen
// werden, nicht was sie tun.
let geladen = 0, verkleinert = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit Nachtrag 125 liegt downloadSetImage in utils/setImages.ts statt im
  // Router — der Abfang muss dorthin zeigen, sonst greift er ins Leere und
  // der Test misst still den echten Download.
  if (typeof name === 'string' && /setImages(\.js)?$/.test(name) && m && m.downloadSetImage) {
    return new Proxy(m, { get: (t, k) => k === 'downloadSetImage'
      ? (async () => { geladen++; return '/images/sets/test.jpg'; }) : t[k] });
  }
  if (typeof name === 'string' && /thumbs(\.js)?$/.test(name) && m && m.generateThumb) {
    return new Proxy(m, { get: (t, k) => k === 'generateThumb'
      ? (async () => { verkleinert++; return true; }) : t[k] });
  }
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const express = require(path.join(ROOT, 'node_modules', 'express'));

test('die Anfrage notiert, der Job legt ab', { concurrency: 1 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const IQ = _req('jobs/imageQueue.js');
  await IQ.initImageQueue();
  const PRAEFIX = `TQ${process.pid}`;
  const weg = async () =>
    db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [PRAEFIX + '%']).catch(() => {});
  await weg();

  try {
    await t.test('doppelte Notizen zählen einmal', async () => {
      // Beim Scrollen kommt dasselbe Bild mehrfach vorbei. Ohne Entdopplung
      // stünde es mehrfach in der Warteschlange und würde mehrfach geholt.
      for (let i = 1; i <= 25; i++)
        IQ.merkeGebraucht(`https://cdn.rebrickable.com/media/sets/${PRAEFIX}_${i}.jpg`, `${PRAEFIX}_${i}`);
      IQ.merkeGebraucht(`https://cdn.rebrickable.com/media/sets/${PRAEFIX}_1.jpg`, `${PRAEFIX}_1`);
      // Seit Nachtrag 103 wird GEPUFFERT: merkeGebraucht() schreibt nichts mehr
      // selbst — ein INSERT je Bildanfrage leerte den Verbindungspool. Das
      // Wegschreiben läuft im Takt; hier von Hand angestossen.
      await IQ._schreibePuffer();
      const n = (await db.get(
        `SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [PRAEFIX + '%'])).c;
      assert.equal(n, 25, `${n} Notizen statt 25`);
    });

    await t.test('der Job arbeitet gestapelt, nicht alles auf einmal', async () => {
      // Der Sinn der Sache: Auf schwacher Hardware darf nicht der ganze
      // Rückstau in einem Rutsch gerechnet werden.
      // Die Stapelgrösse steht in der Quelle (Nachtrag 108: von 5 auf 20
      // erhöht, nachdem die CPU-Ursachen behoben waren). Der Test liest sie
      // dort, statt eine Zahl zu wiederholen, die sich ändern darf — die REGEL
      // ist „nicht alles auf einmal", nicht „genau fünf".
      const stapel = parseInt(
        (fs.readFileSync(path.join(ROOT, 'jobs', 'imageQueue.ts'), 'utf8')
          .match(/const STAPEL = (\d+)/) || [])[1] || '0');
      assert.ok(stapel > 0, 'STAPEL nicht auffindbar');
      const vorher = geladen;
      const n1 = (await IQ._arbeiteStapel()).gesamt;
      assert.ok(n1 > 0 && n1 <= stapel,
        `${n1} Bilder in einem Durchgang bei STAPEL=${stapel} — die Begrenzung greift nicht`);
      assert.ok(n1 < 25, 'Der ganze Rückstau wurde in einem Rutsch gerechnet');
      assert.equal(geladen - vorher, n1, 'es wurden mehr Bilder geholt als abgearbeitet');
      assert.equal(verkleinert, geladen, 'zu jedem geholten Bild gehört eine Vorschau');
    });

    await t.test('am Ende bleibt keine Notiz liegen', async () => {
      for (let i = 0; i < 5; i++) await IQ._arbeiteStapel();
      const n = (await db.get(
        `SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [PRAEFIX + '%'])).c;
      assert.equal(n, 0, `${n} Notizen übrig`);
    });
  } finally {
    await weg();
    // Den Pool NICHT hier schliessen: Der Kachel-Test weiter unten braucht ihn
    // noch. Er schliesst als letzter DB-Test.
    Module.prototype.require = echtesRequire;
  }
});

test('die Kachel „Bild-Download (CDN)" zeigt die Katalog-Warteschlange',
  { concurrency: 1 }, async (t) => {
  // ── Marcos Wunsch (Nachtrag 108) ──────────────────────────────────────────
  // „Ich fände es sprechend, wenn diese in der Kachel ‚Bild-Download (CDN)'
  // enthalten sind, da der Titel nichts von meinen Sets aussagt."
  //
  // Er hat recht: Die Kachel zählte ausschliesslich Bilder des eigenen
  // BESTANDES und meldete „Alle 62 170 Bilder gecacht", während der
  // Hintergrund-Job gerade hunderte Katalogbilder nachlud. Der Titel verspricht
  // aber alles, was vom CDN kommt.
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const NUTZER = `ka-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',1)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;

  const { base, srv } = testServer(_req, {
    sitzung: { userId: uid, isAdmin: 1 },
    apiNutzer: { user_id: uid, is_admin: 1 },
    routen: { '/api/v1': 'routes/api_v1/index.js' },
    t,
  });
  const kachel = async () => (await (await fetch(`${base}/api/v1/admin/jobs`)).json()).jobs?.imgDl;

  try {
    await db.run(`DELETE FROM image_wanted`);
    const leer = await kachel();
    assert.ok(leer, 'Die Kachel fehlt in der Antwort');
    assert.equal(leer.queue, 0);
    assert.doesNotMatch(leer.sub, /Katalog/,
      'Ohne Warteschlange soll die Kachel nicht von Katalogbildern reden');

    await db.run(`INSERT INTO image_wanted (url,set_number)
                  SELECT 'https://x/'||g||'.jpg', 'KA'||g FROM generate_series(1,137) g`);
    const voll = await kachel();
    assert.equal(voll.queue, 137, 'Die Warteschlange wird nicht gezählt');
    assert.match(voll.sub, /137 Katalog-Bilder in Warteschlange/,
      'Die Zahl steht nicht im Text der Kachel');
    // „Bestand" muss danebenstehen — sonst weiss man nicht, worauf sich die
    // ANDERE Zahl bezieht.
    assert.match(voll.sub, /Bestand:/,
      'Ohne diese Beschriftung sind die beiden Zahlen nicht auseinanderzuhalten');
    // ── „running" heisst jetzt: hat kürzlich etwas getan (Nachtrag 120) ────
    //
    // Vorher genügte eine nicht leere Warteschlange. Das war keine Aussage über
    // TÄTIGKEIT — eine steckengebliebene Warteschlange sah genauso aus wie eine,
    // die abgearbeitet wird. Genau daran ist Marco hängengeblieben: Kachel und
    // Fortschrittsbalken meldeten Betrieb, im Log stand nichts.
    //
    // Ohne einen Durchgang steht sie deshalb auf „idle" UND nennt den Grund.
    //
    // Zurücksetzen: Ein früherer Teilschritt dieser Datei hat den Job schon
    // laufen lassen. Der Stand liegt seit Nachtrag 121 in `global_settings`
    // und nicht mehr nur im Modulspeicher — dort muss er also weg. (Vorher
    // genügte hier `letzterLauf.zeit = null`; genau das hat mitverdeckt, dass
    // die Kachel eine PROZESSLOKALE Zahl las. Den Nachweis, dass ein anderer
    // Prozess den Stand sieht, führt image-queue-pace-db.test.js.)
    // ── Die Kachel hat DREI Eingaenge, dieser Test beherrschte einen ──────
    //
    // In routes/api_v1/admin.ts steht
    //
    //     status: (imgRunning || reDlRunning || (katalogOffen > 0 && jobLaeuft))
    //
    // Zurueckgesetzt wurde hier nur das dritte Glied. Die anderen beiden
    // liegen ebenfalls in der DATENBANK und ueberdauern damit die Grenze
    // zwischen zwei Testdateien — jede laeuft zwar im eigenen Prozess, aber
    // alle auf derselben Datenbank.
    //
    // Aufgefallen im ALLERERSTEN CI-Lauf dieses Repositories: dort rot, hier
    // gruen. Nachgestellt und bewiesen — ein hinterlassenes
    // imgredl_status={running:true} macht genau diese Zeile rot
    // („'running' !== 'idle'"), und ohne den Schluessel ist sie wieder gruen.
    //
    // Der eigentliche Fehler lag daneben und ist behoben: Der Leser beachtete
    // das Alter des Standes nicht, und der Schreiber wartete sein eigenes
    // Schreiben nicht ab. Diese Zeilen hier stellen sicher, dass der Test
    // MISST, was er behauptet, statt auf einen aufgeraeumten Nachbarn zu
    // hoffen.
    await db.run(`DELETE FROM global_settings WHERE key='imgqueue_last_run'`);
    await db.run(`DELETE FROM global_settings WHERE key='imgredl_status'`);
    await _req('utils/jobMonitor.js').imgDlReset().catch(() => {});
    _req('jobs/imageQueue.js').letzterLauf.zeit = null;
    const ohneLauf = await kachel();
    assert.equal(ohneLauf.status, 'idle',
      'Ohne Durchgang darf die Kachel keinen Betrieb melden');
    assert.match(ohneLauf.sub, /Job noch nicht gelaufen/,
      'Die Kachel verschweigt, dass der Job noch nicht gelaufen ist');

    // Und nach einem Durchgang meldet sie Betrieb. Gemeint ist der TAKT —
    // dort wird der Stand für die anderen Arbeitsprozesse abgelegt.
    await _req('jobs/imageQueue.js')._taktDurchgang();
    const nachLauf = await kachel();
    assert.equal(nachLauf.status, 'running',
      'Nach einem Durchgang muss die Kachel Betrieb melden');
    assert.ok(nachLauf.queueLastRun, 'Der Zeitpunkt des letzten Durchgangs fehlt');
    // Und der Balken darf nicht auf 100 % stehen, während noch etwas aussteht.
    assert.ok(voll.total >= 137, `total=${voll.total} enthält die Warteschlange nicht`);

    // ── Ein STEHENGEBLIEBENES „läuft" ist kein Betrieb ────────────────────
    //
    // Der Bilder-Nachlauf (redownloadMissingImages) legt seinen Fortschritt in
    // `imgredl_status` ab und setzt ihn am Ende auf `running: false`. Wird der
    // Prozess mittendrin beendet — Neustart, Auslieferung, Container gestoppt
    // —, kommt er dazu nie mehr. Hier stand `reDl?.running === true`, also der
    // Wert ohne sein Alter: Die Kachel meldete dann für immer Betrieb.
    //
    // Genau dieselbe Regel steht zwölf Zeilen daneben für den Katalog-Job,
    // begründet mit Marcos Befund „scheint zu laufen, aber im Log steht
    // nichts". Sie stand nur an einer der beiden Stellen.
    //
    // Gemessen wird der UNTERSCHIED: zwei Stände, die sich ausschliesslich im
    // Zeitstempel unterscheiden, müssen verschieden ausfallen. Ein Test, der
    // nur den alten Stand prüft, bliebe auch dann grün, wenn die Kachel gar
    // keinen Betrieb mehr melden könnte.
    // Die anderen beiden Eingaenge zuerst stilllegen — sonst misst dieser
    // Abschnitt sie statt des Nachlaufs. (Erster Anlauf tat genau das: Der
    // Durchgang von eben liess `jobLaeuft` wahr sein, und die Kachel stand
    // auch mit zehn Minuten altem Nachlauf auf „running". Dieselbe
    // Fehlerklasse wie der Fehler, um den es hier geht.)
    await db.run(`DELETE FROM global_settings WHERE key='imgqueue_last_run'`);
    _req('jobs/imageQueue.js').letzterLauf.zeit = null;
    await _req('utils/jobMonitor.js').imgDlReset().catch(() => {});
    assert.notEqual((await kachel()).status, 'running',
      'Vorbedingung verletzt: Ohne Nachlauf darf hier kein Betrieb stehen');

    const redl = async (at) => db.run(
      `INSERT INTO global_settings (key,value) VALUES ('imgredl_status',$1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ running: true, phase: 'scanning', at })]);

    await redl(Date.now());
    const frisch = await kachel();
    assert.equal(frisch.status, 'running',
      'Ein FRISCHER Nachlauf muss weiterhin als Betrieb gelten');

    await redl(Date.now() - 10 * 60_000);
    const alt = await kachel();
    assert.notEqual(alt.status, 'running',
      'Ein zehn Minuten alter Stand gilt noch als Betrieb — dann bleibt die ' +
      'Kachel nach einem abgebrochenen Lauf für immer auf „läuft" stehen.');
    await db.run(`DELETE FROM global_settings WHERE key='imgredl_status'`);
  } finally {
    await db.run(`DELETE FROM image_wanted`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    // Letzter Test mit Datenbank in dieser Datei.
    await db.pool.end().catch(() => {});
  }
});

test('der Job meldet auch reine Übersprünge', () => {
  // ── Marcos Befund (Nachtrag 120) ──────────────────────────────────────────
  // „Der Bild-CDN-Job scheint zu laufen laut Monitoring und Fortschrittsbalken,
  // aber im Log sind keine Einträge dazu zu finden."
  //
  // Das Schweigen war eingebaut: Der Takt meldete nur, wenn etwas GELADEN
  // wurde. Ein Durchgang, der zehn Notizen abarbeitet und alle überspringt —
  // weil Bild und Vorschau längst liegen —, sagte nichts. Von aussen sah das
  // aus wie ein hängender Job, obwohl die Warteschlange schrumpfte.
  //
  // Ausgerechnet wenn er am schnellsten arbeitet, schwieg er am lautesten.
  //
  // UMFORMULIERT in Nachtrag 122: Die Prüfung hing am WORTLAUT der Takt-Funktion
  // (`if (e.gesamt)` und der Name `uebersprungen` im Meldungstext). Als die
  // Meldung in die Funktion meldung() wanderte, wurde sie rot, ohne dass sich
  // ihre Aussage geändert hätte — dieselbe Sorte Test, die in Nachtrag 118 eine
  // Sicherheitslücke festgeschrieben hat. Geprüft wird jetzt, was der Text SAGT.
  const { meldung } = _req('jobs/imageQueue.js');
  const nurUebersprungen = {
    geholt: 0, vorschau: 0, uebersprungen: 10, gesamt: 10,
    nichtGeladen: 0, keineVorschau: 0, bekanntFehlend: 0, ohneNummer: 0,
    zurueckgelegt: 0, arbeit: 0,
  };
  const text = meldung(nurUebersprungen);
  assert.match(text, /10 bearbeitet/,
    'Ein Durchgang mit lauter Übersprüngen nennt seine Zahl nicht');
  assert.match(text, /10 bereits vorhanden/,
    'Die Meldung nennt die Übersprünge nicht — dann weiss man nicht, ob der ' +
    'Job arbeitet oder nur leerläuft');

  // Und der Takt darf sie nicht verschweigen: Die Bedingung vor der Ausgabe
  // darf an keiner Zahl hängen, die bei reinen Übersprüngen null ist.
  const q = fs.readFileSync(path.join(ROOT, 'jobs', 'imageQueue.ts'), 'utf8');
  const i = q.indexOf('const takt = async');
  assert.ok(i > 0, 'Kein Takt');
  const fn = q.slice(i, q.indexOf('\n  };', i)).replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(fn, /if \(e\.geholt/,
    'Gemeldet wird nur bei geladenen Bildern — ein Durchgang mit lauter ' +
    'Übersprüngen bleibt unsichtbar');
  assert.match(fn, /meldung\(e\)/,
    'Der Takt baut den Text selbst zusammen — dann laufen Meldung und Zähler ' +
    'auseinander, sobald ein Zähler dazukommt');
});

test('die Bild-Tabellen kommen aus einer MIGRATION, nicht aus initSchema', () => {
  // ── Marcos Befund (Nachtrag 107) ──────────────────────────────────────────
  //     relation "image_wanted" does not exist
  // auf einem Server, der die aktuelle App-Version fährt.
  //
  // Ich hatte die Tabellen am Ende von initSchema() angelegt. Die läuft aber
  // nur, wenn sich die APP-Version geändert hat (schema_meta), und der Aufruf
  // stand hinter einem `.catch(...)`, das Fehler nur protokolliert. Schlug er
  // beim ersten Start einer Version fehl, wurde die Version trotzdem als
  // „angewandt" vermerkt — und danach nie wieder versucht. Ein einziger
  // stiller Fehlschlag schaltete den Bild-Job dauerhaft ab.
  //
  // Nummerierte Migrationen laufen IMMER und werden EINZELN vermerkt. Genau
  // dafür gibt es sie; ich hatte den vorgesehenen Weg nicht benutzt.
  const mig = fs.readFileSync(
    path.join(ROOT, 'db', 'migrations', '0009-bild-tabellen.sql'), 'utf8');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS image_wanted/, 'image_wanted fehlt in der Migration');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS image_misses/, 'image_misses fehlt in der Migration');

  // Und NICHT mehr anderswo — zwei Stellen, die dasselbe anlegen, laufen
  // irgendwann auseinander.
  for (const datei of ['db/database.ts', 'utils/imageMisses.ts', 'jobs/imageQueue.ts']) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(src, /CREATE TABLE IF NOT EXISTS image_(wanted|misses)/,
      `${datei} legt die Tabelle ebenfalls an — das gehört nur in die Migration`);
  }

  // Die init-Funktionen müssen NACH den Migrationen laufen (sonst gibt es die
  // Tabelle beim Laden des Bestands noch nicht) …
  const dbSrc = fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8');
  const nachMigration = dbSrc.indexOf('const applied = await runMigrations(client)');
  // Gesucht wird der AUFRUF, nicht seine Schreibweise (Nachtrag 155).
  //
  // Vorher stand hier die Zeichenkette
  // "require('../utils/imageMisses').initImageMisses()" woertlich. Als der
  // require() durch einen Top-Level-Import ersetzt wurde — weil ein rohes
  // require() `any` liefert und damit jeden Zugriff darauf ungeprueft laesst —,
  // fand indexOf() nichts mehr und lieferte -1. Der Test wurde rot, obwohl die
  // gepruefte Zusage („der Aufruf steht NACH den Migrationen") unveraendert
  // galt: Er stand vorher wie nachher an derselben Stelle im Ablauf.
  //
  // Beide Schreibweisen zaehlen jetzt, denn beide sind derselbe Aufruf.
  const initAufruf = Math.max(
    dbSrc.indexOf("require('../utils/imageMisses').initImageMisses()"),
    dbSrc.indexOf('await initImageMisses()'),
  );
  assert.ok(nachMigration > 0 && initAufruf > nachMigration,
    'initImageMisses() läuft vor den Migrationen — dann fehlt die Tabelle noch');
  // … und ausserhalb von initSchema(), damit sie JEDEN Arbeitsprozess erreichen.
  const initSchemaStart = dbSrc.indexOf('async function initSchema()');
  const initSchemaEnde = dbSrc.indexOf('async function initSchemaOnce()');
  assert.ok(initAufruf < initSchemaStart || initAufruf > initSchemaEnde,
    'Der Aufruf steht in initSchema() — die läuft nur bei einer Versionsänderung ' +
    'und nur in EINEM Arbeitsprozess');
});

test('der Puffer wird in JEDEM Arbeitsprozess weggeschrieben', () => {
  // ── Marcos Befund (Nachtrag 106) ──────────────────────────────────────────
  // „Ich habe das Gefühl, die Bilder aus dem Katalog werden nicht
  // heruntergeladen im Hintergrund. Es sind immer gleich viele Bilder im Ordner
  // images/sets."
  //
  // Er hatte recht. Der Puffer liegt im ARBEITSSPEICHER eines Prozesses, das
  // Wegschreiben hing aber an start() — und start() läuft nur auf dem
  // Primärprozess. Bildanfragen verteilen sich über alle vier: Drei Viertel
  // aller Notizen wurden nie geschrieben, und was der Primär notierte, nur
  // wenn er die Anfrage zufällig selbst bediente.
  //
  // Derselbe Geltungsbereichs-Fehler wie in den Nachträgen 98 bis 100 und 105,
  // diesmal in meinem eigenen Fix: Etwas Prozess-Lokales an etwas
  // Prozess-Globales gehängt.
  //
  // initImageQueue() läuft in JEDEM Prozess (aufgerufen aus db/database.ts) —
  // dort gehört der Takt hin.
  const q = fs.readFileSync(path.join(ROOT, 'jobs', 'imageQueue.ts'), 'utf8');
  const init = q.slice(q.indexOf('export async function initImageQueue'),
                       q.indexOf('export function merkeGebraucht'));
  assert.match(init, /setInterval\([\s\S]{0,80}schreibePuffer/,
    'Das Wegschreiben steht nicht in initImageQueue() — dann läuft es nur dort, ' +
    'wo start() aufgerufen wird, also nur im Primärprozess');

  // Und initImageQueue() muss tatsächlich überall laufen.
  const dbInit = fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8');
  // UMFORMULIERT in Nachtrag 155 — aus demselben Grund wie zwoelf Zeilen
  // tiefer bei start(), nur hatte diese Nachbarzusicherung den Fehler behalten:
  // Sie verlangte die Schreibweise `jobs/imageQueue').initImageQueue()`, also
  // ausdruecklich ein require(). Als daraus ein Top-Level-Import wurde, wurde
  // sie rot — obwohl der Aufruf an derselben Stelle steht und dieselbe Wirkung
  // hat. Gemeint ist: initImageQueue() wird beim Aufbau der Datenbank
  // aufgerufen. Das prueft jetzt der Aufruf selbst, gleich welcher Herkunft.
  assert.match(dbInit, /\binitImageQueue\(\)/,
    'initImageQueue() wird nicht beim Aufbau der Datenbank aufgerufen');

  // Das ABARBEITEN dagegen gehört auf den Primärprozess — sonst rechnen
  // wieder alle vier.
  // UMFORMULIERT in Nachtrag 139: Geprüft wurde der WORTLAUT
  //     require('./jobs/imageQueue').start()
  // Beim Umstellen auf echte Importe wurde daraus `starteJobBilder()`, und die
  // Prüfung wurde rot, ohne dass sich ihre Aussage geändert hätte.
  //
  // Dass der Job überhaupt anläuft, prüft jetzt test/background-jobs-start.js
  // zur LAUFZEIT — belastbarer als jede Suche im Quelltext. Hier bleibt die
  // Aussage, die dort nicht messbar ist: Er läuft nur im Primärprozess.
  const start = require('./helpers/sources').startQuelle();
  const i = start.indexOf('starteJobBilder()');
  assert.ok(i > 0, 'Der Bilder-Job wird nirgends angestossen');
  const davor = start.slice(0, i);
  assert.ok(davor.lastIndexOf('if (!isPrimaryWorker) return') > davor.lastIndexOf('app.listen'),
    'Das Abarbeiten steht nicht im Primärprozess-Block');
});

test('die Anfrage rechnet nichts mehr, sie notiert nur', () => {
  // Geprüft am Quelltext, weil es um die REIHENFOLGE geht: Der Proxy darf im
  // gen=0-Fall keine Verkleinerung anstossen, sondern muss die Notiz
  // hinterlassen. Ein Test über die Route würde beides nicht unterscheiden —
  // ausgeliefert wird so oder so sofort.
  const px = require('./helpers/sources').proxyThumbQuelle();
  assert.match(px, /const notiere = \(\) => \{/, 'Der Proxy hinterlässt keine Notiz');
  assert.match(px, /if \(darfErzeugen\) queueThumb\(cacheFile, thumbFile\); else notiere\(\);/,
    'Im gen=0-Fall wird weiter sofort verkleinert statt notiert');
  // Und die Notiz braucht die Setnummer — ohne sie weiss der Job nicht, wohin.
  assert.match(px, /media\\\/sets\\\/\(\[\^\/\?#\]\+\?\)/,
    'Die Setnummer wird nicht aus der Adresse gelesen');

  // Der Job läuft nur auf dem Primärprozess — sonst rechnen wieder alle vier.
  // Siehe oben (Nachtrag 139): echter Import statt spätem require().
  const srv = require('./helpers/sources').startQuelle();
  const i = srv.indexOf('starteJobBilder()');
  assert.ok(i > 0, 'Der Bilder-Job wird nirgends angestossen');
  const davor = srv.slice(0, i);
  assert.ok(davor.lastIndexOf('if (!isPrimaryWorker) return') > davor.lastIndexOf('app.listen'),
    'Der Job steht nicht im Primärprozess-Block — dann läuft er in jedem ' +
    'Arbeitsprozess, und die Drosselung ist wirkungslos');
});
