/**
 * Gemeinsame Quelltext-Zugriffe für die statischen Tests. Die Sichten nennen
 * den GEGENSTAND einer Prüfung, nicht den Ablageort: Wandert Code um, ändert
 * sich eine Stelle hier statt zwanzig Prüfungen.
 */
const { isAppModule } = require('../../scripts/build-frontend');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/** Die App (startup/app.ts, Middleware in ihrer Reihenfolge) und server.ts:
 *  für Prüfungen, bei denen die REIHENFOLGE zählt. Wer den Start meint, nimmt startSource(). */
const serverOnly = () =>
  fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8') +
  '\n' +
  fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

const imgProxy = () =>
  fs.readFileSync(path.join(ROOT, 'src/images/http/imageProxy.ts'), 'utf8') +
  '\n' +
  fs.readFileSync(path.join(ROOT, 'routes/imgProxy.ts'), 'utf8');

/** Server, Bild-Proxy und Vorschau-Weg: für „kommt X irgendwo vor". Die
 *  Reihenfolge über Dateigrenzen ist bedeutungslos — für indexOf-Vergleiche
 *  serverOnly() oder imgProxy() nehmen. */
const serverAll = () => serverOnly() + '\n' + imgProxy() + '\n' + proxyThumbSource() + '\n' + startSource();

/** Die ganze Finanzschicht aneinandergehängt: Die Regeln („nur EINE
 *  Zustandsauflösung") gelten der Schicht, nicht der Fassade financeCalc.ts. */
