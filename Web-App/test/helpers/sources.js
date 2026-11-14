/**
 * Gemeinsame Quelltext-Zugriffe für die statischen Tests. Die Sichten nennen
 * den GEGENSTAND einer Prüfung, nicht den Ablageort: Wandert Code um, ändert
 * sich eine Stelle hier statt zwanzig Prüfungen.
 */
const { istAppModul } = require('../../scripts/build-frontend');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/** Die App (startup/app.ts, Middleware in ihrer Reihenfolge) und server.ts:
 *  für Prüfungen, bei denen die REIHENFOLGE zählt. Wer den Start meint, nimmt startQuelle(). */
const serverOnly = () =>
  fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8') +
  '\n' +
  fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

const imgProxy = () =>
  fs.readFileSync(path.join(ROOT, 'src/bilder/http/bildProxy.ts'), 'utf8') +
  '\n' +
  fs.readFileSync(path.join(ROOT, 'routes/imgProxy.ts'), 'utf8');

/** Server, Bild-Proxy und Vorschau-Weg: für „kommt X irgendwo vor". Die
 *  Reihenfolge über Dateigrenzen ist bedeutungslos — für indexOf-Vergleiche
 *  serverOnly() oder imgProxy() nehmen. */
const serverAll = () => serverOnly() + '\n' + imgProxy() + '\n' + proxyThumbQuelle() + '\n' + startQuelle();

/** Die ganze Finanzschicht aneinandergehängt: Die Regeln („nur EINE
 *  Zustandsauflösung") gelten der Schicht, nicht der Fassade financeCalc.ts. */
const finanzQuelle = () => {
  const ordner = path.join(ROOT, 'src/finanzen/rechnung');
  const teile = [dienstQuelle('src/finanzen/financeCalc.ts')];
  for (const n of fs
    .readdirSync(ordner)
    .filter(x => x.endsWith('.ts'))
    .sort()) {
    teile.push(dienstQuelle('src/finanzen/rechnung/' + n));
  }
  // Selbstbeweis: Fände der Helfer die Module nicht, prüften die Regeln nur die
  // Fassade und wären still grün.
  if (teile.length < 4) {
    throw new Error(`finanzQuelle(): nur ${teile.length} Dateien gefunden — liegt src/finanzen/rechnung/ noch da?`);
  }
  return teile.join('\n');
};

module.exports = {
  ROOT,
  serverOnly,
  imgProxy,
  serverAll,
  finanzQuelle,
  umgebung,
  buildAndRequire,
  testZugang,
  testDaten,
  testBildwerk,
  testQuellen,
  alsKonto,
  testDienste,
  testKontext,
  testBereich,
  ersetzeDienste,
  testNacharbeit,
  bereichsSeite,
};

/**
 * Baut die .ts-Quellen nach dist/ (nie neben die Quellen) und liefert einen
 * require-Helfer darauf: `buildAndRequire()('src/sets/index.js')`.
 */
let _built = false;

/** @returns {number} 0, wenn es das Verzeichnis nicht gibt */
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

/** Ohne diese Prüfung baute jede Testdatei in ihrem eigenen Prozess den Baum
 *  neu und riss auf schwacher Hardware die Zeitgrenze des Test-Runners. */
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

/** dist/ und Bündel auf den Stand der Quellen bringen, ohne etwas daraus zu laden.
 *  Das Bündel gehört dazu, weil jeder Server mit Oberfläche es ausliefert. */
function baueDist() {
  if (_built) return;
  require('./buendel').stelleBuendelSicher();
  if (!distIsFresh()) {
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
      stdio: 'ignore',
    });
  }
  _built = true;
}

/** Der Zugang der Testdatei: db/database kennt keinen Zugang des Prozesses mehr;
 *  ein Test bekommt ihn wie der Server von seinem Einstieg, hier also von hier. */
let _testDb = null;
let _eigenDb = null;
/** Erzeugen die Zugänge; gesetzt von buildAndRequire(). */
let _zugangFabrik = null;
/** Baut Dienste und Kontexte dieser Testdatei; gesetzt von buildAndRequire(). */
let _dienstFabrik = null;
let _gebaut = null;
/** Ersetzungen (ersetzeDienste), auch vor dem ersten Bau gemerkt. */
const _ersatz = [];
const _nacharbeit = {};

/** Die Dienste dieser Testdatei: baueDienste(testZugang()) wie im Server, einmal je Datei. */
/** @returns {any} */
function testDienste() {
  if (!_dienstFabrik) throw new Error('testDienste() erst nach buildAndRequire()');
  if (!_gebaut) {
    _gebaut = _dienstFabrik();
    for (const [b, e] of _ersatz) Object.assign(_gebaut.d[b], e);
  }
  return _gebaut.d;
}

/** Der Kontext eines Bereichs (Repositories, Zugang, Abhängigkeiten) für Tests, die
 *  hineinsehen; die Dienste selbst geben ihn nicht heraus. */
/** @param {string} bereich @returns {any} */
function testKontext(bereich) {
  testDienste();
  const k = _gebaut.kontexte[bereich];
  if (!k) throw new Error(`kein Kontext für ${bereich}`);
  return k;
}

/** Ersetzt Dienste eines Bereichs für diese Testdatei, auch für andere Bereiche, die
 *  sie über ihren Kontext rufen (dasselbe Objekt). Vor oder nach dem ersten Bau. */
