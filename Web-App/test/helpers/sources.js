/**
 * Gemeinsame Quelltext-Zugriffe für die statischen Tests.
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 * Viele Tests prüfen Sachverhalte, indem sie den Quelltext lesen und auf Muster
 * matchen. Sie lasen dafür alle direkt server.ts. Seit der Bild-Proxy nach
 * routes/imgProxy.ts ausgelagert ist (server.ts war mit über 1200 Zeilen wieder
 * ein Monolith aus Proxy, Thumb-Warteschlange, Cluster-Setup und Startup),
 * stehen die geprüften Stellen in zwei Dateien.
 *
 * Statt in jedem Test einzeln zu entscheiden, wo etwas steht, gibt es hier drei
 * klar benannte Sichten. Wandert künftig weiterer Code aus server.ts heraus,
 * ist das eine Stelle statt zwanzig.
 */
const fs   = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/** Nur server.ts. Für Prüfungen, bei denen die REIHENFOLGE innerhalb der Datei zählt. */
// serverOnly() ist bewusst NUR server.ts: Prüfungen, die „was ist in server.ts
// GEBLIEBEN" meinen (Reihenfolge der Middleware, Pfad-Normalisierung), brauchen
// genau das. Wer den START meint, nimmt startQuelle() weiter unten — sonst
// wird die Prüfung durch einen blossen Umzug rot (Nachtrag 134).
const serverOnly = () => fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

/** Nur routes/imgProxy.ts. Für Prüfungen, die ausschliesslich den Proxy betreffen. */
const imgProxy = () => fs.readFileSync(path.join(ROOT, 'routes/imgProxy.ts'), 'utf8');

/**
 * server.ts + routes/imgProxy.ts.
 *
 * Für Prüfungen der Art "kommt Muster X irgendwo im Servercode vor". Die
 * Reihenfolge ÜBER die Dateigrenze hinweg ist hier bedeutungslos — wer
 * indexOf-Vergleiche anstellt, muss serverOnly() oder imgProxy() nehmen.
 */
// ── Was `serverAll()` umfasst (Nachtrag 129) ────────────────────────────────
// Der Bild-Proxy besteht seit dem Aufteilen von registerImgProxy() aus zwei
// Dateien: routes/imgProxy.ts (Route, Cache, CDN-Abruf) und
// src/katalog/bilder/proxyThumbs.ts (Vorschau-Warteschlange, Sperre, Verkleinern). Prüfungen
// der Art „kommt X irgendwo im Server vor" müssen beide sehen — sonst werden
// sie durch einen blossen Umzug rot, ohne dass sich etwas geändert hat.
const serverAll = () => serverOnly() + '\n' + imgProxy() + '\n' + proxyThumbQuelle()
  + '\n' + startQuelle();

/**
 * Die FINANZSCHICHT als eine Quelle — Fassade plus alle Module darunter.
 *
 * ── Warum es diesen Helfer gibt (Nachtrag 171) ──────────────────────────────
 *
 * src/finanzen/financeCalc.ts trug 1529 Zeilen und drei Aufgaben. Seit der Trennung
 * liegen sie unter utils/finance/ (zustand, preise, bewertung, gewinnVerlust),
 * und financeCalc.ts reicht nur noch durch.
 *
 * Neunzehn Pruefungen lasen die eine Datei und stellten Regeln ueber ihren
 * Inhalt auf — „die Schreibregel steht nur an EINER Stelle", „genau EINE
 * Zustandsaufloesung". Diese Regeln gelten der SCHICHT, nicht der Datei. Sie
 * auf financeCalc.ts zu lassen haette sie stillschweigend entwertet: Die
 * Fassade ist zweiunddreissig Zeilen lang, in denen nichts zweimal stehen
 * kann.
 *
 * Deshalb hier die ganze Schicht, aneinandergehaengt. Jede Regel zaehlt damit
 * weiter ueber denselben Stoff wie vorher — nur ist er jetzt sortiert.
 */
const finanzQuelle = () => {
  const ordner = path.join(ROOT, 'src/finanzen/rechnung');
  const teile = [fs.readFileSync(path.join(ROOT, 'src/finanzen/financeCalc.ts'), 'utf8')];
  for (const n of fs.readdirSync(ordner).filter(x => x.endsWith('.ts')).sort()) {
    teile.push(fs.readFileSync(path.join(ordner, n), 'utf8'));
  }
  // Selbstbeweis an der Quelle: Findet der Helfer die Module nicht mehr,
  // pruefen neunzehn Regeln nur noch die Fassade — und waeren still gruen.
  if (teile.length < 4) {
    throw new Error(`finanzQuelle(): nur ${teile.length} Dateien gefunden — liegt src/finanzen/rechnung/ noch da?`);
  }
  return teile.join('\n');
};

module.exports = { ROOT, serverOnly, imgProxy, serverAll, finanzQuelle };

