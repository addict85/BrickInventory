/**
 * Bilder werden im HINTERGRUND lokal abgelegt — die Anfrage rechnet nichts.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Herunterladen und Verkleinern abfangen — hier zählt, WANN sie aufgerufen
// werden, nicht was sie tun.
let geladen = 0, verkleinert = 0;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit einer früheren Runde liegt downloadSetImage in src/katalog/bilder/setImages.ts statt im
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
const { dbOderSkip } = require('./helpers/db');
const { leereWarteschlange } = require('./helpers/bildwarteschlange');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');

test('die Anfrage notiert, der Job legt ab', { concurrency: 1 }, async (t) => {
  if (!await dbOderSkip(t, _req, { migrieren: false })) return;
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await leereWarteschlange(db);

  const IQ = _req('src/katalog/bilder/bildbedarfLauf.js');
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
      // Seit einer früheren Runde wird GEPUFFERT: merkeGebraucht() schreibt nichts mehr
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
      // Die Stapelgrösse steht in der Quelle (: von 5 auf 20
      // erhöht, nachdem die CPU-Ursachen behoben waren). Der Test liest sie …
      const stapel = IQ.STAPEL;
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
  // Marcos Wunsch
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await leereWarteschlange(db);

  const NUTZER = `ka-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [NUTZER]);
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
    // „running" heisst jetzt: hat kürzlich etwas getan
    await db.run(`DELETE FROM laufzustand WHERE schluessel='imgqueue_last_run'`);
    await db.run(`DELETE FROM laufzustand WHERE schluessel='imgredl_status'`);
    await _req('src/auftraege/jobMonitor.js').imgDlReset().catch(() => {});
    _req('src/katalog/bilder/bildbedarfLauf.js').letzterLauf.zeit = null;
    const ohneLauf = await kachel();
    assert.equal(ohneLauf.status, 'idle',
      'Ohne Durchgang darf die Kachel keinen Betrieb melden');
    assert.match(ohneLauf.sub, /Job noch nicht gelaufen/,
      'Die Kachel verschweigt, dass der Job noch nicht gelaufen ist');

    // Und nach einem Durchgang meldet sie Betrieb. Gemeint ist der TAKT —
    // dort wird der Stand für die anderen Arbeitsprozesse abgelegt.
    await _req('src/katalog/bilder/bildbedarfLauf.js')._taktDurchgang();
    const nachLauf = await kachel();
    assert.equal(nachLauf.status, 'running',
      'Nach einem Durchgang muss die Kachel Betrieb melden');
    assert.ok(nachLauf.queueLastRun, 'Der Zeitpunkt des letzten Durchgangs fehlt');
    // Und der Balken darf nicht auf 100 % stehen, während noch etwas aussteht.
    assert.ok(voll.total >= 137, `total=${voll.total} enthält die Warteschlange nicht`);

    // Ein STEHENGEBLIEBENES „läuft" ist kein Betrieb
    await db.run(`DELETE FROM laufzustand WHERE schluessel='imgqueue_last_run'`);
    _req('src/katalog/bilder/bildbedarfLauf.js').letzterLauf.zeit = null;
    await _req('src/auftraege/jobMonitor.js').imgDlReset().catch(() => {});
    assert.notEqual((await kachel()).status, 'running',
      'Vorbedingung verletzt: Ohne Nachlauf darf hier kein Betrieb stehen');

    const redl = async (at) => db.run(
      `INSERT INTO laufzustand (schluessel, wert) VALUES ('imgredl_status',$1)
         ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert`,
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
    await db.run(`DELETE FROM laufzustand WHERE schluessel='imgredl_status'`);
  } finally {
    await db.run(`DELETE FROM image_wanted`).catch(() => {});
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
    await new Promise(r => srv.close(r));
    // Letzter Test mit Datenbank in dieser Datei.
    await db.pool.end().catch(() => {});
  }
});

test('der Job meldet auch reine Übersprünge', () => {
  // Marcos Befund
  const { meldung } = _req('src/katalog/bilder/bildbedarfLauf.js');
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
  const q = fs.readFileSync(path.join(ROOT, 'src/katalog/bilder/bildbedarfLauf.ts'), 'utf8');
  const i = q.indexOf('async function bildbedarfAbarbeiten');
  assert.ok(i > 0, 'Kein Takt');
  const fn = q.slice(i, q.indexOf('\n}\n', i)).replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(fn, /if \(e\.geholt/,
    'Gemeldet wird nur bei geladenen Bildern — ein Durchgang mit lauter ' +
    'Übersprüngen bleibt unsichtbar');
  assert.match(fn, /meldung\(e\)/,
    'Der Takt baut den Text selbst zusammen — dann laufen Meldung und Zähler ' +
    'auseinander, sobald ein Zähler dazukommt');
});

test('die Bild-Tabellen kommen aus einer MIGRATION, nicht aus initSchema', () => {
  // Marcos Befund
  const mig = fs.readFileSync(
    path.join(ROOT, 'db/migrations/0009-bild-tabellen.sql'), 'utf8');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS image_wanted/, 'image_wanted fehlt in der Migration');
  assert.match(mig, /CREATE TABLE IF NOT EXISTS image_misses/, 'image_misses fehlt in der Migration');

  // Und NICHT mehr anderswo — zwei Stellen, die dasselbe anlegen, laufen
  // irgendwann auseinander.
  for (const datei of ['db/database.ts', 'src/katalog/bilder/imageMisses.ts', 'src/katalog/bilder/bildbedarfLauf.ts']) {
    const src = fs.readFileSync(path.join(ROOT, datei), 'utf8')
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('--')).join('\n');
    assert.doesNotMatch(src, /CREATE TABLE IF NOT EXISTS image_(wanted|misses)/,
      `${datei} legt die Tabelle ebenfalls an — das gehört nur in die Migration`);
  }

  // Die init-Funktionen laufen NACH Schema und Migrationen (sonst fehlt die
  // Tabelle beim Laden des Bestands) und in jedem Arbeitsprozess: Sie stehen in
  // startup/datenbank.ts hinter initSchemaOnce(), das jeder Prozess aufruft.
  const vorbereitung = fs.readFileSync(path.join(ROOT, 'startup/datenbank.ts'), 'utf8');
  const schema = vorbereitung.indexOf('await db.initSchemaOnce()');
  assert.ok(schema > 0 && vorbereitung.indexOf('await initImageMisses()') > schema,
    'initImageMisses() läuft vor den Migrationen — dann fehlt die Tabelle noch');
});

test('der Puffer wird in JEDEM Arbeitsprozess weggeschrieben', () => {
  // Marcos Befund
  const q = fs.readFileSync(path.join(ROOT, 'src/katalog/bilder/bildbedarf.ts'), 'utf8');
  const init = q.slice(q.indexOf('export async function initImageQueue'),
                       q.indexOf('export async function loescheVerfallene'));
  assert.match(init, /setInterval\([\s\S]{0,80}schreibePuffer/,
    'Das Wegschreiben steht nicht in initImageQueue() — dann läuft es nur dort, ' +
    'wo start() aufgerufen wird, also nur im Primärprozess');

  // Und initImageQueue() muss tatsächlich überall laufen.
  const dbInit = fs.readFileSync(path.join(ROOT, 'startup/datenbank.ts'), 'utf8');
  // UMFORMULIERT in — aus demselben Grund wie zwoelf Zeilen
  // tiefer bei start(), nur hatte diese Nachbarzusicherung den Fehler behalten:
  // Sie verlangte die Schreibweise `jobs/imageQueue').initImageQueue()`, also
  // ausdruecklich ein require(). Als daraus ein Top-Level-Import wurde, wurde …
  assert.match(dbInit, /\binitImageQueue\(\)/,
    'initImageQueue() wird nicht beim Aufbau der Datenbank aufgerufen');

  // Abgearbeitet wird nur im Job-Prozess: test/web-und-jobs-db.test.js prüft das am echten Server.
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
  assert.match(px, /const setAusUrl = \(\) => setNummerAusBildAdresse\(/,
    'Die Setnummer wird nicht aus der Adresse gelesen');
  assert.equal(_req('routes/imgProxy.js').setNummerAusBildAdresse('https://cdn.rebrickable.com/media/sets/10294-1.jpg'),
    '10294-1', 'Die Setnummer wird nicht aus der Adresse gelesen');

});
