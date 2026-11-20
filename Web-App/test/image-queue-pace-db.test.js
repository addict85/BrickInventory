/**
 * @einzeln: Im parallelen Lauf brach zweimal der Test-Läufer selbst beim
 * Lesen der Ausgabe dieser Datei ab („Unable to deserialize cloned data“);
 * einzeln nie. Ursache in Node ungeklärt, deshalb nacheinander.
 *
 * Die Taktung des Bild-Hintergrundjobs — und wer sie von aussen sehen kann.
 *
 * ── Marcos Log ───────────────────────────────────────────────
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
 * Test, was der Job TUT, und liest den Kachelstand aus einem ZWEITEN PROCESS.
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

// Herunterladen und Verkleinern abfangen — hier zählt, WIE OFT und WANN sie
// gerufen werden, nicht was sie tun.
const loadTimes = [];
/**
 * Schalter für den abgefangenen Download.
 */
let loadFailsFail = false;

const { buildAndRequire, testData, testImageWorker } = require('./helpers/sources');
const _req = buildAndRequire();
testImageWorker(null, {
  setBildLaden: async (_u, sn) => {
    // Auch der Fehlschlag zählt als Anfrage: Der Roundtrip zum CDN hat
    // stattgefunden, und genau darum geht es beim Kontingent.
    loadTimes.push(Date.now());
    return loadFailsFail ? null : `/images/sets/${sn}.jpg`;
  },
  createPreview: async () => true,
});
const { keineDb } = require('./helpers/db');
const { emptyQueue } = require('./helpers/bildwarteschlange');
const { portOf } = require('./helpers/server');
const db = testData();
const IQ = _req('src/images/imageDemandRun.js');
const { SET_IMAGES_DIR } = _req('src/infra/appPaths.js');

/** Stapelgrösse und Deckel aus dem Modul — der Test wiederholt keine Zahl. */
const { STAPEL, DURCHGANG_MAX_NOTIZEN: DECKEL } = IQ;

const angelegt = [];
/** Bild UND Vorschau hinlegen — der Job hat für diese Notiz nichts zu tun. */
function finishedImage(sn) {
  for (const f of [`${sn}.jpg`, `${sn}_thumb.jpg`]) {
    const p = path.join(SET_IMAGES_DIR, f);
    fs.writeFileSync(p, 'x');
    angelegt.push(p);
  }
}
const offen = async p =>
  (await db.get(`SELECT COUNT(*)::int c FROM image_wanted WHERE set_number LIKE $1`, [p + '%'])).c;
/**
 * Notizen einreihen — mit AUFSTEIGENDEM `requested_at`.
 *
 * Der Stapel holt `ORDER BY requested_at ASC`. Trägt ein einziges INSERT für
 * alle Zeilen dasselbe NOW() ein, ist die Reihenfolge beliebig — und ein Test,
 * der auf Stapelgrenzen zielt, misst dann Zufall.
 */