const finanzQuelle = () => {
  const ordner = path.join(ROOT, 'src/finances/calculation');
  const teile = [serviceSource('src/finances/financeCalc.ts')];
  for (const n of fs
    .readdirSync(ordner)
    .filter(x => x.endsWith('.ts'))
    .sort()) {
    teile.push(serviceSource('src/finances/calculation/' + n));
  }
  // Selbstbeweis: Fände der Helfer die Module nicht, prüften die Regeln nur die
  // Fassade und wären still grün.
  if (teile.length < 4) {
    throw new Error(`finanzQuelle(): nur ${teile.length} Dateien gefunden — liegt src/finances/calculation/ noch da?`);
  }
  return teile.join('\n');
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
function buildDist() {
  if (_built) return;
  require('./buendel').placeBundleSafe();
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
let _ownDb = null;
/** Erzeugen die Zugänge; gesetzt von buildAndRequire(). */
let _accessFactory = null;
/** Baut Dienste und Kontexte dieser Testdatei; gesetzt von buildAndRequire(). */
let _serviceFactory = null;
let _gebaut = null;
/** Ersetzungen (replaceServices), auch vor dem ersten Bau gemerkt. */
const _ersatz = [];

/** Die Dienste dieser Testdatei: buildServices(testAccess()) wie im Server, einmal je Datei. */
/** @returns {any} */
function testServices() {
  if (!_serviceFactory) throw new Error('testServices() erst nach buildAndRequire()');
  if (!_gebaut) {
    _gebaut = _serviceFactory();
    for (const [b, e] of _ersatz) Object.assign(_gebaut.d[b], e);
  }
  return _gebaut.d;
}

/** Der Kontext eines Bereichs (Repositories, Zugang, Abhängigkeiten) für Tests, die
 *  hineinsehen; die Dienste selbst geben ihn nicht heraus. */
/** @param {string} bereich @returns {any} */
function testContext(bereich) {
  testServices();
  const k = _gebaut.contexts[bereich];
  if (!k) throw new Error(`kein Kontext für ${bereich}`);
  return k;
}

/** Ersetzt Dienste eines Bereichs für diese Testdatei, auch für andere Bereiche, die
 *  sie über ihren Kontext rufen (dasselbe Objekt). Vor oder nach dem ersten Bau. */
function replaceServices(bereich, ersatz) {
  _ersatz.push([bereich, ersatz]);
  if (_gebaut) Object.assign(_gebaut.d[bereich], ersatz);
}

/** Die öffentliche Seite eines Bereichs (index.js) samt seinen Diensten dieser Testdatei:
 *  Was index.js nicht exportiert, reicht beim Aufruf an testServices()[bereich] weiter,
 *  damit eine Datei die Dienste erst baut, wenn ein Test sie ruft. */
/** @param {string} bereich @returns {any} */
function areaPage(bereich) {
  const modul = require(path.join(ROOT, 'dist', 'src', bereich, 'index.js'));
  return new Proxy(modul, {
    get: (m, n) => (n in m ? m[n] : (...a) => testServices()[bereich][n](...a)),
  });
}

/** Schreibt mit, was die Bilder vormerken (rememberUsed, src/images/imageDemand.ts): am Puffer
 *  selbst, damit jeder Weg dorthin zählt. `ende()` hört wieder auf. */
/** @param {any} [kontext] @returns {{ notes: [string, string][], ende: () => void }} */
function imageNotes(kontext = testContext('images')) {
  const puffer = kontext.faecher.fach('bildbedarf:puffer', () => new Map());
  /** @type {[string, string][]} */
  const notes = [];
  puffer.set = (/** @type {string} */ url, /** @type {string} */ sn) => {
    notes.push([url, sn]);
    return Map.prototype.set.call(puffer, url, sn);
  };
  return { notes, ende: () => delete puffer.set };
}

/** Wie früher xBereich(): Dienste eines Bereichs, Lesezugriff fällt auf seinen Kontext
 *  zurück. Schreiben geht an die Dienste. */
/** @param {string} bereich @returns {any} */
function testArea(bereich) {
  return new Proxy(
    {},
    {
      get: (_z, n) => {
        const d = testServices()[bereich];
        return n in d ? d[n] : testContext(bereich)[n];
      },
      set: (_z, n, v) => {
        testServices()[bereich][n] = v;
        return true;
      },
      has: (_z, n) => n in testServices()[bereich] || n in testContext(bereich),
      ownKeys: () => [
        ...new Set([...Reflect.ownKeys(testContext(bereich)), ...Reflect.ownKeys(testServices()[bereich])]),
      ],
      getOwnPropertyDescriptor: (_z, n) => {
        const d = testServices()[bereich];
        const quelle = n in d ? d : testContext(bereich);
        return n in quelle ? { value: quelle[n], enumerable: true, configurable: true, writable: true } : undefined;
      },
    },
  );
}
let _dataFactory = null;
/** Das Bildwerk der Dienste (src/catalog/context.ts): eines je Datei, auch wenn sie
 *  buildAndRequire() mehrmals ruft, damit ein ersetzter Teil nicht verloren geht. */
const _imageWorker = {
  setBildLaden: (...a) =>
    require(path.join(ROOT, 'dist', 'src/images/setImages.js')).setBildHerunterladen(testContext('images'), ...a),
  createPreview: (...a) => require(path.join(ROOT, 'dist', 'src/images/thumbs.js')).vorschauErzeugenAus(...a),
};

/** Die ersetzten Klienten der Dienste (src/externalSources/sources.ts): leer heisst echt. */
const _sources = {};

/** Die Uhr der Dienste dieser Testdatei (k.uhr, stellbareClock aus src/infra/uhr.ts): Sie läuft
 *  mit der Systemzeit, ein Test springt mit vor(ms) über eine Frist, statt sie abzuwarten. */
let _clock = null;
function testClock() {
  if (!_clock) _clock = require(path.join(ROOT, 'dist', 'src/infra/uhr.js')).stellbareClock();
  return _clock;
}

function buildAndRequire() {
  // Jede Antwort einer Route mit Vertrag läuft in Tests durch ihr Schema (src/http/vertragsRouter.ts).
  process.env.VERTRAG_PRUEFEN ??= '1';
  // Ohne NODE_ENV gelten die Regeln des Betriebs (Superuser-Verbot, APP_BASE_URL);
  // ausserhalb von npm test (und mit `@superuser`) ist die Test-DB Superuser, und gestartete Server erben das.
  process.env.NODE_ENV ??= 'test';
  buildDist();
  const V = () => require(path.join(ROOT, 'dist', 'startup/verdrahtung.js'));
  const dbModule = require(path.join(ROOT, 'dist', 'db/database.js'));
  // Wie server.ts: Der Zugang legt in einer leeren Datenbank das erste Konto an.
  const firstStart = () => testServices().konto.putStartAdminAn();
  const testDb = () => (_testDb ??= dbModule.createDb(dbModule.dbKonfigFromEnvironment(), { firstStart }));
  _accessFactory = testDb;
  // Dieselbe Verdrahtung wie der Server (buildServices), gebaut erst beim ersten Gebrauch:
  // Ein Test stellt Klienten über testSources(), auch nach diesem Aufruf.
  _serviceFactory = () => {
    const contexts = {};
    // Die Konfiguration, die buildServices reicht, liest beim Zugriff: Ein Test, der mit
    // umgebung()/setKonfig() einen Wert ändert, sieht ihn auch in k.konfig.
    const K = require(path.join(ROOT, 'dist', 'src/infra/konfig.js'));
    const konfig = {};
    for (const n of Object.keys(K.konfig()))
      Object.defineProperty(konfig, n, { enumerable: true, get: () => K.konfig()[n] });
    const d = V().buildServices(testDb(), {
      bildwerk: _imageWorker,
      quellen: _sources,
      contexts,
      konfig,
      uhr: testClock(),
    });
    return { d, contexts };
  };
  // Testdaten legt die Eigentümerin an (am Zeilenschutz vorbei, ohne FORCE); der Code
  // unter Test fragt über testDb() als Laufzeitrolle wie im Betrieb (helpers/eigene-db.js).
  const ownDb = () => (_ownDb ??= ownerAccess(dbModule, testDb, firstStart));
  _dataFactory = ownDb;
  return rel => {
    const m = withContext(rel, require(path.join(ROOT, 'dist', rel)));
    return rel.startsWith('routes/') ? withAccountTheRequest(m) : m;
  };
}

/** Innere Dienste eines Bereichs nehmen den Kontext als ersten Parameter (src/infra/bereich.ts).
 *  Ein Test, der ein solches Modul direkt lädt, ruft sie mit dem Kontext dieser Testdatei. */
const _withContext = new Map();
const CONTEXT_FN =
  /^(?:export )?(?:async )?function (\w+)(?:<[^(]*>)?\(\s*kx?: \w+(?:Kontext|Context)\b|^(?:export )?const (\w+) = (?:async )?\(\s*kx?: \w+(?:Kontext|Context)\b/gm;
/** Die Namen der Kontext-Dienste einer Quelle, auch weitergereichte (export { a as b } [from './x']). */
function contextNames(ts, tiefe = 0) {
  const quelle = fs.existsSync(ts) ? fs.readFileSync(ts, 'utf8') : '';
  const namen = new Set([...quelle.matchAll(CONTEXT_FN)].map(x => x[1] || x[2]));
  if (tiefe < 2)
    for (const i of quelle.matchAll(/^import \{([^}]*)\} from '(\.[^']+)';/gm)) {
      const dort = contextNames(path.join(path.dirname(ts), `${i[2]}.ts`), tiefe + 1);
      for (const n of i[1].split(',').map(x => x.trim())) if (dort.has(n)) namen.add(n);
    }
  for (const e of quelle.matchAll(/^export \{([^}]*)\}(?: from '(\.[^']+)')?;/gm)) {
    const quellNames = e[2] && tiefe < 2 ? contextNames(path.join(path.dirname(ts), `${e[2]}.ts`), tiefe + 1) : namen;
    for (const teil of e[1].split(',')) {
      const [a, b = a] = teil.trim().split(/\s+as\s+/);
      if (a && quellNames.has(a)) namen.add(b);
    }
  }
  return namen;
}
function withContext(rel, modul) {
  const m =
    /^src\/(\w+)\/(?!index\.js$|bereich\.js$|kontext\.js$|area\.js$|context\.js$|repository\/|http\/)[\w/]+\.js$/.exec(
      rel,
    );
  if (
    !m ||
    !(
      fs.existsSync(path.join(ROOT, 'src', m[1], 'bereich.ts')) ||
      fs.existsSync(path.join(ROOT, 'src', m[1], 'area.ts'))
    )
  )
    return modul;
  if (!_withContext.has(rel)) {
    const namen = contextNames(path.join(ROOT, rel.replace(/\.js$/, '.ts')));
    const bereich = () => testContext(m[1]);
    _withContext.set(
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
  return _withContext.get(rel);
}

/** Der Zugang der Eigentümerin, wenn der Lauf Rollen trennt, sonst der Testzugang selbst.
 * Wer einen der beiden Pools schliesst, schliesst beide: Früher war es einer. */
function ownerAccess(dbModule, testDb, firstStart) {
  const url = process.env.TEST_DB_EIGEN_URL;
  if (!url || url === process.env.DATABASE_URL) return testDb();
  const k = dbModule.dbKonfigFromEnvironment();
  // Wie server.ts: Der Erststart legt das erste Konto im Systemrahmen an.
  const { inSystemContext } = require(path.join(ROOT, 'dist', 'src/infra/kontoKontext.js'));
  const eigen = dbModule.createDb(
    { ...k, verbindung: { connectionString: url }, system: null },
    { firstStart: () => inSystemContext('start', firstStart) },
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

/** Wie startup/app.ts (rememberRequest vor allen Routen): Ein Router aus routes/, den ein Test
 * selbst einhängt, läuft im Konto seiner Anfrage, sonst sähe er unter dem Zeilenschutz nichts. */
function withAccountTheRequest(m) {
  const isRouter = x => typeof x === 'function' && Array.isArray(x.stack) && typeof x.handle === 'function';
  if (!isRouter(m)) return m;
  const { asRequest } = require(path.join(ROOT, 'dist', 'src/infra/kontoKontext.js'));
  const { errorResponse } = require(path.join(ROOT, 'dist', 'src/http/httpAntwort.js'));
  // Wie startup/app.ts: Den Fehlerweg hängt die App an, nicht der Router.
  const weiter = (req, res, next) => e =>
    e && e !== 'route' && e !== 'router' ? errorResponse(e, req, res, next) : next();
  return new Proxy(m, {
    apply: (ziel, ich, [req, res, next]) => asRequest(req, () => ziel.call(ich, req, res, weiter(req, res, next))),
  });
}

/** Ein Routenmodul mit Fabrik (baueXRouter(d)) als Router, mit den Diensten dieser Testdatei
 *  (testServices()); ein Modul ohne Fabrik unverändert. */
function routerFrom(_req, rel) {
  const m = _req(rel);
  const build = Object.entries(m).find(([n, f]) => /^build\w*Router$/.test(n) && typeof f === 'function');
  // Wie startup/app.ts: Der gebaute Router läuft im Konto seiner Anfrage.
  return build ? withAccountTheRequest(build[1](testServices())) : m;
}

/** Der Zugang aus createDb(), den auch die verdrahteten Dienste dieser Testdatei
 *  benutzen: für Code unter Test, der als Laufzeitrolle fragen soll wie im Betrieb.
 *  Erst nach buildAndRequire(). */
function testAccess() {
  if (!_accessFactory) throw new Error('testAccess() erst nach buildAndRequire()');
  return _accessFactory();
}

/** Das Bildwerk, das buildServices() dieser Datei bekommen hat: Ein Test ersetzt einen Teil
 *  darin, statt das Modul beim Laden umzubiegen. Mit `t` gilt der Ersatz bis zum Ende des Tests.
 *  @param {{ after: (f: () => void) => void } | null} [t] @param {Record<string, Function>} [ersatz] */
function testImageWorker(t, ersatz = {}) {
  const vorher = { ..._imageWorker };
  Object.assign(_imageWorker, ersatz);
  t?.after(() => Object.assign(_imageWorker, vorher));
  return _imageWorker;
}

/** Ruft f im Namen eines Kontos wie eine Anfrage (asRequest): Der Code unter Test sieht
 *  unter dem Zeilenschutz nur dessen Haushalt, wie im Betrieb.
 *  @template T @param {number} uid @param {() => T} f @param {{ verwalter?: boolean }} [o] @returns {T} */
function asAccount(uid, f, o = {}) {
  const { asRequest } = require(path.join(ROOT, 'dist', 'src/infra/kontoKontext.js'));
  return asRequest({ apiUser: { user_id: uid, is_admin: !!o.verwalter } }, f);
}

/** Ersetzt Fremdquellen (Rebrickable, BrickLink, Brickset; Namen wie in buildSources(), src/externalSources/sources.ts)
 *  an der Verdrahtung, statt Module beim Laden umzubiegen. Mit `t` bis zum Ende des Tests.
 *  @param {{ after: (f: () => void) => void } | null} t @param {Record<string, unknown>} ersatz */
function testSources(t, ersatz) {
  Object.assign(_sources, ersatz);
  t?.after(() => {
    for (const k of Object.keys(ersatz)) delete _sources[k];
  });
  return _sources;
}

/** Der Zugang der Eigentümerin für Testdaten: Er schreibt am Zeilenschutz vorbei, damit
 *  ein Test Zeilen beliebiger Konten anlegt. Erst beim ersten Gebrauch gebaut, damit eine
 *  Testdatei die Umgebung noch nach dem Aufruf stellen kann. Erst nach buildAndRequire(). */
function testData() {
  if (!_dataFactory) throw new Error('testData() erst nach buildAndRequire()');
  return _dataHandle;
}
const _dataHandle = new Proxy(/** @type {any} */ ({}), { get: (_z, k) => _dataFactory()[k] });

/** Stellt Umgebungsvariablen um (undefined löscht) und lässt konfig() sie neu
 *  lesen: Der Server liest sie einmal beim Start (src/infra/konfig.ts). */
function environment(werte) {
  for (const [k, v] of Object.entries(werte)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Noch nicht geladen: Der erste konfig()-Aufruf liest die neuen Werte ohnehin.
  const datei = path.join(ROOT, 'dist', 'src/infra/konfig.js');
  if (require.cache[datei]) require(datei).readKonfigNew();
}

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

/** HTML-Kommentare bis zum Fixpunkt: Ein Rest wie „<!<!---->--“ ergäbe sonst einen neuen. */
function withoutHtmlComments(src) {
  let s = String(src);
  for (let vorher; vorher !== s; ) {
    vorher = s;
    s = s.replace(/<!--[\s\S]*?-->/g, '');
  }
  return s;
}

/** Für `new RegExp`: jedes Sonderzeichen wörtlich. */
const regexLiteral = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Der Vorschau-Weg des Bild-Proxys (src/images/proxyThumbs.ts). */
function proxyThumbSource() {
  return [
    'src/images/http/imageProxy.ts',
    'routes/imgProxy.ts',
    'src/images/proxyThumbs.ts',
    'src/images/imgCacheServe.ts',
    'src/images/http/imageCacheDelivery.ts',
  ]
    .map(serviceSource)
    .join('\n');
}

/** Die Oberfläche rund um Erfassungen: Set-Detail, Kaufpreis-Modal, Detailfenster
 *  und ihre Bausteine (Lagerort, Preisalarm, Diagramme, Rückfragen). */
function adminSource() {
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
    'kauf-dialoge.js',
    'manuell-detail.js',
    'erfassung-zustand.js',
    'kaufpreis-anzeige.js',
  ]
    .map(f => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'))
    .join('\n');
}

/** Der Weg, auf dem ein Set entsteht oder sich ändert, samt Katalogarbeit. */
function setCoreSource() {
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
    ['src/sets/erfassen.ts'],
    ['src/catalog/partsImport.ts'],
    ['src/catalog/minifigsImport.ts'],
    ['src/sets/setInhaltImport.ts'],
  ]
    .map(p => serviceSource(p[0]))
    .join('\n');
}

/** Die Leseabfragen je Fachbereich als EIN Quelltext. */
const HANDLER_MODULE = [
  'src/inventory/shared',
  'src/household/household',
  'src/parts/queries',
  'src/sets/lesen',
  'src/sets/loeschen',
  'src/minifigs/queries',
  'src/inventory/metrics',
];
function handlerQuelle() {
  return HANDLER_MODULE.map(m => serviceSource(m + '.ts')).join('\n');
}

/** Das gebaute Modul für einen Namen aus den Leseabfragen. */
function handlerModule(_req) {
  // Die Sets-Dienste dieser Testdatei, mit ihrem Kontext gebunden.
  return Object.assign({}, ...(_req && HANDLER_MODULE.map(m => _req(`${m}.js`))), _req && testServices().sets);
}

/** server.ts samt Start des Job-Prozesses und der Läufe dort: für „läuft X
 *  beim Start an". */
function startSource() {
  const path = require('node:path'),
    fs = require('node:fs');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = path.join(ROOT, 'startup');
  const teile = [
    'server.ts',
    'src/catalog/imageFollowUp.ts',
    'src/management/startFollowUpRuns.ts',
    'src/management/cleanup.ts',
    'src/catalog/imageState.ts',
  ].map(f => serviceSource(f));
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
      teile.push(serviceSource('startup/' + f));
    }
  }
  return teile.join('\n');
}

/** Die Portfolio-Kurve: Orchestrierung, Rekonstruktion und Diagrammdaten. */
function portfolioSource() {
  const path = require('node:path'),
    fs = require('node:fs');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = path.join(ROOT, 'src/finances/portfolio');
  const teile = [serviceSource('src/finances/portfolioHistory.ts')];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
      teile.push(serviceSource('src/finances/portfolio/' + f));
    }
  }
  return teile.join('\n');
}

/** Die Grundausstattung des Frontends samt der ausgelagerten Abschnitte. */
function coreSource() {
  const path = require('node:path'),
    fs = require('node:fs');
  const dir = path.join(__dirname, '..', '..', 'public', 'js');
  // escaping.js VORNE: esc() gehört zur Grundausstattung, und
  // test/frontend-escaping.test.js schneidet seinen Sandkasten ab `function esc(s)`.
  return [
    'escaping.js',
    'state.js',
    'events.js',
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
    'kontofilter.js',
    'rollbalken.js',
    'sitzung.js',
  ]
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

/**
 * Der Kopf einer Funktion bis zur schliessenden Klammer der Parameterliste.
 * Damit nennt eine Prüfung den Parameter, nicht Reihenfolge und Schreibweise
 * aller anderen — die fielen bei jeder Typschärfung um.
 * @returns {string} z.B. "function f(a, b: string | null = null)"
 */
function functionHeader(src, name) {
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

/**
 * Der RUMPF einer Funktion ohne die umschliessenden Klammern. Gesucht wird
 * `function name(` (unabhängig von Annotationen), und es WIRFT, wenn nichts
 * gefunden wird — ein -1 aus indexOf ergäbe sonst still eine leere Funktion.
 * Das Ende ist die schliessende Klammer in SPALTE 0.
 */
function functionBody(src, name) {
  const kopf = functionHeader(src, name);
  const afterHeader = src.indexOf(kopf) + kopf.length;
  const auf = src.indexOf('{', afterHeader);
  if (auf < 0) throw new Error(`Rumpf von ${name} beginnt nicht mit {`);
  const zu = src.indexOf('\n}', auf);
  if (zu < 0) throw new Error(`Rumpf von ${name} ist nicht geschlossen`);
  return src.slice(auf + 1, zu);
}

/** Unabhängig von Typannotation und Position; mit `withDefaultNull` zusätzlich
 *  die Vorgabe null (dann dürfen Aufrufer ihn weglassen). */
function hatParameter(src, name, param, withDefaultNull = false) {
  const kopf = functionHeader(src, name);
  const drin = new RegExp(`\\b${param}\\b`).test(kopf);
  if (!drin) return false;
  if (!withDefaultNull) return true;
  return new RegExp(`\\b${param}\\b[^,)]*=\\s*null`).test(kopf);
}

/**
 * Genau diese Parameter, der Reihe nach, ohne Rücksicht auf Typannotationen,
 * Vorgabewerte oder Zeilenumbrüche: `checkParameter(src, 'besitzerAnhaengen',
 * ['uids', 'rows'])`. Ein Muster über den ganzen Kopf fiele um, sobald jemand
 * einen Typ schärft.
 * @param {string} [hinweis] Zusatz für die Fehlermeldung
 */
function checkParameter(src, name, params, hinweis = '') {
  const assert = require('node:assert/strict');
  const kopf = functionHeader(src, name);
  const innen = kopf.slice(kopf.indexOf('(') + 1, kopf.length - 1);

  let zuletzt = -1;
  for (const p of params) {
    const treffer = new RegExp(`\\b${p}\\b`).exec(innen.slice(zuletzt + 1));
    assert.ok(treffer, `${name} nimmt '${p}' nicht (mehr) entgegen${hinweis ? ' — ' + hinweis : ''}: ${kopf}`);
    zuletzt = zuletzt + 1 + treffer.index;
  }
}

/**
 * Wo welcher Router hängt — aus server.ts GELESEN, nicht abgeschrieben: Eine
 * Prüfung, die die Verdrahtung abschreibt, prüft nicht die Verdrahtung.
 * @returns [{ mount: '/api/v1/sets', datei: '<abs>/routes/sets.ts', name: 'sets' }]
 *          ohne routes/api_v1/* — das ist der Index selbst.
 */
/** @param {{ withoutParts?: boolean }} [o] withoutParts: nur die eingehängten Module, nicht die Dateien eines Zusammenbaus */
function routerEinhaengungen(o = {}) {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8'));
  // `import xRouter from '../routes/x'` oben, `app.use('/api/…', xRouter)` unten.
  const fileJeName = new Map(
    [...src.matchAll(/import\s+(?:\{\s*)?(\w+)(?:\s*\})?\s+from\s+['"](?:\.\.?\/)+(routes\/[^'"]+)['"]/g)].map(m => [
      m[1],
      m[2],
    ]),
  );
  const out = [];
  // Ein Router mit Fabrik hängt als `baueXRouter(d)` ein.
  for (const m of src.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*(\w+)(?:\(\w+\))?\s*\)/g)) {
    const datei = fileJeName.get(m[2]);
    if (!datei || datei.startsWith('routes/api_v1')) continue;
    out.push({
      mount: m[1].replace(/\/+$/, ''),
      datei: path.join(ROOT, datei + '.ts'),
      name: datei.replace(/^routes\//, ''),
    });
    // Ein Zusammenbau (routes/auth.ts) hängt seine Teile unter derselben Adresse ein.
    const teile = path.join(ROOT, datei);
    if (!o.withoutParts && fs.existsSync(teile) && fs.statSync(teile).isDirectory())
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

/**
 * Einen Ausschnitt schneiden — und WERFEN, wenn ein Anker fehlt: `slice(-1)`
 * gäbe sonst einen leeren Ausschnitt, auf dem `assert.doesNotMatch` still grün ist.
 * @param {string} [bis]   bis hierher (muss vorkommen, wenn angegeben), sonst bis zum Ende
 * @param {string} [purpose]  wofür der Ausschnitt gebraucht wird, für die Meldung
 */
function abschnitt(quelle, ab, bis, purpose = '') {
  const i = String(quelle).indexOf(ab);
  if (i < 0)
    throw new Error(
      `Ankertext nicht gefunden${purpose ? ` (${purpose})` : ''}: ${JSON.stringify(ab).slice(0, 90)}\n` +
        'Der Ausschnitt waere leer, und Zusicherungen darauf pruefen nichts mehr.',
    );
  if (bis === undefined) return String(quelle).slice(i);
  const j = String(quelle).indexOf(bis, i);
  if (j < 0)
    throw new Error(`Endanker nicht gefunden${purpose ? ` (${purpose})` : ''}: ${JSON.stringify(bis).slice(0, 90)}`);
  return String(quelle).slice(i, j);
}

/**
 * Ein Pfad-Literal des Frontends auf seine FORM bringen, einmal für alle
 * Prüfungen. `[^}]*` käme über ein verschachteltes `${…}` nicht hinweg.
 * Ein `${…}` ist nur dann ein Pfadabschnitt, wenn direkt ein `/` davorsteht:
 *     `/v1/parts/${nr}/${farbe}`            → /v1/parts/:X/:X
 *     `/v1/minifigs/${nr}${owner ? …: ''}`  → /v1/minifigs/:X
 * @param {string} [marke]   Platzhalter je Abschnitt — ':X' oder ':x'
 */
function pathForm(roh, marke = ':X') {
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

/**
 * Die Routen einer Router-Datei wie ein Treffer von `router.<verb>('<pfad>'`: [ganz, verb, pfad
 * relativ zu `mount`]. Vertragsrouter nennen den vollen Pfad im Schlüssel (`endpunkt('GET /api/v1/…'`).
 * @param {string} src @param {string} mount @returns {string[][]}
 */
function routesFromSource(src, mount) {
  const raus = [];
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]/g)) raus.push([...m]);
  for (const m of src.matchAll(/\.endpunkt\(\s*['"`](GET|POST|PUT|PATCH|DELETE) ([^'"`]+)['"`]/g)) {
    const voll = m[2];
    const rel = voll === mount ? '/' : voll.startsWith(`${mount}/`) ? voll.slice(mount.length) : null;
    if (rel !== null) raus.push([m[0], m[1].toLowerCase(), rel]);
  }
  return raus;
}

/** Die Dateiliste steht hier, damit test/api-eingang-db.test.js keinen
 *  variablen Pfad liest (test/eigenbruecken.test.js zählt sie). */
function v1Routes() {
  const gefunden = [];
  const lies = (datei, vorne) => {
    const s = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    for (const m of s.matchAll(/(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g))
      gefunden.push([m[1].toUpperCase(), vorne + m[2]]);
    // Vertragsrouter: Der Schlüssel nennt Methode und vollen Pfad.
    for (const m of s.matchAll(/\.endpunkt\(\s*['"`](GET|POST|PUT|PATCH|DELETE) ([^'"`]+)['"`]/g))
      gefunden.push([m[1], m[2]]);
  };
  for (const f of fs.readdirSync(path.join(ROOT, 'routes/api_v1')).filter(f => f.endsWith('.ts')))
    lies(`routes/api_v1/${f}`, '/api/v1');
  // Die in server.ts eingehängten Router (auth samt Teilen, gesundheit).
  for (const r of routerEinhaengungen().filter(r => r.mount.startsWith('/api/v1')))
    lies(path.relative(ROOT, r.datei), r.mount);
  lies('server.ts', '');
  return gefunden.filter(([, p]) => p.startsWith('/api/v1'));
}

/** Für Prüfungen, die eine Eigenschaft überall verlangen, statt eine
 *  Dateiliste zu führen, die beim nächsten Umzug veraltet. */
function allSources() {
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

/** Prüfungen auf das SQL eines Dienstes meinen seinen Weg zur Datenbank,
 *  nicht die Datei.
 * @param {string} rel Pfad relativ zu ROOT, z. B. 'src/sets/setMove.ts' */
function serviceSource(rel) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const repos = new Set(
    [...ohneKommentare(s).matchAll(/(?:from\s+|import\(\s*|require\(\s*)['"](\.[^'"]*repository[^'"]*)['"]/g)]
      .map(m => path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])).replace(/\.js$/, ''))
      .map(z => (fs.existsSync(path.join(ROOT, z + '.ts')) ? z + '.ts' : z + '/index.ts')),
  );
  // Der Katalog bindet seine Repositories in einer Fabrik (src/catalog/area.ts).
  for (const m of ohneKommentare(s).matchAll(/\bkatalog\(\)\.(\w+)\./g))
    if (fs.existsSync(path.join(ROOT, `src/catalog/repository/${m[1]}.ts`)))
      repos.add(`src/catalog/repository/${m[1]}.ts`);
  // Die übrigen Bereiche ebenso (src/<b>/bereich.ts, Zugriff über <b>Bereich()).
  for (const m of ohneKommentare(s).matchAll(/\b(\w+)Bereich\(\)\.(\w+)\./g)) {
    const factoryFile = ['bereich.ts', 'area.ts'].find(f => fs.existsSync(path.join(ROOT, `src/${m[1]}/${f}`)));
    if (!factoryFile) continue;
    const factory = path.join(ROOT, `src/${m[1]}/${factoryFile}`);
    const ziel = fs.readFileSync(factory, 'utf8').match(new RegExp(`import \\* as ${m[2]} from '\\./([^']+)'`));
    if (ziel && /repository/.test(ziel[1])) repos.add(`src/${m[1]}/${ziel[1]}.ts`);
  }
  // Über den Kontext des Dienstes (k.repo., k.<bereich>.repo.; t in einer Transaktion).
  const eigener = /^src\/(\w+)\//.exec(rel)?.[1];
  const ueber = (b, name) => {
    const factoryFile = b && ['kontext.ts', 'context.ts'].find(f => fs.existsSync(path.join(ROOT, `src/${b}/${f}`)));
    const factory = factoryFile && path.join(ROOT, `src/${b}/${factoryFile}`);
    if (!factory) return;
    const ziel = fs.readFileSync(factory, 'utf8').match(new RegExp(`import \\* as ${name} from '\\./([^']+)'`));
    if (ziel && /repository/.test(ziel[1])) repos.add(`src/${b}/${ziel[1]}.ts`);
  };
  for (const m of ohneKommentare(s).matchAll(/\b(?:k|kx|sk|t)\.(\w+)\.(\w+)?/g)) {
    ueber(eigener, m[1]);
    if (m[2]) ueber(m[1], m[2]);
  }
  return [s, ...[...repos].map(r => fs.readFileSync(path.join(ROOT, r), 'utf8'))].join('\n');
}

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
      .filter(f => isAppModule(f))
      .sort()
      .map(f => path.join(pub, 'js', f)),
    path.join(pub, 'i18n.js'),
  ]
    .map(f => fs.readFileSync(f, 'utf8'))
    .join('\n');
}

/** Die Anmelderouten: routes/auth.ts setzt sie aus routes/auth/*.ts zusammen. */
function loginSource() {
  const teile = fs
    .readdirSync(path.join(ROOT, 'routes', 'auth'))
    .filter(n => n.endsWith('.ts'))
    .sort();
  // Die Abläufe nach der Prüfung stehen seit dem 09.11.2026 in src/konto/anmeldungAblauf.ts.
  return ['routes/auth.ts', ...teile.map(n => `routes/auth/${n}`), 'src/konto/anmeldungAblauf.ts']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
}

/** Die Dateien je Ansicht; eine geteilte Ansicht bleibt so unter einem Namen prüfbar. */
const VIEWS = {
  einstellungen: ['settings.js', 'zugaenge.js', 'haushalt.js', 'user-management.js', 'alarme.js', 'lagerorte.js'],
};

/** Alle Dateien einer Ansicht (Schlüssel aus VIEWS) als EIN Text. */
function ansichtQuelle(/** @type {keyof typeof VIEWS} */ name) {
  const js = path.join(ROOT, 'public', 'js');
  return VIEWS[name].map(f => fs.readFileSync(path.join(js, f), 'utf8')).join('\n');
}

module.exports = {
  ROOT,
  serverOnly,
  imgProxy,
  serverAll,
  finanzQuelle,
  environment,
  buildAndRequire,
  testAccess,
  testData,
  testImageWorker,
  testSources,
  asAccount,
  testServices,
  testContext,
  testArea,
  replaceServices,
  imageNotes,
  areaPage,
  routerFrom,
  buildDist,
  loadTranslations,
  localeSource,
  i18nAll,
  ohneKommentare,
  kompakt,
  withoutHtmlComments,
  regexLiteral,
  proxyThumbSource,
  adminSource,
  setCoreSource,
  handlerQuelle,
  handlerModule,
  startSource,
  portfolioSource,
  coreSource,
  functionHeader,
  functionBody,
  hatParameter,
  checkParameter,
  routerEinhaengungen,
  einhaengung,
  abschnitt,
  pathForm,
  leseLiteral,
  routesFromSource,
  v1Routes,
  allSources,
  serviceSource,
  frontendQuelle,
  loginSource,
  ansichtQuelle,
  testClock,
  DIST: path.join(ROOT, 'dist'),
};
