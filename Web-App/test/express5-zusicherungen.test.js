/**
 * Zwei Zusicherungen, die der Umstieg auf Express 5 lautlos gekostet haette.
 *
 * ── Gegenproben (durchgefuehrt, Ergebnis im Commit) ─────────────────────────
 *   a) Muster auf '/*splat' zurueckgedreht → Schritt 1 rot, nennt den 404
 *   b) die Zusicherung aus server.ts entfernt → Schritt 2 rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { serverAll, ohneKommentare } = require('./helpers/sources');

test('1. die Startseite ist auch ohne Pfad erreichbar', async () => {
  const src = serverAll();

  // Den Catch-all an seiner AUFGABE finden, nicht an seinem Muster: Es ist
  // die app.get-Registrierung, die renderIndexHtml() ausliefert. Haenge die
  // Suche am Muster, muesste sie bei jeder Umbenennung mitgepflegt werden —
  // und dann prueft sie irgendwann die Schreibweise statt der Sache. …
  const kandidaten = [];
  for (const m of src.matchAll(/^\s*app\.get\('([^']+)'/gm)) {
    if (/renderIndexHtml|sendeStartseite/.test(src.slice(m.index, m.index + 800))) kandidaten.push(m[1]);
  }
  assert.ok(kandidaten.length, 'Keine Route rendert mehr index.html — Suche veraltet?');
  const muster = kandidaten.find(k => k.includes('*'));
  assert.ok(muster,
    `Keine der rendernden Routen (${kandidaten.join(', ')}) fängt noch alles ab. ` +
    'Dann gibt es keinen SPA-Catch-all mehr.');

  // Dasselbe Muster auf einem leeren Express: Was die echte Route ausliefert,
  // ist hier egal — gefragt ist allein, OB sie trifft.
  const app = express();
  app.get(muster, (_req, res) => res.status(200).send('ok'));
  const srv = app.listen(0);
  await new Promise(r => srv.once('listening', r));
  const basis = `http://localhost:${srv.address().port}`;
  try {
    const wurzel = await fetch(`${basis}/`);
    assert.equal(wurzel.status, 200,
      `Das Muster ${muster} trifft die nackte Wurzel nicht (${wurzel.status}). ` +
      'Damit laeuft jeder Aufruf der Seite ohne Pfad — Lesezeichen, ' +
      'Startbildschirm, erster Besuch — ins Leere.');
    // Und die Pfade darunter weiterhin; sonst koennte man die Regel mit
    // einem Muster beruhigen, das NUR die Wurzel trifft.
    for (const pfad of ['/start', '/tief/drin', '/reset-password']) {
      assert.equal((await fetch(basis + pfad)).status, 200,
        `Das Muster ${muster} trifft ${pfad} nicht mehr`);
    }
  } finally {
    await new Promise(r => srv.close(r));
  }
});

test('2. req.body ist immer ein Objekt, auch ohne passenden Parser', async () => {
  // Zuerst der BEDARF: Stimmt die Annahme ueberhaupt noch? Laeuft Express
  // eines Tages wieder von selbst auf `{}` zurueck, soll diese Regel nicht
  // stumm eine Zusicherung einfordern, die niemand mehr braucht — dann faellt
  // sie hier auf.
  const blank = express();
  blank.use(express.json());
  blank.use(express.urlencoded({ extended: true }));
  blank.post('/a', (req, res) => res.json({ fehlt: req.body === undefined }));
  const s1 = blank.listen(0);
  await new Promise(r => s1.once('listening', r));
  let ohneZusicherung;
  try {
    ohneZusicherung = (await (await fetch(`http://localhost:${s1.address().port}/a`,
      { method: 'POST' })).json()).fehlt;
  } finally { await new Promise(r => s1.close(r)); }
  assert.equal(ohneZusicherung, true,
    'Express liefert ohne Zusicherung wieder ein Objekt — dann ist die Zeile ' +
    'in server.ts ueberfluessig geworden und darf weg (mitsamt dieser Regel).');

  // Und jetzt die Zusicherung selbst. Gelesen wird ohne Kommentare: Der
  // Erklaerblock darueber nennt `req.body` reichlich, ein blosses indexOf
  // waere damit fuer immer zufrieden.
  // Seit dem 04.11.2026 in rumpfLesen: Die Rümpfe werden erst nach der Anmeldung gelesen.
  const code = ohneKommentare(fs.readFileSync(path.join(__dirname, '..', 'routes', 'api_v1', 'middleware.ts'), 'utf8'));
  assert.match(code, /req\.body === undefined.*req\.body = \{\}/,
    'In rumpfLesen fehlt die Zusicherung, dass req.body ein Objekt ist. ' +
    'Ohne sie antworten vierzehn Handler mit 500 statt mit ihrem eigenen 400, ' +
    'sobald ein Client den Content-Type vergisst.');

  // Sie muss NACH den Parsern stehen — davor brächte sie nichts, weil der
  // Parser danach überschreibt.
  const nachParser = code.indexOf('req.body === undefined');
  const beiJson    = code.indexOf('express.json(');
  assert.ok(beiJson >= 0 && nachParser > beiJson,
    'Die Zusicherung steht vor den Parsern — dort ist sie wirkungslos.');
});

/**
 * Die Startseite geht durch den Renderer — nicht an ihm vorbei.
 *
 * Gegenproben (durchgefuehrt, Ergebnisse abgeschrieben):
 *   `index: false` entfernt → dieser Fall rot.
 *   Beim ERSTEN Versuch blieb er gruen: Die Pruefung las den Quelltext samt
 *   Kommentaren, und der Kommentar ueber der Option nennt sie beim Namen.
 *   Dieselbe Falle wie bei scripts/check-global-settings.js, das Erwaehnungen
 *   in Kommentaren mitzaehlt.
 */
test('3. die Startseite geht durch den Renderer', () => {
  // OHNE KOMMENTARE, und das ist nicht Zierde: Der Erklaerkommentar ueber der
  // Option nennt `index: false` selbst. Die erste Fassung las den Quelltext
  // samt Kommentaren — GEMESSEN blieb die Gegenprobe deshalb gruen, obwohl
  // die Option entfernt war. Eine Pruefung, die ihre eigene Begruendung
  // mitliest, bestaetigt sich selbst.
  const src = ohneKommentare(serverAll());
  const auf = src.indexOf('express.static(PUBLIC_DIR');
  assert.ok(auf > 0, 'Die statische Auslieferung ist nicht mehr zu finden.');
  const block = src.slice(auf, src.indexOf('}));', auf));
  assert.match(block, /index:\s*false/,
    'express.static liefert die index.html fuer `/` wieder selbst aus. Dann ' +
    'geht die Startseite am Renderer vorbei: kein serverseitiges data-theme ' +
    '(sichtbarer Designsprung beim ersten Aufruf) und kein Dateistempel an ' +
    'den Assets (der Browser behaelt seine alten Kopien).');
});
