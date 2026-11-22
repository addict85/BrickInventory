/**
 * Shared source text accesses for the static tests. The views name
 * the SUBJECT of a check, not the storage location: if code moves, one
 * place changes here instead of twenty checks.
 */
const { isAppModule } = require('../../scripts/build-frontend');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

/** The app (startup/app.ts, middleware in its order) and server.ts:
 *  for checks where the ORDER counts. Whoever means the start takes startSource(). */
const serverOnly = () =>
  fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8') +
  '\n' +
  fs.readFileSync(path.join(ROOT, 'server.ts'), 'utf8');

const imgProxy = () =>
  fs.readFileSync(path.join(ROOT, 'src/images/http/imageProxy.ts'), 'utf8') +
  '\n' +
  fs.readFileSync(path.join(ROOT, 'routes/imgProxy.ts'), 'utf8');

/** Server, image proxy and preview path: for “does X occur anywhere". The
 *  order across file boundaries is meaningless — for indexOf comparisons
 *  take serverOnly() or imgProxy(). */
const serverAll = () => serverOnly() + '\n' + imgProxy() + '\n' + proxyThumbSource() + '\n' + startSource();

/** The whole finance layer concatenated: the rules (“only ONE
 *  condition resolution") apply to the layer, not to the facade financeCalc.ts. */
const finanzQuelle = () => {
  const ordner = path.join(ROOT, 'src/finances/calculation');
  const parts = [serviceSource('src/finances/financeCalc.ts')];
  for (const n of fs
    .readdirSync(ordner)
    .filter(x => x.endsWith('.ts'))
    .sort()) {
    parts.push(serviceSource('src/finances/calculation/' + n));
  }
  // Self-proof: if the helper did not find the modules, the rules would only check the
  // facade and be silently green.
  if (parts.length < 4) {
    throw new Error(`finanzQuelle(): nur ${parts.length} Dateien gefunden — liegt src/finances/calculation/ noch da?`);
  }
  return parts.join('\n');
};

/**
 * Builds the .ts sources to dist/ (never next to the sources) and returns a
 * require helper for it: `buildAndRequire()('src/sets/index.js')`.
 */
let _built = false;

/** @returns {number} 0 if the directory does not exist */
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

/** Without this check every test file would rebuild the tree in its own process
 *  and break the test runner's time limit on weak hardware. */
function distIsFresh() {
  const dist = path.join(ROOT, 'dist');
  const distAt = newestMtime(dist, /\.js$/);
  if (!distAt) return false;
  let srcAt = fs.statSync(path.join(ROOT, 'server.ts')).mtimeMs;
  for (const d of ['db', 'src', 'routes', 'jobs', 'clients', 'startup']) {
    srcAt = Math.max(srcAt, newestMtime(path.join(ROOT, d), /\.ts$/));
  }
  // Migrations are .sql and are copied along: a new one counts like a
  // changed source, a deleted one via the time of the directory.
  const mig = path.join(ROOT, 'db/migrations');
  srcAt = Math.max(srcAt, newestMtime(mig, /\.sql$/), fs.existsSync(mig) ? fs.statSync(mig).mtimeMs : 0);
  return distAt >= srcAt;
}

/** Bring dist/ and the bundle up to date with the sources without loading anything from them.
 *  The bundle belongs to it because every server with a UI delivers it. */
function buildDist() {
  if (_built) return;
  require('./bundle').placeBundleSafe();
  if (!distIsFresh()) {
    const { execFileSync } = require('node:child_process');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-ts.js'), '--outdir', path.join(ROOT, 'dist')], {
      stdio: 'ignore',
    });
  }
  _built = true;
}

/** The test file's access: db/database no longer knows an access of the process;
 *  a test gets it like the server from its entry point, here from here. */
let _testDb = null;
let _ownDb = null;
/** Create the accesses; set by buildAndRequire(). */
let _accessFactory = null;
/** Builds services and contexts of this test file; set by buildAndRequire(). */
let _serviceFactory = null;
let _gebaut = null;
/** Replacements (replaceServices), remembered even before the first build. */
const _ersatz = [];

