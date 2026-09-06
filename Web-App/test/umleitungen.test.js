/**
 * Ausgehende Umleitungen: begrenzt, nur https, ohne Geheimnisse.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Der Baum hatte die Regel an zwei Stellen richtig und an zwei Stellen gar
 * nicht:
 *
 *   RICHTIG   routes/imgProxy.ts holt mit `https.get`, das von sich aus keiner
 *             Umleitung folgt — plus eine Host-Allowlist.
 *   RICHTIG   Die Android-App baut ihren Update-Client mit
 *             `followSslRedirects(false)` (di/AppModule.kt).
 *   FEHLTE    clients/rebrickable.ts folgte Umleitungen von Hand, an zwei
 *             Stellen, und pruefte dabei nichts.
 *
 * Drei Folgen, alle nachgemessen:
 *
 *  1. DER SCHLUESSEL WANDERTE MIT. Neun der zwoelf Aufrufer von
 *     httpsGetRobust schicken `Authorization: key <REBRICKABLE_API_KEY>`
 *     (rebrickable.ts 122/217/312/352/384, routes/parts.ts 125/149,
 *     utils/handlers/parts.ts 533, jobs/rebrickableCsvSync.ts 281). Der Kopf
 *     ging unveraendert an das Umleitungsziel.
 *  2. HTTPS -> HTTP war erlaubt (`protocol === 'https:' ? https : http`) —
 *     derselbe Schluessel im Klartext.
 *  3. KEIN ENDE: httpsGetRobust hatte keinen Umleitungszaehler. Eine Schleife
 *     A -> B -> A lief unbegrenzt, ausloesbar allein vom fremden Server.
 *
 * Geprueft wird hier die REGEL selbst (sie ist rein und damit direkt
 * aufrufbar) UND dass die beiden Stellen sie wirklich benutzen. Nur das eine
 * zu pruefen reichte in diesem Baum noch nie: Die frueheren Token-Regeln waren
 * jahrelang gruen, weil nur ihr Vorhandensein geprueft wurde und nie ihr
 * Gebrauch.
 *
 * Ausfuehren: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { buildAndRequire, ohneKommentare } = require('./helpers/sources');
const _req = buildAndRequire();
const {
  naechsteUmleitung, hostErlaubt, UMLEITUNGS_GRENZE,
  ERLAUBTE_BILD_HOSTS, ERLAUBTE_DOWNLOAD_HOSTS,
} = _req('utils/fremdeAdressen.js');

const KOPF = { Authorization: 'key GEHEIM', 'User-Agent': 'test' };

test('eine Umleitung nimmt den Schluessel nicht mit auf einen fremden Host', () => {
  const w = naechsteUmleitung('https://rebrickable.com/a', 'https://angreifer.tld/b', KOPF);
  assert.ok(w, 'Der Sprung selbst ist erlaubt — nur eben ohne Geheimnis');
  assert.equal(w.url, 'https://angreifer.tld/b');
  assert.equal(w.kopfzeilen.Authorization, undefined,
    'Der API-Schluessel darf einen Hostwechsel nicht ueberleben');
  assert.equal(w.kopfzeilen['User-Agent'], 'test',
    'Alles andere bleibt — sonst sperrt uns das CDN wegen fehlendem User-Agent aus');
});

test('auf demselben Host bleibt der Schluessel', () => {
  // Sonst waere die Regel unbrauchbar: rebrickable.com leitet innerhalb der
  // eigenen Adressen um (Schraegstrich am Ende), und ohne Schluessel kaeme
  // dort ein 401 zurueck.
  const w = naechsteUmleitung('https://rebrickable.com/a', 'https://rebrickable.com/a/', KOPF);
  assert.equal(w.kopfzeilen.Authorization, 'key GEHEIM');
});

test('ein Downgrade auf http wird nicht befolgt', () => {
  assert.equal(naechsteUmleitung('https://rebrickable.com/a', 'http://rebrickable.com/a', KOPF), null,
    'Sonst geht derselbe Schluessel im Klartext hinaus');
  // Positiv auf https geprueft, nicht negativ auf http: Eine Verbotsliste
  // vergisst irgendwann ein Schema.
  for (const boese of ['file:///etc/passwd', 'ftp://x.tld/a', 'data:text/plain,x'])
    assert.equal(naechsteUmleitung('https://rebrickable.com/a', boese, KOPF), null,
      `${boese} darf nicht befolgt werden`);
});

test('ein relatives Umleitungsziel wird aufgeloest', () => {
  // Ein Location-Kopf DARF ein blosser Pfad sein (RFC 9110). Vorher lief das
  // in `new URL(location)` und damit in ein "Invalid URL" — richtig
  // abgewiesen, aber aus dem falschen Grund: eine gueltige Umleitung kam nicht
  // an.
  const w = naechsteUmleitung('https://rebrickable.com/sets/123/', '/sets/123-1/', KOPF);
  assert.equal(w.url, 'https://rebrickable.com/sets/123-1/');
  assert.equal(w.kopfzeilen.Authorization, 'key GEHEIM', 'Derselbe Host — der Schluessel bleibt');
});

test('ohne Location-Kopfzeile gibt es kein Ziel', () => {
  assert.equal(naechsteUmleitung('https://rebrickable.com/a', undefined, KOPF), null);
  assert.equal(naechsteUmleitung('https://rebrickable.com/a', '', KOPF), null);
});

test('mit Host-Liste zaehlt auch das Umleitungsziel', () => {
  // Der Dateidownload prueft den Host bei JEDEM Sprung, weil er das Geholte
  // ausliefert (data/instructions/ ist fuer angemeldete Nutzer abrufbar).
  assert.equal(
    naechsteUmleitung('https://cdn.rebrickable.com/a.pdf', 'https://angreifer.tld/a.pdf', KOPF,
      ERLAUBTE_DOWNLOAD_HOSTS), null,
    'Sonst holt der Server eine beliebige Adresse und gibt sie zurueck');
  assert.ok(
    naechsteUmleitung('https://cdn.rebrickable.com/a.pdf', 'https://www.lego.com/a.pdf', KOPF,
      ERLAUBTE_DOWNLOAD_HOSTS),
    'Anleitungen liegen bei lego.com — die muessen weiter ankommen');
});

test('die Host-Pruefung faellt nicht auf einen angehaengten Namen herein', () => {
  // Dieselbe Falle wie beim Bearer-Token der App und bei der Update-Adresse:
  // ein blosses endsWith() ohne den Punkt davor.
  assert.ok(hostErlaubt('https://cdn.rebrickable.com/x', ERLAUBTE_BILD_HOSTS));
  assert.ok(hostErlaubt('https://rebrickable.com/x', ERLAUBTE_BILD_HOSTS));
  for (const boese of ['https://evil-rebrickable.com/x', 'https://rebrickable.com.angreifer.tld/x',
                       'https://xlego.com/x', 'https://lego.com.angreifer.tld/x'])
    assert.ok(!hostErlaubt(boese, ERLAUBTE_DOWNLOAD_HOSTS), `${boese} darf nicht durchgehen`);
  // Unparsebar heisst NICHT holen — und nicht: werfen.
  assert.equal(hostErlaubt('kein-url', ERLAUBTE_BILD_HOSTS), false);
});

test('die beiden Stellen benutzen die Regel wirklich', () => {
  const rb = ohneKommentare(read('clients/rebrickable.ts'));

  // ── httpsGetRobust ────────────────────────────────────────────────────────
  assert.match(rb, /naechsteUmleitung\(u, res\.headers\.location, kopf\)/,
    'httpsGetRobust folgt wieder von Hand — dann wandert der API-Schluessel mit');
  assert.match(rb, /\+\+umleitungen > UMLEITUNGS_GRENZE/,
    'Ohne eigenen Zaehler laeuft eine Umleitungsschleife unbegrenzt: `attempts` ' +
    'wird nur bei 429, Timeout und ECONNRESET geprueft');
  // Der Kopf muss DURCHGEREICHT werden, nicht aus dem aeusseren `headers`
  // gelesen — sonst ist das Abwerfen wirkungslos, weil beim naechsten Anlauf
  // wieder das Original steht.
  assert.doesNotMatch(rb, /\.\.\.headers \} \}, res =>/,
    'Der Anlauf muss den GEFILTERTEN Kopf benutzen, nicht den urspruenglichen');
  assert.match(rb, /\.\.\.kopf \} \}, res =>/,
    'httpsGetRobust schickt nicht mehr den durchgereichten Kopf');

  // ── downloadFile ──────────────────────────────────────────────────────────
  assert.match(rb, /hostErlaubt\(url, ERLAUBTE_DOWNLOAD_HOSTS\)/,
    'downloadFile prueft die Ausgangsadresse nicht mehr');
  assert.match(rb, /naechsteUmleitung\(u, res\.headers\.location, kopf, ERLAUBTE_DOWNLOAD_HOSTS\)/,
    'downloadFile prueft die Umleitungsziele nicht mehr — die Datei wird ausgeliefert');

  // ── Und die Liste steht nur noch an EINER Stelle ──────────────────────────
  const proxy = ohneKommentare(read('routes/imgProxy.ts'));
  assert.doesNotMatch(proxy, /const ALLOWED_IMAGE_HOSTS = \[/,
    'Die Bild-Allowlist ist zurueck in der Route — sie gehoert nach utils/, ' +
    'weil clients/ sie braucht und ein Client nicht von einer Route abhaengen soll');
  assert.match(proxy, /hostErlaubt\(url, ERLAUBTE_BILD_HOSTS\)/,
    'Der Bild-Proxy prueft nicht mehr ueber die gemeinsame Regel');
  assert.match(ohneKommentare(read('routes/api_v1/admin.ts')), /hostErlaubt\(url, ERLAUBTE_BILD_HOSTS\)/,
    'Die Bild-Diagnose prueft nicht mehr ueber die gemeinsame Regel');
});

test('die Grenze ist die, die downloadFile schon hatte', () => {
  // Selbstbeweis: Die Zahl kommt aus dem Baum, nicht aus dem Kopf. Stand
  // vorher als `redirects > 5` in downloadFile.
  assert.equal(UMLEITUNGS_GRENZE, 5);
});