function ersetzeDienste(bereich, ersatz) {
  _ersatz.push([bereich, ersatz]);
  if (_gebaut) Object.assign(_gebaut.d[bereich], ersatz);
}

/** Die öffentliche Seite eines Bereichs (index.js) samt seinen Diensten dieser Testdatei:
 *  Was index.js nicht exportiert, reicht beim Aufruf an testDienste()[bereich] weiter,
 *  damit eine Datei die Dienste erst baut, wenn ein Test sie ruft. */
/** @param {string} bereich @returns {any} */
function bereichsSeite(bereich) {
  const modul = require(path.join(ROOT, 'dist', 'src', bereich, 'index.js'));
  return new Proxy(modul, {
    get: (m, n) => (n in m ? m[n] : (...a) => testDienste()[bereich][n](...a)),
  });
}

/** Die Nacharbeit dieser Testdatei: Ein Test ersetzt eine Methode darin. */
/** @returns {any} */
function testNacharbeit() {
  return _nacharbeit;
}

/** Wie früher xBereich(): Dienste eines Bereichs, Lesezugriff fällt auf seinen Kontext
 *  zurück. Schreiben geht an die Dienste. */
/** @param {string} bereich @returns {any} */
function testBereich(bereich) {
  return new Proxy(
    {},
    {
      get: (_z, n) => {
        const d = testDienste()[bereich];
        return n in d ? d[n] : testKontext(bereich)[n];
      },
      set: (_z, n, v) => {
        testDienste()[bereich][n] = v;
        return true;
      },
      has: (_z, n) => n in testDienste()[bereich] || n in testKontext(bereich),
      ownKeys: () => [
        ...new Set([...Reflect.ownKeys(testKontext(bereich)), ...Reflect.ownKeys(testDienste()[bereich])]),
      ],
      getOwnPropertyDescriptor: (_z, n) => {
        const d = testDienste()[bereich];
        const quelle = n in d ? d : testKontext(bereich);
        return n in quelle ? { value: quelle[n], enumerable: true, configurable: true, writable: true } : undefined;
      },
    },
  );
}
let _datenFabrik = null;
/** Das Bildwerk der Dienste (src/katalog/kontext.ts): eines je Datei, auch wenn sie
 *  buildAndRequire() mehrmals ruft, damit ein ersetzter Teil nicht verloren geht. */
const _bildwerk = {
  setBildLaden: (...a) => require(path.join(ROOT, 'dist', 'src/bilder/setImages.js')).setBildHerunterladen(...a),
  vorschauErzeugen: (...a) => require(path.join(ROOT, 'dist', 'src/bilder/thumbs.js')).generateThumb(...a),
};

/** Die ersetzten Klienten der Dienste (src/fremdquellen/quellen.ts): leer heisst echt. */
const _quellen = {};

function buildAndRequire() {
  // Jede Antwort einer Route mit Vertrag läuft in Tests durch ihr Schema (src/http/vertragsRouter.ts).
  process.env.VERTRAG_PRUEFEN ??= '1';
  // Ohne NODE_ENV gelten die Regeln des Betriebs (Superuser-Verbot, APP_BASE_URL);
  // ausserhalb von npm test (und mit `@superuser`) ist die Test-DB Superuser, und gestartete Server erben das.
  process.env.NODE_ENV ??= 'test';
  baueDist();
  const V = () => require(path.join(ROOT, 'dist', 'startup/verdrahtung.js'));
  // Ein Objekt für alle Bereiche: Ein Test ersetzt eine Methode darin (testNacharbeit()).
  // Es reicht an die echte Nacharbeit dieser Dienste weiter, gebaut beim ersten Gebrauch.
  let echt = null;
  const nacharbeit = () => (echt ??= V().baueNacharbeit(testDienste));
  for (const k of [
    'preisJobAnstossen',
    'preisFuerSetHolen',
    'bildVormerken',
    'setTeileAnreichern',
    'figurenAnreichern',
    'setBilderLaden',
  ])
    _nacharbeit[k] = (...a) => nacharbeit()[k](...a);
  const dbModul = require(path.join(ROOT, 'dist', 'db/database.js'));
  // Wie server.ts: Der Zugang legt in einer leeren Datenbank das erste Konto an.
  const erststart = () => testDienste().konto.legeStartVerwalterAn();
  const testDb = () => (_testDb ??= dbModul.erzeugeDb(dbModul.dbKonfigAusUmgebung(), { erststart }));
  _zugangFabrik = testDb;
  // Dieselbe Verdrahtung wie der Server (baueDienste), gebaut erst beim ersten Gebrauch:
  // Ein Test stellt Klienten über testQuellen(), auch nach diesem Aufruf.
  _dienstFabrik = () => {
    const kontexte = {};
    const d = V().baueDienste(testDb(), { nacharbeit: _nacharbeit, bildwerk: _bildwerk, quellen: _quellen, kontexte });
    return { d, kontexte };
  };
  // Testdaten legt die Eigentümerin an (am Zeilenschutz vorbei, ohne FORCE); der Code
  // unter Test fragt über testDb() als Laufzeitrolle wie im Betrieb (helpers/eigene-db.js).
  const eigenDb = () => (_eigenDb ??= eigentuemerZugang(dbModul, testDb, erststart));
  _datenFabrik = eigenDb;
  return rel => {
    const m = mitKontext(rel, require(path.join(ROOT, 'dist', rel)));
    return rel.startsWith('routes/') ? mitKontoDerAnfrage(m) : m;
  };
}