/** The services of this test file: buildServices(testAccess()) as in the server, once per file. */
/** @returns {any} */
function testServices() {
  if (!_serviceFactory) throw new Error('testServices() erst nach buildAndRequire()');
  if (!_gebaut) {
    _gebaut = _serviceFactory();
    for (const [b, e] of _ersatz) Object.assign(_gebaut.d[b], e);
  }
  return _gebaut.d;
}

/** The context of a scope (repositories, access, dependencies) for tests that
 *  look inside; the services themselves do not hand it out. */
/** @param {string} bereich @returns {any} */
function testContext(bereich) {
  testServices();
  const k = _gebaut.contexts[bereich];
  if (!k) throw new Error(`kein Kontext für ${bereich}`);
  return k;
}

/** Replaces services of a scope for this test file, also for other scopes that
 *  call them via their context (the same object). Before or after the first build. */
function replaceServices(bereich, ersatz) {
  _ersatz.push([bereich, ersatz]);
  if (_gebaut) Object.assign(_gebaut.d[bereich], ersatz);
}

/** The public side of a scope (index.js) together with its services of this test file:
 *  whatever index.js does not export is passed on to testServices()[bereich] on call,
 *  so that a file only builds the services when a test calls them. */
/** @param {string} bereich @returns {any} */
function areaPage(bereich) {
  const modul = require(path.join(ROOT, 'dist', 'src', bereich, 'index.js'));
  return new Proxy(modul, {
    get: (m, n) => (n in m ? m[n] : (...a) => testServices()[bereich][n](...a)),
  });
}

/** Records what the images note (rememberUsed, src/images/imageDemand.ts): at the buffer
 *  itself, so that every path there counts. `ende()` stops again. */
/** @param {any} [kontext] @returns {{ notes: [string, string][], ende: () => void }} */
function imageNotes(kontext = testContext('images')) {
  const puffer = kontext.compartments.slot('image_demand:puffer', () => new Map());
  /** @type {[string, string][]} */
  const notes = [];
  puffer.set = (/** @type {string} */ url, /** @type {string} */ sn) => {
    notes.push([url, sn]);
    return Map.prototype.set.call(puffer, url, sn);
  };
  return { notes, ende: () => delete puffer.set };
}

/** Like the former xBereich(): services of a scope, read access falls back to its context.
 *  Writing goes to the services. */
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
        const source = n in d ? d : testContext(bereich);
        return n in source ? { value: source[n], enumerable: true, configurable: true, writable: true } : undefined;
      },
    },
  );
}
let _dataFactory = null;
/** The services' image machinery (src/catalog/context.ts): one per file, even if it
 *  calls buildAndRequire() several times, so that a replaced part does not get lost. */
const _imageWorker = {
  loadSetImage: (...a) =>
    require(path.join(ROOT, 'dist', 'src/images/setImages.js')).downloadSetImage(testContext('images'), ...a),
  createPreview: (...a) => require(path.join(ROOT, 'dist', 'src/images/thumbs.js')).previewFrom(...a),
};

/** The replaced clients of the services (src/externalSources/sources.ts): empty means real. */
const _sources = {};

/** The clock of this test file's services (k.uhr, settableClock from src/infra/clock.ts): it runs
 *  with the system time, a test jumps over a deadline with vor(ms) instead of waiting it out. */
let _clock = null;
function testClock() {
  if (!_clock) _clock = require(path.join(ROOT, 'dist', 'src/infra/clock.js')).settableClock();
  return _clock;
}

