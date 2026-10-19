/**
 * Zwei Zusicherungen, die der Umstieg auf Express 5 lautlos gekostet haette.
 *
 * ── Woher die kommen ────────────────────────────────────────────────────────
 *
 * Beim Heben von express 4.22.3 auf 5.2.1 (05.10.) sind zwei Dinge
 * aufgefallen, die KEIN bestehender Test abgedeckt hat — und beide waeren im
 * Betrieb aufgefallen, nicht vorher.
 *
 * ── 1. Die Startseite ───────────────────────────────────────────────────────
 *
 * Express 5 verlangt fuer einen Platzhalter einen Namen. Die naheliegende
 * Uebersetzung von `app.get('*')` ist `app.get('/*splat')` — und die trifft
 * die nackte Wurzel NICHT. GEMESSEN gegen express 5.2.1:
 *
 *   '/*splat'    /  → 404      /start → 200
 *   '/{*splat}'  /  → 200      /start → 200
 *
 * Ein Aufruf von https://…/ ohne Pfad ist der Normalfall: das Lesezeichen,
 * das Symbol auf dem Startbildschirm, jeder erste Besuch. Kein Test hat je `/`
 * abgerufen — nachgesehen, es war wirklich keiner.
 *
 * Geprueft wird deshalb die WIRKUNG und nicht die Schreibweise: Das Muster
 * wird aus server.ts gelesen, auf einem leeren Express registriert und
 * abgefragt. Wer es auf '/*splat' zurueckdreht, bekommt hier einen 404 — egal
 * wie die Zeile sonst aussieht.
 *
 * ── 2. Der Rumpf einer Anfrage ──────────────────────────────────────────────
 *
 * In Express 4 war `req.body` ein leeres Objekt, wenn kein Parser etwas fand.
 * In Express 5 ist es `undefined`. Vierzehn Handler schreiben
 * `const { … } = req.body` — das wirft darauf, und zwar als 500.
 *
 * Vorher liefen dieselben Anfragen in die eigene Pruefung des Handlers und
 * bekamen einen sauberen 400. Wer den Content-Type vergisst, verdient die
 * zweite Antwort.
 *
 * ── Gegenproben (durchgefuehrt, Ergebnis im Commit) ─────────────────────────
 *   a) Muster auf '/*splat' zurueckgedreht → Schritt 1 rot, nennt den 404
 *   b) die Zusicherung aus server.ts entfernt → Schritt 2 rot
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { serverAll, ohneKommentare } = require('./helpers/sources');

test('1. die Startseite ist auch ohne Pfad erreichbar', async () => {
  const src = serverAll();

  // Den Catch-all an seiner AUFGABE finden, nicht an seinem Muster: Es ist
  // die app.get-Registrierung, die renderIndexHtml() ausliefert. Haenge die
  // Suche am Muster, muesste sie bei jeder Umbenennung mitgepflegt werden —
  // und dann prueft sie irgendwann die Schreibweise statt der Sache.
  // ── Nachtrag 17.10.: renderIndexHtml() liefert nicht mehr NUR der
  //    Catch-all aus ──────────────────────────────────────────────────────
  //
  // Hier stand `break` beim ERSTEN Treffer. Das stimmte, solange genau eine
  // Route die Seite rendert. Seit /reset-password über denselben Renderer
  // geht (sonst gängen von dort die Assets OHNE Stempel hinaus, siehe
  // utils/assetStempel.ts), findet die Suche den festen Pfad zuerst — und
  // meldete einen 404 für `/`, obwohl der Catch-all heil war. Eine Prüfung,
  // die die falsche Route misst, ist schlimmer als keine: Sie sieht nach
  // einem Befund aus.
  //
  // Gesucht wird deshalb unter ALLEN rendernden Routen die mit einem
  // Platzhalter. Das ist nicht dasselbe wie die Schreibweise festzunageln,
  // wogegen der Absatz oben argumentiert: Ob `/*splat` oder `/{*splat}`
  // dasteht, bleibt offen — gefordert ist nur, dass überhaupt eines
  // ALLES fängt.
  const kandidaten = [];
  for (const m of src.matchAll(/^app\.get\('([^']+)'/gm)) {
    if (src.slice(m.index, m.index + 800).includes('renderIndexHtml')) kandidaten.push(m[1]);
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
  const code = ohneKommentare(serverAll());
  assert.match(code, /req\.body === undefined.*req\.body = \{\}/,
    'In server.ts fehlt die Zusicherung, dass req.body ein Objekt ist. ' +
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
 * ── Der Befund, am laufenden Server gemessen ────────────────────────────────
 *
 * `express.static` liefert index.html fuer `/` von sich aus aus (Option
 * `index`, Vorgabe `index.html`) und kommt damit dem SPA-Catch-all zuvor.
 * GEMESSEN am 17.10., bevor das abgestellt wurde:
 *
 *   /           <html lang="de">                       ?v=2026.10.17.1217
 *   /irgendwas  <html data-theme="classic" lang="de">   ?v=mvccag5c-14dl
 *
 * Auf der Startseite fielen damit ZWEI Dinge aus:
 *
 *   • das serverseitig gesetzte `data-theme`. Genau dafuer gibt es
 *     utils/indexHtml.ts: Ohne den Wert startet ein frischer Browser im
 *     Standarddesign und springt nach dem Abgleich sichtbar um. Der Kopf
 *     jener Datei beschreibt diesen Sprung als geloest — auf `/` war er es
 *     nie.
 *   • der Dateistempel (utils/assetStempel.ts). Deshalb blieb die
 *     Cache-Reparatur bei Marco wirkungslos: Sie kam an seiner Adresse gar
 *     nicht zum Einsatz.
 *
 * ── Warum hier die SCHREIBWEISE gepruefte wird ──────────────────────────────
 *
 * Der Absatz oben argumentiert, man solle die Wirkung pruefen und nicht das
 * Muster. Hier ist die Option selbst die Wirkung: `index: false` sagt genau
 * „liefere keine Verzeichnis-Startdatei aus", und etwas anderes gibt es dafuer
 * nicht. Die Wirkung am echten Server zu pruefen hiesse, ihn samt Datenbank
 * hochzufahren — das tut keine Pruefung dieser Reihe.
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
