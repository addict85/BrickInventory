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
  fs.readFileSync(path.join(ROOT, 'src/katalog/http/bildProxy.ts'), 'utf8') +
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

module.exports = { ROOT, serverOnly, imgProxy, serverAll, finanzQuelle, umgebung };

/**
 * Baut die .ts-Quellen nach dist/ (nie neben die Quellen) und liefert einen
 * require-Helfer darauf: `buildAndRequire()('db/database.js')`.
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
/** Erzeugt den Zugang; gesetzt von buildAndRequire(). */
let _zugangFabrik = null;

function buildAndRequire() {
  // Jede Antwort einer Route mit Vertrag läuft in Tests durch ihr Schema (src/http/vertragsRouter.ts).
  process.env.VERTRAG_PRUEFEN ??= '1';
  // Ohne NODE_ENV gelten die Regeln des Betriebs (Superuser-Verbot, APP_BASE_URL);
  // die Test-DB läuft als Superuser, und gestartete Server erben diese Umgebung.
  process.env.NODE_ENV ??= 'test';
  baueDist();
  // Wie server.ts: Ohne Verdrahtung prüften Tests eine stumme Fassung der Nacharbeit.
  // Die Bauteile erst beim ersten Gebrauch: Viele Tests stellen Klienten nach diesem
  // Aufruf über require.cache; ein früher geladener Dienst hielte die echten fest.
  const echt = () => require(path.join(ROOT, 'dist', 'startup/verdrahtung.js')).baueVerdrahtung();
  const faul = new Proxy(
    {},
    {
      get:
        (_z, k) =>
        (...a) =>
          echt().nacharbeit[k](...a),
    },
  );
  require(path.join(ROOT, 'dist', 'src/auftraege/nacharbeit.js')).verdrahteNacharbeit(faul);
  const dbModul = require(path.join(ROOT, 'dist', 'db/database.js'));
  // Wie server.ts: Der Zugang legt in einer leeren Datenbank das erste Konto an.
  const testDb = () =>
    (_testDb ??= dbModul.erzeugeDb(dbModul.dbKonfigAusUmgebung(), { erststart: () => echt().erststart() }));
  _zugangFabrik = testDb;
  // Wie verdrahte(): Ohne Zugang wirft jeder Abruf eines Klienten. Die Bauteile erst beim ersten Gebrauch.
  let klienten = null;
  const klientenEcht = () =>
    (klienten ??= require(path.join(ROOT, 'dist', 'startup/verdrahtung.js')).baueKlientenZugang());
  require(path.join(ROOT, 'dist', 'clients/zugang.js')).verdrahteKlienten(
    new Proxy({}, { get: (_z, k) => klientenEcht()[k] }),
  );
  // prozess.js lädt nichts; bereich.js erst beim ersten Gebrauch der Dienste.
  const BEREICHE = [
    ['einstellungen', 'Einstellungen'],
    ['auftraege', 'Auftraege'],
    ['haushalt', 'Haushalt'],
    ['konto', 'Konto'],
    ['idempotenz', 'Idempotenz'],
    ['finanzen', 'Finanzen'],
    ['bestand', 'Bestand'],
    ['teile', 'Teile'],
    ['figuren', 'Figuren'],
    ['merkliste', 'Merkliste'],
    ['gutscheine', 'Gutscheine'],
    ['sammlung', 'Sammlung'],
    ['verwaltung', 'Verwaltung'],
  ];
  for (const [b, B] of BEREICHE)
    require(path.join(ROOT, 'dist', `src/${b}/prozess.js`))[`verdrahte${B}`](() =>
      require(path.join(ROOT, 'dist', `src/${b}/bereich.js`))[`erzeuge${B}`]({ db: testDb() }),
    );
  require(path.join(ROOT, 'dist', 'src/katalog/prozess.js')).verdrahteKatalog(() =>
    require(path.join(ROOT, 'dist', 'src/katalog/bereich.js')).erzeugeKatalog({ db: testDb() }),
  );
  require(path.join(ROOT, 'dist', 'src/sets/prozess.js')).verdrahteSets(() =>
    require(path.join(ROOT, 'dist', 'src/sets/bereich.js')).erzeugeSets({
      db: testDb(),
      nacharbeit: faul,
      katalog: require(path.join(ROOT, 'dist', 'src/katalog/prozess.js')).katalog(),
      finanzen: require(path.join(ROOT, 'dist', 'src/finanzen/prozess.js')).finanzenBereich(),
      auftraege: require(path.join(ROOT, 'dist', 'src/auftraege/prozess.js')).auftraegeBereich(),
    }),
  );
  // db/database.js mit den Funktionen des Testzugangs, wie es früher der Prozesszugang war.
  const fassade = Object.create(dbModul, {
    pool: { get: () => testDb().pool },
    standardDb: { value: testDb },
  });
  for (const f of [
    'all',
    'get',
    'run',
    'exec',
    'transaction',
    'initSchema',
    'initSchemaOnce',
    'getPoolStats',
    'datenbankAntwortet',
    'alsSuperuserVerbunden',
    'eigeneVerbindung',
    'inTransaktion',
  ])
    fassade[f] = (...a) => testDb()[f](...a);
  return rel => (rel === 'db/database.js' ? fassade : require(path.join(ROOT, 'dist', rel)));
}

module.exports.buildAndRequire = buildAndRequire;

/** Der Zugang aus erzeugeDb(), den auch die verdrahteten Dienste dieser Testdatei
 *  benutzen: für neue Tests statt der Fassade `_req('db/database.js')`, die so
 *  tut, als gäbe es noch einen Zugang des Prozesses. Erst nach buildAndRequire(). */
function testZugang() {
  if (!_zugangFabrik) throw new Error('testZugang() erst nach buildAndRequire()');
  return _zugangFabrik();
}
module.exports.testZugang = testZugang;

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

/** Der Vorschau-Weg des Bild-Proxys (src/katalog/bilder/proxyThumbs.ts). */
function proxyThumbQuelle() {
  return [
    'src/katalog/http/bildProxy.ts',
    'routes/imgProxy.ts',
    'src/katalog/bilder/proxyThumbs.ts',
    'src/katalog/bilder/imgCacheServe.ts',
    'src/katalog/http/bildCacheAuslieferung.ts',
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
  // Die Sets-Dienste bekommen ihren Kontext über die Fassade (src/sets/index.ts).
  return Object.assign({}, ...(_req && HANDLER_MODULE.map(m => _req(`${m}.js`))), _req?.('src/sets/index.js'));
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
    'src/katalog/bildlage.ts',
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
    [...src.matchAll(/import\s+(\w+)\s+from\s+['"](?:\.\.?\/)+(routes\/[^'"]+)['"]/g)].map(m => [m[1], m[2]]),
  );
  const out = [];
  for (const m of src.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*(\w+)\s*\)/g)) {
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