/** Innere Dienste eines Bereichs nehmen den Kontext als ersten Parameter (src/infra/bereich.ts).
 *  Ein Test, der ein solches Modul direkt lädt, ruft sie mit dem Kontext dieser Testdatei. */
const _mitKontext = new Map();
const KONTEXT_FN =
  /^(?:export )?(?:async )?function (\w+)(?:<[^(]*>)?\(\s*kx?: \w+Kontext\b|^(?:export )?const (\w+) = (?:async )?\(\s*kx?: \w+Kontext\b/gm;
/** Die Namen der Kontext-Dienste einer Quelle, auch weitergereichte (export { a as b } [from './x']). */
function kontextNamen(ts, tiefe = 0) {
  const quelle = fs.existsSync(ts) ? fs.readFileSync(ts, 'utf8') : '';
  const namen = new Set([...quelle.matchAll(KONTEXT_FN)].map(x => x[1] || x[2]));
  if (tiefe < 2)
    for (const i of quelle.matchAll(/^import \{([^}]*)\} from '(\.[^']+)';/gm)) {
      const dort = kontextNamen(path.join(path.dirname(ts), `${i[2]}.ts`), tiefe + 1);
      for (const n of i[1].split(',').map(x => x.trim())) if (dort.has(n)) namen.add(n);
    }
  for (const e of quelle.matchAll(/^export \{([^}]*)\}(?: from '(\.[^']+)')?;/gm)) {
    const quellNamen = e[2] && tiefe < 2 ? kontextNamen(path.join(path.dirname(ts), `${e[2]}.ts`), tiefe + 1) : namen;
    for (const teil of e[1].split(',')) {
      const [a, b = a] = teil.trim().split(/\s+as\s+/);
      if (a && quellNamen.has(a)) namen.add(b);
    }
  }
  return namen;
}
function mitKontext(rel, modul) {
  const m = /^src\/(\w+)\/(?!index\.js$|bereich\.js$|kontext\.js$|repository\/|http\/)[\w/]+\.js$/.exec(rel);
  if (!m || !fs.existsSync(path.join(ROOT, 'src', m[1], 'bereich.ts'))) return modul;
  if (!_mitKontext.has(rel)) {
    const namen = kontextNamen(path.join(ROOT, rel.replace(/\.js$/, '.ts')));
    const bereich = () => testKontext(m[1]);
    _mitKontext.set(
      rel,
      namen.size
        ? new Proxy(modul, {
            get: (z, n) =>
              typeof n === 'string' && namen.has(n) && typeof z[n] === 'function'
                ? (...a) => z[n](bereich(), ...a)
                : z[n],
          })
        : modul,
    );
  }
  return _mitKontext.get(rel);
}

/** Der Zugang der Eigentümerin, wenn der Lauf Rollen trennt, sonst der Testzugang selbst.
 * Wer einen der beiden Pools schliesst, schliesst beide: Früher war es einer. */
function eigentuemerZugang(dbModul, testDb, erststart) {
  const url = process.env.TEST_DB_EIGEN_URL;
  if (!url || url === process.env.DATABASE_URL) return testDb();
  const k = dbModul.dbKonfigAusUmgebung();
  // Wie server.ts: Der Erststart legt das erste Konto im Systemrahmen an.
  const { imSystemkontext } = require(path.join(ROOT, 'dist', 'src/infra/kontoKontext.js'));
  const eigen = dbModul.erzeugeDb(
    { ...k, verbindung: { connectionString: url }, system: null },
    { erststart: () => imSystemkontext('start', erststart) },
  );
  const app = testDb();
  const enden = [eigen.pool, app.pool].map(p => {
    const ende = p.end.bind(p);
    let zu = null;
    return { p, schliesse: () => (zu ??= ende()) };
  });
  for (const { p } of enden) p.end = () => Promise.all(enden.map(e => e.schliesse())).then(() => undefined);
  return eigen;
}

/** Wie startup/app.ts (merkeAnfrage vor allen Routen): Ein Router aus routes/, den ein Test
 * selbst einhängt, läuft im Konto seiner Anfrage, sonst sähe er unter dem Zeilenschutz nichts. */
function mitKontoDerAnfrage(m) {
  const istRouter = x => typeof x === 'function' && Array.isArray(x.stack) && typeof x.handle === 'function';
  if (!istRouter(m)) return m;
  const { alsAnfrage } = require(path.join(ROOT, 'dist', 'src/infra/kontoKontext.js'));
  return new Proxy(m, {
    apply: (ziel, ich, [req, res, next]) => alsAnfrage(req, () => ziel.call(ich, req, res, next)),
  });
}

/** Ein Routenmodul mit Fabrik (baueXRouter(d)) als Router, mit den Diensten dieser Testdatei
 *  (testDienste()); ein Modul ohne Fabrik unverändert. */
function routerAus(_req, rel) {
  const m = _req(rel);
  const baue = Object.entries(m).find(([n, f]) => /^baue\w*Router$/.test(n) && typeof f === 'function');
  // Wie startup/app.ts: Der gebaute Router läuft im Konto seiner Anfrage.
  return baue ? mitKontoDerAnfrage(baue[1](testDienste())) : m;
}
module.exports.routerAus = routerAus;

