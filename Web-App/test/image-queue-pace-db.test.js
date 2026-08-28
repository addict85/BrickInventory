/**
 * Die Taktung des Bild-Hintergrundjobs — und wer sie von aussen sehen kann.
 *
 * ── Marcos Log (Nachtrag 121) ───────────────────────────────────────────────
 *     [image-queue] 10 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 10 bereits vorhanden
 * fünfmal hintereinander, bei 1113 Notizen in der Warteschlange, und in der
 * Kachel daneben „Job noch nicht gelaufen".
 *
 * Zwei Fehler in einem Bild:
 *
 *   1. Das Kontingent von dreissig Anfragen je Minute (Marcos Vorgabe gegen
 *      eine Sperre durch das CDN) wurde auf NOTIZEN angewandt statt auf CDN-
 *      Anfragen. Eine Notiz, für die Bild und Vorschau längst dalagen, kostete
 *      damit dasselbe wie ein Download — 1113 fertige Bilder brauchten so 37
 *      Minuten reines Warten.
 *
 *   2. Der Stand des letzten Durchgangs lag im Arbeitsspeicher des Prozesses,
 *      der den Job ausführt. Die Kachel wird aber von irgendeinem der vier
 *      Arbeitsprozesse beantwortet — in drei von vier Fällen also von einem,
 *      der nichts davon weiss.
 *
 * Beides sind Verhaltensfragen, keine Quelltextfragen. Deshalb misst dieser
 * Test, was der Job TUT, und liest den Kachelstand aus einem ZWEITEN PROZESS.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.WEB_WORKERS = '1';

// Herunterladen und Verkleinern abfangen — hier zählt, WIE OFT und WANN sie
// gerufen werden, nicht was sie tun.
const ladeZeiten = [];
/**
 * Schalter für den abgefangenen Download.
 *
 * EIGENE FALLE (Nachtrag 122): Der erste Anlauf stellte `downloadSetImage` im
 * Teilschritt per Object.defineProperty auf null um. Wirkungslos — der
 * require-Abfang oben in dieser Datei liefert für diesen Namen IMMER seinen
 * eigenen Ersatz und überschreibt den Patch stillschweigend. (Dieselbe Klasse
 * wie die esbuild-Getter aus Nachtrag 143: Ein Monkeypatch, dessen WIRKUNG man
 * nicht beobachtet, ist keine Prüfung.) Der Ersatz trägt den Schalter deshalb
 * selbst.
 */
let ladenSchlaegtFehl = false;
const echtesRequire = Module.prototype.require;
Module.prototype.require = function (name) {
  const m = echtesRequire.apply(this, arguments);
  // Seit Nachtrag 125 liegt downloadSetImage in utils/setImages.ts statt im
  // Router — der Abfang muss dorthin zeigen, sonst greift er ins Leere und
  // der Test misst still den echten Download.
  if (typeof name === 'string' && /setImages(\.js)?$/.test(name) && m && m.downloadSetImage) {
    return new Proxy(m, { get: (t, k) => k === 'downloadSetImage'
      ? (async (_u, sn) => {
          // Auch der Fehlschlag zählt als Anfrage: Der Roundtrip zum CDN hat
          // stattgefunden, und genau darum geht es beim Kontingent.
          ladeZeiten.push(Date.now());
          return ladenSchlaegtFehl ? null : `/images/sets/${sn}.jpg`;
        }) : t[k] });
  }
  if (typeof name === 'string' && /thumbs(\.js)?$/.test(name) && m && m.generateThumb) {
    return new Proxy(m, { get: (t, k) => k === 'generateThumb'
      ? (async () => true) : t[k] });
  }
  return m;
};

const _req = require('./helpers/sources').buildAndRequire();
const db = _req('db/database.js');
const IQ = _req('jobs/imageQueue.js');
const { SET_IMAGES_DIR } = _req('utils/appPaths.js');

/** Stapelgrösse und Deckel aus der Quelle lesen — der Test wiederholt keine Zahl. */
const src = fs.readFileSync(path.join(ROOT, 'jobs', 'imageQueue.ts'), 'utf8');
const STAPEL = parseInt((src.match(/const STAPEL = (\d+)/) || [])[1], 10);
const DECKEL = parseInt(
  (src.match(/const DURCHGANG_MAX_NOTIZEN = ([\d_]+)/) || [])[1].replace(/_/g, ''), 10);