function buildAndRequire() {
  // In tests every response of a route with a contract runs through its schema (src/http/contractRouter.ts).
  process.env.CHECK_CONTRACT ??= '1';
  // Without NODE_ENV the production rules apply (superuser ban, APP_BASE_URL);
  // outside npm test (and with `@superuser`) the test DB is superuser, and started servers inherit that.
  process.env.NODE_ENV ??= 'test';
  buildDist();
  const V = () => require(path.join(ROOT, 'dist', 'startup/wiring.js'));
  const dbModule = require(path.join(ROOT, 'dist', 'db/database.js'));
  // Like server.ts: the access creates the first account in an empty database.
  const firstStart = () => testServices().account.createStartAdmin();
  const testDb = () => (_testDb ??= dbModule.createDb(dbModule.dbConfigFromEnvironment(), { firstStart }));
  _accessFactory = testDb;
  // The same wiring as the server (buildServices), built only on first use:
  // a test provides clients via testSources(), even after this call.
  _serviceFactory = () => {
    const contexts = {};
    // The configuration that buildServices passes reads on access: a test that
    // changes a value with umgebung()/setConfig() also sees it in k.konfig.
    const K = require(path.join(ROOT, 'dist', 'src/infra/config.js'));
    const config = {};
    for (const n of Object.keys(K.config()))
      Object.defineProperty(config, n, { enumerable: true, get: () => K.config()[n] });
    const d = V().buildServices(testDb(), {
      imageWorker: _imageWorker,
      sources: _sources,
      contexts,
      config,
      clock: testClock(),
    });
    return { d, contexts };
  };
  // The owner creates test data (bypassing row security, without FORCE); the code
  // under test queries via testDb() as the runtime role as in production (helpers/own-db.js).
  const ownDb = () => (_ownDb ??= ownerAccess(dbModule, testDb, firstStart));
  _dataFactory = ownDb;
  return rel => {
    const m = withContext(rel, require(path.join(ROOT, 'dist', rel)));
    return rel.startsWith('routes/') ? withAccountTheRequest(m) : m;
  };
}

/** Inner services of a scope take the context as their first parameter (src/infra/area.ts).
 *  A test that loads such a module directly calls them with the context of this test file. */