/** Der Zugang aus erzeugeDb(), den auch die verdrahteten Dienste dieser Testdatei
 *  benutzen: für Code unter Test, der als Laufzeitrolle fragen soll wie im Betrieb.
 *  Erst nach buildAndRequire(). */
function testZugang() {
  if (!_zugangFabrik) throw new Error('testZugang() erst nach buildAndRequire()');
  return _zugangFabrik();
}

/** Das Bildwerk, das baueDienste() dieser Datei bekommen hat: Ein Test ersetzt einen Teil
 *  darin, statt das Modul beim Laden umzubiegen. Mit `t` gilt der Ersatz bis zum Ende des Tests.
 *  @param {{ after: (f: () => void) => void } | null} [t] @param {Record<string, Function>} [ersatz] */
function testBildwerk(t, ersatz = {}) {
  const vorher = { ..._bildwerk };
  Object.assign(_bildwerk, ersatz);
  t?.after(() => Object.assign(_bildwerk, vorher));
  return _bildwerk;
}

/** Ruft f im Namen eines Kontos wie eine Anfrage (alsAnfrage): Der Code unter Test sieht
 *  unter dem Zeilenschutz nur dessen Haushalt, wie im Betrieb.
 *  @template T @param {number} uid @param {() => T} f @param {{ verwalter?: boolean }} [o] @returns {T} */
function alsKonto(uid, f, o = {}) {
  const { alsAnfrage } = require(path.join(ROOT, 'dist', 'src/infra/kontoKontext.js'));
  return alsAnfrage({ apiUser: { user_id: uid, is_admin: !!o.verwalter } }, f);
}

/** Ersetzt Fremdquellen (Rebrickable, BrickLink, Brickset; Namen wie in baueQuellen(), src/fremdquellen/quellen.ts)
 *  an der Verdrahtung, statt Module beim Laden umzubiegen. Mit `t` bis zum Ende des Tests.
 *  @param {{ after: (f: () => void) => void } | null} t @param {Record<string, unknown>} ersatz */
function testQuellen(t, ersatz) {
  Object.assign(_quellen, ersatz);
  t?.after(() => {
    for (const k of Object.keys(ersatz)) delete _quellen[k];
  });
  return _quellen;
}

/** Der Zugang der Eigentümerin für Testdaten: Er schreibt am Zeilenschutz vorbei, damit
 *  ein Test Zeilen beliebiger Konten anlegt. Erst beim ersten Gebrauch gebaut, damit eine
 *  Testdatei die Umgebung noch nach dem Aufruf stellen kann. Erst nach buildAndRequire(). */
function testDaten() {
  if (!_datenFabrik) throw new Error('testDaten() erst nach buildAndRequire()');
  return _datenGriff;
}
const _datenGriff = new Proxy(/** @type {any} */ ({}), { get: (_z, k) => _datenFabrik()[k] });

/** Stellt Umgebungsvariablen um (undefined löscht) und lässt konfig() sie neu
 *  lesen: Der Server liest sie einmal beim Start (src/infra/konfig.ts). */
function umgebung(werte) {
  for (const [k, v] of Object.entries(werte)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Noch nicht geladen: Der erste konfig()-Aufruf liest die neuen Werte ohnehin.
  const datei = path.join(ROOT, 'dist', 'src/infra/konfig.js');
  if (require.cache[datei]) require(datei).konfigNeuLesen();
}
module.exports.baueDist = baueDist;
module.exports.DIST = path.join(ROOT, 'dist');

/** Beide Sprachdateien zusammen: i18n.js allein liefert ein leeres I18N.
 *  @returns {{de: Record<string,string>, en: Record<string,string>}} */
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

const localeSource = lang => fs.readFileSync(path.join(ROOT, 'public', 'locales', `${lang}.js`), 'utf8');

const i18nAll = () =>
  fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8') + '\n' + localeSource('de') + '\n' + localeSource('en');

module.exports.loadTranslations = loadTranslations;
module.exports.localeSource = localeSource;
module.exports.i18nAll = i18nAll;

/**
 * Quelltext ohne Kommentare, damit ein Erklärkommentar mit dem gesuchten Namen
 * eine Prüfung nicht grün hält. Nur Blockkommentare am Zeilenanfang: Ein `/*`
 * in einer Zeichenkette (`'/images/*pfad'`) risse sonst Löcher in die Datei.
 */
function ohneKommentare(src) {
  return String(src)
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}

module.exports.ohneKommentare = ohneKommentare;

/**
 * Quelltext in einer Zeile, wie ihn der Formatierer bei beliebiger Zeilenbreite
 * schriebe: Ein Muster auf eine Anweisung soll nicht daran hängen, wo Biome umbricht
 * (Klammern über mehrere Zeilen, Komma vor der schliessenden Klammer).
 */
function kompakt(src) {
  return String(src)
    .replace(/\s+/g, ' ')
    .replace(/([([]) /g, '$1')
    .replace(/,? ([)\]])/g, '$1')
    .replace(/, \}/g, ' }');
}
module.exports.kompakt = kompakt;

/** HTML-Kommentare bis zum Fixpunkt: Ein Rest wie „<!<!---->--“ ergäbe sonst einen neuen. */
function ohneHtmlKommentare(src) {
  let s = String(src);
  for (let vorher; vorher !== s; ) {
    vorher = s;
    s = s.replace(/<!--[\s\S]*?-->/g, '');
  }
  return s;
}
module.exports.ohneHtmlKommentare = ohneHtmlKommentare;