const angelegt = [];
/** Bild UND Vorschau hinlegen — der Job hat für diese Notiz nichts zu tun. */
function fertigesBild(sn) {
  for (const f of [`${sn}.jpg`, `${sn}_thumb.jpg`]) {
    const p = path.join(SET_IMAGES_DIR, f);
    fs.writeFileSync(p, 'x'); angelegt.push(p);
  }
}
const offen = async (p) => (await db.get(
  `SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [p + '%'])).c;
/**
 * Notizen einreihen — mit AUFSTEIGENDEM `requested_at`.
 *
 * Der Stapel holt `ORDER BY requested_at ASC`. Trägt ein einziges INSERT für
 * alle Zeilen dasselbe NOW() ein, ist die Reihenfolge beliebig — und ein Test,
 * der auf Stapelgrenzen zielt, misst dann Zufall.
 */
const einreihen = async (praefix, von, bis) => {
  await db.run(`INSERT INTO image_wanted (url, set_number, requested_at)
                  SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g,
                         NOW() - (($3::int - g) || ' seconds')::interval
                    FROM generate_series($2::int, $3::int) g`, [praefix, von, bis]);
};

test('ein Takt räumt fertige Notizen ab, statt je zwanzig Sekunden zehn',
  { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  const P = `FE${process.pid}`;
  const ANZAHL = STAPEL * 4;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= ANZAHL; i++) fertigesBild(`${P}_${i}`);
  await einreihen(P, 1, ANZAHL);

  try {
    ladeZeiten.length = 0;
    const t0 = Date.now();
    const e = await IQ._taktDurchgang();
    const dauer = Date.now() - t0;

    assert.equal(await offen(P), 0,
      `Nach einem Takt liegen noch ${await offen(P)} von ${ANZAHL} Notizen. ` +
      'Genau das war Marcos Lage: Der Job arbeitete ab, aber mit ' +
      `${STAPEL} je zwanzig Sekunden — für 1113 fertige Bilder gut 37 Minuten.`);
    assert.equal(e.uebersprungen, ANZAHL, 'Nicht alle wurden als „vorhanden" gezählt');
    assert.equal(e.arbeit, 0,
      'Für ein Bild samt Vorschau darf kein Arbeitsschritt anfallen');
    assert.equal(ladeZeiten.length, 0, 'Es wurde beim CDN angefragt, obwohl alles dalag');
    // Ohne echte Arbeit darf auch keine Höflichkeitspause anfallen: Sie schützt
    // das CDN, und das wurde hier nicht angefasst.
    assert.ok(dauer < 2000,
      `Der Takt brauchte ${dauer} ms für reine Übersprünge — dann greift die ` +
      'Pause noch immer an der falschen Stelle');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('das Kontingent gilt für echte Arbeit, nicht für Notizen',
  { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `KO${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  // ── Bewusst über STAPELGRENZEN hinweg ────────────────────────────────────
  //
  // Jeder dritte Eintrag muss geladen werden, der Rest liegt fertig da. Die
  // zehn Anfragen verteilen sich damit über mehrere Stapel — nur so misst der
  // Abstandstest unten überhaupt eine Stapelgrenze. Lägen alle zehn im ersten
  // Stapel, bliebe der alte, zu enge Zuschnitt der Pause unentdeckt.
  const ANZAHL = STAPEL * 4;
  const zuLaden = new Set();
  for (let i = 1; i <= ANZAHL; i++) {
    if (i % 3 === 0) zuLaden.add(i); else fertigesBild(`${P}_${i}`);
  }
  assert.ok(zuLaden.size > STAPEL, 'Vorbedingung: mehr zu laden als das Kontingent');
  await einreihen(P, 1, ANZAHL);

  try {
    ladeZeiten.length = 0;
    const e = await IQ._taktDurchgang();

    await t.test('höchstens STAPEL Anfragen je Takt', async () => {
      assert.equal(ladeZeiten.length, STAPEL,
        `${ladeZeiten.length} CDN-Anfragen in einem Takt — erlaubt sind ${STAPEL}. ` +
        'Die Rate am CDN ist Marcos Vorgabe und darf sich durch das Nachholen ' +
        'von Stapeln NICHT erhöhen.');
      assert.equal(e.arbeit, STAPEL);
      assert.ok(await offen(P) > 0, 'Der Rest muss liegenbleiben');
      // Vorbedingung für den Abstandstest: Die zehn Anfragen lagen wirklich in
      // mehr als einem Stapel.
      assert.ok(e.gesamt > STAPEL,
        `alle ${e.arbeit} Anfragen lagen in einem einzigen Stapel — dann prüft ` +
        'der Abstandstest unten die Stapelgrenze gar nicht');
    });

    await t.test('zwischen zwei Anfragen liegt eine halbe Sekunde', () => {
      const abst = ladeZeiten.slice(1).map((z, i) => z - ladeZeiten[i]);
      const kleinster = Math.min(...abst);
      assert.ok(kleinster >= 500,
        `kleinster Abstand ${kleinster} ms. Die Pause hing vorher an einem Zähler ` +
        'INNERHALB eines Stapels — sobald ein Takt mehrere Stapel nachholt, ' +
        'liefen sonst zwei Anfragen unmittelbar hintereinander.');
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('Übersprünge verbrauchen kein Kontingent — Marcos gemischte Warteschlange',
  { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  // Der Normalfall nach dem Knopf „Katalogbilder holen": ein paar fehlende
  // Bilder, verstreut zwischen hunderten, die längst dalagen.
  const P = `MX${process.pid}`;
  const FERTIG = STAPEL * 5, ZU_LADEN = 3;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= FERTIG; i++) fertigesBild(`${P}_${i}`);
  await einreihen(P, 1, FERTIG + ZU_LADEN);

  try {
    ladeZeiten.length = 0;
    const e = await IQ._taktDurchgang();
    assert.equal(await offen(P), 0,
      'Ein Takt muss die ganze Strecke abräumen — die drei fehlenden Bilder ' +
      'liegen unter dem Kontingent, die fertigen kosten nichts');
    assert.equal(e.geholt, ZU_LADEN);
    assert.equal(e.uebersprungen, FERTIG);
    assert.equal(ladeZeiten.length, ZU_LADEN, 'Es wurde mehr geladen als nötig');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('ein Takt sieht höchstens DURCHGANG_MAX_NOTIZEN Notizen durch',
  { concurrency: 1 }, async (t) => {
  // Der Deckel ist nötig, weil `existsSync` synchron ist: Ohne ihn liefe eine
  // Warteschlange aus 25 000 fertigen Bildern in einem Zug durch und hielte
  // den Event-Loop des Arbeitsprozesses in Schüben auf.
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  const P = `DK${process.pid}`;
  const ANZAHL = DECKEL + STAPEL * 2;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= ANZAHL; i++) fertigesBild(`${P}_${i}`);
  await einreihen(P, 1, ANZAHL);

  try {
    const e = await IQ._taktDurchgang();
    assert.equal(e.gesamt, DECKEL,
      `${e.gesamt} Notizen in einem Takt — der Deckel liegt bei ${DECKEL}`);
    assert.equal(await offen(P), ANZAHL - DECKEL, 'Der Rest muss auf den nächsten Takt warten');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('verfallene Notizen werden wirklich gelöscht', { concurrency: 1 }, async (t) => {
  // ── Was der Kommentar behauptete und der Code nicht tat ───────────────────
  // Bei NOTIZ_GILT_MS stand „Ältere Notizen als diese verfallen". Die Abfrage
  // des Stapels grenzte aber nur ein, was sie AUSWÄHLT — gelöscht wurde nie
  // etwas. Alte Notizen blieben also für immer liegen, zählten weiter in der
  // Kachel und liessen den Job verstummen, weil die Logzeile an `gesamt > 0`
  // hängt. Von aussen: eine Warteschlange, die bei einer Zahl stehenbleibt.
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  const P = `VF${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(`INSERT INTO image_wanted (url, set_number, requested_at)
                VALUES ($1, $2, NOW() - INTERVAL '30 days')`,
               [`https://cdn/${P}_alt.jpg`, `${P}_alt`]);
  await db.run(`INSERT INTO image_wanted (url, set_number, requested_at)
                VALUES ($1, $2, NOW())`, [`https://cdn/${P}_neu.jpg`, `${P}_neu`]);

  try {
    // Vorbedingung: Der Stapel fasst die alte Notiz gar nicht erst an — genau
    // deshalb blieb sie liegen.
    const e = await IQ._taktDurchgang();
    assert.equal(e.gesamt, 1, 'Die alte Notiz darf nicht abgearbeitet werden');
    assert.equal(await offen(P), 1, 'Nur die alte Notiz sollte noch liegen');

    const weg = await IQ._loescheVerfallene();
    assert.ok(weg >= 1, 'Es wurde keine verfallene Notiz gelöscht');
    assert.equal(await offen(P), 0,
      'Die verfallene Notiz liegt weiterhin da — sie zählt dann für immer in ' +
      'der Kachel mit, ohne je bearbeitet zu werden');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('ein ANDERER Prozess sieht, dass der Job gelaufen ist', { concurrency: 1 }, async (t) => {
  // ── Warum als eigener Prozess (Lehre aus Nachtrag 126) ────────────────────
  // Ein Test, der im selben Prozess prüft, kann diesen Fehler nicht sehen: Der
  // Merker liegt ja genau dort. Die Kachel wird aber von einem BELIEBIGEN der
  // vier Arbeitsprozesse beantwortet, und keiner davon führt den Job aus.
  // Deshalb läuft der Job hier im Kindprozess und gefragt wird im Elternteil.
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }

  await db.run(`DELETE FROM global_settings WHERE key='imgqueue_last_run'`);
  const vorher = await db.get(
    `SELECT value FROM global_settings WHERE key='imgqueue_last_run'`);
  assert.equal(vorher, undefined, 'Vorbedingung: noch kein Laufstand abgelegt');

  // Der Kindprozess kennt NICHTS aus diesem hier — er baut nicht, sondern nutzt
  // das bereits erzeugte dist/ und legt nur einen Takt hin.
  execFileSync(process.execPath, ['-e', `
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const db = require(${JSON.stringify(path.join(ROOT, 'dist', 'db', 'database.js'))});
    const IQ = require(${JSON.stringify(path.join(ROOT, 'dist', 'jobs', 'imageQueue.js'))});
    (async () => {
      await db.initSchemaOnce();
      await IQ._taktDurchgang();
      await db.pool.end();
    })().catch(e => { console.error(e); process.exit(1); });
  `], { env: process.env, stdio: 'pipe' });

  const zeile = await db.get(
    `SELECT value FROM global_settings WHERE key='imgqueue_last_run'`);
  assert.ok(zeile?.value,
    'Der Durchgang eines anderen Prozesses ist hier nicht sichtbar. Dann meldet ' +
    'die Kachel „Job noch nicht gelaufen", während im Log Durchgänge stehen — ' +
    'genau Marcos Befund.');
  const stand = JSON.parse(zeile.value);
  assert.ok(Date.now() - stand.zeit < 60_000, 'Der abgelegte Zeitpunkt ist nicht plausibel');

  // ── Und jetzt bis zur KACHEL ──────────────────────────────────────────────
  //
  // Die Zeile in der Datenbank allein sagt nichts: Läse die Route weiterhin den
  // Modulspeicher, bliebe alles beim Alten. Gefragt wird deshalb der Endpunkt,
  // den die Überwachung fragt — in diesem Prozess, der den Job NIE ausgeführt
  // hat.
  // Der Modulspeicher DIESES Prozesses wird geleert: Frühere Prüfungen dieser
  // Datei haben den Job hier laufen lassen, ein Worker, der nur Anfragen
  // bedient, hätte den Merker aber nie gefüllt. Genau dieser Zustand ist der
  // Normalfall — in drei von vier Prozessen.
  const IQhier = _req('jobs/imageQueue.js');
  IQhier.letzterLauf.zeit = null;
  IQhier.letzterLauf.ergebnis = null;

  const NUTZER = `pace-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',1)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: uid, isAdmin: 1 };
    req.apiUser = { user_id: uid, is_admin: 1 };
    next();
  });
  app.use('/api/v1', _req('routes/api_v1/index.js'));
  const srv = app.listen(0);
  try {
    const kachel = (await (await fetch(
      `http://localhost:${srv.address().port}/api/v1/admin/jobs`)).json()).jobs?.imgDl;
    assert.ok(kachel?.queueLastRun,
      'Die Kachel kennt den Durchgang des anderen Prozesses nicht. Genau so kam ' +
      'Marcos „Job noch nicht gelaufen" zustande: Der Merker lag im ' +
      'Arbeitsspeicher des Prozesses, der den Job ausführt — die Anfrage ' +
      'beantwortet aber irgendeiner der vier.');
  } finally {
    await new Promise(r => srv.close(r));
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
  }

  await db.run(`DELETE FROM global_settings WHERE key='imgqueue_last_run'`).catch(() => {});
});


// ── Nachtrag 122 ────────────────────────────────────────────────────────────
// Marcos Log: „2 bearbeitet: 0 geladen, 0 Vorschau erzeugt, 0 bereits
// vorhanden" — zweimal, und seine Frage: „Wieso werden die 2 Bilder nicht
// geladen?" Die Zahlen gingen nicht auf, weil VIER Wege durch die Schleife
// endeten, ohne einen der drei Zähler zu erhöhen. Die Meldung konnte die vier
// nicht unterscheiden.

test('jeder Ausgang der Schleife hat einen Zähler', { concurrency: 1 }, async (t) => {
  try { await db.initSchemaOnce(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1') throw e;
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const IM = _req('utils/imageMisses.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  await t.test('Notiz ohne Setnummer', async () => {
    const P = `ON${process.pid}`;
    await db.run(`DELETE FROM image_wanted WHERE url LIKE $1`, [`%${P}%`]);
    await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1, NULL)`,
                 [`https://cdn/${P}.jpg`]);
    const e = await IQ._arbeiteStapel();
    assert.equal(e.ohneNummer, 1,
      'Eine Notiz ohne Setnummer verschwindet spurlos — sie zählte als ' +
      '„bearbeitet", ohne irgendwo aufzutauchen');
    assert.equal(e.geholt + e.vorschau + e.uebersprungen, 0);
    await db.run(`DELETE FROM image_wanted WHERE url LIKE $1`, [`%${P}%`]).catch(() => {});
  });

  await t.test('gescheiterter Download', async () => {
    // Der abgefangene Download liefert für diesen Teilschritt null — genau ihr
    // Verhalten bei HTTP 404, Netzwerkfehler oder zu kleiner Antwort.
    const P = `FD${process.pid}`;
    ladenSchlaegtFehl = true;
    try {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
      await einreihen(P, 1, 2);
      const e = await IQ._arbeiteStapel();
      assert.equal(e.nichtGeladen, 2,
        'Marcos Fall: zwei Notizen, kein Bild, und kein Zähler nannte den Grund');
      assert.equal(e.gesamt, 2);
      assert.match(IQ.meldung(e), /2 Download fehlgeschlagen/,
        'Die Meldung nennt den Fehlschlag nicht — dann steht dort dreimal null ' +
        'und die Frage bleibt offen');
    } finally {
      ladenSchlaegtFehl = false;
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    }
  });

  await t.test('bekannt fehlendes Bild kostet weder Kontingent noch Wartezeit', async () => {
    // merkeFehlend('set:…') wurde geschrieben, aber im Job nie gelesen: Eine
    // Notiz, die über den Proxy erneut entsteht, löste bei jedem Durchgang
    // wieder einen Roundtrip zu einem Bild aus, das der CDN nachweislich nicht
    // hat — und verbrauchte dafür einen Platz im Kontingent.
    const P = `BF${process.pid}`;
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
    const ANZAHL = STAPEL;
    for (let i = 1; i <= ANZAHL; i++) IM.merkeFehlend(`set:${P}_${i}`);
    await IM._schreibePuffer();
    await einreihen(P, 1, ANZAHL);
    try {
      ladeZeiten.length = 0;
      const t0 = Date.now();
      const e = await IQ._taktDurchgang();
      const dauer = Date.now() - t0;
      assert.equal(e.bekanntFehlend, ANZAHL, 'Der Merker wird im Job nicht gelesen');
      assert.equal(ladeZeiten.length, 0,
        `${ladeZeiten.length} CDN-Anfragen für Bilder, von denen feststeht, dass ` +
        'es sie nicht gibt');
      assert.equal(e.arbeit, 0,
        'Ein bekannt fehlendes Bild verbraucht einen Platz im Kontingent — ' +
        'dann bremsen ausgerechnet die aussichtslosen Notizen die aussichtsreichen');
      assert.ok(dauer < 2000,
        `${dauer} ms für ${ANZAHL} bekannt fehlende Bilder — die Höflichkeitspause ` +
        'schützt den CDN, und der wurde hier gar nicht angefasst');
    } finally {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    }
  });
});

test('aufräumen', { concurrency: 1 }, async () => {
  for (const f of angelegt) fs.rmSync(f, { force: true });
  Module.prototype.require = echtesRequire;
  // Letzter Test dieser Datei — nur hier wird der Pool geschlossen. (Lehre aus
  // Nachtrag 116: Ein früher geschlossener Pool macht jeden folgenden DB-Test
  // rot, und die Meldung nennt den Grund nicht.)
  await db.pool.end().catch(() => {});
});
