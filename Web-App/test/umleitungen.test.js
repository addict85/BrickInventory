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
 *             `followSslRedirects(false)` (di/NetzModule.kt).
 *   FEHLTE    clients/rebrickable.ts folgte Umleitungen von Hand, an zwei
 *             Stellen, und pruefte dabei nichts.
 *
 * Drei Folgen, alle nachgemessen:
 *
 *  1. DER SCHLUESSEL WANDERTE MIT. Neun der zwoelf Aufrufer von
 *     httpsGetRobust schicken `Authorization: key <REBRICKABLE_API_KEY>`
 *     (rebrickable.ts 122/217/312/352/384, routes/parts.ts 125/149,
 *     src/teile/abfragen.ts 533, jobs/rebrickableCsvSync.ts 281). Der Kopf
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
} = _req('src/infra/fremdeAdressen.js');

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

/**
 * Port, Userinfo und Eimer-Unterdomänen.
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln):
 *   `u.hostname === h` statt `u.host === h` → rot bei „:22"
 *   Userinfo-Prüfung entfernt → rot bei „evil.com@"
 *   zusätzlich `u.host.endsWith('.' + h)` (alter Suffix) → rot bei „x.bdpinstructions"
 */
test('Hostprüfung: nur Standardport, keine Userinfo, Eimer exakt', () => {
  for (const gut of ['https://cdn.rebrickable.com/x', 'https://cdn.rebrickable.com:443/x',
                     'https://www.lego.com/cdn/a.pdf', 'https://assets.lego.com/a.pdf'])
    assert.ok(hostErlaubt(gut, ERLAUBTE_DOWNLOAD_HOSTS), `${gut} muss erlaubt sein`);
  for (const boese of ['https://cdn.rebrickable.com:22/', 'https://cdn.rebrickable.com:8443/x'])
    assert.ok(!hostErlaubt(boese, ERLAUBTE_BILD_HOSTS), `${boese}: fremder Port`);
  for (const boese of ['https://evil.com@cdn.rebrickable.com/', 'https://a:b@cdn.rebrickable.com/'])
    assert.ok(!hostErlaubt(boese, ERLAUBTE_BILD_HOSTS), `${boese}: Userinfo`);
  for (const boese of ['https://x.bdpinstructions.s3.amazonaws.com/a.pdf',
                       'https://x.cdn.rebrickable.com/a.png'])
    assert.ok(!hostErlaubt(boese, ERLAUBTE_DOWNLOAD_HOSTS), `${boese}: Unterdomäne`);
});

/**
 * Die Anleitungen der BrickLink Designer Programme.
 *
 * ── Marcos Serverprotokoll ─────────────────────────────────────────────────
 *
 *     [download] Adresse nicht in der Liste erlaubter Hosts:
 *                https://bdpinstructions.s3.amazonaws.com/11010.pdf
 *
 * Seitenweise, fuer jedes BDP-Set. Diese Adresse baut der Baum SELBST
 * (src/katalog/instructions.ts, Rueckfall 2) und lehnte sie dann ab: Der Rueckfall
 * konnte nie etwas holen, seit es ihn gibt.
 */
test('der BDP-Eimer darf geholt werden — aber nur er', () => {
  assert.ok(hostErlaubt('https://bdpinstructions.s3.amazonaws.com/11010.pdf',
                        ERLAUBTE_DOWNLOAD_HOSTS),
    'Der Rueckfall in src/katalog/instructions.ts baut genau diese Adresse — sie hier ' +
    'abzulehnen heisst, ihn bauen zu lassen und ins Leere laufen zu lassen');

  // ── Und NICHT der halbe Anbieter ─────────────────────────────────────────
  //
  // Der Punkt dieses Falls. `amazonaws.com` in die Liste zu schreiben waere
  // die bequeme Fassung gewesen — und die Erlaubnis fuer jeden fremden
  // S3-Eimer der Welt, denn hostErlaubt() laesst echte Subdomains durch und
  // ein Eimername IST eine Subdomain. Ohne diese Haelfte waere der Fall
  // darueber auch mit der bequemen Fassung gruen.
  for (const fremd of ['https://amazonaws.com/x.pdf',
                       'https://s3.amazonaws.com/x.pdf',
                       'https://boeser-eimer.s3.amazonaws.com/x.pdf',
                       'https://bdpinstructions.s3.amazonaws.com.angreifer.tld/x.pdf']) {
    assert.ok(!hostErlaubt(fremd, ERLAUBTE_DOWNLOAD_HOSTS),
      `${fremd} darf nicht durchgehen — sonst ist jeder fremde Eimer erlaubt`);
  }

  // Und die Bildliste bleibt unberuehrt: Von dort kommen PDFs, keine Bilder.
  assert.ok(!hostErlaubt('https://bdpinstructions.s3.amazonaws.com/11010.pdf',
                         ERLAUBTE_BILD_HOSTS),
    'Der PDF-Eimer hat in der BILDliste nichts zu suchen — der Bild-Proxy ' +
    'liefert an den Browser aus, und das ist eine andere Frage');
});

test('Abrufe nach draussen gehen nur über src/infra/abruf.ts', () => {
  // Struktur, kein Verhalten: Das Verhalten des Helfers prüft
  // test/abruf-helfer.test.js gegen einen echten TLS-Server.
  const fremd = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) { if (!['node_modules', 'dist', 'test', 'public', 'scripts', '.git'].includes(n)) lauf(p); continue; }
      if (!n.endsWith('.ts') || p.endsWith(path.join('src', 'infra', 'abruf.ts'))) continue;
      if (/\bhttps?\.(get|request)\(|\bfetch\(/.test(ohneKommentare(fs.readFileSync(p, 'utf8')))) fremd.push(path.relative(ROOT, p));
    }
  })(ROOT);
  assert.deepEqual(fremd, [], 'eigener Abrufweg an Hostliste, Umleitungs- und Grössengrenze vorbei');
  assert.match(ohneKommentare(read('src/infra/abruf.ts')), /naechsteUmleitung\(u, r\.headers\?\.location, kopf, o\.hosts\)/,
    'der Helfer prüft die Umleitungsziele nicht gegen die Hostliste');
  assert.match(ohneKommentare(read('clients/rebrickable.ts')), /hosts: ERLAUBTE_DOWNLOAD_HOSTS/,
    'downloadFile prueft die Umleitungsziele nicht mehr — die Datei wird ausgeliefert');

  // ── Und die Liste steht nur noch an EINER Stelle ──────────────────────────
  const proxy = ohneKommentare(read('routes/imgProxy.ts'));
  assert.doesNotMatch(proxy, /const ALLOWED_IMAGE_HOSTS = \[/,
    'Die Bild-Allowlist ist zurueck in der Route — sie gehoert nach utils/, ' +
    'weil clients/ sie braucht und ein Client nicht von einer Route abhaengen soll');
  // Dies ist eine MUSTERregel: Sie faengt eine geloeschte Zeile. Dass der
  // Weg wirklich lebt, laeuft in test/verdrahtung-laeuft-db.test.js —
  // beides zusammen, nicht eines statt des anderen.
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