/** Für `new RegExp`: jedes Sonderzeichen wörtlich. */
const regexWoertlich = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
module.exports.regexWoertlich = regexWoertlich;

/** Der Vorschau-Weg des Bild-Proxys (src/bilder/proxyThumbs.ts). */
function proxyThumbQuelle() {
  return [
    'src/bilder/http/bildProxy.ts',
    'routes/imgProxy.ts',
    'src/bilder/proxyThumbs.ts',
    'src/bilder/imgCacheServe.ts',
    'src/bilder/http/bildCacheAuslieferung.ts',
  ]
    .map(dienstQuelle)
    .join('\n');
}
module.exports.proxyThumbQuelle = proxyThumbQuelle;

/** Die Oberfläche rund um Erfassungen: Set-Detail, Kaufpreis-Modal, Detailfenster
 *  und ihre Bausteine (Lagerort, Preisalarm, Diagramme, Rückfragen). */
function adminQuelle() {
  const path = require('node:path'),
    fs = require('node:fs');
  const ROOT = path.join(__dirname, '..', '..');
  return [
    'admin.js',
    'set-detail.js',
    'detailfelder.js',
    'diagramme.js',
    'fadenkreuz.js',
    'rueckfrage.js',
    'acquisition-modals.js',
    'manuell-detail.js',
    'erfassung-zustand.js',
    'kaufpreis-anzeige.js',
  ]
    .map(f => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'))
    .join('\n');
}
module.exports.adminQuelle = adminQuelle;

/** Der Weg, auf dem ein Set entsteht oder sich ändert, samt Katalogarbeit. */
function setKernQuelle() {
  return [
    ['routes/api_v1/sets.ts'],
    ['routes/api_v1/setsImport.ts'],
    ['routes/api_v1/setsAnleitungen.ts'],
    ['routes/api_v1/setsLager.ts'],
    ['src/sets/dienst.ts'],
    ['src/sets/inhalt.ts'],
    ['src/sets/barcode.ts'],
    ['src/sets/csvImport.ts'],
    ['src/sets/anleitungen.ts'],
    ['src/sets/preise.ts'],
    ['src/sets/setService.ts'],
    ['src/sets/erfassen.ts'],
    ['src/katalog/partsImport.ts'],
    ['src/katalog/minifigsImport.ts'],
  ]
    .map(p => dienstQuelle(p[0]))
    .join('\n');
}
module.exports.setKernQuelle = setKernQuelle;

/** Die Leseabfragen je Fachbereich als EIN Quelltext. */
const HANDLER_MODULE = [
  'src/bestand/gemeinsam',
  'src/haushalt/haushalt',
  'src/teile/abfragen',
  'src/sets/lesen',
  'src/sets/loeschen',
  'src/figuren/abfragen',
  'src/bestand/kennzahlen',
];
function handlerQuelle() {
  return HANDLER_MODULE.map(m => dienstQuelle(m + '.ts')).join('\n');
}
module.exports.handlerQuelle = handlerQuelle;

/** Das gebaute Modul für einen Namen aus den Leseabfragen. */
function handlerModul(_req) {
  // Die Sets-Dienste dieser Testdatei, mit ihrem Kontext gebunden.
  return Object.assign({}, ...(_req && HANDLER_MODULE.map(m => _req(`${m}.js`))), _req && testDienste().sets);
}
module.exports.handlerModul = handlerModul;

/** server.ts samt Start des Job-Prozesses und der Läufe dort: für „läuft X
 *  beim Start an". */
function startQuelle() {
  const path = require('node:path'),
    fs = require('node:fs');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = path.join(ROOT, 'startup');
  const teile = [
    'server.ts',
    'src/katalog/bildNachlauf.ts',
    'src/verwaltung/startNachlaeufe.ts',
    'src/verwaltung/aufraeumen.ts',
    'src/bilder/bildlage.ts',
  ].map(f => dienstQuelle(f));
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
      teile.push(dienstQuelle('startup/' + f));
    }
  }
  return teile.join('\n');
}
module.exports.startQuelle = startQuelle;

/** Die Portfolio-Kurve: Orchestrierung, Rekonstruktion und Diagrammdaten. */
function portfolioQuelle() {
  const path = require('node:path'),
    fs = require('node:fs');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = path.join(ROOT, 'src/finanzen/portfolio');
  const teile = [dienstQuelle('src/finanzen/portfolioHistory.ts')];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
      teile.push(dienstQuelle('src/finanzen/portfolio/' + f));
    }
  }
  return teile.join('\n');
}
module.exports.portfolioQuelle = portfolioQuelle;

/** Die Grundausstattung des Frontends samt der ausgelagerten Abschnitte. */
function coreQuelle() {
  const path = require('node:path'),
    fs = require('node:fs');
  const dir = path.join(__dirname, '..', '..', 'public', 'js');
  // escapen.js VORNE: esc() gehört zur Grundausstattung, und
  // test/frontend-escaping.test.js schneidet seinen Sandkasten ab `function esc(s)`.
  return [
    'escapen.js',
    'zustand.js',
    'ereignisse.js',
    'dom.js',
    'format.js',
    'meldungen.js',
    'verbindung.js',
    'api.js',
    'bilder.js',
    'formular.js',
    'konto.js',
    'fortschritt.js',
    'monitor.js',
    'scope.js',
    'scrollbar.js',
    'sitzung.js',
  ]
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}
module.exports.coreQuelle = coreQuelle;

