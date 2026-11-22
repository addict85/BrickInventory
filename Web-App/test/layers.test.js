/**
 * The dependencies point inwards.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * What is still fetched inwards from a route — and why it is still there.
 */
const EXCEPTIONS = new Set([]);

/** Source text without comments, line by line: a regex would take the /* in '/data/x/*' for a comment. */
function ohneKommentare(s) {
  const zeilen = [];
  let imBlock = false;
  for (const z of String(s).split('\n')) {
    const t = z.trim();
    if (imBlock) {
      zeilen.push('');
      if (t.endsWith('*/')) imBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      zeilen.push('');
      if (!t.includes('*/')) imBlock = true;
      continue;
    }
    zeilen.push(t.startsWith('//') || t.startsWith('*') ? '' : z);
  }
  return zeilen.join('\n');
}

/** All .ts files of the inner layers. */
function innerFiles() {
  const found = [];
  const lauf = rel => {
    const voll = path.join(ROOT, rel);
    if (!fs.existsSync(voll)) return;
    for (const e of fs.readdirSync(voll, { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind);
      else if (e.name.endsWith('.ts')) found.push(kind);
    }
  };
  // startup/ is the outsourced server start (only server.ts uses it) and
  // counts to the outer layer; its own rule stands further below.
  ['src', 'jobs', 'clients', 'db'].forEach(lauf);
  return found;
}

/** Source text of a file (relative to ROOT) without comments. */
function sourceText(rel) {
  return ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

/** All targets of import/require of a file (relative to ROOT), raw. */
function importe(rel) {
  const src = sourceText(rel);
  return [...src.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
}

/** Imports and require() from routes/, per file. */
function afterOuter(rel) {
  const treffer = new Set();
  for (const ziel of importe(rel).filter(z => /routes\//.test(z)))
    treffer.add(ziel.replace(/^.*?(routes\/)/, '$1').replace(/\.js$/, ''));
  return [...treffer];
}

test('no domain layer imports from routes/ — except the named cases', () => {
  const dateien = innerFiles();
  // Self-proof: if the search finds no files, the check below would be
  // silently green. MEASURED there are over sixty.
  assert.ok(dateien.length > 40, `Nur ${dateien.length} Dateien in den inneren Schichten gefunden — Ordner umbenannt?`);

  const neu = [];
  for (const d of dateien)
    for (const ziel of afterOuter(d)) {
      const marke = `${d} -> ${ziel}`;
      if (!EXCEPTIONS.has(marke)) neu.push(marke);
    }
  assert.deepEqual(
    neu,
    [],
    'Neue Abhaengigkeit von einer Fachdatei auf eine ROUTE. Die Funktion gehoert ' +
      'in die Schicht, die sie braucht — sonst zieht jeder Nutzer den HTTP-Apparat ' +
      'mit. Kommt sie nicht anders unter, gehoert sie oben in EXCEPTIONS, mit Grund.',
  );
});

test('a v1 route imports no other route file', () => {
  // Shared things belong in src/<bereich>/ (manualParts, manualMinifigs). A
  // route that imports a route drags its router including middleware along.
  // Counter-check (28.10.2026): require('../parts') in wanted.ts → red.
  const ordner = path.join(ROOT, 'routes/api_v1');
  const dateien = fs.readdirSync(ordner).filter(f => f.endsWith('.ts'));
  assert.ok(dateien.length > 10, `nur ${dateien.length} v1-Dateien gefunden`);
  const treffer = [];
  for (const f of dateien)
    for (const ziel of importe(`routes/api_v1/${f}`).filter(z => /^\.\.\/[^.]/.test(z)))
      treffer.push(`api_v1/${f} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('no route imports another route file', () => {
  // Only the guard (api_v1/middleware) and the assembly in
  // api_v1/index.ts, auth.ts (from routes/auth/) and api_v1/settings.ts (settingsGlobal behind requireLogin) are allowed.
  // Counter-check (10.11.2026): `import { requireLogin } from '../auth'` in routes/api_v1/minifigs.ts → red;
  // (14.11.2026) `import { buildSetsRouter } from './sets'` in routes/api_v1/settingsGlobal.ts → rot.
  const dateien = [];
  const lauf = rel => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind);
      else if (e.name.endsWith('.ts')) dateien.push(kind);
    }
  };
  lauf('routes');
  assert.ok(dateien.length > 15, `nur ${dateien.length} Routendateien gefunden`);
  const treffer = [];
  for (const d of dateien.filter(d => d !== 'routes/api_v1/index.ts'))
    for (const ziel of importe(d).filter(z => z.startsWith('.'))) {
      const voll = path.posix.normalize(path.posix.join(path.posix.dirname(d), ziel)).replace(/\.js$/, '');
      if (
        voll.startsWith('routes/') &&
        voll !== 'routes/api_v1/middleware' &&
        !(d === 'routes/auth.ts' && voll.startsWith('routes/auth/')) &&
        !(d === 'routes/api_v1/settings.ts' && voll === 'routes/api_v1/settingsGlobal')
      )
        treffer.push(`${d} -> ${ziel}`);
    }
  assert.deepEqual(treffer, []);
});

test('no state on global', () => {
  // What processes share stands in one module (src/jobQueue/startState.ts) and
  // can be found via the import. Counter-check (29.10.2026): a line
  // `global.startupStatus = …` in server.ts → rot.
  const treffer = [];
  for (const d of [
    'server.ts',
    ...innerFiles(),
    ...fs.readdirSync(path.join(ROOT, 'startup')).map(f => `startup/${f}`),
    ...fs
      .readdirSync(path.join(ROOT, 'routes'))
      .filter(f => f.endsWith('.ts'))
      .map(f => `routes/${f}`),
  ])
    for (const m of sourceText(d).matchAll(
      /\b(?:global|globalThis)\s*(?:as\s+\w+\s*\)\s*)?\.\s*\w+\s*=[^=]|\(\s*(?:global|globalThis)\s+as\s+any\s*\)/g,
    ))
      treffer.push(`${d}: ${m[0].trim()}`);
  // The UI shares state via public/js/state.js, not via `window._…`.
  // Counter-check (15.11.2026): `window._finGrandTotal = kopfWert` back in finanzen.js → red.
  const js = path.join(ROOT, 'public', 'js');
  for (const f of fs.readdirSync(js).filter(f => f.endsWith('.js') && !f.includes('bundle')))
    for (const m of ohneKommentare(fs.readFileSync(path.join(js, f), 'utf8')).matchAll(/\bwindow\._[a-zA-Z]\w*/g))
      treffer.push(`public/js/${f}: ${m[0]}`);
  assert.deepEqual(treffer, []);
});

test('src/ and clients/ import nothing from jobs/', () => {
  // Whatever background work src/ triggers, it enqueues as a job (src/jobQueue);
  // the execution is set up by startup/wiring.ts.
  // Counter-check (28.10.2026): require('../jobs/imageQueue') in wanted.ts → red.
  const treffer = [];
  for (const d of innerFiles().filter(f => /^(src|clients)\//.test(f)))
    for (const ziel of importe(d).filter(z => /jobs\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('db/, clients/ and jobs/ know no HTTP response', () => {
  // They report errors via src/infra/error.ts; only the HTTP side knows the way
  // to the response (src/http/httpResponse.ts, routes).
  // Counter-check (05.11.2026): `import { fehlertext } from '../src/http/httpResponse'`
  // in db/migrate.ts → rot.
  const treffer = [];
  for (const d of innerFiles().filter(f => /^(db|clients|jobs)\//.test(f)))
    for (const ziel of importe(d).filter(z => /httpAntwort|^express$/.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

/** Code lines without blank lines and comments. */
const codeRows = rel =>
  sourceText(rel)
    .split('\n')
    .filter(z => z.trim()).length;

test('jobs/ executes jobs, the work of a job lives in src/', () => {
  // jobs/ holds the worker (lease, retry, abort), the handler table
  // and the entry of the import process; what a job does in domain terms lies in src/<bereich>/.
  // Code lines in Biome format (line width 120).
  // Counter-checks (09.11.2026): `import * as db from '../db/database'` in jobs/startJobs.ts → red
  // (db/); fetchAndCachePrice and statesJeSet back to jobs/startJobs.ts → red (113
  // lines); `import { STAPEL } from '../src/images/imageDemand'` in jobs/jobWorker.ts → red.
  const KERN = 'jobs/jobWorker.ts';
  const dateien = tsBelow('jobs');
  assert.ok(dateien.includes(KERN) && dateien.includes('jobs/startJobs.ts'), 'Worker oder Bearbeitertabelle fehlt');
  assert.deepEqual(
    dateien.flatMap(d =>
      importe(d)
        .filter(z => /(?:^|\/)db\//.test(z))
        .map(z => `${d} -> ${z}`),
    ),
    [],
    'jobs/ erreicht die Datenbank nur über src/jobQueue und die Fachdienste',
  );
  const fremd = resolvedImports(KERN).filter(
    z => z.startsWith('src/') && !['jobQueue', 'infra'].includes(areaOf(`${z}/`)),
  );
  assert.deepEqual(fremd, [], 'Der Worker kennt keine Fachbereiche, nur Aufträge');
  const zuLang = dateien.filter(d => d !== KERN && codeRows(d) > 80).map(d => `${d} (${codeRows(d)})`);
  assert.deepEqual(zuLang, [], 'Ein Bearbeiter ruft einen Dienst; seine Arbeit gehört nach src/<bereich>/');
  const LIMIT = 326;
  const summe = dateien.reduce((n, d) => n + codeRows(d), 0);
  assert.ok(summe <= LIMIT, `${summe} Codezeilen in jobs/, erlaubt sind ${LIMIT}`);
  if (summe < LIMIT) console.log(`  ℹ Codezeilen in jobs/: ${summe} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('db/ imports nothing from jobs/', () => {
  // The database layer is the lowest; the image services are started by
  // startup/database.ts. Counter-check (28.10.2026): the import of
  // setUpImageDemand back in db/database.ts → red.
  const treffer = [];
  for (const d of innerFiles().filter(f => f.startsWith('db/')))
    for (const ziel of importe(d).filter(z => /jobs\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

/** All .ts files under routes/, relative to ROOT. */
function routesFiles() {
  const dateien = [];
  const lauf = rel => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind);
      else if (e.name.endsWith('.ts')) dateien.push(kind);
    }
  };
  lauf('routes');
  return dateien;
}

test('no route executes SQL or imports from db/', () => {
  // Routes read the request, call a service and write the response;
  // data access, locks and notifications stand behind src/<bereich>/.
  // Counter-checks: `import * as db from '../../db/database'` and a db.get line
  // in routes/api_v1/catalog.ts → red, both hits (29.10.2026);
  // `import { withInventoryLock } from '../../db/txLock'` in api_v1/sets.ts → rot (05.11.2026).
  const dateien = routesFiles();
  assert.ok(dateien.length > 15, `nur ${dateien.length} Routendateien gefunden`);
  const treffer = [];
  for (const d of dateien) {
    for (const m of sourceText(d).matchAll(/\b(?:db|tx)\.(?:get|all|run|exec|transaction|pool)\b/g))
      treffer.push(`${d}: ${m[0]}`);
    for (const ziel of importe(d).filter(z => /(?:^|\/)db\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  }
  assert.deepEqual(treffer, []);
});

test('no route imports from jobs/ or clients/', () => {
  // A route controls jobs via the services of src/jobQueue and the job table,
  // it reaches foreign services via a service in src/<bereich>/.
  // Counter-check (29.10.2026): `import { triggerNow } from '../../jobs/priceJob'`
  // in admin.ts and `import { getSetByEan } from '../../clients/brickset'` in
  // api_v1/sets.ts → red, both hits.
  const treffer = [];
  for (const d of routesFiles())
    for (const ziel of importe(d).filter(z => /(?:^|\/)(?:jobs|clients)\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('only clients/ goes to the network, via src/infra/fetch.ts', () => {
  // Host list, size cap, deadline and abort stand in abruf.ts; the clients
  // set hosts and headers. A fetch beside it would have none of that.
  // Counter-check (05.11.2026): `import { holeHttps } from '../infra/abruf'` in
  // src/catalog/partsImport.ts back → red: “src/catalog/partsImport.ts”.
  const ALLOWED = new Set(['src/infra/fetch.ts']);
  const treffer = tsBelow('src', 'routes', 'jobs', 'startup', 'db')
    .concat('server.ts')
    .filter(d => !ALLOWED.has(d))
    .filter(d => /\b(holeHttps|openHttps)\b|from '(?:node:)?https'|\bfetch\(/.test(sourceText(d)));
  assert.deepEqual(treffer, []);
});

test('startup/ and routes/ know each other in only one direction, router factories take Pick<Dienste, …>', () => {
  // What the start triggers (cleanup runs) stands in src/; a route only belongs in
  // the assembly of the app (startup/app.ts). Conversely routes/ and jobs/ do not depend
  // on startup/: the type Dienste exists in src/services.ts, and every router factory
  // narrows it to the scopes it calls.
  // Counter-checks: `import { startPdfJobCleanup } from '../routes/api_v1/pdf'` in
  // startup/jobsProcess.ts → red (10.11.2026); `import type { Dienste } from
  // '../../startup/wiring'` back in routes/api_v1/catalog.ts → red with this file,
  // `buildCatalogRouter(d: Dienste)` in the same place → red with “buildCatalogRouter” (14.11.2026).
  const treffer = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'startup')).filter(f => f.endsWith('.ts') && f !== 'app.ts'))
    for (const ziel of importe(`startup/${f}`).filter(z => /routes\//.test(z))) treffer.push(`startup/${f} -> ${ziel}`);
  assert.deepEqual(treffer, []);

  const dateien = [];
  const lauf = rel => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind);
      else if (e.name.endsWith('.ts')) dateien.push(kind);
    }
  };
  ['routes', 'jobs'].forEach(lauf);
  assert.ok(dateien.length > 20, `nur ${dateien.length} Dateien in routes/ und jobs/ — greift die Suche noch?`);
  const zuStartup = dateien.flatMap(d =>
    importe(d)
      .filter(z => /(^|\/)startup\//.test(z))
      .map(z => `${d} -> ${z}`),
  );
  assert.deepEqual(zuStartup, []);

  const factories = dateien.flatMap(d =>
    [...sourceText(d).matchAll(/export function (build\w*Router)\(\s*\w+: ([^,)]+?)[,)]/g)].map(m => ({
      name: m[1],
      typ: m[2].trim(),
    })),
  );
  assert.ok(factories.length >= 23, `nur ${factories.length} Routerfabriken gefunden — greift die Suche noch?`);
  assert.deepEqual(
    factories.filter(f => !f.typ.startsWith('Pick<')).map(f => f.name),
    [],
  );
});

test('no import cycles in the inner layers', () => {
  // A cycle forces delayed require() and makes the load order
  // a gamble. `import type` counts too: a type cycle is the same
  // entanglement, only without consequences when loading.
  // Counter-checks: marketPrice.ts via financeCalc again → red (28.10.2026);
  // (05.11.2026) `import type { SetMaster } from '../dienst'` in
  // src/sets/repository/setDetail.ts → red (setDetail → dienst → setDetail).
  // (08.11.2026) `import('./database')` as a type in db/migrate.ts → red (migrate ↔ database).
  const dateien = new Set(innerFiles());
  const kanten = new Map();
  for (const d of dateien) {
    const src = sourceText(d);
    // Two separate searches: `import … from` only at the start of a line, `require(…)`/`import(…)` everywhere.
    const kopf = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]/gm)].map(m => m[1]);
    const call = [...src.matchAll(/(?:require|import)\(\s*['"](\.[^'"]+)['"]\s*\)?/g)].map(m => m[1]);
    const ziele = [...kopf, ...call]
      .map(r => path.posix.normalize(path.posix.join(path.posix.dirname(d), r)).replace(/\.js$/, ''))
      .flatMap(z => [z + '.ts', z + '/index.ts'])
      .filter(z => dateien.has(z));
    kanten.set(d, ziele);
  }
  const cycles = [];
  const visitState = new Map(); // 1 = on the path, 2 = done
  const trail = [];
  const visit = d => {
    visitState.set(d, 1);
    trail.push(d);
    for (const z of kanten.get(d) || []) {
      if (visitState.get(z) === 1) cycles.push(trail.slice(trail.indexOf(z)).concat(z).join(' → '));
      else if (!visitState.has(z)) visit(z);
    }
    trail.pop();
    visitState.set(d, 2);
  };
  for (const d of dateien) if (!visitState.has(d)) visit(d);
  assert.deepEqual(cycles, []);
});

test('the exception list stays honest — every entry still has a case', () => {
  // ── Why this second half is needed ────────────────────────────────────────
  // An exception list that never shrinks is no longer a list of open points
  // but wallpaper. If a case drops away, the entry must go with it — otherwise
  // in a year a collection of claims about code that no longer exists
  // stands here.
  const alive = new Set();
  for (const d of innerFiles()) for (const ziel of afterOuter(d)) alive.add(`${d} -> ${ziel}`);

  const tot = [...EXCEPTIONS].filter(a => !alive.has(a));
  assert.deepEqual(tot, [], 'Diese Ausnahmen treffen auf nichts mehr zu — bitte aus der Liste streichen');
});

test('nothing lies in routes/ that is not a route', () => {
  // Where this check comes from
  const allowedWithoutRouter = {
    'imgProxy.ts': 'registriert seine Routen ueber app.get() statt router.get()',
    'api_v1/middleware.ts': 'Waechter FUER Routen; ohne Routen sinnlos',
  };
  // As with EXCEPTIONS: an entry without a file is dead.
  // Counter-check: 'mailer.ts' registered again → red.
  assert.deepEqual(
    Object.keys(allowedWithoutRouter).filter(d => !fs.existsSync(path.join(ROOT, 'routes', d))),
    [],
    'allowedWithoutRouter nennt Dateien, die es nicht mehr gibt',
  );
  const dateien = [];
  const lauf = rel => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind);
      else if (e.name.endsWith('.ts')) dateien.push(kind);
    }
  };
  lauf('routes');
  assert.ok(dateien.length > 5, `Nur ${dateien.length} Routendateien — Ordner umbenannt?`);

  const withoutRoute = dateien.filter(d => {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, d), 'utf8'));
    if (/\b(router|app)\.(get|post|put|delete|patch|use|endpoint|attachOne)\s*\(/.test(src)) return false;
    return !allowedWithoutRouter[d.replace(/^routes\//, '')];
  });
  assert.deepEqual(
    withoutRoute,
    [],
    'Diese Datei liegt in routes/, definiert aber keine Route. Entweder sie gehoert ' +
      'nach src/<bereich>/, oder ihr Grund gehoert nach allowedWithoutRouter — die stille Variante ' +
      'hat schon einmal neun Importe in die falsche Richtung erzeugt.',
  );
});

// ── Domain areas: src/<bereich>/ with repository (SQL), service and routes ──────

/** Does the file lie in a repository (src/<bereich>/repository.ts or …/repository/…)? */
const isRepository = rel => /(^|\/)repository(\/|\.ts$)/.test(rel);
/** The domain area of a file under src/, otherwise null. */
const areaOf = rel => (rel.match(/^src\/([^/]+)\//) || [])[1] || null;

/** All targets of relative imports of a file, resolved to ROOT, with import().
 * `import type` only with `withTypes`: for the load order types disappear
 * on compilation, for the dependency between layers they do not. */
function resolvedImports(rel, { withTypes = false } = {}) {
  const roh = sourceText(rel);
  const src = withTypes ? roh : roh.replace(/^\s*(?:import|export) type\b[^;]*;/gm, '');
  return [...src.matchAll(/(?:from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)].map(m =>
    path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])).replace(/\.js$/, ''),
  );
}

/** All .ts files under the folders, relative to ROOT. */
function tsBelow(...ordner) {
  const raus = [];
  const lauf = rel => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind);
      else if (e.name.endsWith('.ts')) raus.push(kind);
    }
  };
  ordner.forEach(lauf);
  return raus;
}

/** SQL in code: a statement as a string or a call on a connection. */
const SQL_TEXT =
  /[`'"]\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+(?:\w+\s+)?SET|DELETE\s+FROM|WITH\s+(?:RECURSIVE\s+)?\w+|CREATE\s+(?:TABLE|INDEX|UNIQUE)|ALTER\s+TABLE|DROP\s|TRUNCATE|LISTEN|NOTIFY|UNLISTEN|SET\s+LOCAL|LOCK\s+TABLE|ANALYZE|VACUUM)\b/;
const SQL_AUFRUF = /\b(?:db|tx|client|pool)\.(?:run|get|all|query|exec)\s*(?:<[^>]*>)?\(/;
/** Also a fragment in the middle of a string, e.g. `EXISTS (SELECT 1 FROM …)`. */
const SQL_FRAGMENT = /\bSELECT\b[^;`'"]*\bFROM\b/;
/** A piece of a statement in a string: sorting, condition, upsert, join. */
const SQL_CLAUSE =
  /[`'"][^`'"\n]*\b(?:ILIKE|COALESCE\(|ON CONFLICT|EXCLUDED\.|NULLS (?:LAST|FIRST)|ORDER BY|GROUP BY|(?:LEFT |INNER )?JOIN \w+ \w+ ON|RETURNING|WHERE \w)/;
const hatSql = rel => {
  const s = sourceText(rel);
  return SQL_TEXT.test(s) || SQL_AUFRUF.test(s) || SQL_FRAGMENT.test(s) || SQL_CLAUSE.test(s);
};

test('SQL only lives in repositories and in db/', () => {
  // A ban, no longer a ratchet: the list of exceptions has been empty since
  // 31.10.2026. Counter-checks (31.10.2026): `await db.get('SELECT 1')` in
  // src/household/household.ts → rot; `'SELECT 1'` in src/management/cleanup.ts → rot;
  // (05.11.2026) the EXISTS fragment back to src/finances/priceAlert.ts → red.
  const dateien = tsBelow('src', 'jobs', 'clients', 'routes', 'startup').concat('server.ts');
  assert.ok(dateien.length > 150, `nur ${dateien.length} Dateien gefunden`);
  assert.deepEqual(
    dateien.filter(d => !isRepository(d) && hatSql(d)),
    [],
    'SQL gehört in das Repository des Bereichs (src/<bereich>/repository…).',
  );
  assert.ok(tsBelow('src').filter(isRepository).every(hatSql), 'ein Repository ohne SQL ist keines');
  // The clause search must work in the repositories, otherwise it would see nothing outside either.
  assert.ok(
    tsBelow('src')
      .filter(isRepository)
      .filter(d => SQL_CLAUSE.test(sourceText(d))).length > 30,
  );
});

/** What a service may take from db/database: the unit of work and the operation, no query. */
// Since 09.11.2026 also creating the access (createDb …): only server.ts and startup/ do that;
// since 10.11.2026 the type Db (context of a scope); standardDb() no longer exists since 11.11.2026.
const DB_OUTSIDE = new Set([
  'transaction',
  'pool',
  'ownConnection',
  'databaseResponds',
  'getPoolStats',
  'asSuperuserConnected',
  'initSchemaOnce',
  'DbInterface',
  'Db',
  'createDb',
  'dbConfigFromEnvironment',
  'TxOptions',
  'TxGriff',
]);

test('outside of repository/ and db/ nobody queries the database', () => {
  // The SQL search above reads text; a call under another name (`datenbank.all(SQL)` with the
  // text from a repository) would get past it. Counter-checks (09.11.2026):
  // `import * as datenbank from '../../db/database'` and `datenbank.all(repo.SQL)` in
  // src/sets/delete.ts → red “src/sets/delete.ts: all”, the check above stayed green;
  // the wishlist sorting (COALESCE … NULLS LAST) back in src/wanted/wanted.ts → red above.
  const treffer = [];
  let gesehen = 0;
  for (const d of tsBelow('src', 'jobs', 'clients', 'routes', 'startup')
    .concat('server.ts')
    .filter(d => !isRepository(d))) {
    const s = sourceText(d);
    for (const m of s.matchAll(/import\s+(type\s+)?(?:\*\s+as\s+(\w+)|\{([^}]*)\})\s+from\s+'[./]+\/db\/database'/g)) {
      gesehen++;
      const namen = m[2]
        ? [...s.matchAll(new RegExp(`\\b${m[2]}\\.(\\w+)`, 'g'))].map(x => x[1])
        : m[3]
            .split(',')
            .map(
              n =>
                n
                  .trim()
                  .replace(/^type\s+/, '')
                  .split(/\s+as\s+/)[0],
            )
            .filter(Boolean);
      for (const n of namen) if (!DB_OUTSIDE.has(n)) treffer.push(`${d}: ${n}`);
    }
  }
  assert.ok(gesehen > 20, `nur ${gesehen} Importe von db/database gefunden — greift die Suche noch?`);
  assert.deepEqual(treffer, []);
  workUnitAtCallLocation();
});

test('routes, jobs and clients import no repositories', () => {
  // Counter-check (31.10.2026): `import * as r from '../../src/account/repository/accounts'`
  // in routes/api_v1/admin.ts → rot.
  const treffer = [];
  for (const d of tsBelow('routes', 'jobs', 'clients', 'startup').concat('server.ts'))
    for (const z of resolvedImports(d)) if (isRepository(z)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);

  // xBereich() delivers bound repositories and the access (db); a route takes
  // the services the scope offers in its index.ts. Counter-checks (13.11.2026):
  // `await kontoBereich().protokoll.protokolliere(…)` back in routes/auth/users.ts
  // → rot „routes/auth/users.ts: kontoBereich()“; `gutscheineBereich` als Import in
  // routes/api_v1/vouchers.ts → rot „…: gutscheineBereich (Import)“.
  const CALL = /\b\w+Bereich\s*\(\s*\)/g;
  const IMPORT = /import\s*\{([^}]*)\}\s*from\s*'[./]+\/src\/[^']+'/g;
  for (const d of tsBelow('routes')) {
    const s = sourceText(d);
    for (const m of s.matchAll(CALL)) treffer.push(`${d}: ${m[0].replace(/\s/g, '')}`);
    for (const m of s.matchAll(IMPORT))
      for (const n of m[1].split(',').map(x => x.trim().split(/\s+as\s+/)[0]))
        if (/Bereich$/.test(n)) treffer.push(`${d}: ${n} (Import)`);
  }
  assert.ok(
    CALL.test('await kontoBereich().accounts.accountShort(1)') && tsBelow('routes').length > 15,
    'Selbstbeweis: das Muster findet einen Aufruf, und es gibt Routen',
  );
  assert.deepEqual(treffer, []);
  routesOnlyViaFactory();
  routesWithoutSlotFlow();
});

/** Domain flows (mail, token hash, design cache) stand in services, not in routes. */
function routesWithoutSlotFlow() {
  // A route reads the request, calls d and answers; whoever imports src/mail, tokenDigest or
  // forgetTheme or a scope as a namespace builds the flow themselves.
  // Counter-checks (14.11.2026): `import { tokenDigest } from '../../src/account'` in
  // routes/api_v1/settings.ts → rot; `import * as sets from '../../src/sets'` in
  // routes/api_v1/sets.ts → rot; `import { createMail } from '../../src/mail'` in
  // routes/auth/registration.ts → rot.
  /** @type {[RegExp, string][]} */
  const MUSTER = [
    [
      /import\s*\{[^}]*\b(?:tokenDigest|forgetTheme)\b[^}]*\}\s*from\s*'[./]+\/src\/(?:account|profile)'/g,
      'Werkzeug aus src/account',
    ],
    [/import\s*\*\s*as\s*\w+\s*from\s*'[./]+\/src\/\w+'/g, 'Bereich als Namensraum'],
    [/from\s*'[./]+\/src\/mail(?:\/\w+)?'/g, 'src/mail'],
  ];
  assert.ok(
    MUSTER.every(([re], i) =>
      new RegExp(re.source).test(
        [
          "import { tokenDigest } from '../../src/account';",
          "import * as sets from '../../src/sets';",
          "import { sendMail } from '../../src/mail';",
        ][i],
      ),
    ),
    'Selbstbeweis: jedes Muster findet sein Beispiel',
  );
  const treffer = [];
  for (const d of tsBelow('routes'))
    for (const [re, was] of MUSTER) for (const _ of sourceText(d).matchAll(re)) treffer.push(`${d}: ${was}`);
  assert.deepEqual(treffer, []);
}