const _withContext = new Map();
const CONTEXT_FN =
  /^(?:export )?(?:async )?function (\w+)(?:<[^(]*>)?\(\s*kx?: \w+(?:Kontext|Context)\b|^(?:export )?const (\w+) = (?:async )?\(\s*kx?: \w+(?:Kontext|Context)\b/gm;
/** The names of the context services of a source, also passed-on ones (export { a as b } [from './x']). */
function contextNames(ts, depth = 0) {
  const source = fs.existsSync(ts) ? fs.readFileSync(ts, 'utf8') : '';
  const namen = new Set([...source.matchAll(CONTEXT_FN)].map(x => x[1] || x[2]));
  if (depth < 2)
    for (const i of source.matchAll(/^import \{([^}]*)\} from '(\.[^']+)';/gm)) {
      const dort = contextNames(path.join(path.dirname(ts), `${i[2]}.ts`), depth + 1);
      for (const n of i[1].split(',').map(x => x.trim())) if (dort.has(n)) namen.add(n);
    }
  for (const e of source.matchAll(/^export \{([^}]*)\}(?: from '(\.[^']+)')?;/gm)) {
    const quellNames = e[2] && depth < 2 ? contextNames(path.join(path.dirname(ts), `${e[2]}.ts`), depth + 1) : namen;
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

/** The owner's access if the run separates roles, otherwise the test access itself.
 * Whoever closes one of the two pools closes both: it used to be one. */
function ownerAccess(dbModule, testDb, firstStart) {
  const url = process.env.TEST_DB_EIGEN_URL;
  if (!url || url === process.env.DATABASE_URL) return testDb();
  const k = dbModule.dbConfigFromEnvironment();
  // Like server.ts: the first start creates the first account in the system context.
  const { inSystemContext } = require(path.join(ROOT, 'dist', 'src/infra/accountContext.js'));
  const eigen = dbModule.createDb(
    { ...k, connection: { connectionString: url }, system: null },
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

/** Like startup/app.ts (rememberRequest before all routes): a router from routes/ that a test
 * mounts itself runs in the account of its request, otherwise it would see nothing under row security. */
function withAccountTheRequest(m) {
  const isRouter = x => typeof x === 'function' && Array.isArray(x.stack) && typeof x.handle === 'function';
  if (!isRouter(m)) return m;
  const { asRequest } = require(path.join(ROOT, 'dist', 'src/infra/accountContext.js'));
  const { errorResponse } = require(path.join(ROOT, 'dist', 'src/http/httpResponse.js'));
  // Like startup/app.ts: the app attaches the error path, not the router.
  const weiter = (req, res, next) => e =>
    e && e !== 'route' && e !== 'router' ? errorResponse(e, req, res, next) : next();
  return new Proxy(m, {
    apply: (ziel, ich, [req, res, next]) => asRequest(req, () => ziel.call(ich, req, res, weiter(req, res, next))),
  });
}

/** A route module with a factory (baueXRouter(d)) as a router, with the services of this test file
 *  (testServices()); a module without a factory unchanged. */
function routerFrom(_req, rel) {
  const m = _req(rel);
  const build = Object.entries(m).find(([n, f]) => /^build\w*Router$/.test(n) && typeof f === 'function');
  // Like startup/app.ts: the built router runs in the account of its request.
  return build ? withAccountTheRequest(build[1](testServices())) : m;
}

/** The access from createDb() that the wired services of this test file also
 *  use: for code under test that should query as the runtime role as in production.
 *  Only after buildAndRequire(). */
function testAccess() {
  if (!_accessFactory) throw new Error('testAccess() erst nach buildAndRequire()');
  return _accessFactory();
}

/** The image machinery that buildServices() of this file got: a test replaces a part
 *  in it instead of bending the module on load. With `t` the replacement applies until the end of the test.
 *  @param {{ after: (f: () => void) => void } | null} [t] @param {Record<string, Function>} [ersatz] */
function testImageWorker(t, ersatz = {}) {
  const vorher = { ..._imageWorker };
  Object.assign(_imageWorker, ersatz);
  t?.after(() => Object.assign(_imageWorker, vorher));
  return _imageWorker;
}

/** Calls f on behalf of an account like a request (asRequest): the code under test sees
 *  only its household under row security, as in production.
 *  @template T @param {number} uid @param {() => T} f @param {{ verwalter?: boolean }} [o] @returns {T} */
function asAccount(uid, f, o = {}) {
  const { asRequest } = require(path.join(ROOT, 'dist', 'src/infra/accountContext.js'));
  return asRequest({ apiUser: { user_id: uid, is_admin: !!o.verwalter } }, f);
}

/** Replaces external sources (Rebrickable, BrickLink, Brickset; names as in buildSources(), src/externalSources/sources.ts)
 *  at the wiring instead of bending modules on load. With `t` until the end of the test.
 *  @param {{ after: (f: () => void) => void } | null} t @param {Record<string, unknown>} ersatz */
function testSources(t, ersatz) {
  Object.assign(_sources, ersatz);
  t?.after(() => {
    for (const k of Object.keys(ersatz)) delete _sources[k];
  });
  return _sources;
}

/** The owner's access for test data: it writes past row security so that
 *  a test creates rows of arbitrary accounts. Only built on first use so that a
 *  test file can still set the environment after the call. Only after buildAndRequire(). */
function testData() {
  if (!_dataFactory) throw new Error('testData() erst nach buildAndRequire()');
  return _dataHandle;
}
const _dataHandle = new Proxy(/** @type {any} */ ({}), { get: (_z, k) => _dataFactory()[k] });

/** Switches environment variables (undefined deletes) and lets konfig() reread
 *  them: the server reads them once at startup (src/infra/config.ts). */
function environment(values) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // Not loaded yet: the first konfig() call reads the new values anyway.
  const datei = path.join(ROOT, 'dist', 'src/infra/config.js');
  if (require.cache[datei]) require(datei).readConfigNew();
}

/** Both language files together: i18n.js alone delivers an empty I18N.
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
 * Source text without comments so that an explanatory comment with the searched name
 * does not keep a check green. Only block comments at the start of a line: a `/*`
 * in a string (`'/images/*pfad'`) would otherwise tear holes into the file.
 */
function ohneKommentare(src) {
  return String(src)
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}

/**
 * Source text in one line, as the formatter would write it at any line width:
 * a pattern on a statement should not depend on where Biome wraps
 * (brackets over several lines, comma before the closing bracket).
 */
function kompakt(src) {
  return String(src)
    .replace(/\s+/g, ' ')
    .replace(/([([]) /g, '$1')
    .replace(/,? ([)\]])/g, '$1')
    .replace(/, \}/g, ' }');
}

/** HTML comments until the fixed point: a leftover like “<!<!---->--” would otherwise form a new one. */
function withoutHtmlComments(src) {
  let s = String(src);
  for (let vorher; vorher !== s; ) {
    vorher = s;
    s = s.replace(/<!--[\s\S]*?-->/g, '');
  }
  return s;
}

/** For `new RegExp`: every special character literally. */
const regexLiteral = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The preview path of the image proxy (src/images/proxyThumbs.ts). */
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

/** The UI around entries: set detail, purchase price modal, detail window
 *  and their building blocks (storage location, price alert, charts, confirmations). */
function adminSource() {
  const path = require('node:path'),
    fs = require('node:fs');
  const ROOT = path.join(__dirname, '..', '..');
  return [
    'admin.js',
    'set-detail.js',
    'detail-fields.js',
    'charts.js',
    'crosshair.js',
    'confirm-prompt.js',
    'purchase-dialogs.js',
    'manual-detail.js',
    'entry-state.js',
    'purchase-price-display.js',
  ]
    .map(f => fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8'))
    .join('\n');
}

/** The path on which a set is created or changes, including catalog work. */
function setCoreSource() {
  return [
    ['routes/api/sets.ts'],
    ['routes/api/setsImport.ts'],
    ['routes/api/setsInstructions.ts'],
    ['routes/api/setsStorage.ts'],
    ['src/sets/service.ts'],
    ['src/sets/content.ts'],
    ['src/sets/barcode.ts'],
    ['src/sets/csvImport.ts'],
    ['src/sets/instructions.ts'],
    ['src/sets/prices.ts'],
    ['src/sets/addSet.ts'],
    ['src/catalog/partsImport.ts'],
    ['src/catalog/minifigsImport.ts'],
    ['src/sets/setContentImport.ts'],
  ]
    .map(p => serviceSource(p[0]))
    .join('\n');
}

/** The read queries per domain area as ONE source text. */
const HANDLER_MODULE = [
  'src/inventory/shared',
  'src/household/household',
  'src/parts/queries',
  'src/sets/read',
  'src/sets/delete',
  'src/minifigs/queries',
  'src/inventory/metrics',
];
function handlerQuelle() {
  return HANDLER_MODULE.map(m => serviceSource(m + '.ts')).join('\n');
}

/** The built module for a name from the read queries. */
function handlerModule(_req) {
  // The sets services of this test file, bound with their context.
  return Object.assign({}, ...(_req && HANDLER_MODULE.map(m => _req(`${m}.js`))), _req && testServices().sets);
}

/** server.ts including the start of the job process and the runs there: for “does X
 *  start up at startup". */
function startSource() {
  const path = require('node:path'),
    fs = require('node:fs');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = path.join(ROOT, 'startup');
  const parts = [
    'server.ts',
    'src/catalog/imageFollowUp.ts',
    'src/management/startFollowUpRuns.ts',
    'src/management/cleanup.ts',
    'src/catalog/imageState.ts',
  ].map(f => serviceSource(f));
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
      parts.push(serviceSource('startup/' + f));
    }
  }
  return parts.join('\n');
}

/** The portfolio curve: orchestration, reconstruction and chart data. */
function portfolioSource() {
  const path = require('node:path'),
    fs = require('node:fs');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = path.join(ROOT, 'src/finances/portfolio');
  const parts = [serviceSource('src/finances/portfolioHistory.ts')];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.ts'))) {
      parts.push(serviceSource('src/finances/portfolio/' + f));
    }
  }
  return parts.join('\n');
}