/**
 * Der Kopf einer Funktion bis zur schliessenden Klammer der Parameterliste.
 * Damit nennt eine Prüfung den Parameter, nicht Reihenfolge und Schreibweise
 * aller anderen — die fielen bei jeder Typschärfung um.
 * @returns {string} z.B. "function f(a, b: string | null = null)"
 */
function funktionsKopf(src, name) {
  // Auch mit Typparametern (`function f<T>(`).
  const i = Math.max(src.indexOf(`function ${name}(`), src.indexOf(`function ${name}<`));
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
 * Der RUMPF einer Funktion ohne die umschliessenden Klammern. Gesucht wird
 * `function name(` (unabhängig von Annotationen), und es WIRFT, wenn nichts
 * gefunden wird — ein -1 aus indexOf ergäbe sonst still eine leere Funktion.
 * Das Ende ist die schliessende Klammer in SPALTE 0.
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

/** Unabhängig von Typannotation und Position; mit `mitVorgabeNull` zusätzlich
 *  die Vorgabe null (dann dürfen Aufrufer ihn weglassen). */
function hatParameter(src, name, param, mitVorgabeNull = false) {
  const kopf = funktionsKopf(src, name);
  const drin = new RegExp(`\\b${param}\\b`).test(kopf);
  if (!drin) return false;
  if (!mitVorgabeNull) return true;
  return new RegExp(`\\b${param}\\b[^,)]*=\\s*null`).test(kopf);
}
module.exports.hatParameter = hatParameter;

/**
 * Genau diese Parameter, der Reihe nach, ohne Rücksicht auf Typannotationen,
 * Vorgabewerte oder Zeilenumbrüche: `pruefeParameter(src, 'besitzerAnhaengen',
 * ['uids', 'rows'])`. Ein Muster über den ganzen Kopf fiele um, sobald jemand
 * einen Typ schärft.
 * @param {string} [hinweis] Zusatz für die Fehlermeldung
 */
function pruefeParameter(src, name, params, hinweis = '') {
  const assert = require('node:assert/strict');
  const kopf = funktionsKopf(src, name);
  const innen = kopf.slice(kopf.indexOf('(') + 1, kopf.length - 1);

  let zuletzt = -1;
  for (const p of params) {
    const treffer = new RegExp(`\\b${p}\\b`).exec(innen.slice(zuletzt + 1));
    assert.ok(treffer, `${name} nimmt '${p}' nicht (mehr) entgegen${hinweis ? ' — ' + hinweis : ''}: ${kopf}`);
    zuletzt = zuletzt + 1 + treffer.index;
  }
}
module.exports.pruefeParameter = pruefeParameter;

/**
 * Wo welcher Router hängt — aus server.ts GELESEN, nicht abgeschrieben: Eine
 * Prüfung, die die Verdrahtung abschreibt, prüft nicht die Verdrahtung.
 * @returns [{ mount: '/api/v1/sets', datei: '<abs>/routes/sets.ts', name: 'sets' }]
 *          ohne routes/api_v1/* — das ist der Index selbst.
 */
/** @param {{ ohneTeile?: boolean }} [o] ohneTeile: nur die eingehängten Module, nicht die Dateien eines Zusammenbaus */
function routerEinhaengungen(o = {}) {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8'));
  // `import xRouter from '../routes/x'` oben, `app.use('/api/…', xRouter)` unten.
  const dateiJeName = new Map(
    [...src.matchAll(/import\s+(?:\{\s*)?(\w+)(?:\s*\})?\s+from\s+['"](?:\.\.?\/)+(routes\/[^'"]+)['"]/g)].map(m => [
      m[1],
      m[2],
    ]),
  );
  const out = [];
  // Ein Router mit Fabrik hängt als `baueXRouter(d)` ein.
  for (const m of src.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*(\w+)(?:\(\w+\))?\s*\)/g)) {
    const datei = dateiJeName.get(m[2]);
    if (!datei || datei.startsWith('routes/api_v1')) continue;
    out.push({
      mount: m[1].replace(/\/+$/, ''),
      datei: path.join(ROOT, datei + '.ts'),
      name: datei.replace(/^routes\//, ''),
    });
    // Ein Zusammenbau (routes/auth.ts) hängt seine Teile unter derselben Adresse ein.
    const teile = path.join(ROOT, datei);
    if (!o.ohneTeile && fs.existsSync(teile) && fs.statSync(teile).isDirectory())
      for (const n of fs
        .readdirSync(teile)
        .filter(n => n.endsWith('.ts'))
        .sort())
        out.push({
          mount: m[1].replace(/\/+$/, ''),
          datei: path.join(teile, n),
          name: `${datei.replace(/^routes\//, '')}/${n.replace(/\.ts$/, '')}`,
        });
  }
  return out;
}
module.exports.routerEinhaengungen = routerEinhaengungen;

/**
 * Die Adresse an EINER Stelle (startup/app.ts): Ein Prüfstand, der Router von Hand
 * einhängt, bliebe nach einem Umzug grün.
 * @param {string} name Dateiname ohne routes/ und ohne .ts, z. B. 'auth'.
 */