const einreihen = async (praefix, von, bis) => {
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                  SELECT 'https://cdn/'||$1||'_'||g||'.jpg', $1||'_'||g,
                         NOW() - (($3::int - g) || ' seconds')::interval
                    FROM generate_series($2::int, $3::int) g`,
    [praefix, von, bis],
  );
};

test('ein Takt räumt fertige Notizen ab, statt je zwanzig Sekunden zehn', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await emptyQueue(db);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  const P = `FE${process.pid}`;
  const COUNT = STAPEL * 4;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= COUNT; i++) finishedImage(`${P}_${i}`);
  await einreihen(P, 1, COUNT);

  try {
    loadTimes.length = 0;
    const t0 = Date.now();
    const e = await IQ._tickPass();
    const duration = Date.now() - t0;

    assert.equal(
      await offen(P),
      0,
      `Nach einem Takt liegen noch ${await offen(P)} von ${COUNT} Notizen. ` +
        'Genau das war Marcos Lage: Der Job arbeitete ab, aber mit ' +
        `${STAPEL} je zwanzig Sekunden — für 1113 fertige Bilder gut 37 Minuten.`,
    );
    assert.equal(e.uebersprungen, COUNT, 'Nicht alle wurden als „vorhanden" gezählt');
    assert.equal(e.work, 0, 'Für ein Bild samt Vorschau darf kein Arbeitsschritt anfallen');
    assert.equal(loadTimes.length, 0, 'Es wurde beim CDN angefragt, obwohl alles dalag');
    // Ohne echte Arbeit darf auch keine Höflichkeitspause anfallen: Sie schützt
    // das CDN, und das wurde hier nicht angefasst.
    assert.ok(
      duration < 2000,
      `Der Takt brauchte ${duration} ms für reine Übersprünge — dann greift die ` +
        'Pause noch immer an der falschen Stelle',
    );
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('das Kontingent gilt für echte Arbeit, nicht für Notizen', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await emptyQueue(db);

  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });
  const P = `KO${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  // ── Bewusst über STAPELGRENZEN hinweg ────────────────────────────────────
  //
  // Jeder dritte Eintrag muss geladen werden, der Rest liegt fertig da. Die
  // zehn Anfragen verteilen sich damit über mehrere Stapel — nur so misst der
  // Abstandstest unten überhaupt eine Stapelgrenze. Lägen alle zehn im ersten
  // Stapel, bliebe der alte, zu enge Zuschnitt der Pause unentdeckt.
  const COUNT = STAPEL * 4;
  const zuLaden = new Set();
  for (let i = 1; i <= COUNT; i++) {
    if (i % 3 === 0) zuLaden.add(i);
    else finishedImage(`${P}_${i}`);
  }
  assert.ok(zuLaden.size > STAPEL, 'Vorbedingung: mehr zu laden als das Kontingent');
  await einreihen(P, 1, COUNT);

  try {
    loadTimes.length = 0;
    const e = await IQ._tickPass();

    await t.test('höchstens STAPEL Anfragen je Takt', async () => {
      assert.equal(
        loadTimes.length,
        STAPEL,
        `${loadTimes.length} CDN-Anfragen in einem Takt — erlaubt sind ${STAPEL}. ` +
          'Die Rate am CDN ist Marcos Vorgabe und darf sich durch das Nachholen ' +
          'von Stapeln NICHT erhöhen.',
      );
      assert.equal(e.work, STAPEL);
      assert.ok((await offen(P)) > 0, 'Der Rest muss liegenbleiben');
      // Vorbedingung für den Abstandstest: Die zehn Anfragen lagen wirklich in
      // mehr als einem Stapel.
      assert.ok(
        e.gesamt > STAPEL,
        `alle ${e.work} Anfragen lagen in einem einzigen Stapel — dann prüft ` +
          'der Abstandstest unten die Stapelgrenze gar nicht',
      );
    });

    await t.test('zwischen zwei Anfragen liegt eine halbe Sekunde', () => {
      const abst = loadTimes.slice(1).map((z, i) => z - loadTimes[i]);
      const smallest = Math.min(...abst);
      assert.ok(
        smallest >= 500,
        `kleinster Abstand ${smallest} ms. Die Pause hing vorher an einem Zähler ` +
          'INNERHALB eines Stapels — sobald ein Takt mehrere Stapel nachholt, ' +
          'liefen sonst zwei Anfragen unmittelbar hintereinander.',
      );
    });
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('Übersprünge verbrauchen kein Kontingent — Marcos gemischte Warteschlange', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await emptyQueue(db);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  // Der Normalfall nach dem Knopf „Katalogbilder holen": ein paar fehlende
  // Bilder, verstreut zwischen hunderten, die längst dalagen.
  const P = `MX${process.pid}`;
  const DONE = STAPEL * 5,
    ZU_LADEN = 3;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= DONE; i++) finishedImage(`${P}_${i}`);
  await einreihen(P, 1, DONE + ZU_LADEN);

  try {
    loadTimes.length = 0;
    const e = await IQ._tickPass();
    assert.equal(
      await offen(P),
      0,
      'Ein Takt muss die ganze Strecke abräumen — die drei fehlenden Bilder ' +
        'liegen unter dem Kontingent, die fertigen kosten nichts',
    );
    assert.equal(e.geholt, ZU_LADEN);
    assert.equal(e.uebersprungen, DONE);
    assert.equal(loadTimes.length, ZU_LADEN, 'Es wurde mehr geladen als nötig');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('ein Takt sieht höchstens DURCHGANG_MAX_NOTIZEN Notizen durch', { concurrency: 1 }, async t => {
  // Der Deckel ist nötig, weil `existsSync` synchron ist: Ohne ihn liefe eine
  // Warteschlange aus 25 000 fertigen Bildern in einem Zug durch und hielte
  // den Event-Loop des Arbeitsprozesses in Schüben auf.
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await emptyQueue(db);
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  const P = `DK${process.pid}`;
  const COUNT = DECKEL + STAPEL * 2;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  for (let i = 1; i <= COUNT; i++) finishedImage(`${P}_${i}`);
  await einreihen(P, 1, COUNT);

  try {
    const e = await IQ._tickPass();
    assert.equal(e.gesamt, DECKEL, `${e.gesamt} Notizen in einem Takt — der Deckel liegt bei ${DECKEL}`);
    assert.equal(await offen(P), COUNT - DECKEL, 'Der Rest muss auf den nächsten Takt warten');
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('verfallene Notizen werden wirklich gelöscht', { concurrency: 1 }, async t => {
  // Was der Kommentar behauptete und der Code nicht tat
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await emptyQueue(db);

  const P = `VF${process.pid}`;
  await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                VALUES ($1, $2, NOW() - INTERVAL '30 days')`,
    [`https://cdn/${P}_alt.jpg`, `${P}_alt`],
  );
  await db.run(
    `INSERT INTO image_wanted (url, set_number, requested_at)
                VALUES ($1, $2, NOW())`,
    [`https://cdn/${P}_neu.jpg`, `${P}_neu`],
  );

  try {
    // Vorbedingung: Der Stapel fasst die alte Notiz gar nicht erst an — genau
    // deshalb blieb sie liegen.
    const e = await IQ._tickPass();
    assert.equal(e.gesamt, 1, 'Die alte Notiz darf nicht abgearbeitet werden');
    assert.equal(await offen(P), 1, 'Nur die alte Notiz sollte noch liegen');

    const weg = await IQ._deleteExpired();
    assert.ok(weg >= 1, 'Es wurde keine verfallene Notiz gelöscht');
    assert.equal(
      await offen(P),
      0,
      'Die verfallene Notiz liegt weiterhin da — sie zählt dann für immer in ' +
        'der Kachel mit, ohne je bearbeitet zu werden',
    );
  } finally {
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
  }
});

test('ein ANDERER Prozess sieht, dass der Job gelaufen ist', { concurrency: 1 }, async t => {
  // ── Warum als eigener Prozess (Lehre aus einer früheren Runde) ────────────────────
  // Ein Test, der im selben Prozess prüft, kann diesen Fehler nicht sehen: Der
  // Merker liegt ja genau dort. Die Kachel wird aber von einem BELIEBIGEN der
  // vier Arbeitsprozesse beantwortet, und keiner davon führt den Job aus.
  // Deshalb läuft der Job hier im Kindprozess und gefragt wird im Elternteil.
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await emptyQueue(db);

  await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`);
  const vorher = await db.get(`SELECT value FROM run_state WHERE key='imgqueue_last_run'`);
  assert.equal(vorher, undefined, 'Vorbedingung: noch kein Laufstand abgelegt');

  // Der Kindprozess kennt NICHTS aus diesem hier — er baut nicht, sondern nutzt
  // das bereits erzeugte dist/ und legt nur einen Takt hin.
  // Das Kind setzt die Adresse NICHT selbst, es erbt sie über die Umgebung.
  execFileSync(
    process.execPath,
    [
      '-e',
      `
    const V = require(${JSON.stringify(path.join(ROOT, 'dist', 'startup', 'wiring.js'))});
    const { dbKonfigFromEnvironment, createDb } = require(${JSON.stringify(path.join(ROOT, 'dist', 'db', 'database.js'))});
    const db = createDb(dbKonfigFromEnvironment(), { firstStart: async () => {} });
    const contexts = {};
    V.buildServices(db, { contexts });
    const IQ = require(${JSON.stringify(path.join(ROOT, 'dist', 'src/images/imageDemandRun.js'))});
    (async () => {
      await db.initSchemaOnce();
      await IQ._tickPass(contexts.images);
      await db.pool.end();
    })().catch(e => { console.error(e); process.exit(1); });
  `,
    ],
    { env: process.env, stdio: 'pipe' },
  );

  const zeile = await db.get(`SELECT value FROM run_state WHERE key='imgqueue_last_run'`);
  assert.ok(
    zeile?.value,
    'Der Durchgang eines anderen Prozesses ist hier nicht sichtbar. Dann meldet ' +
      'die Kachel „Job noch nicht gelaufen", während im Log Durchgänge stehen — ' +
      'genau Marcos Befund.',
  );
  const stand = JSON.parse(zeile.value);
  assert.ok(Date.now() - stand.zeit < 60_000, 'Der abgelegte Zeitpunkt ist nicht plausibel');

  // Und jetzt bis zur KACHEL
  const IQhier = _req('src/images/imageDemandRun.js');
  IQhier.letzterLauf.zeit = null;
  IQhier.letzterLauf.ergebnis = null;

  const NUTZER = `pace-${process.pid}`;
  await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]);
  await db.run(`INSERT INTO users (username,password_hash,is_admin) VALUES ($1,'x',true)`, [NUTZER]);
  const uid = (await db.get(`SELECT id FROM users WHERE username=$1`, [NUTZER])).id;
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    /** @type {any} */ (req).session = { userId: uid, isAdmin: 1 };
    /** @type {any} */ (req).apiUser = { user_id: uid, is_admin: 1 };
    next();
  });
  app.use('/api/v1', require('./helpers/sources').routerFrom(_req, 'routes/api_v1/index.js'));
  const srv = app.listen(0);
  try {
    const kachel = (await (await fetch(`http://localhost:${portOf(srv)}/api/v1/admin/jobs`)).json()).jobs?.imgDl;
    assert.ok(
      kachel?.queueLastRun,
      'Die Kachel kennt den Durchgang des anderen Prozesses nicht. Genau so kam ' +
        'Marcos „Job noch nicht gelaufen" zustande: Der Merker lag im ' +
        'Arbeitsspeicher des Prozesses, der den Job ausführt — die Anfrage ' +
        'beantwortet aber irgendeiner der vier.',
    );
  } finally {
    await new Promise(r => srv.close(r));
    await db.run(`DELETE FROM users WHERE username=$1`, [NUTZER]).catch(() => {});
  }

  await db.run(`DELETE FROM run_state WHERE key='imgqueue_last_run'`).catch(() => {});
});

test('jeder Ausgang der Schleife hat einen Zähler', { concurrency: 1 }, async t => {
  try {
    await db.initSchemaOnce();
  } catch (e) {
    keineDb(t, e);
    return;
  }
  // Die Warteschlange gehoert VOR dem Benutzen geleert, nicht nur das eigene
  // Praefix — sonst nimmt der Stapel die Zeilen eines Vorgaengers. Begruendung
  // und Nachstellung in helpers/bildwarteschlange.js.
  await emptyQueue(db);
  const IM = _req('src/images/imageMisses.js');
  fs.mkdirSync(SET_IMAGES_DIR, { recursive: true });

  await t.test('Notiz ohne Setnummer', async () => {
    const P = `ON${process.pid}`;
    await db.run(`DELETE FROM image_wanted WHERE url LIKE $1`, [`%${P}%`]);
    await db.run(`INSERT INTO image_wanted (url, set_number) VALUES ($1, NULL)`, [`https://cdn/${P}.jpg`]);
    const e = await IQ._workStack();
    assert.equal(
      e.ohneNummer,
      1,
      'Eine Notiz ohne Setnummer verschwindet spurlos — sie zählte als ' + '„bearbeitet", ohne irgendwo aufzutauchen',
    );
    assert.equal(e.geholt + e.vorschau + e.uebersprungen, 0);
    await db.run(`DELETE FROM image_wanted WHERE url LIKE $1`, [`%${P}%`]).catch(() => {});
  });

  await t.test('gescheiterter Download', async () => {
    // Der abgefangene Download liefert für diesen Teilschritt null — genau ihr
    // Verhalten bei HTTP 404, Netzwerkfehler oder zu kleiner Antwort.
    const P = `FD${process.pid}`;
    loadFailsFail = true;
    try {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
      await einreihen(P, 1, 2);
      const e = await IQ._workStack();
      assert.equal(e.notLoaded, 2, 'Marcos Fall: zwei Notizen, kein Bild, und kein Zähler nannte den Grund');
      assert.equal(e.gesamt, 2);
      assert.match(
        IQ.meldung(e),
        /2 Download fehlgeschlagen/,
        'Die Meldung nennt den Fehlschlag nicht — dann steht dort dreimal null ' + 'und die Frage bleibt offen',
      );
    } finally {
      loadFailsFail = false;
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    }
  });

  await t.test('bekannt fehlendes Bild kostet weder Kontingent noch Wartezeit', async () => {
    // rememberMissing('set:…') wurde geschrieben, aber im Job nie gelesen: Eine
    // Notiz, die über den Proxy erneut entsteht, löste bei jedem Durchgang
    // wieder einen Roundtrip zu einem Bild aus, das der CDN nachweislich nicht
    // hat — und verbrauchte dafür einen Platz im Kontingent.
    const P = `BF${process.pid}`;
    await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']);
    await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']);
    const COUNT = STAPEL;
    for (let i = 1; i <= COUNT; i++) IM.rememberMissing(`set:${P}_${i}`);
    await IM._writeBuffer();
    await einreihen(P, 1, COUNT);
    try {
      loadTimes.length = 0;
      const t0 = Date.now();
      const e = await IQ._tickPass();
      const duration = Date.now() - t0;
      assert.equal(e.knownMissing, COUNT, 'Der Merker wird im Job nicht gelesen');
      assert.equal(
        loadTimes.length,
        0,
        `${loadTimes.length} CDN-Anfragen für Bilder, von denen feststeht, dass ` + 'es sie nicht gibt',
      );
      assert.equal(
        e.work,
        0,
        'Ein bekannt fehlendes Bild verbraucht einen Platz im Kontingent — ' +
          'dann bremsen ausgerechnet die aussichtslosen Notizen die aussichtsreichen',
      );
      assert.ok(
        duration < 2000,
        `${duration} ms für ${COUNT} bekannt fehlende Bilder — die Höflichkeitspause ` +
          'schützt den CDN, und der wurde hier gar nicht angefasst',
      );
    } finally {
      await db.run(`DELETE FROM image_wanted WHERE set_number LIKE $1`, [P + '%']).catch(() => {});
      await db.run(`DELETE FROM image_misses WHERE cache_key LIKE $1`, ['set:' + P + '%']).catch(() => {});
    }
  });
});

test('aufräumen', { concurrency: 1 }, async () => {
  for (const f of angelegt) fs.rmSync(f, { force: true });
  // Letzter Test dieser Datei — nur hier wird der Pool geschlossen. (Lehre aus
  // Ein früher geschlossener Pool macht jeden folgenden DB-Test
  // rot, und die Meldung nennt den Grund nicht.)
  await db.pool.end().catch(() => {});
});