/** The basic equipment of the frontend including the outsourced sections. */
function coreSource() {
  const path = require('node:path'),
    fs = require('node:fs');
  const dir = path.join(__dirname, '..', '..', 'public', 'js');
  // escaping.js FIRST: esc() belongs to the basic equipment, and
  // test/frontend-escaping.test.js cuts its sandbox from `function esc(s)`.
  return [
    'escaping.js',
    'state.js',
    'events.js',
    'dom.js',
    'format.js',
    'messages.js',
    'connection.js',
    'api.js',
    'images.js',
    'form.js',
    'account.js',
    'progress.js',
    'monitor.js',
    'account-filter.js',
    'scrollbar.js',
    'session.js',
  ]
    .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n');
}

/**
 * The head of a function up to the closing parenthesis of the parameter list.
 * That way a check names the parameter, not order and spelling
 * of all the others — those would break with every type tightening.
 * @returns {string} e.g. "function f(a, b: string | null = null)"
 */
function functionHeader(src, name) {
  // Also with type parameters (`function f<T>(`).
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
 * The BODY of a function without the enclosing braces. What is searched for is
 * `function name(` (regardless of annotations), and it THROWS if nothing
 * is found — a -1 from indexOf would otherwise silently yield an empty function.
 * The end is the closing brace in COLUMN 0.
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

/** Regardless of type annotation and position; with `withDefaultNull` additionally
 *  the default null (then callers may omit it). */
function hatParameter(src, name, param, withDefaultNull = false) {
  const kopf = functionHeader(src, name);
  const drin = new RegExp(`\\b${param}\\b`).test(kopf);
  if (!drin) return false;
  if (!withDefaultNull) return true;
  return new RegExp(`\\b${param}\\b[^,)]*=\\s*null`).test(kopf);
}

/**
 * Exactly these parameters, in order, regardless of type annotations,
 * default values or line breaks: `checkParameter(src, 'attachOwners',
 * ['uids', 'rows'])`. A pattern over the whole head would break as soon as someone
 * tightens a type.
 * @param {string} [hint] addition for the error message
 */
function checkParameter(src, name, params, hint = '') {
  const assert = require('node:assert/strict');
  const kopf = functionHeader(src, name);
  const innen = kopf.slice(kopf.indexOf('(') + 1, kopf.length - 1);

  let zuletzt = -1;
  for (const p of params) {
    const treffer = new RegExp(`\\b${p}\\b`).exec(innen.slice(zuletzt + 1));
    assert.ok(treffer, `${name} nimmt '${p}' nicht (mehr) entgegen${hint ? ' — ' + hint : ''}: ${kopf}`);
    zuletzt = zuletzt + 1 + treffer.index;
  }
}

/**
 * Where which router hangs — READ from server.ts, not copied: a
 * check that copies the wiring does not check the wiring.
 * @returns [{ mount: '/api/v2/sets', datei: '<abs>/routes/sets.ts', name: 'sets' }]
 *          without routes/api/* — that is the index itself.
 */
/** @param {{ withoutParts?: boolean }} [o] withoutParts: only the mounted modules, not the files of an assembly */
function routerEinhaengungen(o = {}) {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, 'startup/app.ts'), 'utf8'));
  // `import xRouter from '../routes/x'` at the top, `app.use('/api/…', xRouter)` below.
  const fileJeName = new Map(
    [...src.matchAll(/import\s+(?:\{\s*)?(\w+)(?:\s*\})?\s+from\s+['"](?:\.\.?\/)+(routes\/[^'"]+)['"]/g)].map(m => [
      m[1],
      m[2],
    ]),
  );
  const out = [];
  // A router with a factory is mounted as `baueXRouter(d)`.
  for (const m of src.matchAll(/app\.use\(\s*['"](\/api[^'"]*)['"]\s*,\s*(\w+)(?:\(\w+\))?\s*\)/g)) {
    const datei = fileJeName.get(m[2]);
    if (!datei || datei.startsWith('routes/api')) continue;
    out.push({
      mount: m[1].replace(/\/+$/, ''),
      datei: path.join(ROOT, datei + '.ts'),
      name: datei.replace(/^routes\//, ''),
    });
    // An assembly (routes/auth.ts) mounts its parts under the same address.
    const parts = path.join(ROOT, datei);
    if (!o.withoutParts && fs.existsSync(parts) && fs.statSync(parts).isDirectory())
      for (const n of fs
        .readdirSync(parts)
        .filter(n => n.endsWith('.ts'))
        .sort())
        out.push({
          mount: m[1].replace(/\/+$/, ''),
          datei: path.join(parts, n),
          name: `${datei.replace(/^routes\//, '')}/${n.replace(/\.ts$/, '')}`,
        });
  }
  return out;
}

