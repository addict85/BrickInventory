/**
 * Bild-Proxy: Auslieferung, Zwischenspeicherung, Diagnose.
 *
 * Gegenproben zu den nach bild-proxy-deckel.test.js (Typprüfung, Platzhalter)
 * und img-cache-serve.test.js (304) verlegten Fällen stehen dort; für 304 je
 * die `req.fresh`-Zeile in src/katalog/http/bildCacheAuslieferung.ts entfernt → dort rot
 * „bekannter Stand → 304 und KEIN Bild“ (08.11.2026). Doppelte Schrägstriche
 * im Pfad → sicherheit-querschnitt-db I (Normalisierung entfernt → dort rot).
 * Zähler und Protokoll der Fehlschläge, Inhaltsprüfung der Probe →
 * bild-proxy-deckel.test.js I und J.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { abschnitt } = require('./helpers/sources');

const ROOT = path.join(__dirname, '..');
// Der Bild-Proxy ist aus server.ts nach routes/imgProxy.ts gewandert (server.ts
// war mit über 1200 Zeilen wieder ein kleiner Monolith aus Proxy, Thumb-Queue,
// Cluster-Setup und Startup-Orchestrierung). Die hier geprüften Sachverhalte
// gelten unverändert — sie verteilen sich jetzt nur auf zwei Dateien:
const SERVER_ONLY = require('./helpers/sources').startQuelle();
const PROXY = require('./helpers/sources').proxyThumbQuelle();
const SERVER = SERVER_ONLY + '\n' + PROXY;
const CODE = SERVER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('gleichzeitige Anfragen schreiben in getrennte Temp-Dateien', () => {
  // Der Name enthielt nur die Prozess-ID. Fordert eine Kachelwand dasselbe Bild
  // mehrfach gleichzeitig an, schrieben alle Anfragen desselben Workers in
  // DIESELBE Datei — gemessen 418'603 statt 81'920 Bytes, also fünf Kopien
  // hintereinander. Solche Dateien beginnen mit FFD8 und enden auf FFD9, der
  // Browser kann sie aber nicht dekodieren.
  assert.match(
    SERVER,
    /const tmpFile = `\$\{cacheFile\}\.tmp-\$\{process\.pid\}-\$\{_tmpSeq\+\+\}`/,
    'Der Temp-Name braucht eine laufende Nummer je Anfrage',
  );
  assert.match(SERVER, /let _tmpSeq = 0;/, 'Zähler fehlt');
});

test('nur vollständige Dateien kommen in den Cache', () => {
  // Eine abgeschnittene Datei würde dauerhaft ausgeliefert: Der Browser bekommt
  // 200, kann das Bild aber nicht dekodieren.
  assert.match(
    SERVER,
    /const expected = parseInt\(String\(r\.kopf\['content-length'\]/,
    'Die erwartete Länge muss gemerkt werden',
  );
  // Nach dem Entpacken passt die angekündigte Länge nicht mehr — dann entfällt
  // die Prüfung (siehe „komprimierte Antworten werden entpackt").
  assert.match(
    SERVER,
    /if \(!enc && expected > 0 && st\.size !== expected\)/,
    'Vor dem Umbenennen muss die Grösse geprüft werden',
  );
});

test('der Cache-Stream hängt vor dem Client-Stream', () => {
  // r.pipe(ws) stand einmal hinter einem `await mkdir`. r.pipe(res) läuft
  // synchron davor — die ersten Chunks flossen also zum Client, bevor der
  // Cache-Stream überhaupt hing.
  // Der Cache-Zweig steht in inDenCache(); dort bis body.pipe(ws), dann im
  // Aufrufer vom Aufruf bis body.pipe(res).
  const start = CODE.indexOf("const rohTyp = String(r.kopf['content-type']");
  const blk = CODE.slice(start, CODE.indexOf('body.pipe(res);', start) + 20);
  const iCache = blk.indexOf('inDenCache(d, body'),
    iClient = blk.indexOf('body.pipe(res)');
  assert.ok(iCache > 0 && iClient > iCache, 'inDenCache(body …) muss vor body.pipe(res) stehen');
  const cache = CODE.slice(CODE.indexOf('function inDenCache('), CODE.indexOf('body.pipe(ws)'));
  assert.ok(cache.length > 0 && CODE.indexOf('function inDenCache(') > 0, 'body.pipe(ws) steht nicht in inDenCache()');
  assert.doesNotMatch(
    blk.slice(0, iCache) + cache,
    /await /,
    'Zwischen Antwortbeginn und Cache-Stream darf kein await liegen',
  );
});

test('komprimierte Antworten werden entpackt, nicht weitergereicht', () => {
  // Ein durchgereichter komprimierter Körper mit Content-Type: image/jpeg
  // ergibt beim Browser eine weisse Fläche — bei Status 200 und passender
  // Länge, also ohne jeden Hinweis im Log. Entpacken macht auch die
  // gespeicherte Datei zu einem echten Bild, unabhängig von allem davor.
  assert.match(SERVER, /'Accept-Encoding': 'identity'/, 'Unkomprimiert anfordern ist die erste Verteidigungslinie');
  const idents = (SERVER.match(/'Accept-Encoding': 'identity'/g) || []).length;
  assert.equal(idents, 2, 'Beide Kopfzeilen-Sätze müssen identity anfordern');

  assert.match(SERVER, /enc === 'gzip' \? zlib\.createGunzip\(\)/, 'gzip wird nicht entpackt');
  assert.match(SERVER, /enc === 'br' \? zlib\.createBrotliDecompress\(\)/, 'brotli wird nicht entpackt');
  assert.match(
    SERVER,
    /res\.removeHeader\('Content-Length'\)/,
    'Nach dem Entpacken stimmt die angekündigte Länge nicht mehr',
  );

  // Beide Ziele müssen den ENTPACKTEN Strom bekommen
  assert.match(SERVER, /body\.pipe\(ws\)/, 'Der Cache bekommt nicht den entpackten Strom');
  assert.match(SERVER, /body\.pipe\(res\)/, 'Der Client bekommt nicht den entpackten Strom');

  // Vorschau und Plattencache teilen eine Stelle (bildCacheAuslieferung.ts;
  // Verhalten: img-cache-serve.test.js), dazu der CDN-Abruf.
  const lengths = (SERVER.match(/res\.setHeader\('Content-Length'/g) || []).length;
  assert.ok(lengths >= 2, `Nur ${lengths} von zwei Stellen setzen Content-Length (Cache, CDN-Abruf)`);
});

test('abgebrochene Client-Anfragen geben die CDN-Verbindung frei', () => {
  // Ohne das blieb der Socket belegt: Der Antwort-Stream lief in ein totes res,
  // die Gegendruck-Steuerung hielt ihn an, und die Warteschlange verhungerte.
  assert.match(
    SERVER,
    /res\.on\('close', \(\) => \{[\s\S]{0,400}?roh\.destroy\(\)/,
    'Der Abbruch muss die laufende CDN-Anfrage beenden',
  );
  // `!writableFinished` allein ist zu scharf: Je nachdem, was zwischen Server
  // und Browser sitzt, kann close feuern, bevor Node writableFinished gesetzt
  // hat — dann wurde eine gesunde Übertragung abgeschossen. Der Client bekam
  // 200 und danach nichts, der Cache blieb leer, protokolliert wurde nichts.
  assert.match(
    SERVER,
    /if \(res\.writableFinished \|\| !res\.destroyed\) return;/,
    'res.destroyed ist der belastbare Hinweis auf einen echten Abbruch',
  );
  assert.match(
    SERVER,
    /Client hat abgebrochen, Verbindung freigegeben/,
    'Ein Abbruch muss sichtbar sein — stilles Abschiessen war die Ursache',
  );
  assert.match(
    SERVER,
    /r\.verwerfen\(\);\s*r = await holen\(HEADER_SETS\[1\]\)/,
    'Beim Rückfall ohne Referer muss die erste Antwort freigegeben werden',
  );
});

test('der Verbindungs-Pool ist weit genug', async () => {
  // Mit 8 wartete ein einzeln geöffnetes Bild hinter 60 Kachel-Anfragen
  // 1195 ms; mit 32 sind es 282 ms, ohne Grenze 153 ms.
  // Der Pool steht im Klienten (clients/bildCdn.ts), der Proxy nimmt ihn mit `pool: true`.
  // Gegenprobe (05.11.2026): maxSockets 8 in clients/bildCdn.ts → rot.
  const { oeffneBild } = require('./helpers/sources').buildAndRequire()('clients/bildCdn.js');
  const { mitschnitt } = require('./helpers/https-mitschnitt');
  const url = 'https://cdn.rebrickable.com/media/sets/1-1.jpg';
  const [mitPool, ohnePool] = await mitschnitt(async () => {
    await oeffneBild(url, { maxBytes: 1000, pool: true }).catch(() => {});
    await oeffneBild(url, { maxBytes: 1000 }).catch(() => {});
  });
  const agent = mitPool?.optionen.agent;
  assert.ok(agent, 'der Proxy-Abruf nimmt den Pool nicht');
  assert.ok(agent.maxSockets >= 32, `maxSockets ${agent.maxSockets} ist zu eng — Einzelabrufe warten spürbar`);
  assert.equal(agent.keepAlive, true, 'Wiederverwendung spart den TLS-Handshake');
  assert.equal(ohnePool?.optionen.agent, undefined, 'ein Einzelabruf hält keine Verbindung offen');
  assert.match(SERVER, /pool: true/, 'der Proxy nimmt den Pool nicht');
});

test('die Diagnose-Endpunkte sind vorhanden', () => {
  const route = require('./helpers/sources').kompakt(
    fs.readFileSync(path.join(ROOT, 'routes/api_v1/admin.ts'), 'utf8'),
  );
  assert.match(route, /router\.post\('\/admin\/img-probe', requireApiAdmin/, 'img-probe fehlt');
  assert.match(route, /router\.post\('\/admin\/price-probe', requireApiAdmin/, 'price-probe fehlt');
  // Die Abrufe selbst stehen im Dienst der Verwaltung (Routen rufen nicht ins Netz).
  const admin = fs.readFileSync(path.join(ROOT, 'src/verwaltung/diagnose.ts'), 'utf8');
  assert.match(
    admin,
    /content_encoding: k\['content-encoding'\]/,
    'Die Probe muss zeigen, ob das CDN komprimiert liefert',
  );
  assert.match(admin, /proxy_failures: failures/, 'Die Zähler gehören in die Antwort');
});

test('der ausgebaute Reparaturjob ist restlos weg', () => {
  // Er beruhte auf der Annahme, die Bildadressen seien kaputt. Die war falsch —
  // das CDN lieferte durchgehend 200.
  assert.ok(!fs.existsSync(path.join(ROOT, 'jobs', 'imageRepair.ts')), 'Job-Datei noch da');
  for (const f of ['server.ts', 'src/auftraege/jobMonitor.ts', 'src/auftraege/zeitplan.ts', 'db/database.ts']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /imgRepair|img_repair|dead_images/, `${f}: Reste vorhanden`);
  }
});

test('kaputte Antworten werden nicht für einen Tag im Browser festgenagelt', () => {
  // Beobachtet: "200 OK (from disk cache)" — die Anfrage erreichte den Server
  // gar nicht mehr. Der Browser lieferte eine kaputte Antwort aus der Zeit der
  // behobenen Fehler weiter aus. Kein Log-Eintrag, kein Server-Cache, weisse
  // Fläche. Mit `max-age=86400` ohne Rückfrage dauert das einen ganzen Tag.
  assert.doesNotMatch(
    SERVER,
    /'public, max-age=86400'\s*\)/,
    'Ein langes max-age ohne must-revalidate nagelt Fehler im Browser fest',
  );

  // Der gestreamte Pfad kennt den Inhalt noch nicht — dort kurz halten.
  const stream = SERVER.slice(
    SERVER.indexOf("const rohTyp = String(r.kopf['content-type']"),
    SERVER.indexOf('body.pipe(res);'),
  );
  assert.match(
    stream,
    /max-age=3600, must-revalidate/,
    'Frisch gestreamte Antworten dürfen nicht lange festgehalten werden',
  );

  // Die Cache-Wege liefern geprüften Inhalt und dürfen länger — aber mit ETag,
  // damit der Browser billig rückfragen kann.
  assert.match(SERVER, /`"c-\$\{cst\.size\}-\$\{Math\.floor\(cst\.mtimeMs\)\}"`/, 'ETag für den Plattencache fehlt');
  assert.match(SERVER, /`"t-\$\{tst\.size\}-\$\{Math\.floor\(tst\.mtimeMs\)\}"`/, 'ETag für die Vorschau fehlt');
});

test('Minifiguren-Bilder werden lokal abgelegt wie Set-Bilder', () => {
  // Vorher lud der Hintergrundlauf nur `source='manual'`. Minifiguren aus Sets
  // liefen dadurch dauerhaft über /api/img-proxy: Anmeldeprüfung, Cache-Suche
  // und Stream bei jeder Kachel, beim ersten Anzeigen ein CDN-Roundtrip je
  // Bild. Set-Bilder liegen längst lokal und gehen über express.static. …
  assert.match(
    SERVER,
    /SELECT mc\.fig_number, mc\.image_url FROM minifigs_catalog mc/,
    'Der Hintergrundlauf muss alle Minifiguren ohne lokales Bild finden',
  );
  assert.doesNotMatch(
    SERVER,
    /FROM minifigs\s+WHERE source='manual' AND image_url IS NOT NULL AND image_local IS NULL/,
    'Die Beschränkung auf manuelle Figuren muss weg sein',
  );
  // Aber nur Figuren, die jemand BESITZT: Der Katalog kennt auch Figuren aus
  // Set-Teilelisten, die niemand hat — die braucht kein lokales Bild.
  assert.match(
    SERVER,
    /EXISTS \(SELECT 1 FROM minifigs m WHERE m\.fig_number = mc\.fig_number\)/,
    'Der Lauf darf nicht Bilder von Figuren holen, die niemand besitzt',
  );

  // Eine Datei je Nummer, geteilt über alle Nutzer — und seit Migration 0034
  // auch nur EINE Zeile, die darauf zeigt.
  assert.match(
    SERVER,
    /setzeFigurBildLokal\((?:\s*(?:kx?|sk|t)(?:: \w+)?(?:,\s*|(?=\s*\))))?f\.fig_number, local\)/,
    'Ein Download muss den Katalogeintrag der Figur setzen',
  );

  // Fortschritt im bestehenden Job, kein zweiter Eintrag im Monitoring
  assert.match(SERVER, /const tick = async \(\) => \{/, 'Fortschrittszähler fehlt');
  assert.match(SERVER, /text: `\$\{done\} \/ \$\{total\} geladen`/, 'Zwischenstand fehlt');
  const mon = fs.readFileSync(path.join(ROOT, 'src/auftraege/jobMonitor.ts'), 'utf8');
  const figJobs = (mon.match(/^\s{2}\w+:\s*\{/gm) || []).filter(l => /fig|minifig/i.test(l));
  assert.deepEqual(figJobs, [], 'Es darf kein eigener Job dafür entstehen — imgDl deckt es ab');

  // Und die offene Menge im Monitoring muss sie mitzählen. Die Abfrage steht
  // im Dienst der Verwaltungsrouten; die Route ruft sie für die Kachel auf.
  const route = fs.readFileSync(path.join(ROOT, 'src/verwaltung/jobUebersicht.ts'), 'utf8');
  assert.match(
    route,
    /verwaltung\.bestandsFigurenbilderOffen\(\)/,
    'Die Job-Übersicht muss die Figurenbilder des Bestands abfragen',
  );
  const admin = fs.readFileSync(path.join(ROOT, 'src/verwaltung/repository/verwaltung.ts'), 'utf8');
  assert.match(
    admin,
    /COUNT\(\*\)::int AS c FROM minifigs_catalog mc/,
    'Die Minifiguren des Bestands fehlen in der offenen Menge',
  );
  // Dieselbe Menge wie der Hintergrundlauf — sonst zeigt das Monitoring eine
  // Zahl, die mit dem Fortschritt nicht zusammenpasst.
  assert.match(
    admin,
    /EXISTS \(SELECT 1 FROM minifigs m WHERE m\.fig_number = mc\.fig_number\)/,
    'Die offene Menge und der Hintergrundlauf müssen dieselbe Menge meinen',
  );
});

test('der Cache-Aufräumlauf ist ein geplanter Auftrag', () => {
  // Das tägliche Aufräumen stand einmal in registerImgProxy() und lief damit
  // in jedem Web-Worker; heute ist es ein Schritt des geplanten Auftrags
  // 'aufraeumen_taeglich' (src/verwaltung/aufraeumen.ts) und läuft nur im Job-Prozess.
  assert.match(
    SERVER,
    /export async function raeumeBildCacheAuf/,
    'Der Lauf muss von aussen startbar sein, statt beim Registrieren loszulaufen',
  );
  const reg = abschnitt(
    SERVER,
    'function registerImgProxy',
    'export async function raeumeBildCacheAuf',
    'Registrierung ohne tagesweites Intervall',
  );
  assert.doesNotMatch(reg, /setInterval/, 'Kein eigenes Intervall im Teil, den der Web-Prozess ausführt');
  const plan = require('./helpers/sources').ohneKommentare(
    fs.readFileSync(path.join(ROOT, 'src/verwaltung/aufraeumen.ts'), 'utf8'),
  );
  assert.match(
    plan.slice(plan.indexOf('function aufraeumenTaeglich')),
    /raeumeBildCacheAuf\]/,
    'Der Bild-Cache gehört zum täglichen Aufräumen',
  );
});
