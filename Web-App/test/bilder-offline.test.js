/**
 * Die Bilder der Tabellen stehen auch ohne Netz.
 * Ausführlich: docs/begruendungen/test/bilder-offline.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ohneKommentare } = require('./helpers/sources');

const BAUM = path.join(__dirname, '..', '..');
// Kommentare ZUERST weg. Der Kopf von server.ts erklaert die /images-Route in
// Zeile 4 und nennt sie dabei woertlich — die erste Fassung dieser Pruefung
// fand diese Erwaehnung statt der Route und meldete, es gebe gar kein
// Cache-Control mehr. Dieselbe Falle, wegen der es diesen Helfer gibt.
const SERVER = ohneKommentare(fs.readFileSync(path.join(__dirname, '..', 'server.ts'), 'utf8'));

/** Die Cache-Control-Zeile der /images-Route — aus der Datei gelesen. */
function bilderKopfzeile() {
  // Die Route verweist auf liefereBild; dessen Rumpf setzt den Kopf.
  const ab = SERVER.indexOf("async function liefereBild(");
  assert.ok(SERVER.includes("app.get('/images/*pfad', liefereBild)"), 'Die /images-Route liefert nicht mehr über liefereBild');
  assert.ok(ab > 0, 'Die /images-Route ist nicht mehr zu finden');
  const abschnitt = SERVER.slice(ab, ab + 4000);
  const m = abschnitt.match(/setHeader\('Cache-Control',\s*'([^']+)'\)/);
  assert.ok(m, 'Die /images-Route setzt gar kein Cache-Control mehr — dann ' +
    'entscheidet der Browser, und offline ist nichts verlässlich.');
  return m[1];
}

test('die Bilder der Tabellen duerfen offline aus dem Zwischenspeicher kommen', () => {
  const kopf = bilderKopfzeile();

  // 1. Nicht `no-cache`: verbietet die Verwendung ohne Rueckfrage.
  assert.ok(!/(^|,)\s*no-cache\b/.test(kopf),
    `Die /images-Route sendet "${kopf}". "no-cache" heisst „vor jeder ` +
    `Verwendung rückfragen" — ohne Netz geht das nie, und die Tabellen zeigen ` +
    `wieder Platzhalter. Fuer „immer nachfragen, aber notfalls die alte Kopie" ` +
    `ist max-age=0 die richtige Zeile.`);

  // 2. Nicht `must-revalidate` und nicht `no-store`: beide verbieten
  //    ausdruecklich, was der Offline-Rueckfall braucht.
  assert.ok(!/must-revalidate|no-store/.test(kopf),
    `Die /images-Route sendet "${kopf}". must-revalidate und no-store ` +
    `verbieten die Auslieferung einer veralteten Kopie — genau das, worauf ` +
    `der Offline-Rückfall der App baut.`);

  // 3. Und trotzdem bei JEDER Verwendung nachfragen, solange es geht: Das war
  //    Marcos frühere Anforderung, und sie gilt weiter.
  assert.match(kopf, /max-age=0/,
    `Die /images-Route sendet "${kopf}" — ohne max-age=0 gilt wieder eine ` +
    `Frist ohne Rückfrage. Ein falsches oder ersetztes Bild bliebe dann stehen, ` +
    `obwohl der Server längst ein neues hat.`);

  // 4. Privat bleibt privat: Die Antwort haengt an einer Anmeldung.
  assert.match(kopf, /private/,
    `Die /images-Route sendet "${kopf}" — ohne "private" darf ein ` +
    `Reverse-Proxy die Bilder fremder Konten zwischenspeichern.`);
});

test('die App hat einen Offline-Rueckfall, der davon Gebrauch macht', () => {
  // Ohne ihn nuetzt die Kopfzeile nichts: Die Kopie liegt da, aber niemand
  // holt sie, wenn die Anfrage scheitert.
  const modul = fs.readFileSync(path.join(__dirname, '..', '..', 'Android-App', 'core-data', 'src', 'main', 'java', 'ch', 'brickinventoryapp', 'di', 'NetzModule.kt'), 'utf8');
  assert.match(modul, /FORCE_CACHE/,
    'Der Offline-Rückfall der App ist weg — dann bleibt die Kopie ungenutzt.');
  assert.match(modul, /catch \(e: java\.io\.IOException\)/,
    'Der Rückfall hängt nicht mehr am Fehler. Am Verbindungsstatus des Geräts ' +
    'festzumachen war schon einmal falsch: Ein Gerät kann im WLAN sein, ohne ' +
    'dass der Heimserver antwortet.');
  assert.match(modul, /image_http_cache/,
    'Der HTTP-Zwischenspeicher für Bilder fehlt — ohne ihn gibt es offline ' +
    'nichts auszuliefern.');
});
