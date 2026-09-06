/**
 * Katalog-Bilder: nutzerunabhängige, bereits heruntergeladene Dateien
 * bevorzugen statt CDN/Proxy.
 *
 * Nutzerwunsch: "image_local sollte doch nie an einen Benutzer gebunden
 * sein. Alle Images sollten Benutzer unabhängig sein. Somit sollte doch auch
 * der Katalog über die Webapp geladen werden können?" — zutreffend:
 * downloadSetImage() (routes/sets.ts) legt Set-Bilder unter
 * public/images/sets/<setnummer>.jpg ab, benannt nach der Setnummer allein.
 * Die Datei ist von Anfang an nutzerunabhängig; nur die Spalte `image_local`
 * lebt zufällig auf der Pro-Nutzer-Zeile in `sets`. Der Katalog kann diese
 * bereits vorhandene Datei nutzen, auch für Sets, die der aktuelle Nutzer
 * nicht selbst besitzt.
 *
 * Ausführen: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { pruefeParameter , abschnitt } = require('./helpers/sources');
const SRC = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'catalog.ts'), 'utf8');
const CODE = SRC.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('die Katalog-Liste prüft auf bereits heruntergeladene Bilder', () => {
  // Aktualisiert: Die ursprüngliche Fassung benutzte fs.promises.access()
  // direkt und lief über ein Promise.all mit bis zu 200 gleichzeitigen
  // Zugriffen — das flutete den libuv-Thread-Pool und löste Datenbank-
  // Timeouts aus (siehe die beiden folgenden Tests). Jetzt über
  // resolveIfExists() (utils/images.ts): synchron, gecacht, bevorzugt
  // ausserdem korrekt die Vorschau.
  const fn = CODE.slice(CODE.indexOf("router.get('/catalog/sets', requireToken"),
                        CODE.indexOf("router.get('/catalog/sets/:setNumber'"));
  assert.match(fn, /const image_local = resolveIfExists\(`\/images\/sets\/\$\{safe\}\.jpg`\);/,
    'Die Liste muss resolveIfExists() benutzen');
  // Dieselbe Sicherheitsbereinigung der Setnummer wie beim Download selbst —
  // sonst könnten Liste und Datei-Ablage auseinanderlaufen.
  assert.match(fn, /replace\(\/\[\^a-z0-9-\]\/gi, '_'\)/,
    'Die Setnummer muss genauso bereinigt werden wie beim Herunterladen');
});

test('der Katalog-Detail-Endpunkt prüft ebenfalls', () => {
  const fn = CODE.slice(CODE.indexOf("router.get('/catalog/sets/:setNumber'"));
  assert.match(fn, /let image_local = resolveIfExists\(`\/images\/sets\/\$\{safe\}\.jpg`\);/,
    'Der Detail-Endpunkt muss dieselbe Prüfung durchführen wie die Liste');
});

test('die Existenzprüfung flutet nicht mehr den Thread-Pool', () => {
  // Gemeldet: Beim Filtern nach Jahr (grosse Trefferzahl auf einmal) luden
  // Seiten nicht mehr, mit "timeout exceeded when trying to connect" im
  // Server-Log. Ursache: Promise.all(sets.map(async s => fs.promises.access))
  // feuerte bis zu 200 gleichzeitige asynchrone Dateisystem-Zugriffe — die
  // laufen über den (standardmässig 4 Threads grossen) libuv-Thread-Pool und
  // fluteten ihn, was andere Pool-Arbeit verzögerte, unter anderem
  // TLS-Handshakes neuer Datenbank-Verbindungen. resolveIfExists() ist
  // synchron UND gecacht — kein Promise.all mit vielen gleichzeitigen
  // fs-Zugriffen mehr nötig.
  // abschnitt() statt slice/indexOf: Auf diesem Ausschnitt stehen NUR
  // doesNotMatch-Zusicherungen, und die sind auf leerem Text gruen. Zieht die
  // Route um oder aendert sich ihre Signatur, soll der Test das sagen statt
  // stillzuschweigen. Siehe die Begruendung an abschnitt().
  const fn = abschnitt(CODE, "router.get('/catalog/sets', requireToken",
                       "router.get('/catalog/sets/:setNumber'", 'Katalogliste ohne Promise.all');
  assert.doesNotMatch(fn, /await Promise\.all\(sets\.map/,
    'Kein Promise.all mit vielen gleichzeitigen fs-Zugriffen mehr');
  assert.doesNotMatch(fn, /fs\.promises\.access/,
    'Die alte, ungebremste asynchrone Prüfung darf nicht mehr vorkommen');
});

test('die Webapp-Katalogkachel läuft über den Server, das Detail direkt vom CDN', () => {
  // Auf Nutzerwunsch vereinheitlicht: Sets, Teile und Minifiguren laden ihre
  // Kacheln längst über imgUrl(thumbUrl(...), true) — der Katalog lud bisher
  // die rohe CDN-Adresse in voller Auflösung direkt im Browser. Jetzt
  // dieselbe Regel: Kachel über den Proxy mit Vorschaubild (kleiner, und
  // profitiert vom serverseitigen image_local-Existenz-Check), Detail direkt
  // vom CDN — genau wie beim Zoom der eigenen Sets (11-actions.js,
  // openImageLightboxFromEl): Für eine einmalige volle Auflösung ist der
  // direkte Browser-Zugriff schneller und entlastet den Server.
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', '09-catalog.js'), 'utf8');

  const cardFn = src.slice(src.indexOf('function catCard('), src.indexOf('function catCard(') + 900);
  // Seit Nachtrag 101 mit 'nur' statt true: Vorschau NUTZEN, aber keine
  // erzeugen. Der Katalog zeigt rund 25 000 fremde Sets; für jedes eine
  // Verkleinerung zu rechnen ist Arbeit, die niemand je wieder braucht — man
  // scrollt vorbei. Die geprüfte Regel bleibt dieselbe: Kachel über den
  // Proxy, nicht roh vom CDN.
  assert.match(cardFn, /imgUrl\(thumbUrl\(src\), 'nur'\)/,
    'Die Katalogkachel muss über den Proxy mit Vorschaubild laufen, wie Sets/Teile/Minifiguren');
  assert.match(cardFn, /const src = s\.image_local \|\| s\.image_url;/,
    'image_local muss bevorzugt werden');

  const modalFn = src.slice(src.indexOf('async function openCatModal'),
                            src.indexOf('async function openCatModal') + 1200);
  assert.match(modalFn, /G\('cat-m-img'\)\.src = detailSrc \? fullUrl\(detailSrc\)/,
    'Das Detail-Bild muss direkt vom CDN kommen (fullUrl ohne imgUrl-Proxy-Wicklung)');
  assert.doesNotMatch(modalFn, /imgUrl\(fullUrl/,
    'Das Detail-Bild darf NICHT über den Proxy laufen — das widerspräche dem Sets-Muster und belastete den Server unnötig');
});

test('der Katalog-Detail-Endpunkt lädt und speichert das Bild dauerhaft, statt nur zwischenzuspeichern', () => {
  // Nutzerwunsch: Beim ersten Aufruf eines Katalog-Sets soll das Bild
  // heruntergeladen, unter public/images/sets/ abgelegt und daraus ein
  // Vorschaubild erzeugt werden — damit auch die spätere Kachel (und ein
  // eventuelles Hinzufügen zum Bestand) keinen zweiten CDN-Abruf mehr
  // braucht. Vorher prüfte der Endpunkt nur, OB die Datei zufällig schon
  // existiert (weil irgendein Nutzer das Set besitzt) — ohne sie selbst zu
  // holen, blieb ein rein durchstöbertes Set für immer beim CDN-Umweg.
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'catalog.ts'), 'utf8');
  const fn = src.slice(src.indexOf("router.get('/catalog/sets/:setNumber'"));

  // Fundort seit Nachtrag 125: utils/setImages.ts, und als echter Import statt
  // als spätes require(). Die Aussage bleibt: DIESELBE Funktion wie addSet().
  const imports = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'catalog.ts'), 'utf8');
  assert.match(imports, /import \{ downloadSetImage \} from '\.\.\/\.\.\/utils\/setImages'/,
    'Der Endpunkt muss dieselbe Download-Funktion wie addSet() benutzen');
  assert.match(fn, /downloadSetImage\(set\.image_url, set\.set_number\)/,
    'Der Endpunkt muss sie auch aufrufen');
  assert.match(fn, /image_local = await downloadSetImage\(set\.image_url, set\.set_number\)/,
    'Das Set-Bild muss aktiv heruntergeladen werden, nicht nur auf Existenz geprüft');

  // Die Vorschau-Erzeugung liegt NICHT in downloadSetImage() selbst (siehe
  // addSet() in routes/sets.ts) — sie muss separat angestossen werden, sonst
  // bekäme das Bild nie eine "_thumb.jpg"-Variante.
  //
  // Seit Nachtrag 105 aber NICHT MEHR VON HIER: Ein direkter Aufruf liefe an
  // den Drosselungen im Bild-Proxy vorbei (THUMB_MAX_PARALLEL, Sitzungssperre),
  // und genau das war die Ursache der über 300 % CPU. Angemeldet wird jetzt
  // beim Hintergrund-Job, der beides erledigt.
  assert.match(fn, /jobs\/imageQueue'\)\.merkeGebraucht/,
    'Die Vorschau muss beim Hintergrund-Job angemeldet werden');
  // Und NICHT direkt — sonst ist die Drosselung wieder umgangen.
  assert.doesNotMatch(fn, /generateThumb\(/,
    'Der Detail-Zweig ruft generateThumb() wieder direkt auf');

  // Nur EINMAL versuchen — wenn bereits ein image_local existiert, darf kein
  // weiterer Download angestossen werden.
  assert.match(fn, /if \(!image_local && set\.image_url\) \{/,
    'Der Download darf nur laufen, wenn noch keine lokale Datei existiert');
});

test('die Katalog-Liste stösst selbst KEINE Bildarbeit mehr an', () => {
  // ── Marcos Zuordnung (Nachtrag 105) ───────────────────────────────────────
  // „Die CPU ist seit der Umstellung des Katalogs mit dem Scrolling so stark
  // ausgelastet."
  //
  // Diese Datei hatte eine EIGENE Bild-Warteschlange, die `generateThumb()`
  // direkt aufrief — vorbei an THUMB_MAX_PARALLEL und an der Sitzungssperre,
  // die beide im Bild-Proxy sitzen. Mit eigener Parallelität 2 und vier
  // Arbeitsprozessen waren das acht gleichzeitige Jimp-Läufe.
  //
  // Der ursprüngliche Wunsch dahinter — „der lokale Cache soll sich über die
  // Zeit aufbauen" — bleibt erfüllt, nur an einer anderen Stelle: Jede
  // Bildanfrage über den Proxy hinterlässt eine Notiz, und jobs/imageQueue.ts
  // legt Bild UND Vorschau im Hintergrund ab. EIN Erzeuger statt zweier, und
  // dieser eine ist gedrosselt.
  const src = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'catalog.ts'), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

  assert.doesNotMatch(code, /generateThumb/,
    'Die Katalog-Datei erzeugt wieder selbst Vorschauen — dann greift keine der ' +
    'Drosselungen aus dem Bild-Proxy');
  assert.doesNotMatch(code, /_catalogDlQueue/,
    'Die eigene Download-Warteschlange ist zurück');
  // Und der Detail-Zweig geht ebenfalls über den Job.
  assert.match(code, /require\('\.\.\/\.\.\/jobs\/imageQueue'\)\.merkeGebraucht/,
    'Der Detail-Zweig meldet das Bild nicht beim Hintergrund-Job an');
});


test('der Katalog benutzt jetzt die gecachte, vorschau-bewusste Existenzprüfung', () => {
  // Zwei Fehler in einer Zeile, beide gemeldet:
  //
  // 1. Die Katalog-Kacheln zeigten immer die volle Auflösung. Ursache: Die
  //    eigene Existenzprüfung fragte nur nach der ORIGINAL-Datei
  //    (`${safe}.jpg`), nie nach der Vorschau (`${safe}_thumb.jpg`) — anders
  //    als resolveImageLocal() in utils/images.ts, das genau das bereits
  //    korrekt macht.
  //
  // 2. Beim Filtern nach Jahr (grosse Trefferzahl auf einmal) luden Seiten
  //    gar nicht mehr, mit Datenbank-Fehlern im Log
  //    ("timeout exceeded when trying to connect"). Ursache:
  //    Promise.all(sets.map(async s => fs.promises.access(...))) feuerte bis
  //    zu 200 gleichzeitige asynchrone Dateisystem-Zugriffe pro Anfrage — die
  //    laufen über den (standardmässig nur 4 Threads grossen) libuv-Thread-Pool
  //    und fluteten ihn, was andere Pool-Arbeit verzögerte, unter anderem
  //    TLS-Handshakes neuer Datenbank-Verbindungen.
  // Kommentarbereinigte Fassung (CODE) benutzen: Der Erklärtext oben nennt
  // "fs.promises.access" selbst, als Beschreibung dessen, was NICHT mehr
  // passiert — mit dem rohen Dateiinhalt würde die Prüfung sich selbst ins
  // Bein schiessen.
  const catalogSrc = fs.readFileSync(path.join(ROOT, 'routes', 'api_v1', 'catalog.ts'), 'utf8');
  const catalogCode = catalogSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(catalogSrc, /import \{ resolveIfExists \} from '\.\.\/\.\.\/utils\/images';/,
    'Die gemeinsame, gecachte Prüfung muss importiert werden');
  assert.doesNotMatch(catalogCode, /fs\.promises\.access/,
    'Die alte, ungebremste asynchrone Prüfung darf nicht mehr vorkommen');
  assert.doesNotMatch(catalogCode, /await Promise\.all\(sets\.map/,
    'Die Liste darf nicht mehr über ein Promise.all mit vielen gleichzeitigen fs-Zugriffen laufen');

  const listFn = catalogSrc.slice(catalogSrc.indexOf("router.get('/catalog/sets', requireToken"),
                                  catalogSrc.indexOf("router.get('/catalog/sets/:setNumber'"));
  assert.match(listFn, /const image_local = resolveIfExists\(`\/images\/sets\/\$\{safe\}\.jpg`\);/,
    'Die Liste muss resolveIfExists() benutzen');

  const detailFn = catalogSrc.slice(catalogSrc.indexOf("router.get('/catalog/sets/:setNumber'"));
  assert.match(detailFn, /let image_local = resolveIfExists\(`\/images\/sets\/\$\{safe\}\.jpg`\);/,
    'Der Detail-Endpunkt muss dieselbe Funktion benutzen wie die Liste');
});

test('resolveIfExists() bevorzugt die Vorschau und ist gecacht', () => {
  const src = fs.readFileSync(path.join(ROOT, 'utils', 'images.ts'), 'utf8');
  pruefeParameter(src, 'resolveIfExists', ['publicRelPath'], 'die Funktion fehlt');
  const fn = src.slice(src.indexOf('function resolveIfExists('));
  assert.match(fn, /return exists \? resolveImageLocal\(publicRelPath\) : null;/,
    'Bei Existenz muss resolveImageLocal() für die Vorschau-Bevorzugung aufgerufen werden');
  assert.match(fn, /const _existsCache = new Map\(\);|_existsCache\.get\(publicRelPath\)/,
    'Ein Cache muss wiederholte Dateisystem-Zugriffe auf denselben Pfad vermeiden');
  assert.match(fn, /fs\.existsSync\(fsPath\)/,
    'Synchron plus Cache statt async über den Thread-Pool');
});