function einhaengung(name) {
  const treffer = routerEinhaengungen().filter(r => r.name === name);
  if (treffer.length !== 1)
    throw new Error(`routes/${name}.ts haengt ${treffer.length}-mal in startup/app.ts — erwartet: genau einmal`);
  return treffer[0].mount;
}
module.exports.einhaengung = einhaengung;

/**
 * Einen Ausschnitt schneiden — und WERFEN, wenn ein Anker fehlt: `slice(-1)`
 * gäbe sonst einen leeren Ausschnitt, auf dem `assert.doesNotMatch` still grün ist.
 * @param {string} [bis]   bis hierher (muss vorkommen, wenn angegeben), sonst bis zum Ende
 * @param {string} [wozu]  wofür der Ausschnitt gebraucht wird, für die Meldung
 */
function abschnitt(quelle, ab, bis, wozu = '') {
  const i = String(quelle).indexOf(ab);
  if (i < 0)
    throw new Error(
      `Ankertext nicht gefunden${wozu ? ` (${wozu})` : ''}: ${JSON.stringify(ab).slice(0, 90)}\n` +
        'Der Ausschnitt waere leer, und Zusicherungen darauf pruefen nichts mehr.',
    );
  if (bis === undefined) return String(quelle).slice(i);
  const j = String(quelle).indexOf(bis, i);
  if (j < 0) throw new Error(`Endanker nicht gefunden${wozu ? ` (${wozu})` : ''}: ${JSON.stringify(bis).slice(0, 90)}`);
  return String(quelle).slice(i, j);
}

module.exports.abschnitt = abschnitt;

/**
 * Ein Pfad-Literal des Frontends auf seine FORM bringen, einmal für alle
 * Prüfungen. `[^}]*` käme über ein verschachteltes `${…}` nicht hinweg.
 * Ein `${…}` ist nur dann ein Pfadabschnitt, wenn direkt ein `/` davorsteht:
 *     `/v1/parts/${nr}/${farbe}`            → /v1/parts/:X/:X
 *     `/v1/minifigs/${nr}${owner ? …: ''}`  → /v1/minifigs/:X
 * @param {string} [marke]   Platzhalter je Abschnitt — ':X' oder ':x'
 */
function pfadForm(roh, marke = ':X') {
  let s = String(roh);
  let vor = null;
  // Innerste zuerst, bis nichts mehr passt — so verschwindet auch ein
  // verschachtelter Ausdruck vollständig.
  while (vor !== s) {
    vor = s;
    s = s.replace(/\$\{[^{}]*\}/g, '\u0000');
  }
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\u0000') {
      out += s[i];
      continue;
    }
    if (out.endsWith('/')) {
      out += marke;
      continue;
    }
    break; // Anhängsel, kein Abschnitt → hier endet der Pfad
  }
  return out.split('?')[0].replace(/'\s*\+.*$/, '');
}

module.exports.pfadForm = pfadForm;

/**
 * Ein Literal ab `i` mit VERSCHACHTELTEN Template-Ausdrücken: Ein Pfad kann
 * Backticks in seinem Inneren tragen, und jedes `[^`]*` bräche dort ab.
 * @returns {{text: string, ende: number}|null} Inhalt ohne Anführungszeichen
 *   und die Position NACH dem Literal; null, wenn an `i` keines beginnt.
 */
function leseLiteral(src, i) {
  const anf = src[i];
  if (anf !== '`' && anf !== "'" && anf !== '"') return null;
  let j = i + 1,
    tiefe = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (anf === '`' && c === '$' && src[j + 1] === '{') {
      tiefe++;
      j += 2;
      continue;
    }
    if (tiefe > 0) {
      if (c === '{') tiefe++;
      else if (c === '}') tiefe--;
      // Ein Literal in ${…} wird mitgelesen, damit es die Zählung nicht verwirrt.
      else if (c === '`' || c === "'" || c === '"') {
        const inner = leseLiteral(src, j);
        if (inner) {
          j = inner.ende;
          continue;
        }
      }
      j++;
      continue;
    }
    if (c === anf) return { text: src.slice(i + 1, j), ende: j + 1 };
    j++;
  }
  return null;
}

module.exports.leseLiteral = leseLiteral;

/** Die Dateiliste steht hier, damit test/api-eingang-db.test.js keinen
 *  variablen Pfad liest (test/eigenbruecken.test.js zählt sie). */
function v1Routen() {
  const gefunden = [];
  const lies = (datei, vorne) => {
    const s = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    for (const m of s.matchAll(/(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g))
      gefunden.push([m[1].toUpperCase(), vorne + m[2]]);
  };
  for (const f of fs.readdirSync(path.join(ROOT, 'routes/api_v1')).filter(f => f.endsWith('.ts')))
    lies(`routes/api_v1/${f}`, '/api/v1');
  // Die in server.ts eingehängten Router (auth samt Teilen, gesundheit).
  for (const r of routerEinhaengungen().filter(r => r.mount.startsWith('/api/v1')))
    lies(path.relative(ROOT, r.datei), r.mount);
  lies('server.ts', '');
  return gefunden.filter(([, p]) => p.startsWith('/api/v1'));
}
module.exports.v1Routen = v1Routen;

/** Für Prüfungen, die eine Eigenschaft überall verlangen, statt eine
 *  Dateiliste zu führen, die beim nächsten Umzug veraltet. */
function alleQuellen() {
  const raus = [];
  const lauf = rel => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = rel ? path.posix.join(rel, e.name) : e.name;
      if (e.isDirectory()) {
        if (!['node_modules', 'dist', 'test', 'scripts', 'public', 'docs', '.git'].includes(e.name)) lauf(kind);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) raus.push(kind);
    }
  };
  lauf('');
  return raus;
}
module.exports.alleQuellen = alleQuellen;