/**
 * The address in ONE place (startup/app.ts): a test bench that mounts routers by hand
 * would stay green after a move.
 * @param {string} name file name without routes/ and without .ts, e.g. 'auth'.
 */
function einhaengung(name) {
  const treffer = routerEinhaengungen().filter(r => r.name === name);
  if (treffer.length !== 1)
    throw new Error(`routes/${name}.ts haengt ${treffer.length}-mal in startup/app.ts — erwartet: genau einmal`);
  return treffer[0].mount;
}

/**
 * Cut a section — and THROW if an anchor is missing: `slice(-1)`
 * would otherwise give an empty section on which `assert.doesNotMatch` is silently green.
 * @param {string} [bis]   up to here (must occur if given), otherwise to the end
 * @param {string} [purpose]  what the section is needed for, for the message
 */
function abschnitt(source, ab, bis, purpose = '') {
  const i = String(source).indexOf(ab);
  if (i < 0)
    throw new Error(
      `Ankertext nicht gefunden${purpose ? ` (${purpose})` : ''}: ${JSON.stringify(ab).slice(0, 90)}\n` +
        'Der Ausschnitt waere leer, und Zusicherungen darauf pruefen nichts mehr.',
    );
  if (bis === undefined) return String(source).slice(i);
  const j = String(source).indexOf(bis, i);
  if (j < 0)
    throw new Error(`Endanker nicht gefunden${purpose ? ` (${purpose})` : ''}: ${JSON.stringify(bis).slice(0, 90)}`);
  return String(source).slice(i, j);
}