/**
 * Baut die .ts-Quellen nach dist/ und liefert einen require-Helfer darauf.
 *
 * ── Warum das nötig wurde ───────────────────────────────────────────────────
 * Neun Testdateien riefen `scripts/build-ts.js` OHNE --outdir auf. Das Skript
 * schrieb die .js dann neben ihre Quellen — also genau die Vermischung von
 * Quelle und Erzeugnis, die mit der Umstellung auf dist/ verschwinden sollte.
 * Ein einziger `npm test`-Lauf streute damit 56 Build-Artefakte zurück in den
 * Baum, und beim nächsten `npm start` hätte wieder unklar sein können, welche
 * Fassung eigentlich läuft.
 *
 * Der Helfer baut einmal pro Prozess nach dist/ und löst Modulpfade dorthin auf.
 *
 * Aufruf im Test:
 *   const { buildAndRequire } = require('./helpers/sources');
 *   const req = buildAndRequire();
 *   const db  = req('db/database.js');
 */
let _built = false;

/**
 * Jüngster Änderungszeitpunkt aller .ts-Quellen bzw. aller Dateien in dist/.
 * @param {string} dir
 * @param {RegExp} match
 * @returns {number} 0, wenn es das Verzeichnis nicht gibt
 */
function newestMtime(dir, match) {
  if (!fs.existsSync(dir)) return 0;
  let newest = 0;
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (match.test(e.name)) newest = Math.max(newest, fs.statSync(abs).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

/**
 * dist/ ist aktuell, wenn es existiert und nichts unter den Quellen jünger ist.
 *
 * Ohne diese Prüfung baute JEDE der neun Testdateien den kompletten Baum neu —
 * jede läuft in einem eigenen Prozess, der Zwischenspeicher `_built` gilt nur
 * darin. Auf einem Raspberry Pi hat allein das die 60-Sekunden-Grenze des
 * Test-Runners gerissen, obwohl inhaltlich nichts falsch war (die Tests wurden
 * als "cancelled" gemeldet, nicht als "failed"). Nach einem `npm run build`
 * fällt der Bau jetzt ganz weg.
 *
 * @returns {boolean}
 */
function distIsFresh() {
  const dist = path.join(ROOT, 'dist');
  const distAt = newestMtime(dist, /\.js$/);
  if (!distAt) return false;
  let srcAt = fs.statSync(path.join(ROOT, 'server.ts')).mtimeMs;
  for (const d of ['db', 'src', 'routes', 'jobs', 'clients', 'startup']) {
    srcAt = Math.max(srcAt, newestMtime(path.join(ROOT, d), /\.ts$/));
  }
  // Migrationen sind .sql und werden mitkopiert: Eine neue zählt wie eine
  // geänderte Quelle, eine gelöschte über die Zeit des Verzeichnisses.
  const mig = path.join(ROOT, 'db/migrations');
  srcAt = Math.max(srcAt, newestMtime(mig, /\.sql$/), fs.existsSync(mig) ? fs.statSync(mig).mtimeMs : 0);
  return distAt >= srcAt;
}

function buildAndRequire() {
  if (!_built) {
    if (!distIsFresh()) {
      const { execFileSync } = require('node:child_process');
      execFileSync(process.execPath,
        [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')],
        { stdio: 'ignore' });
    }
    _built = true;
  }
  // Wie server.ts: Die Nacharbeit aus utils/ (Nachzug, Preis, Bilder) läuft
  // über jobs/verdrahtung — ohne sie prüften Tests eine stumme Fassung.
  require(path.join(ROOT, 'dist', 'jobs/verdrahtung.js')).verdrahte();
  return rel => require(path.join(ROOT, 'dist', rel));
}

module.exports.buildAndRequire = buildAndRequire;
module.exports.DIST = path.join(ROOT, 'dist');

/**
 * Beide Übersetzungswörterbücher laden.
 *
 * ── Warum es das gibt ───────────────────────────────────────────────────────
 * Die Wörterbücher standen früher direkt in public/i18n.js; mehrere Tests
 * lasen die Datei und werteten sie in einer Sandbox aus. Seit sie nach
 * public/locales/{de,en}.js herausgelöst sind (index.html lädt nur noch die
 * aktive Sprache), liefert i18n.js ein leeres I18N — der Inhalt kommt erst
 * über window.I18N_DE / window.I18N_EN dazu.
 *
 * Dieser Helfer lädt beide Sprachdateien und gibt das zusammengesetzte Objekt
 * zurück, sodass die Tests unverändert weiterprüfen können, was sie geprüft
 * haben.
 *
 * @returns {{de: Record<string,string>, en: Record<string,string>}}
 */
function loadTranslations() {
  const vm = require('node:vm');
  const ctx = { window: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const lang of ['de', 'en']) {
    const file = path.join(ROOT, 'public', 'locales', `${lang}.js`);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  }
  return { de: ctx.window.I18N_DE, en: ctx.window.I18N_EN };
}

/** Roher Quelltext einer Sprachdatei — für Prüfungen auf Doppel-Schlüssel. */
const localeSource = lang =>
  fs.readFileSync(path.join(ROOT, 'public', 'locales', `${lang}.js`), 'utf8');

/** i18n.js + beide Sprachdateien, für "kommt Schlüssel X vor"-Prüfungen. */
const i18nAll = () =>
  fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8')
  + '\n' + localeSource('de') + '\n' + localeSource('en');

module.exports.loadTranslations = loadTranslations;
module.exports.localeSource = localeSource;
module.exports.i18nAll = i18nAll;

/**
 * Quelltext ohne Kommentare — für Prüfungen, die auf Muster im CODE schauen.
 *
 * ── Zwei Fallen, beide schon zugeschnappt ───────────────────────────────────
 * 1. Der eigene Erklärkommentar über einer Prüfung enthält den gesuchten Namen
 *    und hält sie grün (passiert in hardened-123/126/127/128).
 * 2. Ein naives `/\*[\s\S]*?\*\//g` reisst Löcher in die Datei: In server.ts
 *    steht `app.get('/images/*pfad', …)`. Das `/*` darin eröffnet für die
 *    Ersetzung einen Blockkommentar, den erst das nächste echte `*​/` schliesst
 *    — 28 von 53 KB verschwanden, und drei Prüfungen wurden grundlos rot.
 *
 * Deshalb werden nur Blockkommentare entfernt, die eine Zeile BEGINNEN, plus
 * ganze Zeilenkommentare. Ein `/*` mitten in einer Zeichenkette bleibt stehen.
 *
 * @param {string} src
 * @returns {string}
 */
function ohneKommentare(src) {
  return String(src)
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}

module.exports.ohneKommentare = ohneKommentare;

/**
 * Der Vorschau-Weg des Bild-Proxys als EIN Quelltext.
 *
 * ── Warum das ein Helfer ist (Nachtrag 129) ─────────────────────────────────
 *
 * Die Vorschau-Maschinerie des Proxys (Warteschlange, prozessübergreifende
 * Sperre, Verkleinern) ist aus routes/imgProxy.ts nach src/katalog/bilder/proxyThumbs.ts
 * gewandert. Ein Dutzend Prüfungen las bis dahin `routes/imgProxy.ts` und
 * meinte in Wahrheit „irgendwo im Vorschau-Weg des Proxys".
 *
 * Jede einzeln auf den neuen Pfad zu zeigen hiesse, sie beim nächsten Umzug
 * wieder anzufassen — und beim Umbiegen per Textersetzung habe ich in dieser
 * Reihe schon zweimal zu breit ersetzt. Der Helfer nennt den GEGENSTAND statt
 * den Ablageort.
 */
function proxyThumbQuelle() {
  const path = require('path'), fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..');
  return [
    path.join(ROOT, 'routes/imgProxy.ts'),
    path.join(ROOT, 'src/katalog/bilder/proxyThumbs.ts'),
    // Cache-Auslieferung, seit Nachtrag 135 eigene Datei.
    path.join(ROOT, 'src/katalog/bilder/imgCacheServe.ts'),
  ].map(p => fs.readFileSync(p, 'utf8')).join('\n');
}
module.exports.proxyThumbQuelle = proxyThumbQuelle;

/**
 * js/07-admin.js samt der beiden Fenster, die dort bis Nachtrag 130 lagen.
 *
 * ── Warum ein Helfer statt zwölf neuer Pfade ────────────────────────────────
 *
 * Kaufpreis-Modal und Detailfenster für manuelle Einträge sind nach
 * js/13-acquisition-modals.js gewandert. Ein Dutzend Prüfungen las bis dahin
 * `public/js/07-admin.js` und meinte in Wahrheit „irgendwo in der Oberfläche
 * rund um Erfassungen".
 *
 * Jede einzeln umzubiegen hiesse, sie beim nächsten Umzug wieder anzufassen —
 * und beim Umbiegen per Textersetzung ist mir in dieser Reihe schon dreimal
 * eine zu breite Ersetzung passiert. Der Helfer nennt den GEGENSTAND statt den
 * Ablageort.
 */
function adminQuelle() {
  const path = require('path'), fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..');
  return ['07-admin.js', '13-acquisition-modals.js']
    .map(f => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'))
    .join('\n');
}
module.exports.adminQuelle = adminQuelle;

/**
 * Der Set-Kern: die Set-Routen samt dem, was daraus ausgelagert wurde
 * (routes/sets.ts ging in routes/api_v1/sets.ts und src/sets/dienst.ts auf).
 *
 * ── Warum ein Helfer (Nachtrag 131) ─────────────────────────────────────────
 *
 * addSet, updateSet, buildSetsCsv und ihr Umfeld liegen in src/sets/setService.ts,
 * die Katalogarbeit in src/katalog/partsImport.ts und src/katalog/minifigsImport.ts. Ein
 * Dutzend Prüfungen las bis dahin `routes/sets.ts` und meinte „irgendwo im Weg,
 * auf dem ein Set entsteht oder sich ändert".
 *
 * Gleiche Begründung wie bei proxyThumbQuelle() und adminQuelle(): den
 * GEGENSTAND nennen, nicht den Ablageort — sonst muss beim nächsten Umzug
 * wieder jede Prüfung einzeln angefasst werden.
 */
function setKernQuelle() {
  const path = require('path'), fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..');
  return [
    ['routes/api_v1/sets.ts'],
    ['src/sets/dienst.ts'],
    ['src/sets/setService.ts'],
    ['src/katalog/partsImport.ts'],
    ['src/katalog/minifigsImport.ts'],
  ].map(p => fs.readFileSync(path.join(ROOT, ...p), 'utf8')).join('\n');
}
module.exports.setKernQuelle = setKernQuelle;

/**
 * Die Leseabfragen (früher utils/handlers.ts) als EIN Quelltext.
 *
 * ── Warum ein Helfer (Nachtrag 133) ─────────────────────────────────────────
 * utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
 * und liegt jetzt je Fachbereich: src/{sets,teile,figuren}/abfragen.ts,
 * src/bestand/gemeinsam.ts und src/bestand/kennzahlen.ts.
 * Ein Dutzend Prüfungen las die alte Datei und meinte „irgendwo in den
 * Leseabfragen".
 *
 * Dieselbe Begründung wie bei proxyThumbQuelle(), adminQuelle() und
 * setKernQuelle(): den GEGENSTAND nennen, nicht den Ablageort.
 */
const HANDLER_MODULE = ['src/bestand/gemeinsam', 'src/teile/abfragen', 'src/sets/abfragen',
  'src/figuren/abfragen', 'src/bestand/kennzahlen'];
function handlerQuelle() {
  const path = require('path'), fs = require('fs');
  const wurzel = path.join(__dirname, '..', '..');
  return HANDLER_MODULE.map(m => fs.readFileSync(path.join(wurzel, m + '.ts'), 'utf8')).join('\n');
}
module.exports.handlerQuelle = handlerQuelle;

/**
 * Das gebaute Modul für einen Namen aus den Leseabfragen. Ersetzt
 * `_req('utils/handlers.js')`, das es so nicht mehr gibt.
 */
function handlerModul(_req) {
  return Object.assign({},
    ..._req && HANDLER_MODULE.map(m => _req(`${m}.js`)));
}
module.exports.handlerModul = handlerModul;

/**
 * server.ts samt dem Start des Job-Prozesses und den Läufen, die früher dort
 * standen (startup/, jobs/bildNachlauf.ts, jobs/startNachlaeufe.ts,
 * jobs/aufraeumen.ts). Prüfungen der Art „läuft X beim Start an" sehen alle.
 *
 * Fünfter Helfer desselben Musters — siehe proxyThumbQuelle().
 */
function startQuelle() {
  const path = require('path'), fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = path.join(ROOT, 'startup');
  const teile = ['server.ts', 'jobs/bildNachlauf.ts', 'jobs/startNachlaeufe.ts', 'jobs/aufraeumen.ts',
    'src/katalog/repository/bildlage.ts']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
      teile.push(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  return teile.join('\n');
}
module.exports.startQuelle = startQuelle;

/**
 * Die Portfolio-Kurve: Orchestrierung samt Rekonstruktion und Diagrammdaten.
 *
 * getPortfolioHistory() war 449 Zeilen und liegt seit Nachtrag 135 als
 * src/finanzen/portfolioHistory.ts + src/finanzen/portfolio/{kurve,diagrammdaten}.ts.
 *
 * Sechster Helfer desselben Musters — siehe proxyThumbQuelle(): den GEGENSTAND
 * nennen, nicht den Ablageort.
 */
function portfolioQuelle() {
  const path = require('path'), fs = require('fs');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = path.join(ROOT, 'src/finanzen/portfolio');
  const teile = [fs.readFileSync(path.join(ROOT, 'src/finanzen/portfolioHistory.ts'), 'utf8')];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
      teile.push(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  return teile.join('\n');
}
module.exports.portfolioQuelle = portfolioQuelle;

/**
 * js/01-core.js samt der Abschnitte, die daraus ausgelagert wurden.
 *
 * ── Warum ein Helfer (Nachtrag 136) ─────────────────────────────────────────
 *
 * Kontofilter und eigener Scrollbalken liegen seit Nachtrag 136 in
 * js/14-scope.js bzw. js/15-scrollbar.js, der Fortschrittsbalken und die
 * Überwachung seit Nachtrag 141 in js/01-fortschritt.js bzw.
 * js/01-monitor.js. Ein Dutzend Prüfungen las
 * `public/js/01-core.js` und meinte „irgendwo in der Grundausstattung des
 * Frontends".
 *
 * Siebter Helfer desselben Musters — siehe proxyThumbQuelle(): den GEGENSTAND
 * nennen, nicht den Ablageort.
 */
function coreQuelle() {
  const path = require('path'), fs = require('fs');
  const dir = path.join(__dirname, '..', '..', 'public', 'js');
  // 00-escapen.js steht VORNE: Seit dem 20.10. liegt esc() dort (DOM-frei,
  // damit der BrickLink-Export es benutzen kann, ohne js/01-core.js zu laden).
  // Wer die Grundausstattung liest, meint esc() mit — test/
  // frontend-escaping.test.js schneidet sich seinen Sandkasten genau ab
  // `function esc(s)` heraus und fand nach dem Umzug nichts mehr
  // („esc is not defined", vier Fälle rot). Derselbe Grund wie fuer diesen
  // Helfer ueberhaupt: den GEGENSTAND nennen, nicht den Ablageort.
  return ['00-escapen.js', '01-core.js', '01-fortschritt.js', '01-monitor.js',
          '14-scope.js', '15-scrollbar.js']
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}
module.exports.coreQuelle = coreQuelle;

/**
 * Der Kopf einer Funktion — von `function <name>(` bis zur schliessenden
 * Klammer der Parameterliste.
 *
 * ── Warum (Nachtrag 148) ────────────────────────────────────────────────────
 * Prüfungen der Art „nimmt diese Funktion noch einen Zustand entgegen?" waren
 * bisher als Muster über den ganzen Kopf geschrieben, inklusive aller anderen
 * Parameter:
 *
 *     assert.match(src, /function getCurrentFigMarketPrice\([^)]*condition = null\)/)
 *
 * Damit hängt die Prüfung an Dingen, über die sie gar nichts sagen will: an
 * der Reihenfolge der Parameter und an ihrer Schreibweise. Beim Einschalten
 * von strictNullChecks wurde aus `condition = null` ein
 * `condition: string | null = null` — vier solcher Prüfungen wurden rot,
 * obwohl sich am Verhalten nichts geändert hatte. Dieselbe Sorte Test, die in
 * Nachtrag 118 eine Sicherheitslücke festgeschrieben hat.
 *
 * Mit dieser Funktion nennt die Prüfung ihren GEGENSTAND: den Parameter.
 *
 * @param {string} src Quelltext
 * @param {string} name Funktionsname
 * @returns {string} Der Kopf, z.B. "function f(a, b: string | null = null)"
 */
function funktionsKopf(src, name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`Funktion ${name} gibt es nicht (mehr)`);
  let depth = 0;
  for (let j = src.indexOf('(', i); j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')' && --depth === 0) return src.slice(i, j + 1);
  }
  throw new Error(`Parameterliste von ${name} ist nicht geschlossen`);
}
module.exports.funktionsKopf = funktionsKopf;

/**
 * Der RUMPF einer Funktion, ohne die umschliessenden Klammern.
 *
 * ── Warum es das gibt (diese Sitzung) ───────────────────────────────────────
 * set-add-exists-db baute sich die Extraktion selbst:
 *
 *     src.indexOf('function sanitizeSetNumber(input) {')
 *
 * Zwei Fehler in einer Zeile. Der Parametername steht mit drin, also zerbrach
 * der Anker, sobald `input` eine Typannotation bekam. Und es gab keine
 * Fundpruefung: indexOf lieferte -1, slice(-1) das letzte Zeichen, und
 * `new Function` daraus eine Funktion, die still `undefined` zurueckgab. Der
 * Test meldete deshalb nicht „Anker veraltet", sondern eine Abweichung im
 * ERGEBNIS — das kostet beim Suchen ein Vielfaches.
 *
 * Deshalb hier, neben funktionsKopf, mit denselben zwei Eigenschaften:
 * annotationsunabhaengig (gesucht wird `function name(`) und WIRFT, wenn es
 * nichts findet.
 *
 * Das Ende ist die schliessende Klammer in SPALTE 0 — in diesem Baum die
 * Konvention fuer Funktionen der obersten Ebene, und robust gegen geschweifte
 * Klammern in Zeichenketten und Kommentaren.
 */
function funktionsRumpf(src, name) {
  const kopf = funktionsKopf(src, name);
  const nachKopf = src.indexOf(kopf) + kopf.length;
  const auf = src.indexOf('{', nachKopf);
  if (auf < 0) throw new Error(`Rumpf von ${name} beginnt nicht mit {`);
  const zu = src.indexOf('\n}', auf);
  if (zu < 0) throw new Error(`Rumpf von ${name} ist nicht geschlossen`);
  return src.slice(auf + 1, zu);
}
module.exports.funktionsRumpf = funktionsRumpf;

/**
 * Nimmt `name` einen Parameter `param` entgegen — unabhängig von Typannotation
 * und Position? Mit `mitVorgabeNull` zusätzlich: hat er die Vorgabe null (dann
 * dürfen Aufrufer ihn weglassen)?
 */
function hatParameter(src, name, param, mitVorgabeNull = false) {
  const kopf = funktionsKopf(src, name);
  const drin = new RegExp(`\\b${param}\\b`).test(kopf);
  if (!drin) return false;
  if (!mitVorgabeNull) return true;
  return new RegExp(`\\b${param}\\b[^,)]*=\\s*null`).test(kopf);
}
module.exports.hatParameter = hatParameter;

/**
 * Prüft, dass `name` genau diese Parameter entgegennimmt — der Reihe nach,
 * aber ohne Rücksicht auf Typannotationen, Vorgabewerte oder Zeilenumbrüche.
 *
 * Die bequeme Form für den häufigsten Fall. Statt
 *
 *     assert.match(src, /async function withOwners\(uids: number\[\], rows: any\[\]\)/)
 *
 * schreibt man
 *
 *     pruefeParameter(src, 'withOwners', ['uids', 'rows']);
 *
 * Der Unterschied ist nicht Bequemlichkeit, sondern WORÜBER die Prüfung eine
 * Aussage macht. Die erste Fassung fällt um, sobald jemand `rows: any[]` zu
 * `rows: Row[]` schärft — eine Verbesserung, die als Fehler gemeldet wird.
 * Genau das ist in den Nachträgen 148 und 150 sechsmal passiert.
 *
 * @param {string} src Quelltext
 * @param {string} name Funktionsname
 * @param {string[]} params Erwartete Parameter, in Reihenfolge
 * @param {string} [hinweis] Zusatz für die Fehlermeldung
 */
function pruefeParameter(src, name, params, hinweis = '') {
  const assert = require('node:assert/strict');
  const kopf = funktionsKopf(src, name);
  // Nur die Parameterliste, ohne "function <name>(" und ohne die letzte ")".
  const innen = kopf.slice(kopf.indexOf('(') + 1, kopf.length - 1);

  let zuletzt = -1;
  for (const p of params) {
    const treffer = new RegExp(`\\b${p}\\b`).exec(innen.slice(zuletzt + 1));
    assert.ok(treffer,
      `${name} nimmt '${p}' nicht (mehr) entgegen${hinweis ? ' — ' + hinweis : ''}: ${kopf}`);
    zuletzt = zuletzt + 1 + treffer.index;
  }
}
module.exports.pruefeParameter = pruefeParameter;

/**
 * Wo haengt welcher Router? — aus server.ts GELESEN, nicht abgeschrieben.
 *
 * ── Warum das hier steht ────────────────────────────────────────────────────
 * Drei Pruefungen trugen dieselbe Liste als Literal:
 *
 *     const MOUNT = { auth: '/api/auth', sets: '/api/sets', … }
 *
 * Beim Zusammenlegen der API-Oberflaechen ist genau das passiert, wogegen
 * dieses Projekt sonst prueft: Die Einhaengepunkte in server.ts aenderten
 * sich, die drei Kopien nicht — zwei Pruefungen scheiterten mit „ENOENT:
 * routes/finance.ts", eine verglich fortan Aepfel mit Birnen.
 *
 * Eine Pruefung, die die Verdrahtung ABSCHREIBT, prueft nicht die
 * Verdrahtung. Sie liest sie jetzt.
 *
 * @returns [{ mount: '/api/v1/sets', datei: '<abs>/routes/sets.ts', name: 'sets' }]
 *          ohne routes/api_v1/* — das ist der Index selbst.
 */
function routerEinhaengungen() {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8'));
  // `import xRouter = require('./routes/x')` oben, `app.use('/api/…', xRouter)` unten.
  const dateiJeName = new Map([...src.matchAll(/import\s+(\w+)\s*=\s*require\(\s*['"]\.\/(routes\/[^'"]+)['"]\s*\)/g)]
    .map(m => [m[1], m[2]]));
  const out = [];
  for (const m of src.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*(\w+)\s*\)/g)) {
    const datei = dateiJeName.get(m[2]);
    if (!datei || datei.startsWith('routes/api_v1')) continue;
    out.push({ mount: m[1].replace(/\/+$/, ''), datei: path.join(ROOT, datei + '.ts'),
               name: datei.replace(/^routes\//, '') });
  }
  return out;
}
module.exports.routerEinhaengungen = routerEinhaengungen;

/**
 * Der Einhaengepunkt EINES Routers, ueber den Dateinamen gesucht.
 *
 * ── Warum es das braucht ────────────────────────────────────────────────────
 * Vier Pruefungen mit eigenem Pruefstand (auth-sessions, admin-role,
 * forgot-password, qr-token) haengten routes/auth.js von Hand unter
 * '/api/auth'. Sie blieben dadurch gruen, als der Router nach /api/v1/auth
 * umzog — sie pruefen ja ihre eigene Verdrahtung, nicht die des Servers. Grün
 * heisst dann nur noch „mein Pruefstand ist in sich stimmig".
 *
 * Mit dieser Funktion steht die Adresse an EINER Stelle: in server.ts.
 *
 * @param {string} name Dateiname ohne routes/ und ohne .ts, z. B. 'auth'.
 * @returns {string} z. B. '/api/v1/auth'
 */
function einhaengung(name) {
  const treffer = routerEinhaengungen().filter(r => r.name === name);
  if (treffer.length !== 1)
    throw new Error(`routes/${name}.ts haengt ${treffer.length}-mal in server.ts — erwartet: genau einmal`);
  return treffer[0].mount;
}
module.exports.einhaengung = einhaengung;

/**
 * Einen Ausschnitt aus einer Quelle schneiden — und WERFEN, wenn der Anker
 * fehlt.
 *
 * ── Woher das kommt ─────────────────────────────────────────────────────────
 * Die Tests schneiden 106-mal mit `src.slice(src.indexOf('…'), …)`. Fehlt der
 * gesuchte Text, liefert indexOf -1, und `slice(-1)` gibt das letzte Zeichen:
 * ein praktisch leerer Ausschnitt.
 *
 * Bei 101 dieser Stellen faellt das von selbst auf, weil eine positive
 * Zusicherung folgt (`assert.match`, `assert.ok`) — die wird auf leerem Text
 * rot. Bei vier Stellen standen NUR `assert.doesNotMatch`, und die sind auf
 * leerem Text GRUEN. Dort prueft der Test dann nichts mehr und sagt nichts.
 *
 * Genau so ist es in dieser Sitzung passiert: Beim Verschieben von
 * estimateFigPriceFromParts nach src/finanzen/marketPrice.ts zeigten mehrere Schnitte
 * ins Leere. Es fiel auf, WEIL dort `assert.match` stand. Mit `doesNotMatch`
 * waeren sie gruen geblieben.
 *
 * @param {string} quelle  der ganze Dateiinhalt
 * @param {string} ab      Text, ab dem geschnitten wird (muss vorkommen)
 * @param {string} [bis]   Text, bis zu dem geschnitten wird (muss vorkommen,
 *                         wenn angegeben) — sonst bis zum Ende
 * @param {string} [wozu]  wofuer der Ausschnitt gebraucht wird, fuer die Meldung
 */
function abschnitt(quelle, ab, bis, wozu = '') {
  const i = String(quelle).indexOf(ab);
  if (i < 0) throw new Error(
    `Ankertext nicht gefunden${wozu ? ` (${wozu})` : ''}: ${JSON.stringify(ab).slice(0, 90)}\n` +
    'Der Ausschnitt waere leer, und Zusicherungen darauf pruefen nichts mehr.');
  if (bis === undefined) return String(quelle).slice(i);
  const j = String(quelle).indexOf(bis, i);
  if (j < 0) throw new Error(
    `Endanker nicht gefunden${wozu ? ` (${wozu})` : ''}: ${JSON.stringify(bis).slice(0, 90)}`);
  return String(quelle).slice(i, j);
}

module.exports.abschnitt = abschnitt;

/**
 * Ein Pfad-Literal des Frontends auf seine FORM bringen.
 *
 * ── Warum das hier steht und nicht zweimal daneben (19.10.) ─────────────────
 *
 * Zwei Prüfungen lesen dieselben Pfade und hatten dafür zwei Fassungen:
 * test/webapp-endpunkte.test.js eine sorgfältige (ihr Kopf zählt drei
 * Anläufe auf, die danebenlagen) und test/frontend-api-paths.test.js eine
 * naive:
 *
 *     roh.replace(/\$\{[^}]*\}/g, ':x')
 *
 * `[^}]*` kann über ein VERSCHACHTELTES `${…}` nicht hinweg. Bei
 *
 *     `/v1/parts/${nr}/${farbe}${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`
 *
 * endet der Ersatz am `}` von `encodeURIComponent(owner)`, und übrig bleibt
 * GEMESSEN:
 *
 *     /api/v1/parts/:x/:x:x` : ''}
 *
 * Das ist kein Pfad. Die Prüfung war trotzdem grün — und zwar aus Zufall: Ihr
 * Vergleich läuft Segment für Segment und nimmt jedes Routensegment hin, das
 * mit `:` beginnt. Der Müll landete im Segment der Farb-ID, also an einer
 * Stelle, wo die Route `:colorId` erwartet. Derselbe Aufruf mit einem Segment
 * DAHINTER (`…/${farbe}/color${owner ? …}`) trifft dort ein Literal und fällt
 * sofort auf.
 *
 * Eine Prüfung, die bei kaputtem Werkzeug schweigt, ist schlimmer als keine.
 * Deshalb gibt es die Auflösung jetzt EINMAL, hier, mit der Fassung, die
 * nachgemessen ist.
 *
 * Ein `${…}` ist nur dann ein PFADABSCHNITT, wenn direkt ein `/` davorsteht:
 *
 *     `/v1/parts/${nr}/${farbe}`            → /v1/parts/:X/:X
 *     `/v1/minifigs/${nr}${owner ? …: ''}`  → /v1/minifigs/:X
 *
 * Im zweiten Fall hängt der Ausdruck am Segment und liefert einen Abfrageteil
 * oder gar nichts; dort endet der Pfad.
 *
 * @param {string} roh       das Literal, ohne Backticks
 * @param {string} [marke]   Platzhalter je Abschnitt — ':X' oder ':x'
 */
function pfadForm(roh, marke = ':X') {
  let s = String(roh);
  let vor = null;
  // Innerste zuerst, bis nichts mehr passt — so verschwindet auch ein
  // verschachtelter Ausdruck vollstaendig.
  while (vor !== s) { vor = s; s = s.replace(/\$\{[^{}]*\}/g, '\u0000'); }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\u0000') { out += s[i]; continue; }
    if (out.endsWith('/')) { out += marke; continue; }
    break;                       // Anhängsel, kein Abschnitt → hier endet der Pfad
  }
  return out.split('?')[0].replace(/'\s*\+.*$/, '');
}

module.exports.pfadForm = pfadForm;

/**
 * Ein Zeichenketten-Literal ab Position `i` lesen — mit VERSCHACHTELTEN
 * Template-Ausdrücken.
 *
 * ── Warum das hier steht (19.10.) ───────────────────────────────────────────
 *
 * Dieselbe Geschichte wie bei pfadForm() darüber, nur eine Ebene davor: Ein
 * einzelner regulärer Ausdruck kann ein solches Literal nicht lesen. Der Pfad
 *
 *     `/v1/parts/${nr}/${farbe}/color${owner ? `?owner=${owner}` : ''}`
 *
 * enthält BACKTICKS in seinem eigenen Inneren. Jedes `[^`]*` bricht dort ab
 * und liefert einen halben Ausdruck.
 *
 * test/webapp-endpunkte.test.js hatte diese Fassung (ihr Kopf nennt fünf
 * falsche Treffer beim Nachmessen), test/frontend-api-paths.test.js daneben
 * ein nacktes ``(`[^`]*`|'[^']*')``. GEMESSEN lieferte das für den Pfad oben
 * den Text ``/v1/parts/${…}/${…}/color${owner `` — die Prüfung meldete einen
 * Pfad, den niemand aufruft, und die Route dahinter gab es sehr wohl.
 *
 * @returns {{text: string, ende: number}|null} Inhalt ohne Anführungszeichen
 *   und die Position NACH dem Literal; null, wenn an `i` keines beginnt.
 */
function leseLiteral(src, i) {
  const anf = src[i];
  if (anf !== '`' && anf !== "'" && anf !== '"') return null;
  let j = i + 1, tiefe = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') { j += 2; continue; }
    if (anf === '`' && c === '$' && src[j + 1] === '{') { tiefe++; j += 2; continue; }
    if (tiefe > 0) {
      if (c === '{') tiefe++;
      else if (c === '}') tiefe--;
      // Innerhalb eines ${…} darf ein weiteres Literal stehen; es wird
      // mitgelesen, damit sein Inhalt die Zählung nicht durcheinanderbringt.
      else if (c === '`' || c === "'" || c === '"') {
        const inner = leseLiteral(src, j);
        if (inner) { j = inner.ende; continue; }
      }
      j++; continue;
    }
    if (c === anf) return { text: src.slice(i + 1, j), ende: j + 1 };
    j++;
  }
  return null;
}

module.exports.leseLiteral = leseLiteral;

/**
 * Alle Routen unter /api/v1, wie sie im Quelltext eingetragen sind: [Methode, Pfad].
 * Für test/api-eingang-db.test.js — die Dateiliste steht hier, damit der Test
 * selbst keinen variablen Pfad liest (test/eigenbruecken.test.js zählt sie).
 */
function v1Routen() {
  const gefunden = [];
  const lies = (datei, vorne) => {
    const s = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    for (const m of s.matchAll(/(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g))
      gefunden.push([m[1].toUpperCase(), vorne + m[2]]);
  };
  for (const f of fs.readdirSync(path.join(ROOT, 'routes/api_v1')).filter(f => f.endsWith('.ts')))
    lies(`routes/api_v1/${f}`, '/api/v1');
  lies('routes/auth.ts', '/api/v1/auth');
  lies('server.ts', '');
  return gefunden.filter(([, p]) => p.startsWith('/api/v1'));
}
module.exports.v1Routen = v1Routen;

/**
 * Alle TypeScript-Quellen des Servers (relativ zu ROOT), ohne Tests, Skripte
 * und Erzeugnisse — für Prüfungen, die eine Eigenschaft überall verlangen,
 * statt eine Dateiliste zu führen, die beim nächsten Umzug veraltet.
 */
function alleQuellen() {
  const raus = [];
  const lauf = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = rel ? path.posix.join(rel, e.name) : e.name;
      if (e.isDirectory()) { if (!['node_modules', 'dist', 'test', 'scripts', 'public', 'docs', '.git'].includes(e.name)) lauf(kind); }
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) raus.push(kind);
    }
  };
  lauf('');
  return raus;
}
module.exports.alleQuellen = alleQuellen;