/** The bound services per scope, as src/<bereich>/bereich.ts offers them. */
function boundServices() {
  const raus = new Map();
  for (const b of fs.readdirSync(path.join(ROOT, 'src'))) {
    const f = ['bereich.ts', 'area.ts'].map(n => path.join(ROOT, 'src', b, n)).find(p => fs.existsSync(p));
    if (!f) continue;
    const s = fs.readFileSync(f, 'utf8');
    const namen = new Set();
    for (const m of s.matchAll(/^ {4,8}(\w+): (?:bound\(|imSystem\(|\(\(|\(<)/gm)) namen.add(m[1]);
    raus.set(b, namen);
  }
  return raus;
}

/** Routes only take services via their factory (baueXRouter(d)). */
function routesOnlyViaFactory() {
  // An import from the index.ts would go via the process's facade; the route would not
  // see which services it needs. Excepted: the guards in front of all routers.
  // Counter-check (13.11.2026): `import { readParts } from '../../src/parts'` in
  // routes/api_v1/parts.ts → rot „routes/api_v1/parts.ts: parts.partsList“.
  const dienste = boundServices();
  assert.ok(dienste.get('parts')?.has('readParts') && dienste.size >= 14, 'Selbstbeweis: gebundene Dienste gefunden');
  const treffer = [];
  for (const d of tsBelow('routes')) {
    if (d === 'routes/api_v1/middleware.ts') continue;
    for (const m of sourceText(d).matchAll(/import\s*\{([^}]*)\}\s*from\s*'[./]+\/src\/(\w+)'/g))
      for (const n of m[1]
        .split(',')
        .map(x => x.trim())
        .filter(x => x && !x.startsWith('type ')))
        if (dienste.get(m[2])?.has(n.split(/\s+as\s+/)[0])) treffer.push(`${d}: ${m[2]}.${n}`);
  }
  assert.deepEqual(treffer, []);
}

/** Services that still take a raw handle; the list may only shrink. The catalog
 * is being split right now (own branch): the switch to `t` follows there. */
const RAW_HANDLE_STILL = new Set(['src/catalog/catalogMaintenance.ts']);

/** A unit of work stands at the call site: k.transact(t => …). */
function workUnitAtCallLocation() {
  // One transaction form: services open it with k.transact, the body gets the
  // context of the transaction (t); repositories take the caller's tx. `.transaction(`
  // only stands in src/infra/area.ts and db/.
  // Counter-checks: (13.11.2026) in src/collection/deletion.ts again `k.db.transaction(async tx =>`
  // → red; (13.11.2026) likewise in src/inventory/setStorageLocation.ts and in
  // src/factors/repository/secondFactor.ts → rot „…: .transaction(“.
  // Likewise db/txLock.ts: stock locks are an option of k.transact, not a separate
  // path with a raw tx; and no service takes a raw handle (tx/dbh), it takes `t`.
  // Counter-checks (14.11.2026): a function with `z.transaction(` in db/txLock.ts → red
  // „db/txLock.ts: .transaction(“; `export async function probe(tx: DbInterface, …)` in
  // src/inventory/trash.ts → red “…: service with raw handle probe”.
  const treffer = [];
  const alle = [...tsBelow('src', 'routes', 'jobs', 'clients', 'startup'), 'server.ts', 'db/txLock.ts'];
  for (const d of alle) {
    const s = sourceText(d);
    if (d !== 'src/infra/area.ts' && /\.transaction\s*(?:<[^>]*>)?\(/.test(s)) treffer.push(`${d}: .transaction(`);
    if (/transact\(\s*(?:async\s*)?\(\)/.test(s)) treffer.push(`${d}: transaktion ohne Kontext`);
    if (d.startsWith('src/') && !isRepository(d) && !RAW_HANDLE_STILL.has(d))
      for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+(\w+)[^(]*\(([^)]*)\)/g))
        if (/\b(?:tx|dbh)\??\s*:\s*(?:Pick<\s*)?(?:DbInterface|Db|Writer)\b/.test(m[2]))
          treffer.push(`${d}: Dienst mit rohem Griff ${m[1]}`);
  }
  assert.ok(
    tsBelow('src').some(d => /\.transact\(async t\b/.test(sourceText(d))) &&
      /\.transaction\(/.test(sourceText('src/infra/area.ts')),
    'Selbstbeweis: es gibt Arbeitseinheiten, und die Suche findet die eine Stelle',
  );
  assert.deepEqual(treffer, []);
}

test('a domain area accesses another only via its services and index.ts', () => {
  // A scope's repository is its inside; other scopes use the
  // services. Counter-check (31.10.2026): `import { accountShort } from
  // '../konto/repository/konten'` in src/household/household.ts → red.
  const treffer = [];
  const dateien = tsBelow('src');
  assert.ok(dateien.filter(isRepository).length >= 10, 'zu wenige Repositories gefunden');
  for (const d of dateien)
    for (const z of resolvedImports(d)) if (isRepository(z) && areaOf(z) !== areaOf(d)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);

  // And the services too only via the scope's index.ts:
  // how a scope cuts its files thus stays its own business. Excepted
  // are the helpers without a domain area (infra, vertrag, http) and the HTTP sides
  // under src/<bereich>/http/, which only routes and the assembly fetch.
  // Counter-check (11.11.2026): `export { catalogPart as _probe } from '../katalog/katalogPflege'`
  // in src/parts/manualParts.ts → rot.
  const FREE = ['infra', 'contract', 'http'];
  const tief = (d, z) => {
    const b = areaOf(`${z}/`);
    return (
      !!b &&
      !FREE.includes(b) &&
      b !== areaOf(d) &&
      z !== `src/${b}` &&
      z !== `src/${b}/index` &&
      !z.startsWith(`src/${b}/http/`)
    );
  };
  const depth = dateien =>
    dateien.flatMap(d =>
      resolvedImports(d, { withTypes: true })
        .filter(z => tief(d, z))
        .map(z => `${d} -> ${z}`),
    );
  // Counter-check (11.11.2026): `import { USERNAME_RE } from '../../src/account/nameRules'`
  // in routes/auth/users.ts → rot.
  assert.deepEqual(depth(tsBelow('src', 'jobs', 'startup', 'routes').concat('server.ts')), []);
  const indizes = tsBelow('src').filter(d => /^src\/[^/]+\/index\.ts$/.test(d));
  assert.ok(indizes.length >= 15, `nur ${indizes.length} index.ts gefunden`);
  indexWithoutAccess(indizes);
});

/** With access: a database access, context or service set as a parameter, or asynchronous (network, files). */
const ACCESS_PARAMETER = /\b(?:Db|DbInterface|Pool|PoolClient|ClientBase|\w+Kontext|\w+Dienste)\b/;

/** The declaration of an exported name, also via `export { … } from` and further imports. */
function declaration(rel, name, depth = 0) {
  const voll = [`${rel}.ts`, `${rel}/index.ts`, rel].find(x => fs.existsSync(path.join(ROOT, x)) && x.endsWith('.ts'));
  if (!voll) return null;
  const s = sourceText(voll);
  const fn =
    new RegExp(
      `(?:^|\\n)(?:export )?(async )?function ${name}\\b(?:<[^(]*>)?\\(([\\s\\S]*?)\\)\\s*(?::\\s*([^{]+))?\\{`,
    ).exec(s) ??
    new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*(async\\s*)?\\(([^)]*)\\)\\s*(?::\\s*([^=]+))?=>`).exec(s);
  if (fn) return { zugang: !!fn[1] || /Promise</.test(fn[3] ?? '') || ACCESS_PARAMETER.test(fn[2]) };
  if (new RegExp(`export (?:const|let|class|enum) ${name}\\b`).test(s)) return { zugang: false };
  for (const m of s.matchAll(/(?:export|import) \{([^}]*)\} from '(\.[^']+)'/g))
    for (const teil of m[1].split(',')) {
      const [a, b = a] = teil.trim().split(/\s+as\s+/);
      if (b === name && depth < 3) return declaration(path.posix.join(path.posix.dirname(voll), m[2]), a, depth + 1);
    }
  return null;
}

/** What an index.ts hands out as a value, except the factory (erzeugeX), including access. */
function valueExports(index) {
  const raus = [];
  for (const m of sourceText(index).matchAll(/export \{([^}]*)\} from '(\.[^']+)'/g))
    for (const teil of m[1].split(',').map(x => x.trim())) {
      if (!teil || teil.startsWith('type ')) continue;
      const [a, b = a] = teil.split(/\s+as\s+/);
      if (/^(?:erzeuge|create)[A-Z]/.test(b)) continue;
      const d = declaration(path.posix.join(path.posix.dirname(index), m[2]), a);
      raus.push({ name: `${index.replace(/\/index\.ts$/, '')}.${b}`, zugang: !!d?.zugang });
    }
  return raus;
}

/** A scope only hands out types, its factory and pure functions via index.ts: whatever needs a database,
 * network or files another scope calls via the context (`k.<bereich>.…`), so that it
 * runs in a transaction via `t` and a test replaces it at the wiring. */
function indexWithoutAccess(indizes) {
  // Counter-checks (14.11.2026): `export { catalogStatus } from './setMaster'` back in
  // src/catalog/index.ts → rot (src/catalog.catalogStatus); `export { vorschauErzeugenAus } from './thumbs'`
  // in src/images/index.ts → red (asynchronous).
  const alle = indizes.filter(i => !/^src\/(?:infra|contract|http)\//.test(i)).flatMap(valueExports);
  assert.ok(alle.length > 50, `nur ${alle.length} Wertexporte gefunden — greift die Suche noch?`);
  assert.ok(
    alle.some(x => x.name === 'src/household.asIds' && !x.zugang) &&
      declaration('src/sets/read', 'readSets')?.zugang &&
      declaration('src/images/thumbs', 'previewFrom')?.zugang,
    'Selbstbeweis: asIds ist rein, setsLesen (Kontext) und vorschauErzeugenAus (asynchron) haben Zugang',
  );
  assert.deepEqual(
    alle.filter(x => x.zugang).map(x => x.name),
    [],
    'Über den Kontext reichen (Dienst des Bereichs), nicht als Import',
  );
}

/** A module without relative imports (row types, constants) depends on nothing. */
const isSheet = rel => !/(?:from\s+|import\(\s*)['"]\./.test(sourceText(rel + '.ts'));

test('a repository knows no services, not even their types', () => {
  // Counter-checks: `import { getSetting } from '../settings'` in
  // src/settings/repository/values.ts → rot (31.10.2026); (05.11.2026)
  // `import type { SetMaster } from '../dienst'` back in
  // src/sets/repository/setDetail.ts → rot.
  const treffer = [];
  for (const d of tsBelow('src').filter(isRepository))
    for (const z of resolvedImports(d, { withTypes: true }))
      if (z.startsWith('src/') && !isRepository(z) && areaOf(z) !== 'infra' && !isSheet(z))
        treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);
});

test('routes do not resolve accounts — the services do that', () => {
  // A route passes on the view (viewOf) or the request; the household rules
  // stand in src/household and the services that apply them.
  // Counter-check (05.11.2026): `await scopeIds(req.apiUser.user_id)` back in
  // routes/api_v1/misc.ts → rot.
  const RESOLUTION =
    /\b(?:scopeIds|schreibbereich|writeTargetOrNull|scopeKind|darfSchreibenFuer|asIds|storageAccounts|scopeFrom|writeAreaFrom)\s*\(/;
  const dateien = tsBelow('routes');
  assert.ok(dateien.length > 15, 'zu wenige Routendateien gefunden');
  assert.deepEqual(
    dateien.filter(d => RESOLUTION.test(sourceText(d))),
    [],
  );
});

/** The HTTP side of a scope (middleware, session): src/<bereich>/http/. */
const isHttp = rel => /^src\/[^/]+\/http\//.test(rel);

test("only src/http, the areas' HTTP sides and the routes know Express", () => {
  // Counter-checks (31.10.2026): `import type { Request } from 'express'` in
  // src/sets/service.ts → red; the same in src/account/loginLimiter.ts → red.
  // (10.11.2026): the same in src/infra/money.ts, src/contract/base.ts and
  // db/txLock.ts → rot.
  const usesExpress = d =>
    /from\s+['"]express['"]|import\(\s*['"]express['"]\s*\)|require\(\s*['"]express['"]\s*\)/.test(sourceText(d));
  // startup/app.ts assembles the app, as server.ts did before.
  const treffer = tsBelow('src', 'db', 'clients', 'jobs', 'startup')
    .filter(d => areaOf(d) !== 'http' && !isHttp(d) && d !== 'startup/app.ts')
    .filter(usesExpress);
  assert.deepEqual(treffer, []);
  assert.ok(tsBelow('src/http').filter(usesExpress).length >= 8, 'die Suche findet Express in src/http nicht mehr');
  assert.ok(tsBelow('src').some(isHttp), 'keine HTTP-Seite unter src/<bereich>/http/ gefunden');

  // Services answer with an error kind, not with an HTTP status; clients/
  // itself speaks HTTP outward. Counter-check (10.11.2026): in
  // src/account/passwordConfirmation.ts again `return { status: 429, ...gesperrt }` → red.
  const STATUS = /\bstatus\s*:\s*[1-5]\d\d\b|\bres\.status\(/;
  // Counter-check (11.11.2026): `res.status(304)` back in src/images/imgCacheServe.ts → red.
  const withStatus = tsBelow('src', 'db', 'jobs')
    .filter(d => areaOf(d) !== 'http' && !isHttp(d))
    .filter(d => STATUS.test(sourceText(d)));
  assert.deepEqual(withStatus, []);
});

test('only routes, server and HTTP sides import an HTTP side or src/http', () => {
  // A service that imports the HTTP side depends on the request again.
  // Counter-check (31.10.2026): `import { adresse } from './http/anmeldung'` in
  // src/account/deviceToken.ts → rot.
  const treffer = [];
  for (const d of tsBelow('src', 'jobs', 'clients').filter(d => !isHttp(d)))
    for (const z of resolvedImports(d)) if (isHttp(z)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);

  // The same for src/http/: the shared helpers depend on the request, a service
  // that fetches them would too; conversely src/http only knows src/infra.
  // Counter-checks (08.11.2026): `import { errorResponse } from '../http/httpAntwort'`
  // in src/account/deviceToken.ts → red; `import { setKey } from '../sets/dienst'` in
  // src/http/httpResponse.ts → rot.
  const http = tsBelow('src').filter(d => areaOf(d) === 'http');
  assert.ok(http.length >= 8, `nur ${http.length} Dateien unter src/http`);
  const nachHttp = z => areaOf(z) === 'http';
  const hinein = tsBelow('src', 'jobs', 'clients', 'db')
    .filter(d => !nachHttp(d) && !isHttp(d))
    .flatMap(d =>
      resolvedImports(d, { withTypes: true })
        .filter(nachHttp)
        .map(z => `${d} -> ${z}`),
    );
  assert.deepEqual(hinein, []);
  const up = http.flatMap(d =>
    resolvedImports(d, { withTypes: true })
      .filter(z => z.startsWith('src/') && !['http', 'infra', 'contract'].includes(areaOf(`${z}/`)))
      .map(z => `${d} -> ${z}`),
  );
  assert.deepEqual(up, []);
});

/** Routes catch nothing: streams pass their error on with .then(…, …) as the last event. */
const TRY_IN_ROUTES = new Map([]);
/** Where a route does answer itself, with a reason. Otherwise it throws (`fachfehler`, `notFound`). */
const SEND_ERROR_IN_ROUTES = new Map([
  // bodyDeadline: the clock runs after next(); a throw would no longer reach an error path.
  ['routes/api_v1/middleware.ts', 1],
]);

test("routes catch no errors — the router's error path answers", () => {
  // Counter-checks: a route in routes/api_v1/minifigs.ts wrapped again in `try { … } catch (e) {
  // handleRouteError(res, e, undefined, req); }` → red (31.10.2026). In parts.ts
  // `return sendError(req, res, 404, 'part_not_manual')` instead of notFound → red
  // “sendError in routes”; in settings.ts again `String(req.eingabe.condition ?? '')` → red
  // “conversions of checked inputs” (14.11.2026). Refusals of the services (15.11.2026): in
  // routes/auth/users.ts again `if (r === LAST_ADMIN) fachfehler(…)` → red “route
  // translates a refusal”; likewise `if ((await d.konto.kontoEntfernen(uid, null)) !== 'entfernt')
  // fachfehler(…)` in routes/auth.ts → rot.
  const ist = new Map();
  const senden = new Map();
  const conversions = [];
  const rejections = [];
  for (const d of tsBelow('routes')) {
    const q = sourceText(d);
    // The service throws a refusal (fachfehler); a state that shapes the response stays allowed.
    const results = [...q.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*await\s+d\./g)].map(m => m[1]);
    const vergleich = n => new RegExp(`\\b${n}(?:\\.\\w+)?\\s*[!=]==\\s*(?:'[^']*'|[A-Z][A-Z_]{2,}\\b)`);
    for (const z of q.split('\n')) {
      const wirft = /\b(?:fachfehler|notFound)\(|\bthrow\b/.test(z);
      if (wirft && (results.some(n => vergleich(n).test(z)) || /\(await d\.[^;]*\)\s*[!=]==\s*'/.test(z)))
        rejections.push(`${d}: ${z.trim()}`);
    }
    const n = (q.match(/\btry\s*\{/g) || []).length;
    if (n) ist.set(d, n);
    const s = (q.match(/\bsendError\(/g) || []).length;
    if (s) senden.set(d, s);
    for (const m of q.matchAll(
      /\b(?:String|Number|parseInt|parseFloat|Boolean)\(\s*(?:String\()?req\.(?:eingabe|abfrage|pfad)\b/g,
    ))
      conversions.push(`${d}: ${m[0]}`);
  }
  assert.deepEqual(Object.fromEntries(ist), Object.fromEntries(TRY_IN_ROUTES));
  assert.deepEqual(Object.fromEntries(senden), Object.fromEntries(SEND_ERROR_IN_ROUTES), 'sendError in Routen');
  // The contract delivers the domain format (z.transform); a route does not convert afterwards.
  assert.deepEqual(conversions, [], 'Umwandlungen geprüfter Eingaben in Routen');
  assert.deepEqual(rejections, [], 'Route übersetzt eine Absage des Dienstes');
});

// ── Ranking of the scopes ───────────────────────────────────────────────────

/** From bottom to top. A scope only imports scopes of lower levels;
 * scopes of the same level do not know each other. A new folder needs
 * a level, otherwise the test is red. */
const LEVELS = [
  ['src/infra'],
  ['src/contract'],
  ['src/http'],
  ['db', 'clients'],
  ['src/throttle'],
  ['src/settings'],
  ['src/mail'],
  ['src/jobQueue'],
  ['src/externalSources'],
  ['src/household', 'src/devices', 'src/factors'],
  ['src/account'],
  ['src/images', 'src/profile'],
  ['src/idempotency', 'src/catalog'],
  ['src/finances'],
  ['src/inventory'],
  ['src/sets'],
  ['src/parts', 'src/minifigs', 'src/wanted', 'src/vouchers'],
  ['src/collection', 'src/management'],
  ['src/services.ts'],
  ['jobs', 'routes'],
  ['startup'],
  ['server.ts'],
];
const levelOf = new Map(LEVELS.flatMap((s, i) => s.map(b => [b, i])));
const areaName = rel => (rel.startsWith('src/') ? rel.split('/').slice(0, 2).join('/') : rel.split('/')[0]);

/** Per file, who imports it, as the compiler resolves it: also `import type`, import()
 * and `export … from`. A regex missed type imports and paths via index.ts. */
function translatorEdges(output) {
  const kanten = [];
  let ziel = null;
  for (const z of output.split('\n')) {
    if (/^\S/.test(z)) ziel = z.trim();
    const m = /^\s+Imported via '[^']+' from file '([^']+)'/.exec(z);
    if (m && ziel && !ziel.includes('node_modules')) kanten.push({ d: m[1], ziel });
  }
  return kanten;
}

let _kanten = null;
/** Edges between scopes from tsc --explainFiles over tsconfig.json; once per run. */
function areaEdges() {
  if (!_kanten) {
    const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    const r = require('node:child_process').spawnSync(
      process.execPath,
      [tsc, '-p', 'tsconfig.json', '--noEmit', '--explainFiles'],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    _kanten = translatorEdges(r.stdout)
      .filter(k => !/^test\//.test(k.d) && !/^test\//.test(k.ziel))
      .map(k => ({ ...k, von: areaName(k.d), nach: areaName(k.ziel) }))
      .filter(k => k.von !== k.nach);
  }
  return _kanten;
}

test('every area only imports areas of lower levels', () => {
  // Counter-checks (05.11.2026): `import { getSetting } from '../src/settings/settings'`
  // in clients/brickset.ts → red (clients → src/settings); the same with
  // `import { withVersion } from '../sets/setNummer'` in src/catalog/service.ts,
  // after setNummer lay under src/sets again → red (katalog → sets).
  // Counter-checks (15.11.2026, compiler instead of regex): `import type { Db } from '../../db/database'`
  // in src/infra/area.ts → red (src/infra → db); the level of src/services.ts deleted
  // → red “scope without level”; the late binding `d().katalog.…` back in verdrahtung.ts → red.
  assert.deepEqual(
    translatorEdges("a.ts\n   Imported via './a' from file 'b.ts'\nc.ts\n   Matched by include pattern"),
    [{ d: 'b.ts', ziel: 'a.ts' }],
    'Selbstbeweis: die Ausgabe von --explainFiles wird gelesen',
  );
  // A higher scope listens to an event of the lower one; late binding would bypass the levels.
  assert.doesNotMatch(sourceText('startup/wiring.ts'), /\bd\(\)\.\w+/, 'späte Bindung in der Verdrahtung');
  const kanten = areaEdges();
  assert.ok(kanten.length > 500, `nur ${kanten.length} Kanten gefunden — greift die Suche noch?`);
  const withoutLevel = [...new Set(kanten.flatMap(k => [k.von, k.nach]))].filter(b => !levelOf.has(b));
  assert.deepEqual(withoutLevel, [], 'Bereich ohne Stufe: in LEVELS eintragen');
  const falsch = kanten
    .filter(k => levelOf.get(k.nach) >= levelOf.get(k.von))
    .map(k => `${k.d} -> ${k.ziel} (${k.von} → ${k.nach})`);
  assert.deepEqual(falsch, []);
});

test('clients are only reached via src/externalSources/sources.ts', () => {
  // There they get key, quota and throttle of their access; a path past
  // it would find no key. `import type` counts too, there are no exceptions.
  // Counter-checks: `import { lookupPart } from '../../clients/rebrickable'` in
  // src/parts/manualParts.ts → rot (05.11.2026); `import { createBrickset } from
  // '../clients/brickset'` in startup/wiring.ts → rot (14.11.2026).
  const kanten = areaEdges();
  const treffer = kanten
    .filter(k => k.nach === 'clients' && k.von !== 'clients' && k.d !== 'src/externalSources/sources.ts')
    .map(k => `${k.d} -> ${k.ziel}`);
  assert.deepEqual(treffer, []);
  assert.ok(
    kanten.some(k => k.d === 'src/externalSources/sources.ts' && k.nach === 'clients'),
    'quellen.ts holt keinen Klienten mehr?',
  );
});

test('docs/architecture.md names the order of the areas like LEVELS', () => {
  // Counter-check: `src/mail` and `src/settings` swapped in the table → red.
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf8');
  const tabelle = doc.slice(doc.indexOf('## Rangfolge der Bereiche'), doc.indexOf('## API-Vertrag'));
  const levels = [...tabelle.matchAll(/^\| (\d+) \| (.+) \|$/gm)].map(m =>
    [...m[2].matchAll(/`([^`]+)`/g)].map(b => b[1]),
  );
  assert.ok(levels.length > 5, 'Die Tabelle der Rangfolge ist nicht zu finden');
  assert.deepEqual(levels, LEVELS);
});

/** Every file below `dir` (relative to ROOT), without products and dependencies. */
function filesBelow(dir) {
  const voll = path.join(ROOT, dir);
  if (!fs.existsSync(voll)) return [];
  if (fs.statSync(voll).isFile()) return [dir];
  return fs
    .readdirSync(voll, { withFileTypes: true })
    .flatMap(e =>
      ['node_modules', 'dist', 'data', 'coverage', 'locales'].includes(e.name)
        ? []
        : e.isDirectory()
          ? filesBelow(path.posix.join(dir, e.name))
          : [path.posix.join(dir, e.name)],
    );
}

/** `<bereich>` and `*` stand for one segment; without an extension also .ts/.js. */
function pathExists(p) {
  const segment = s => new RegExp(`^${s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/<[^>]+>|\*/g, '[^/]+')}$`);
  const from = base => {
    let kandidaten = [base];
    for (const teil of p.replace(/\/$/, '').split('/')) {
      kandidaten = kandidaten.flatMap(k => {
        if (!fs.existsSync(k) || !fs.statSync(k).isDirectory()) return [];
        if (!/<|\*/.test(teil)) return fs.existsSync(path.join(k, teil)) ? [path.join(k, teil)] : [];
        return fs
          .readdirSync(k)
          .filter(n => segment(teil).test(n))
          .map(n => path.join(k, n));
      });
    }
    return kandidaten.length > 0;
  };
  return [p, `${p}.ts`, `${p}.js`].some(x => {
    const vorher = p;
    p = x;
    const da = from(ROOT) || from(path.join(ROOT, '..'));
    p = vorher;
    return da;
  });
}

test('docs/architecture.md names only what exists', () => {
  // Counter-checks (22.11.2026): `fehlerAntwort` (the German name before round 30) back in the
  // chapter “Fehler” → red ['fehlerAntwort']; the German name of db/catalogView.ts instead of it
  // → red; in the chapter “Oberfläche” `state.js` renamed to `00-staat.js` → red (was its own
  // case in frontend-architektur.test.js).
  require('./helpers/bundle').placeBundleSafe(); // the chapter “Oberfläche” names the bundle, a product
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architecture.md'), 'utf8').replace(/```[\s\S]*?```/g, '');
  const spans = [...doc.matchAll(/`([^`\n]+)`/g)].map(m => m[1]);
  const dateien = [
    ...['src', 'db', 'routes', 'startup', 'jobs', 'clients', 'scripts', 'test', 'public', 'biome', 'types'].flatMap(
      filesBelow,
    ),
    ...['frontend-types', 'postgres', 'server.ts', 'package.json', 'Caddyfile', 'compose.yaml'].flatMap(filesBelow),
  ];
  // Without comments: a German name that only survives in a comment does not count as code.
  const code = dateien
    .filter(d => /\.(ts|js|sql|grit|json|sh|yaml)$|Caddyfile$/.test(d))
    .map(d => ohneKommentare(fs.readFileSync(path.join(ROOT, d), 'utf8')).replace(/^\s*(--|#).*$/gm, ''))
    .join('\n');
  const woerter = new Set(code.match(/[A-Za-z_$][\w$]*/g));
  const namen = new Set(dateien.map(d => path.posix.basename(d)));
  const oben = new Set([...fs.readdirSync(ROOT), ...fs.readdirSync(path.join(ROOT, '..'))]);
  // Spelling conventions, not names; `createX` stands for createVouchers, createRebrickable …
  const KONVENTIONEN = new Set(['snake_case', 'camelCase']);
  const gibtEs = w =>
    woerter.has(w) ||
    KONVENTIONEN.has(w) ||
    (/[a-z]X[A-Z]|[a-z]X$/.test(w) && [...woerter].some(v => new RegExp(`^${w.replace('X', '[A-Z]\\w*')}$`).test(v)));
  const fehlt = [];
  for (const s of spans) {
    if (/^\/[\w/:-]*$/.test(s)) {
      if (![`'${s}`, `/api/v2${s}`, ` ${s}`].some(x => code.includes(x))) fehlt.push(s);
    } else if (
      /^[\w-]+\.(ts|js|json|md|sql|html|grit|sh|yaml|txt)$/.test(s) ||
      (/^[\w.<>*-]+\/[\w./<>*-]*$/.test(s) && (oben.has(s.split('/')[0]) || /^[<*]/.test(s)))
    ) {
      if (s.includes('/') ? !pathExists(s) : !namen.has(s)) fehlt.push(s);
    } else for (const w of s.match(/[A-Za-z_$][\w$]*/g) ?? []) if (!gibtEs(w)) fehlt.push(w);
  }
  assert.ok(spans.length > 300, `nur ${spans.length} Namen in Backticks — greift die Suche noch?`);
  assert.ok(namen.has('jobWorker.ts') && woerter.has('buildServices'), 'Selbstbeweis: Dateien und Code gefunden');
  assert.deepEqual([...new Set(fehlt)], [], 'in docs/architecture.md genannt, im Code nicht vorhanden');
});

test('the queue knows no domain areas and payload shapes, events go via ereignis.ts', () => {
  // Counter-checks (15.11.2026): `import type { CatalogServices } from '../katalog'` in
  // src/jobQueue/service.ts → red (edge src/jobQueue → src/catalog); `const P = z.object({})` in
  // src/jobQueue/kinds.ts → red (payload shape); `'brickset'` back in src/jobQueue/service.ts → red.
  const ALLOWED = new Set(['src/infra', 'src/settings', 'db']);
  const fremd = areaEdges()
    .filter(k => k.von === 'src/jobQueue' && !ALLOWED.has(k.nach))
    .map(k => `${k.d} -> ${k.ziel}`);
  assert.deepEqual(fremd, [], 'src/jobQueue importiert einen Fachbereich');

  const dateien = tsBelow('src/jobQueue');
  const shapes = dateien.filter(d => /\bz\.(?:object|enum|array|union|discriminatedUnion)\(/.test(sourceText(d)));
  assert.deepEqual(shapes, [], 'Nutzlastform in src/jobQueue: in den Bereich, der die Art anmeldet');

  // The kinds stand where the scopes register their payload (declare module … JobPayloads).
  const arten = tsBelow('src')
    .flatMap(d => [...sourceText(d).matchAll(/interface JobPayloads \{([^}]*)\}/g)])
    .flatMap(m => [...m[1].matchAll(/^\s*(\w+):/gm)].map(a => a[1]));
  assert.ok(arten.length > 15, `nur ${arten.length} angemeldete Arten gefunden — greift die Suche noch?`);
  const literale = dateien.flatMap(d =>
    [...sourceText(d).matchAll(/['"`](\w+)['"`]/g)].filter(m => arten.includes(m[1])).map(m => `${d}: ${m[1]}`),
  );
  assert.deepEqual(literale, [], 'src/jobQueue nennt eine Auftragsart');

  // Events go via src/infra/event.ts, not via own listeners.
  // Counter-checks (15.11.2026): in src/settings/userSetting.ts again
  // `fach('currencyChange', () => new Set<() => void>())` → red (own listeners);
  // in src/jobQueue/importJob.ts again `k.db.notification.listen('csv_import_progress', f)`
  // → red (NOTIFY by hand); `new EventEmitter()` back in importJob.ts → red.
  const EREIGNIS = 'src/infra/event.ts';
  const alle = tsBelow('src', 'routes', 'jobs').filter(d => d !== EREIGNIS);
  const treffer = muster =>
    alle.flatMap(d => [...sourceText(d).matchAll(muster)].map(m => `${d}: ${m[0].replace(/\s+/g, ' ')}`));
  assert.ok(/new Set<Listener<A>>/.test(sourceText(EREIGNIS)), 'Selbstbeweis: die Horcher stehen in ereignis.ts');
  assert.deepEqual(treffer(/new Set<\s*(?:\(|\w*(?:Horcher|Listener)\b)/g), [], 'eigene Horcher: ereignis() nehmen');
  assert.deepEqual(treffer(/\bbenachrichtigung\s*\.\s*(?:listen|unlisten|notify)\(/g), [], 'NOTIFY von Hand');
  assert.deepEqual(treffer(/\bnew EventEmitter\b/g), [], 'eigener Ereignisbus');
});