/** Prüfungen auf das SQL eines Dienstes meinen seinen Weg zur Datenbank,
 *  nicht die Datei.
 * @param {string} rel Pfad relativ zu ROOT, z. B. 'src/sets/setMove.ts' */
function dienstQuelle(rel) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const repos = new Set(
    [...ohneKommentare(s).matchAll(/(?:from\s+|import\(\s*|require\(\s*)['"](\.[^'"]*repository[^'"]*)['"]/g)]
      .map(m => path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])).replace(/\.js$/, ''))
      .map(z => (fs.existsSync(path.join(ROOT, z + '.ts')) ? z + '.ts' : z + '/index.ts')),
  );
  // Der Katalog bindet seine Repositories in einer Fabrik (src/katalog/bereich.ts).
  for (const m of ohneKommentare(s).matchAll(/\bkatalog\(\)\.(\w+)\./g))
    if (fs.existsSync(path.join(ROOT, `src/katalog/repository/${m[1]}.ts`)))
      repos.add(`src/katalog/repository/${m[1]}.ts`);
  // Die übrigen Bereiche ebenso (src/<b>/bereich.ts, Zugriff über <b>Bereich()).
  for (const m of ohneKommentare(s).matchAll(/\b(\w+)Bereich\(\)\.(\w+)\./g)) {
    const fabrik = path.join(ROOT, `src/${m[1]}/bereich.ts`);
    if (!fs.existsSync(fabrik)) continue;
    const ziel = fs.readFileSync(fabrik, 'utf8').match(new RegExp(`import \\* as ${m[2]} from '\\./([^']+)'`));
    if (ziel && /repository/.test(ziel[1])) repos.add(`src/${m[1]}/${ziel[1]}.ts`);
  }
  // Über den Kontext des Dienstes (k.repo., k.<bereich>.repo.; t in einer Transaktion).
  const eigener = /^src\/(\w+)\//.exec(rel)?.[1];
  const ueber = (b, name) => {
    const fabrik = path.join(ROOT, `src/${b}/kontext.ts`);
    if (!b || !fs.existsSync(fabrik)) return;
    const ziel = fs.readFileSync(fabrik, 'utf8').match(new RegExp(`import \\* as ${name} from '\\./([^']+)'`));
    if (ziel && /repository/.test(ziel[1])) repos.add(`src/${b}/${ziel[1]}.ts`);
  };
  for (const m of ohneKommentare(s).matchAll(/\b(?:k|kx|sk|t)\.(\w+)\.(\w+)?/g)) {
    ueber(eigener, m[1]);
    if (m[2]) ueber(m[1], m[2]);
  }
  return [s, ...[...repos].map(r => fs.readFileSync(path.join(ROOT, r), 'utf8'))].join('\n');
}
module.exports.dienstQuelle = dienstQuelle;

/** Alle Quellen der Oberfläche (public/js ohne Bündel, dazu i18n.js) als EIN
 *  Text: für Prüfungen, die nicht an der Datei hängen sollen, in der eine
 *  Funktion gerade steht. */
function frontendQuelle() {
  const path = require('node:path'),
    fs = require('node:fs');
  const pub = path.join(__dirname, '..', '..', 'public');
  return [
    ...fs
      .readdirSync(path.join(pub, 'js'))
      .filter(f => istAppModul(f))
      .sort()
      .map(f => path.join(pub, 'js', f)),
    path.join(pub, 'i18n.js'),
  ]
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');
}
module.exports.frontendQuelle = frontendQuelle;

/** Die Anmelderouten: routes/auth.ts setzt sie aus routes/auth/*.ts zusammen. */
function anmeldeQuelle() {
  const teile = fs
    .readdirSync(path.join(ROOT, 'routes', 'auth'))
    .filter(n => n.endsWith('.ts'))
    .sort();
  // Die Abläufe nach der Prüfung stehen seit dem 09.11.2026 in src/konto/anmeldungAblauf.ts.
  return ['routes/auth.ts', ...teile.map(n => `routes/auth/${n}`), 'src/konto/anmeldungAblauf.ts']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
}
module.exports.anmeldeQuelle = anmeldeQuelle;

/** Die Dateien je Ansicht; eine geteilte Ansicht bleibt so unter einem Namen prüfbar. */
const ANSICHTEN = {
  einstellungen: ['settings.js', 'zugaenge.js', 'haushalt.js', 'nutzerverwaltung.js', 'alarme.js', 'lagerorte.js'],
};

/** Alle Dateien einer Ansicht (Schlüssel aus ANSICHTEN) als EIN Text. */
function ansichtQuelle(/** @type {keyof typeof ANSICHTEN} */ name) {
  const js = path.join(ROOT, 'public', 'js');
  return ANSICHTEN[name].map(f => fs.readFileSync(path.join(js, f), 'utf8')).join('\n');
}
module.exports.ansichtQuelle = ansichtQuelle;
