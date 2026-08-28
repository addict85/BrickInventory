/**
 * Bild-Proxy: Auslieferung, Zwischenspeicherung, Diagnose.
 *
 * Diese Datei ist der Rest von test/image-repair.test.js, nachdem der
 * Reparaturjob wieder ausgebaut wurde. Die hier geprüften Punkte stammen alle
 * aus echten Fehlern und gelten unabhängig davon weiter.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
// Der Bild-Proxy ist aus server.ts nach routes/imgProxy.ts gewandert (server.ts
// war mit über 1200 Zeilen wieder ein kleiner Monolith aus Proxy, Thumb-Queue,
// Cluster-Setup und Startup-Orchestrierung). Die hier geprüften Sachverhalte
// gelten unverändert — sie verteilen sich jetzt nur auf zwei Dateien:
//
//   SERVER_ONLY — was in server.ts geblieben ist (Pfad-Normalisierung,
//                 Reihenfolge der Middleware, Hintergrundläufe)
//   PROXY       — der Proxy selbst
//   SERVER      — beides zusammen, für Prüfungen der Art "kommt X irgendwo vor"
const SERVER_ONLY = require('./helpers/sources').startQuelle();
const PROXY       = require('./helpers/sources').proxyThumbQuelle();
const SERVER      = SERVER_ONLY + '\n' + PROXY;
const CODE = SERVER.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('gleichzeitige Anfragen schreiben in getrennte Temp-Dateien', () => {
  // Der Name enthielt nur die Prozess-ID. Fordert eine Kachelwand dasselbe Bild
  // mehrfach gleichzeitig an, schrieben alle Anfragen desselben Workers in
  // DIESELBE Datei — gemessen 418'603 statt 81'920 Bytes, also fünf Kopien
  // hintereinander. Solche Dateien beginnen mit FFD8 und enden auf FFD9, der
  // Browser kann sie aber nicht dekodieren.
  assert.match(SERVER, /const tmpFile = `\$\{cacheFile\}\.tmp-\$\{process\.pid\}-\$\{_tmpSeq\+\+\}`/,
    'Der Temp-Name braucht eine laufende Nummer je Anfrage');
  assert.match(SERVER, /let _tmpSeq = 0;/, 'Zähler fehlt');
});

test('nur vollständige Dateien kommen in den Cache', () => {
  // Eine abgeschnittene Datei würde dauerhaft ausgeliefert: Der Browser bekommt
  // 200, kann das Bild aber nicht dekodieren.
  assert.match(SERVER, /const expected = parseInt\(String\(r\.headers\['content-length'\]/,
    'Die erwartete Länge muss gemerkt werden');
  // Nach dem Entpacken passt die angekündigte Länge nicht mehr — dann entfällt
  // die Prüfung (siehe „komprimierte Antworten werden entpackt").
  assert.match(SERVER, /if \(!enc && expected > 0 && st\.size !== expected\)/,
    'Vor dem Umbenennen muss die Grösse geprüft werden');
});

test('der Cache-Stream hängt vor dem Client-Stream', () => {
  // r.pipe(ws) stand einmal hinter einem `await mkdir`. r.pipe(res) läuft
  // synchron davor — die ersten Chunks flossen also zum Client, bevor der
  // Cache-Stream überhaupt hing.
  const blk = CODE.slice(CODE.indexOf("const contentType = r.headers['content-type']"),
                         CODE.indexOf('body.pipe(res);') + 20);
  // Seit der Entpackung heisst die Quelle `body` (bei unkomprimierten
  // Antworten identisch mit r, sonst der entpackte Strom).
  const iCache = blk.indexOf('body.pipe(ws)'), iClient = blk.indexOf('body.pipe(res)');
  assert.ok(iCache > 0 && iClient > iCache, 'body.pipe(ws) muss vor body.pipe(res) stehen');
  assert.doesNotMatch(blk.slice(0, iCache), /await /,
    'Zwischen Antwortbeginn und Cache-Stream darf kein await liegen');
});

test('komprimierte Antworten werden entpackt, nicht weitergereicht', () => {
  // Ein durchgereichter komprimierter Körper mit Content-Type: image/jpeg
  // ergibt beim Browser eine weisse Fläche — bei Status 200 und passender
  // Länge, also ohne jeden Hinweis im Log. Entpacken macht auch die
  // gespeicherte Datei zu einem echten Bild, unabhängig von allem davor.
  assert.match(SERVER, /'Accept-Encoding': 'identity'/,
    'Unkomprimiert anfordern ist die erste Verteidigungslinie');
  const idents = (SERVER.match(/'Accept-Encoding': 'identity'/g) || []).length;
  assert.equal(idents, 2, 'Beide Kopfzeilen-Sätze müssen identity anfordern');

  assert.match(SERVER, /enc === 'gzip' \? zlib\.createGunzip\(\)/, 'gzip wird nicht entpackt');
  assert.match(SERVER, /enc === 'br' \? zlib\.createBrotliDecompress\(\)/, 'brotli wird nicht entpackt');
  assert.match(SERVER, /res\.removeHeader\('Content-Length'\)/,
    'Nach dem Entpacken stimmt die angekündigte Länge nicht mehr');

  // Beide Ziele müssen den ENTPACKTEN Strom bekommen
  assert.match(SERVER, /body\.pipe\(ws\)/, 'Der Cache bekommt nicht den entpackten Strom');
  assert.match(SERVER, /body\.pipe\(res\)/, 'Der Client bekommt nicht den entpackten Strom');

  const lengths = (SERVER.match(/res\.setHeader\('Content-Length'/g) || []).length;
  assert.ok(lengths >= 3,
    `Nur ${lengths} von drei Wegen setzen Content-Length (Vorschau, Plattencache, CDN-Abruf)`);
});

test('abgebrochene Client-Anfragen geben die CDN-Verbindung frei', () => {
  // Ohne das blieb der Socket belegt: Der Antwort-Stream lief in ein totes res,
  // die Gegendruck-Steuerung hielt ihn an, und die Warteschlange verhungerte.
  assert.match(SERVER, /res\.on\('close', \(\) => \{[\s\S]{0,400}?activeReq\?\.destroy\(\)/,
    'Der Abbruch muss die laufende CDN-Anfrage beenden');
  // `!writableFinished` allein ist zu scharf: Je nachdem, was zwischen Server
  // und Browser sitzt, kann close feuern, bevor Node writableFinished gesetzt
  // hat — dann wurde eine gesunde Übertragung abgeschossen. Der Client bekam
  // 200 und danach nichts, der Cache blieb leer, protokolliert wurde nichts.
  assert.match(SERVER, /if \(res\.writableFinished \|\| !res\.destroyed\) return;/,
    'res.destroyed ist der belastbare Hinweis auf einen echten Abbruch');
  assert.match(SERVER, /Client hat abgebrochen, Verbindung freigegeben/,
    'Ein Abbruch muss sichtbar sein — stilles Abschiessen war die Ursache');
  assert.match(SERVER, /let activeReq: any = null;/,
    'Beim Rückfall ohne Referer läuft nicht mehr die erste Anfrage');
});

test('der Verbindungs-Pool ist weit genug', () => {
  // Mit 8 wartete ein einzeln geöffnetes Bild hinter 60 Kachel-Anfragen
  // 1195 ms; mit 32 sind es 282 ms, ohne Grenze 153 ms.
  const agent = SERVER.slice(SERVER.indexOf('const _cdnAgent = new'),
                             SERVER.indexOf('const _cdnAgent = new') + 220);
  const m = /maxSockets: (\d+)/.exec(agent);
  assert.ok(m, 'Pool-Konfiguration nicht gefunden');
  assert.ok(parseInt(m[1]) >= 32, `maxSockets ${m[1]} ist zu eng — Einzelabrufe warten spürbar`);
  assert.match(agent, /keepAlive: true/, 'Wiederverwendung spart den TLS-Handshake');
});

test('Fehler werden gezählt und protokolliert', () => {
  // Der Zähler ist seit Nachtrag 129 ein eigenes Modul (utils/imgProxyStats.ts)
  // statt einer Closure, die über `global.__imgProxyFailures` hinausgereicht
  // wurde. Geprüft wird, dass es ihn gibt und dass er alle vier Fälle führt —
  // nicht mehr, wie er geschrieben ist.
  const stats = fs.readFileSync(path.join(ROOT, 'utils', 'imgProxyStats.ts'), 'utf8');
  for (const feld of ['timeout', 'error', 'notFound', 'other', 'lastError']) {
    assert.match(stats, new RegExp(`${feld}:`), `Zähler-Feld fehlt: ${feld}`);
  }
  assert.doesNotMatch(SERVER, /global as any\)\.__imgProxyFailures/,
    'Der Zähler wird wieder über `global` gereicht statt importiert');
  for (const m of ['Zeitüberschreitung nach 25 s', 'Verbindungsfehler', 'CDN antwortete']) {
    assert.ok(SERVER.includes(m), `Log-Meldung fehlt: ${m}`);
  }
  assert.match(SERVER, /an den Client gingen \$\{sentToClient\} von \$\{expected\} Bytes/,
    'Eine zu kurz gelieferte Antwort muss auffallen');
  assert.match(SERVER, /if \(!enc && expected > 0 && sentToClient !== expected\)/,
    'Der Abgleich gilt nur für unentpackte Antworten');
});

test('die Diagnose-Endpunkte sind vorhanden', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'admin.ts'), 'utf8');
  assert.match(admin, /router\.get\('\/admin\/img-probe', requireApiAdmin/, 'img-probe fehlt');
  assert.match(admin, /router\.get\('\/admin\/price-probe', requireApiAdmin/, 'price-probe fehlt');
  assert.match(admin, /content_encoding: r\.headers\['content-encoding'\]/,
    'Die Probe muss zeigen, ob das CDN komprimiert liefert');
  assert.match(admin, /proxy_failures: failures/, 'Die Zähler gehören in die Antwort');
});

test('der ausgebaute Reparaturjob ist restlos weg', () => {
  // Er beruhte auf der Annahme, die Bildadressen seien kaputt. Die war falsch —
  // das CDN lieferte durchgehend 200.
  assert.ok(!fs.existsSync(path.join(ROOT, 'jobs', 'imageRepair.ts')), 'Job-Datei noch da');
  for (const f of ['server.ts', 'utils/jobMonitor.ts', 'jobs/dailyScheduler.ts', 'db/database.ts']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.doesNotMatch(src, /imgRepair|img_repair|dead_images/, `${f}: Reste vorhanden`);
  }
});

test('die Probe zeigt, WAS ausgeliefert wird', () => {
  // Server meldet 200, CDN meldet 200, nichts im Log — und der Browser zeigt
  // trotzdem nichts. Der einzige Blickwinkel, der fehlte, ist der tatsächliche
  // Inhalt der ersten Bytes.
  const admin = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'admin.ts'), 'utf8');
  assert.match(admin, /body_check: head/, 'Die Inhaltsprüfung fehlt in der Antwort');
  assert.match(admin, /first_bytes_hex/, 'Die ersten Bytes gehören als Hex in die Antwort');
  for (const sig of ['JPEG', 'PNG', 'gzip (komprimiert!)', 'HTML/XML statt Bild']) {
    assert.ok(admin.includes(sig), `Erkennung für "${sig}" fehlt`);
  }
  assert.match(admin, /'Accept-Encoding': 'identity'/,
    'Die Prüfung muss dieselbe Anforderung stellen wie der Proxy');
});

test('mehrfache Schrägstriche im Pfad brechen die Route nicht', () => {
  // `//api/img-proxy?…` trifft die Route NICHT und landet im SPA-Catch-all:
  // 200 mit text/html, also die leere Anwendungshülle. Für ein <img> ergibt
  // das eine weisse Fläche bei Status 200 — ohne Log-Eintrag und ohne
  // Cache-Schreiben. Vier Symptome, die wie ein Proxy-Fehler aussehen.
  // Auf VERHALTEN geprüft, nicht auf die Schreibweise einer bestimmten Zeile:
  // Diese Prüfung hing am Wortlaut der ersten von zwei gleichwertigen
  // Middlewares. Als die überflüssige entfiel, wurde sie rot, obwohl die
  // Normalisierung unverändert stattfindet — genau die Sorte Test, die
  // Aufräumen teuer macht.
  const normalisierung = SERVER_ONLY.slice(
    SERVER_ONLY.indexOf("req.url.startsWith('//')"),
    SERVER_ONLY.indexOf("req.url.startsWith('//')") + 400);
  assert.match(normalisierung, /req\.url\s*=/,
    'Pfad-Normalisierung schreibt req.url nicht zurück');
  assert.match(normalisierung, /replace\(/,
    'Pfad-Normalisierung fehlt');
  // Muss vor den Routen stehen, sonst greift sie zu spät
  // Reihenfolge ist nur innerhalb von server.ts aussagekräftig.
  const norm = SERVER_ONLY.indexOf("req.url.startsWith('//')");
  const firstRoute = SERVER_ONLY.indexOf("app.use('/api/");
  assert.ok(norm > 0 && norm < firstRoute,
    'Die Normalisierung muss vor den Route-Registrierungen laufen');
});

test('kaputte Antworten werden nicht für einen Tag im Browser festgenagelt', () => {
  // Beobachtet: "200 OK (from disk cache)" — die Anfrage erreichte den Server
  // gar nicht mehr. Der Browser lieferte eine kaputte Antwort aus der Zeit der
  // behobenen Fehler weiter aus. Kein Log-Eintrag, kein Server-Cache, weisse
  // Fläche. Mit `max-age=86400` ohne Rückfrage dauert das einen ganzen Tag.
  assert.doesNotMatch(SERVER, /'public, max-age=86400'\s*\)/,
    'Ein langes max-age ohne must-revalidate nagelt Fehler im Browser fest');

  // Der gestreamte Pfad kennt den Inhalt noch nicht — dort kurz halten.
  const stream = SERVER.slice(SERVER.indexOf("const contentType = r.headers['content-type']"),
                              SERVER.indexOf('body.pipe(res);'));
  assert.match(stream, /max-age=3600, must-revalidate/,
    'Frisch gestreamte Antworten dürfen nicht lange festgehalten werden');

  // Die Cache-Wege liefern geprüften Inhalt und dürfen länger — aber mit ETag,
  // damit der Browser billig rückfragen kann.
  assert.match(SERVER, /ETag', `"c-\$\{cst\.size\}-\$\{Math\.floor\(cst\.mtimeMs\)\}"`/,
    'ETag für den Plattencache fehlt');
  assert.match(SERVER, /ETag', `"t-\$\{tst\.size\}-\$\{Math\.floor\(tst\.mtimeMs\)\}"`/,
    'ETag für die Vorschau fehlt');
});

test('Minifiguren-Bilder werden lokal abgelegt wie Set-Bilder', () => {
  // Vorher lud der Hintergrundlauf nur `source='manual'`. Minifiguren aus Sets
  // liefen dadurch dauerhaft über /api/img-proxy: Anmeldeprüfung, Cache-Suche
  // und Stream bei jeder Kachel, beim ersten Anzeigen ein CDN-Roundtrip je
  // Bild. Set-Bilder liegen längst lokal und gehen über express.static.
  assert.match(SERVER, /SELECT DISTINCT ON \(fig_number\) fig_number, image_url FROM minifigs/,
    'Der Hintergrundlauf muss alle Minifiguren ohne lokales Bild finden');
  assert.doesNotMatch(SERVER, /FROM minifigs\s+WHERE source='manual' AND image_url IS NOT NULL AND image_local IS NULL/,
    'Die Beschränkung auf manuelle Figuren muss weg sein');

  // Eine Datei je Nummer, geteilt über alle Nutzer
  assert.match(SERVER, /UPDATE minifigs SET image_local=\$1 WHERE fig_number=\$2 AND image_local IS NULL/,
    'Ein Download muss die Zeilen aller Nutzer setzen');

  // Fortschritt im bestehenden Job, kein zweiter Eintrag im Monitoring
  assert.match(SERVER, /const tick = async \(\) => \{/, 'Fortschrittszähler fehlt');
  assert.match(SERVER, /sub: `\$\{done\} \/ \$\{total\} geladen`/, 'Zwischenstand fehlt');
  const mon = fs.readFileSync(path.join(ROOT, 'utils', 'jobMonitor.ts'), 'utf8');
  const figJobs = (mon.match(/^\s{2}\w+:\s*\{/gm) || []).filter(l => /fig|minifig/i.test(l));
  assert.deepEqual(figJobs, [], 'Es darf kein eigener Job dafür entstehen — imgDl deckt es ab');

  // Und die offene Menge im Monitoring muss sie mitzählen
  const admin = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'admin.ts'), 'utf8');
  assert.match(admin, /COUNT\(DISTINCT fig_number\) as c FROM minifigs WHERE image_url IS NOT NULL AND image_local IS NULL/,
    'Die Minifiguren des Bestands fehlen in der offenen Menge');
});

test('nur Bilder verlassen den Bild-Proxy', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Der Content-Type kam ungeprüft vom CDN und wurde so gesetzt UND als
  // Sidecar im Cache abgelegt. Die Host-Liste ist eng und https2.get folgt
  // keinen Weiterleitungen (kein SSRF), aber auf den erlaubten CDNs liegen
  // teils von Nutzern hochgeladene Dateien. Käme dort ein SVG oder HTML
  // zurück, läge es anschliessend unter der EIGENEN Herkunft — und ein SVG
  // ist ein Dokument, das Skript enthalten kann. nosniff und die CSP fangen
  // den Ernstfall ab; eine Route namens img-proxy sollte trotzdem nichts
  // anderes als ein Bild ausliefern.
  //
  // SVG ist bewusst ausgeschlossen: das einzige Bildformat, das als Dokument
  // geöffnet aktiv wird — und keines der angebundenen CDNs liefert Teile-
  // oder Setbilder als SVG.
  assert.match(SERVER, /mime\.startsWith\('image\/'\)/,
    'Der Typ aus der CDN-Antwort muss geprüft werden');
  assert.match(SERVER, /mime === 'image\/svg\+xml'/, 'SVG gehört ausgeschlossen');
  assert.match(SERVER, /res\.status\(415\)/,
    '415 sagt genau das: Der Inhaltstyp passt nicht zu dieser Route');

  // Auch beim Ausliefern AUS dem Cache: Ein vor dieser Prüfung angelegter
  // Eintrag könnte einen fremden Typ tragen.
  assert.match(SERVER, /ctMime\.startsWith\('image\/'\)/,
    'Der Cache-Pfad braucht dieselbe Prüfung — alte Einträge sind ungeprüft');
});

test('ein bekannter Bildstand wird mit 304 beantwortet', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Beide Auslieferpfade setzten einen ETag und `max-age=86400,
  // must-revalidate` — werteten If-None-Match aber nie aus. Nach Ablauf der
  // 24 Stunden fragt der Browser nach und bekam jedes Mal das VOLLSTÄNDIGE
  // Bild zurück: bei einer Kachelwand mit hundert Teilen täglich einmal die
  // ganze Wand statt hundert leerer Antworten. Der ETag sah aus, als täte er
  // etwas, war aber wirkungslos.
  //
  // Die Route /images/* hatte das Problem nie, weil res.sendFile die Prüfung
  // selbst übernimmt — die beiden Bildwege verhielten sich unterschiedlich.
  //
  // Gegen den echten Proxy nachgestellt (rohe Anfrage, nicht fetch — Node
  // hängt bei manuellem If-None-Match automatisch „Cache-Control: no-cache"
  // an, worauf req.fresh korrekt false liefert):
  //   bekannter ETag → 304, 0 Bytes
  //   alter ETag     → 200, volles Bild
  //   no-cache       → 200, volles Bild
  // UMFORMULIERT in Nachtrag 135: Geprüft wurde der WORTLAUT
  //     if (req.fresh) return res.status(304).end();
  // Beim Auslagern der Cache-Auslieferung nach utils/imgCacheServe.ts wurde
  // daraus `if (req.fresh) { res.status(304).end(); return true; }` — dort ist
  // `true` die Meldung „beantwortet" an den Aufrufer. Die Aussage ist
  // unverändert: BEIDE Auslieferpfade prüfen req.fresh und antworten mit 304.
  // CODE statt SERVER: ohne Kommentare. Sonst zählt die Prüfung Erklärtext
  // mit — beim Umzug nach imgCacheServe.ts hat mein eigener Kommentar
  // („aus `return res.status(304).end();` darf kein blosses … werden") die
  // Zahl auf vier getrieben.
  assert.equal((CODE.match(/if \(req\.fresh\)/g) || []).length, 2,
    'Beide Auslieferpfade (Original und Vorschaubild) brauchen die Prüfung');
  assert.equal((CODE.match(/res\.status\(304\)\.end\(\)/g) || []).length, 2,
    'Beide Pfade müssen auch wirklich mit 304 antworten');

  // Sie muss NACH den Kopfzeilen stehen — req.fresh vergleicht gegen den
  // bereits gesetzten ETag.
  const idxEtag  = CODE.indexOf("res.setHeader('ETag'");
  const idxFresh = CODE.indexOf('if (req.fresh)');
  assert.ok(idxEtag > 0 && idxEtag < idxFresh,
    'Ohne gesetzten ETag vergleicht req.fresh gegen nichts');
});

test('der Cache-Aufräumlauf hängt am Primary-Worker', () => {
  // ── Woher dieser Test kommt ─────────────────────────────────────────────
  // Das tägliche Aufräumen stand in registerImgProxy() — und die wird von
  // JEDEM Cluster-Worker aufgerufen. Bei acht Workern hiess das acht
  // vollständige Durchläufe über das Cache-Verzeichnis (readdir plus stat je
  // Datei) und acht Prozesse, die sich beim unlink gegenseitig ins Gehege
  // kamen; unbemerkt, weil die Fehler ohnehin verworfen werden.
  //
  // Alle übrigen wiederkehrenden Arbeiten (Preis-Job, Token-Aufräumen,
  // Log-Bereinigung) hängen längst hinter isPrimaryWorker.
  assert.match(SERVER, /export function startImgCacheCleanup/,
    'Der Lauf muss von aussen startbar sein, statt beim Registrieren loszulaufen');
  const reg = SERVER.slice(SERVER.indexOf('function registerImgProxy'),
                           SERVER.indexOf('export function startImgCacheCleanup'));
  assert.doesNotMatch(reg, /24 \* 60 \* 60 \* 1000/,
    'Kein tägliches Intervall mehr im Teil, den jeder Worker ausführt');

  const main = require('./helpers/sources').startQuelle();
  // Kommentare raus: Die Erklärzeile daneben nennt den Namen ebenfalls, und
  // die Gegenprobe (Aufruf entfernt) blieb dadurch zunächst grün — ein Test,
  // der den Kommentar für den Aufruf hält, prüft gar nichts.
  const jobs = main.slice(main.indexOf('if (!isPrimaryWorker) return;'))
    .replace(/\/\/[^\n]*/g, '');
  assert.match(jobs, /startImgCacheCleanup\(\)/,
    'Der Aufruf gehört zu den übrigen Hintergrundarbeiten des Primary-Workers');
});
