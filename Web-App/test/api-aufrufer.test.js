/**
 * Zu jeder Route gehört jemand, der sie ruft — oder ein eingetragener Grund.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 * test/api-inventory.test.js ordnet jeden Endpunkt einer Kategorie zu und
 * prüft, dass die Zuordnung VOLLSTÄNDIG ist. Was es nie geprüft hat: ob sie
 * STIMMT. Die Kategorie `nur-v1` sagt wörtlich „wird von BEIDEN Clients
 * genutzt … oder ist Android-spezifisch". NACHGEMESSEN trifft das auf acht so
 * beschriftete Endpunkte nicht zu — sie werden von keinem der beiden Clients
 * gerufen. Eine Beschriftung, die niemand nachmisst, wird irgendwann falsch.
 *
 * ── Was das kostet ──────────────────────────────────────────────────────────
 * Eine Route ohne Aufrufer ist keine Kleinigkeit: Sie wird mitgewartet,
 * mitgetestet, mit umgebaut und bleibt angreifbar. Und sie täuscht — wer
 * `GET /api/sets/export/csv` las, hielt es für den Weg, auf dem die Webapp
 * exportiert. Der Weg ist `/api/settings/export/data` (ZIP); die drei
 * Einzelrouten standen seither ohne Aufrufer da und sind inzwischen entfernt.
 *
 * ── Was der Test NICHT tut ──────────────────────────────────────────────────
 * Er löscht nichts und verlangt auch nicht, dass gelöscht wird. Nicht jede
 * Route braucht einen Aufrufer im Quelltext: Ein Link aus einer E-Mail wird im
 * Browser geöffnet, ein Diagnosewerkzeug von Hand gerufen. Der Test verlangt
 * nur, dass jemand den Grund AUFGESCHRIEBEN hat — und meldet die sechzehnte
 * Route, die still dazukommt.
 *
 * ── Warum gesucht und nicht aufgezählt ──────────────────────────────────────
 * Routen aus den Router-Dateien, Aufrufe aus dem Browser-Code und den
 * Retrofit-Anmerkungen. Drei Schreibweisen desselben Pfades werden anerkannt:
 * `/api/sets` (fetch), `/sets` (der api()-Helfer setzt `/api` davor) und
 * `api/v1/sets` (Retrofit, ohne führenden Schrägstrich).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { routerEinhaengungen } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
const ANDROID = path.join(ROOT, '..', 'Android-App', 'app', 'src', 'main');

function ohneKommentare(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function routenAus(datei, mount) {
  const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const out = [];
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g))
    out.push([m[1].toUpperCase(), (mount + '/' + m[2].replace(/^\//, '')).replace(/\/+$/, '')]);
  return out;
}

function alleRouten() {
  const out = [];
  // Einhaengepunkte aus server.ts GELESEN statt abgeschrieben. Die Liste stand
  // hier als Literal und ist beim Zusammenlegen der API-Oberflaechen falsch
  // geworden — samt „ENOENT: routes/finance.ts". Siehe routerEinhaengungen().
  for (const r of routerEinhaengungen())
    out.push(...routenAus(r.datei, r.mount));
  const v1 = path.join(ROOT, 'routes', 'api_v1');
  for (const f of fs.readdirSync(v1)) {
    if (!f.endsWith('.ts') || f === 'index.ts' || f === 'middleware.ts') continue;
    out.push(...routenAus(path.join(v1, f), '/api/v1'));
  }
  return out;
}

/** Alles, was ein Client sein kann: Browser-Code, Vorlagen, Kotlin. */
function clientQuellen() {
  const dateien = [];
  const sammle = (dir, endungen) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'build') sammle(p, endungen); continue; }
      // app.bundle.js ist das Erzeugnis aus public/js/*.js — mitzuzaehlen
      // hiesse, jeden Aufruf doppelt zu sehen, und ein Aufruf, den es nur im
      // Erzeugnis gaebe, waere ein Fehler und kein Beleg.
      if (e.name === 'app.bundle.js') continue;
      if (endungen.some(x => e.name.endsWith(x))) dateien.push(p);
    }
  };
  sammle(path.join(ROOT, 'public'), ['.js', '.html']);
  sammle(path.join(ROOT, 'views'), ['.js', '.html', '.ejs']);
  sammle(ANDROID, ['.kt']);
  return dateien;
}

/**
 * Routen ohne Aufrufer im Quelltext — mit dem Grund, warum das in Ordnung ist.
 * Wer eine Zeile hinzufügt, schreibt den Grund dazu; wer keinen hat, hat eine
 * Route gefunden, die niemand mehr braucht.
 */