/**
 * Bring a path literal of the frontend into its SHAPE, once for all
 * checks. `[^}]*` would not get past a nested `${…}`.
 * A `${…}` is only a path segment if a `/` stands directly before it:
 *     `/v2/parts/${nr}/${farbe}`            → /v2/parts/:X/:X
 *     `/v2/minifigs/${nr}${owner ? …: ''}`  → /v2/minifigs/:X
 * @param {string} [marke]   placeholder per segment — ':X' or ':x'
 */
function pathForm(roh, marke = ':X') {
  let s = String(roh);
  let ago = null;
  // Innermost first until nothing matches anymore — so a nested expression
  // also disappears completely.
  while (ago !== s) {
    ago = s;
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
    break; // suffix, not a segment → the path ends here
  }
  return out.split('?')[0].replace(/'\s*\+.*$/, '');
}

/**
 * A literal from `i` with NESTED template expressions: a path can
 * carry backticks inside, and every `[^`]*` would break off there.
 * @returns {{text: string, ende: number}|null} content without quotes
 *   and the position AFTER the literal; null if none starts at `i`.
 */
function leseLiteral(src, i) {
  const anf = src[i];
  if (anf !== '`' && anf !== "'" && anf !== '"') return null;
  let j = i + 1,
    depth = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (anf === '`' && c === '$' && src[j + 1] === '{') {
      depth++;
      j += 2;
      continue;
    }
    if (depth > 0) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      // A literal in ${…} is read along so that it does not confuse the count.
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
 * The routes of a router file like a hit of `router.<verb>('<pfad>'`: [whole, verb, path
 * relative to `mount`]. Contract routers name the full path in the key (`endpoint('GET /api/v2/…'`).
 * @param {string} src @param {string} mount @returns {string[][]}
 */
function routesFromSource(src, mount) {
  const raus = [];
  for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]*)['"`]/g)) raus.push([...m]);
  for (const m of src.matchAll(/\.endpoint\(\s*['"`](GET|POST|PUT|PATCH|DELETE) ([^'"`]+)['"`]/g)) {
    const voll = m[2];
    const rel = voll === mount ? '/' : voll.startsWith(`${mount}/`) ? voll.slice(mount.length) : null;
    if (rel !== null) raus.push([m[0], m[1].toLowerCase(), rel]);
  }
  return raus;
}

/** The file list stands here so that test/api-inbox-db.test.js reads no
 *  variable path (test/eigenbruecken.test.js counts those). */
function v1Routes() {
  const found = [];
  const lies = (datei, vorne) => {
    const s = fs.readFileSync(path.join(ROOT, datei), 'utf8');
    for (const m of s.matchAll(/(?:router|app)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g))
      found.push([m[1].toUpperCase(), vorne + m[2]]);
    // Contract routers: the key names method and full path.
    for (const m of s.matchAll(/\.endpoint\(\s*['"`](GET|POST|PUT|PATCH|DELETE) ([^'"`]+)['"`]/g))
      found.push([m[1], m[2]]);
  };
  for (const f of fs.readdirSync(path.join(ROOT, 'routes/api')).filter(f => f.endsWith('.ts')))
    lies(`routes/api/${f}`, '/api/v2');
  // The routers mounted in server.ts (auth including parts, gesundheit).
  for (const r of routerEinhaengungen().filter(r => r.mount.startsWith('/api/v2')))
    lies(path.relative(ROOT, r.datei), r.mount);
  lies('server.ts', '');
  return found.filter(([, p]) => p.startsWith('/api/v2'));
}

/** For checks that require a property everywhere instead of keeping
 *  a file list that goes stale with the next move. */
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

/** Checks on a service's SQL mean its path to the database,
 *  not the file.
 * @param {string} rel path relative to ROOT, e.g. 'src/sets/setMove.ts' */
function serviceSource(rel) {
  const s = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const repos = new Set(
    [...ohneKommentare(s).matchAll(/(?:from\s+|import\(\s*|require\(\s*)['"](\.[^'"]*repository[^'"]*)['"]/g)]
      .map(m => path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])).replace(/\.js$/, ''))
      .map(z => (fs.existsSync(path.join(ROOT, z + '.ts')) ? z + '.ts' : z + '/index.ts')),
  );
  // The catalog binds its repositories in a factory (src/catalog/area.ts).
  for (const m of ohneKommentare(s).matchAll(/\bkatalog\(\)\.(\w+)\./g))
    if (fs.existsSync(path.join(ROOT, `src/catalog/repository/${m[1]}.ts`)))
      repos.add(`src/catalog/repository/${m[1]}.ts`);
  // The other scopes likewise (src/<b>/bereich.ts, access via <b>Bereich()).
  for (const m of ohneKommentare(s).matchAll(/\b(\w+)Bereich\(\)\.(\w+)\./g)) {
    const factoryFile = ['bereich.ts', 'area.ts'].find(f => fs.existsSync(path.join(ROOT, `src/${m[1]}/${f}`)));
    if (!factoryFile) continue;
    const factory = path.join(ROOT, `src/${m[1]}/${factoryFile}`);
    const ziel = fs.readFileSync(factory, 'utf8').match(new RegExp(`import \\* as ${m[2]} from '\\./([^']+)'`));
    if (ziel && /repository/.test(ziel[1])) repos.add(`src/${m[1]}/${ziel[1]}.ts`);
  }
  // Via the service's context (k.repo., k.<bereich>.repo.; t in a transaction).
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

/** All sources of the UI (public/js without the bundle, plus i18n.js) as ONE
 *  text: for checks that should not depend on the file in which a
 *  function currently stands. */
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

/** The login routes: routes/auth.ts assembles them from routes/auth/*.ts. */
function loginSource() {
  const parts = fs
    .readdirSync(path.join(ROOT, 'routes', 'auth'))
    .filter(n => n.endsWith('.ts'))
    .sort();
  // The flows after the check have been in src/account/loginFlow.ts since 09.11.2026.
  return ['routes/auth.ts', ...parts.map(n => `routes/auth/${n}`), 'src/account/loginFlow.ts']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');
}

/** The files per view; a split view thus stays checkable under one name. */
const VIEWS = {
  settings: ['settings.js', 'accesses.js', 'household.js', 'user-management.js', 'alerts.js', 'storage-locations.js'],
};

/** All files of a view (key from VIEWS) as ONE text. */
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