// ── Fuenf Eintraege sind hier verschwunden, weil die Routen es sind ─────────
//
// Und zwei davon trugen einen Grund, der GAR NICHT STIMMTE:
//
//   GET /api/auth/verify    „Wird im Browser geöffnet … deshalb antwortet die
//                            Route auch mit einer Seite und nicht mit JSON."
//                            Sie antwortete mit JSON — seit Nachtrag 154
//                            ausdrücklich, und der Link aus der Mail zeigt auf
//                            die Frontend-Seite /verify, nicht hierher.
//   GET /api/auth/check-token  „Gerufen von der Seite hinter dem Link."
//                            Nachgemessen ueber alle 169 Dateien beider Apps:
//                            von niemandem.
//
// Eine Ausnahme mit erfundenem Grund ist schlimmer als keine Ausnahme — sie
// sieht geprueft aus. Wer hier eine Zeile eintraegt, soll den Aufrufer
// benennen koennen.
const OHNE_AUFRUFER = new Map([
  // ── Diese beiden sind KEINE harmlose Ausnahme ────────────────────────────
  // Sie listen und widerrufen App-Token. Es gibt dafür keine Oberfläche —
  // weder Webapp noch App —, und QR-Login wie App-Login vergeben Token OHNE
  // Ablaufdatum. Wer sein Telefon verliert, kommt an den Zugang nur über die
  // Datenbank. Das ist der Fall aus DeadCodeTest: „Entweder ist die Anzeige
  // dazu nie gebaut worden — dann fehlt eine Funktion." Hier fehlt eine.
  ['GET /api/v1/settings/tokens',
    'Übersicht der ausgegebenen App-Token. Oberfläche FEHLT (siehe oben) — ' +
    'die Route bleibt, damit sie gebaut werden kann, statt sie zu löschen und ' +
    'die Lücke damit unsichtbar zu machen.'],
  ['DELETE /api/v1/settings/tokens/:tokenId',
    'Gegenstück zur Übersicht: einzelnen App-Token entziehen. Ebenfalls noch ' +
    'ohne Oberfläche — der einzige Weg, einen verlorenen Zugang zu sperren.'],
  ['GET /api/v1/admin/img-probe',
    'Diagnosewerkzeug, von Hand gerufen: zeigt, was der Bild-Proxy vom ' +
    'Ursprungsserver bekommt. Entstanden, weil Minifiguren-Bilder über den ' +
    'Proxy fehlschlugen, im Browser aber luden.'],
  ['GET /api/v1/admin/price-probe',
    'Diagnosewerkzeug, von Hand gerufen: zeigt, woher ein Preis stammt ' +
    '(Zustandswahl, Cache oder BrickLink-Antwort).'],
  ['GET /api/v1/admin/image-diag/:setNumber',
    'Diagnosewerkzeug, von Hand gerufen: reine Beobachtung des Bildzustands ' +
    'eines Sets, ohne etwas nachzuladen.'],
  ['POST /api/v1/admin/forget-image-misses',
    'Wartungsgriff, von Hand gerufen: nimmt gemerkte Bild-Fehlanzeigen zurück, ' +
    'damit der Nachlauf es erneut versucht.'],
  ['GET /api/v1/catalog/bricklink',
    'Gebündelte Abfrage der BrickLink-Nummern aus dem lokalen Katalog-Cache. ' +
    'Gegen BrickLink selbst geht das nicht (deren API kennt nur einzelne ' +
    'Artikel und drosselt) — deshalb existiert die Route, benutzt wird sie ' +
    'noch nicht.'],
  ['POST /api/v1/auth/token-create',
    'Stellt einen App-Token für eine bereits bestehende Anmeldung aus ' +
    '(Sitzung ODER Token). Die App holt ihren Token beim Anmelden, die Webapp ' +
    'über den QR-Weg (/auth/qr-token) — dieser dritte Weg wird derzeit von ' +
    'keinem der beiden gerufen.'],
]);

test('jede Route hat einen Aufrufer oder einen eingetragenen Grund', () => {
  const routen = alleRouten();
  const quellen = clientQuellen();
  assert.ok(quellen.length >= 20, `Nur ${quellen.length} Client-Dateien gefunden — Pfade veraltet?`);
  const text = quellen.map(p => fs.readFileSync(p, 'utf8')).join('\n');

  assert.ok(routen.length >= 120, `Nur ${routen.length} Routen gefunden — Muster veraltet?`);

  const ohne = [];
  let mitAufrufer = 0;
  for (const [verb, pfad] of routen) {
    // Bis zum ersten Platzhalter suchen: Den Rest baut der Client zusammen.
    const stamm = pfad.split('/:')[0].replace(/\/+$/, '');
    if (!stamm) continue;
    const formen = [stamm, stamm.slice(1), stamm.slice('/api'.length)].filter(Boolean);
    if (formen.some(f => text.includes(f))) { mitAufrufer++; continue; }
    ohne.push(`${verb} ${pfad}`);
  }

  // Selbstbeweis: Faende das Muster gar nichts, waere `ohne` die ganze Liste
  // und der Test rot — der umgekehrte Fall ist gefaehrlicher: Passte jeder
  // Pfad auf irgendetwas, waere `ohne` leer und der Test gruen, ohne etwas
  // geprueft zu haben. Deshalb beide Seiten festnageln.
  assert.ok(mitAufrufer >= 100,
    `Nur ${mitAufrufer} Routen mit Aufrufer — findet die Suche noch, was sie soll?`);
  assert.ok(ohne.length > 0,
    'Keine einzige Route ohne Aufrufer — das waere schoen, ist aber ' +
    'verdaechtig: Die Suche trifft dann vermutlich auf alles.');

  const unerklaert = ohne.filter(r => !OHNE_AUFRUFER.has(r)).sort();
  assert.deepEqual(unerklaert, [],
    'Diese Routen ruft kein Client, und es steht kein Grund dabei:\n  ' +
    unerklaert.join('\n  ') +
    '\nEntweder sie wird nicht mehr gebraucht (dann entfernen), oder es gibt ' +
    'einen Grund (E-Mail-Link, Diagnosewerkzeug, geplante Oberflaeche) — dann ' +
    'in OHNE_AUFRUFER eintragen, damit der Naechste ihn nicht neu herleiten muss.');

  // Eine Zeile, die niemand mehr braucht, ist eine Erlaubnis, die niemand
  // prueft — dieselbe Regel wie in scripts/check-global-settings.js.
  const veraltet = [...OHNE_AUFRUFER.keys()].filter(r => !ohne.includes(r)).sort();
  assert.deepEqual(veraltet, [],
    'Diese Eintraege beschreiben keine aufruferlose Route mehr — entweder ist ' +
    'sie geloescht worden oder sie hat jetzt einen Aufrufer. Zeile streichen:\n  ' +
    veraltet.join('\n  '));
});
