const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAppModule } = require('../scripts/build-frontend');

const WEB = path.join(__dirname, '..');

/**
 * Ratchets: a measured count may sink, never rise.
 */

/** All TypeScript sources without tests and without generated files. */
function sources() {
  const result = [];
  (function run(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'coverage', 'test'].includes(n)) continue;
        run(p);
      } else if (n.endsWith('.ts')) result.push(p);
    }
  })(WEB);
  return result;
}

const SILENT_CATCHES = [
  /catch\s*\{\s*\}/g,
  /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
  /\.catch\(\(\)\s*=>\s*\{\s*\}\)/g,
  // A text, a number or an object as a substitute also swallows the error.
  /\.catch\(\(\)\s*=>\s*(null|undefined|true|false|-?\d+|'[^']*'|"[^"]*"|\(\{[^()]*\}\))\)/g,
  // For the reader an empty list is not an error message but „nothing there".
  /\.catch\(\(\)\s*=>\s*\[\]\)/g,
  // Any other expression as a substitute (map, list with content, default): on a
  // database error the response would look like a result. reportAndDeliver delivers the same with a log.
  /\.catch\(\s*\(\s*\)\s*=>\s*(?!\{)(?!(?:null|undefined|true|false|-?\d+|'[^']*'|"[^"]*"|\[\])\s*\))\S/g,
];

/**
 * Count hits — in the CODE, not in the explanations above it. With `brand`
 * `/**\/` stays at every comment place: a catch whose body names its
 * why is not silent, even if Biome puts the comment on its own line.
 */
function count(pattern, only = (/** @type {string} */ _f) => true, mark = false) {
  const { withoutComments } = require('./helpers/sources');
  const without = mark
    ? (/** @type {string} */ s) =>
        s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '/**/').replace(/^[ \t]*\/\/[^\n]*$/gm, '/**/')
    : withoutComments;
  let n = 0;
  for (const f of sources().filter(only)) {
    const s = without(fs.readFileSync(f, 'utf8'));
    for (const m of pattern) n += (s.match(m) || []).length;
  }
  return n;
}

test('the search finds the sources at all', () => {
  // ── The actual purpose of this check ────────────────────────────────
  //
  // If a folder is renamed or `quellen()` no longer applies, the ratchets
  // below count ZERO — and zero is smaller than any limit. They would
  // then be green forever without ever looking at anything again.
  const n = sources().length;
  assert.ok(n >= 80, `only ${n} TypeScript sources found — does the search still apply?`);
});

test('silent catches (server, only reported, UI) become fewer, never more', () => {
  // The Rebrickable part mapping only catches 404, which rbGet() itself delivers as null.
  const LIMIT = 0;
  // Self-proof of the last pattern: it must find a substitute value without a report, not the report.
  const spare = SILENT_CATCHES[SILENT_CATCHES.length - 1];
  const matches = s => (s.match(spare) || []).length;
  assert.equal(
    matches('x.catch(() => [userId]);') + matches('x.catch(() => new Map());') + matches('x.catch(()=>DEFAULT);'),
    3,
  );
  assert.equal(
    matches("x.catch(reportAndDeliver('a', [1]));") + matches('x.catch((e) => { reportError("a", e); });'),
    0,
  );
  const actual = count(SILENT_CATCHES, undefined, true);
  assert.ok(
    actual <= LIMIT,
    `${actual} silent catches, allowed are ${LIMIT}. A new \`catch {}\` ` +
      'swallows an error and carries on — in operation one then sees ' +
      'behaviour without a cause. Either handle the error or at least ' +
      'report it (reportError from src/infra/errorTexts).',
  );
  if (actual < LIMIT) {
    console.log(`  ℹ stille Faenge: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
  }
  onlyReportedCatches();
  silentCatchesTheUi();
});

test('“report and continue” becomes fewer, never more; src/sets does without', () => {
  // The rule stands in docs/architecture.md („Fehler“): write paths throw, read paths take
  // versuche()/Abstriche, logAndContinue only for side effects without consequences; a substitute value
  // (reportAndDeliver) justifies itself as „Ausnahme:“ in the code. Outside of src/catalog an own limit.
  // Counter-checks: in src/catalog/colors.ts again `.catch(reportAndDeliver('x', []))` → red (8, limit 7);
  // (14.11.2026) in routes/auth.ts on logout again `.catch(logAndContinue('x'))` → red (86 of 85),
  // with a total limit 200 → red „ausserhalb src/catalog“ (40 of 39).
  // (15.11.2026) catalog write paths throw (job retried); in teileAnreicherung.ts again
  // `.catch(logAndContinue('x'))` on rememberPart → red (68 of 67).
  const LIMITS = { logAndContinue: 64, reportAndDeliver: 7 };
  const AT_LEAST = { logAndContinue: 20, reportAndDeliver: 3 };
  const OUTSIDE_CATALOG = { logAndContinue: 37 };
  const inCatalog = (/** @type {string} */ f) => /[\\/]src[\\/]catalog[\\/]/.test(f);
  for (const [name, limit] of Object.entries(LIMITS)) {
    const pattern = [new RegExp(`\\b${name}\\(`, 'g')];
    const actual = count(pattern);
    assert.ok(actual > AT_LEAST[name], `only ${actual} times ${name} found — does the search still apply?`);
    assert.ok(actual <= limit, `${actual} times ${name}, allowed are ${limit}`);
    if (actual < limit) console.log(`  ℹ ${name}: ${actual} (Schranke ${limit}) — Schranke nachziehen`);
    const outer = OUTSIDE_CATALOG[name];
    if (outer === undefined) continue;
    const n = count(pattern, f => !inCatalog(f));
    assert.ok(n > 0 && n < actual, `outside src/catalog ${n} of ${actual} — does the split still apply?`);
    assert.ok(n <= outer, `${n} times ${name} outside src/catalog, allowed are ${outer}`);
    if (n < outer) console.log(`  ℹ ${name} ausserhalb src/catalog: ${n} (Schranke ${outer}) — Schranke nachziehen`);
  }
  const pattern = /\b(?:logAndContinue|reportAndDeliver)\(/;
  const sets = sources().filter(f => /[\\/]src[\\/]sets[\\/]/.test(f));
  assert.ok(sets.length > 10, 'src/sets not found');
  const withoutComments = require('./helpers/sources').withoutComments;
  assert.deepEqual(
    sets.filter(f => pattern.test(withoutComments(fs.readFileSync(f, 'utf8')))).map(f => path.relative(WEB, f)),
    [],
  );
});

/** Catches that only report and carry on become fewer, never more. */
function onlyReportedCatches() {
  // Every form without throw: `catch (e) { reportError(…) }`, with `return x`/`continue` after it, and
  // `.catch(e => console.warn(…))`. They conceal the error from the caller like reportAndDeliver,
  // only without its name. Whoever writes directly to the console instead of reportError names his
  // why as „Ausnahme:“ in the catch. Only src/: routes do not catch, jobs and db/ have their own rules.
  // Counter-checks (14.11.2026): in src/sets/service.ts the condition switch again in
  // `try { … } catch (e) { console.error(…) }` → red (62 of 61); in src/mail/transport.ts the
  // „Ausnahme:“ on the catch deleted → red „ohne Ausnahme: …“ (src/mail/transport.ts:155).
  // (15.11.2026) purchase price backfill collects and throws, entering instructions throws; in
  // instructions.ts the entering again in try/catch with reportError → red (57 of 56).
  const { catches, onlyReported } = require('./helpers/catches');
  const LIMIT = 56;
  const probe = (/** @type {string} */ q) => catches(q).filter(onlyReported).length;
  assert.equal(
    probe('try { a(); } catch (e) { reportError("x", e); }') +
      probe('try { a(); } catch { console.error("x"); return null; }') +
      probe('x.catch(e => console.warn(e.message));') +
      probe('for (;;) { try { a(); } catch (e) { log(`${e}`); continue; } }'),
    4,
  );
  assert.equal(
    probe('try { a(); } catch (e) { reportError("x", e); throw e; }') +
      probe('try { a(); } catch (e) { reportError("x", e); await nochmal(); }') +
      probe('x.catch(logAndContinue("x"));') +
      probe('// catch (e) { console.error(e) }'),
    0,
  );
  const src = sources().filter(f => /^src[\\/]/.test(path.relative(WEB, f)));
  const hits = src.flatMap(f =>
    catches(fs.readFileSync(f, 'utf8'))
      .filter(onlyReported)
      .map(x => ({ ...x, where: `${path.relative(WEB, f)}:${x.row}` })),
  );
  assert.ok(hits.length > 20, `only ${hits.length} reported catches found — does the search still apply?`);
  assert.ok(hits.length <= LIMIT, `${hits.length} catches only report and carry on, allowed are ${LIMIT}`);
  if (hits.length < LIMIT)
    console.log(`  ℹ nur gemeldete Fänge: ${hits.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
  assert.deepEqual(
    hits.filter(x => /\bconsole\./.test(x.body) && !/Ausnahme:|Exception:/.test(x.raw)).map(x => x.where),
    [],
    'without „Ausnahme:“: straight to the console instead of reportError',
  );
}

/** Silent catches of the UI become fewer, never more. */
function silentCatchesTheUi() {
  // A catch in public/js without throw, message (toast, zeige…, melde…, console) or visible text
  // swallows the error: the view then shows „empty“ instead of „failed“. Many are intended
  // (localStorage, aborted streams); new ones are not needed.
  // Counter-check (15.11.2026): in public/js/wanted.js on the alert when remembering again
  // `.catch(() => null)` → red (92 silent catches, 91 allowed).
  const { catches, silentInBrowser } = require('./helpers/catches');
  // 85 since public/js/format.js no longer has a raw quote in a regex: the mask read the catch in
  // browserWritesDateHowApp() as part of a string before; it is not new.
  const LIMIT = 85;
  const probe = (/** @type {string} */ q) => catches(q).filter(silentInBrowser).length;
  assert.equal(probe('a().catch(() => null); try { b(); } catch { /* weg */ } c.catch(() => {});'), 3);
  assert.equal(probe('a().catch(e => toast(e.message, "error")); try { b(); } catch (e) { showError(e); }'), 0);
  const actual = ui().reduce((n, f) => n + catches(fs.readFileSync(f, 'utf8')).filter(silentInBrowser).length, 0);
  assert.ok(actual > 30, `only ${actual} silent catches in public/js — does the search still apply?`);
  assert.ok(actual <= LIMIT, `${actual} silent catches in public/js, allowed are ${LIMIT}`);
  if (actual < LIMIT)
    console.log(`  ℹ stille Fänge der Oberfläche: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
}

/** The factory (createDb, dbConfigFromEnvironment) and types are no process access. */
const PROCESS_ACCESS = new Set([
  'pool',
  'all',
  'get',
  'run',
  'exec',
  'transaction',
  'initSchema',
  'initSchemaOnce',
  'getPoolStats',
  'databaseResponds',
  'asSuperuserConnected',
  'escapesRowSecurity',
  'ownConnection',
  'inTransaction',
  'standardDb',
  'setzeStandardDb',
]);
function takesProcessAccess(f) {
  if (/[\\/]db[\\/]database\.ts$/.test(f)) return false;
  // Also inside db/ (`./database`): txLock and pgNotify bypassed the counter there.
  return [
    ...fs.readFileSync(f, 'utf8').matchAll(/^import (\* as \w+|\{[^}]*\}) from '(?:[./]+\/db\/|\.\/)database';/gm),
  ].some(
    m =>
      m[1].startsWith('*') ||
      m[1]
        .slice(1, -1)
        .split(',')
        .map(n => n.trim().split(/\s+as\s+/)[0])
        .some(n => PROCESS_ACCESS.has(n)),
  );
}

test('the compatibility path to the database and module-wide state become fewer, never more', () => {
  // db/database.ts has a factory (createDb); whoever still imports the functions of the
  // process access instead of being handed an access counts here.
  // Counter-checks: an `import * as db from '../../db/database'` in src/sets/rows.ts → red (09.11.2026);
  // `import { get as _probe } from '../../db/database'` in the same place → red with 1 (11.11.2026).
  // `import * as _probe from './database'` in db/txLock.ts → red with 1 (11.11.2026).
  const LIMIT = 0;
  const actual = sources().filter(takesProcessAccess).length;
  // Self-proof: type imports from db/database do not count, but the search must still find them.
  const withTypes = sources().filter(f =>
    /^import type \{[^}]*\} from '[./]+\/db\/database';/m.test(fs.readFileSync(f, 'utf8')),
  ).length;
  assert.ok(withTypes > 20, `only ${withTypes} type imports from db/database found — does the search still apply?`);
  assert.ok(actual <= LIMIT, `${actual} files take the process access from db/database, allowed are ${LIMIT}`);
  if (actual < LIMIT)
    console.log(`  ℹ Kompatibilitätsweg db/database: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);

  // Module-wide state (let and empty-created Map/Set/WeakMap/WeakSet): all accesses of a process
  // share it. An area keeps its own in compartments (src/infra/cache.ts),
  // deliberately process-wide state stands with a reason in src/infra/processWide.ts.
  // Counter-checks (13.11.2026): `const _probe = new Map<string, number>();` in src/catalog/context.ts
  // → red with 60; `let _probe = 0;` in the same place → red with 60. (14.11.2026) limit 2 (transaction guard,
  // savepoints in db/); `const sitzungen = new Map<string, Sitzung>();` back in
  // src/vouchers/balanceLookup.ts → red (3 of 2). Limit 1: the transaction guard
  // travels with the transaction in the call frame; left are the savepoints in db/.
  const STATE_LIMIT = 1;
  const CONDITION =
    /^(?:export )?(?:let |const \w+(?:: [^=\n]+)? = new (?:Map|Set|WeakMap|WeakSet)\b(?:<[^\n]*>)?\(\))/gm;
  const countState = s => (s.match(CONDITION) || []).length;
  // Self-proof: empty-created collections and let count, constants with content do not.
  assert.equal(
    countState(
      'let a = 0;\nconst b = new Map<string, number>();\nconst c: X = new WeakMap();\nconst d = new Set([1]);',
    ),
    3,
  );
  const condition = sources().reduce((n, f) => n + countState(fs.readFileSync(f, 'utf8')), 0);
  assert.ok(
    condition > 0 && condition <= STATE_LIMIT,
    `${condition} times module-wide state, allowed are ${STATE_LIMIT}`,
  );
  if (condition < STATE_LIMIT)
    console.log(`  ℹ modulweiter Zustand: ${condition} (Schranke ${STATE_LIMIT}) — Schranke nachziehen`);
  routesMatchContexts();
  bindingWithoutNamesAndProxy();
  configOnlyAtStart();
});

/** Paths around the contexts are forbidden (formerly a ratchet). */
function routesMatchContexts() {
  // A service gets its dependencies via the context (src/<bereich>/kontext.ts);
  // a store of services in the process (getters xBereich(), facades from dienstePerAufruf)
  // no longer exists.
  // Counter-checks (14.11.2026): `export const sets = prozessStelle<SetsServices>('sets');` in
  // src/sets/read.ts → red (1 getter place); `import { readSets } from '../sets'` in
  // src/collection/deletion.ts (with `export const readSets = …` in src/sets/index.ts) → red (1 facade).
  const withoutComments = require('./helpers/sources').withoutComments;
  const src = path.join(WEB, 'src');
  // A module-level `const x = getter<XServices>(…)` is such a store, whatever the getter is called.
  const FETCHER = /^\s*(?:export\s+)?(?:const|let)\s+\w+\s*=\s*\w+<\w*Services>\s*\(/m;
  assert.ok(
    FETCHER.test("export const sets = processSlot<SetsServices>('sets');"),
    'self-proof: a process slot is recognised',
  );
  const fetcher = sources().filter(f => FETCHER.test(withoutComments(fs.readFileSync(f, 'utf8'))));
  assert.deepEqual(
    fetcher.map(f => path.relative(WEB, f)),
    [],
    'services come via the context or as a parameter, not from the process',
  );
  const factoryFile = b => ['bereich.ts', 'area.ts'].map(f => path.join(src, b, f)).find(p => fs.existsSync(p));
  const areaList = fs.readdirSync(src).filter(b => factoryFile(b));
  assert.ok(areaList.length >= 15, `only ${areaList.length} areas found — does the search still apply?`);
  // What an area binds as a service no index.ts may additionally export as a value.
  const services = new Map(
    areaList.map(b => {
      const s = fs.readFileSync(factoryFile(b), 'utf8');
      const n = new Set();
      for (const m of s.matchAll(/^ {4,8}(\w+): /gm)) n.add(m[1]);
      return [b, n];
    }),
  );
  assert.ok(services.get('sets').has('readSets'), 'the services of the areas are no longer found');
  const facades = [];
  for (const f of sources()) {
    const s = withoutComments(fs.readFileSync(f, 'utf8'));
    for (const m of s.matchAll(/^import \{([^}]*)\} from '([^']+)';/gm)) {
      const b = path.relative(src, path.resolve(path.dirname(f), m[2]));
      if (!services.has(b) || f.startsWith(path.join(src, b) + path.sep)) continue;
      for (const x of m[1].split(',').map(y => y.trim()))
        if (x && !x.startsWith('type ') && services.get(b).has(x.split(/\s+as\s+/)[0]))
          facades.push(`${path.relative(WEB, f)}: ${x}`);
    }
  }
  assert.deepEqual(facades, [], 'services of another area come via d or the context, not as an import');
}

/** The startup reads config(); domain areas, routes and jobs get the configuration handed in. */
function configOnlyAtStart() {
  // buildServices passes it as k.config, the startup as a parameter. Left are helpers of the process
  // (src/infra, src/http, db/) and the bcrypt pool built at load time; their number only sinks.
  // Counter-checks (14.11.2026): `const _k = config();` in src/sets/read.ts → red (domain area);
  // the same in src/http/csvResponse.ts → red (14 of 13). The search named the German konfig() and
  // so found nothing; since 22.11.2026 it looks for config(): `config()` in src/sets/content.ts → red.
  const LIMIT = 12;
  const EXCEPTION = ['src/account/bcryptLimit.ts'];
  const without = require('./helpers/sources').withoutComments;
  const rel = f => path.relative(WEB, f).split(path.sep).join('/');
  const readsOnly = sources()
    .map(rel)
    .filter(r => !/^(startup\/|server\.ts$|src\/infra\/config\.ts$)/.test(r))
    .filter(r => /\bconfig\(\)/.test(without(fs.readFileSync(path.join(WEB, r), 'utf8'))));
  assert.ok(readsOnly.length > 0, 'no readers of config() found — does the search still apply?');
  const domainArea = readsOnly.filter(r => !/^(src\/infra|src\/http|db)\//.test(r) && !EXCEPTION.includes(r));
  assert.deepEqual(domainArea, [], 'domain areas, routes and jobs take k.config or a parameter');
  assert.ok(readsOnly.length <= LIMIT, `${readsOnly.length} files read config(), allowed are ${LIMIT}`);
  if (readsOnly.length < LIMIT)
    console.log(`  ℹ config()-Leser: ${readsOnly.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
}

/** Areas bind without names and proxy; AsyncLocalStorage only in the call frame. */
function bindingWithoutNamesAndProxy() {
  // An area is a factory with a closure over k (src/infra/area.ts, mit()); the transaction
  // travels via `t` (tx.db), not via a proxy or a release in the call path.
  // Counter-checks (14.11.2026): `const _p = new Proxy({}, {});` in src/sets/read.ts → red (proxy);
  // `readSets: binde(sk, lesen, ['readSets', 'x'])` in src/sets/area.ts → red (name binding);
  // `new AsyncLocalStorage()` in db/transaction.ts → red (second channel).
  const without = require('./helpers/sources').withoutComments;
  const rel = f => path.relative(WEB, f).split(path.sep).join('/');
  const text = f => without(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(
    sources()
      .filter(f => /\bnew Proxy\b/.test(text(f)))
      .map(rel),
    [],
    'no Proxy in the server',
  );
  const NAMES = /\bbinde\w*\(|\[\s*'\w+'(?:\s*,\s*'\w+')+\s*,?\s*\]/;
  assert.ok(NAMES.test("bindeZugang(k, m, ['a', 'b'])") && NAMES.test("x(k, ['a', 'b'])"), 'Selbstbeweis Namensliste');
  const factories = sources().filter(f => /[\\/]src[\\/]\w+[\\/](bereich|kontext|area|context)\.ts$/.test(f));
  assert.ok(
    factories.length >= 30,
    `only ${factories.length} factories and contexts found — does the search still apply?`,
  );
  assert.deepEqual(factories.filter(f => NAMES.test(text(f))).map(rel), [], 'binding by names instead of „mit()“');
  assert.deepEqual(
    sources()
      .filter(f => /\bAsyncLocalStorage\b/.test(text(f)))
      .map(rel),
    ['src/infra/accountContext.ts'],
    'one channel along the call path: the call frame (docs/architecture.md)',
  );
}

test('any becomes fewer, never more', () => {
  const LIMIT = 1;
  const actual = count([/\bas any\b/g, /:\s*any\b/g]);
  assert.ok(
    actual <= LIMIT,
    `${actual} times \`any\`, allowed are ${LIMIT}. Each of them switches the ` +
      'type checker off for that expression — in a tree that otherwise runs ' +
      'noImplicitAny with an empty exception list.',
  );
  if (actual < LIMIT) {
    console.log(`  ℹ any: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
  }
});

test('any in all forms, unknown parameters and success in services become fewer, never more', () => {
  // Also Promise<any>, any[] and Record<string, any>: the narrow count above only saw
  // `as any` and `: any`.
  // Counter-check (05.11.2026): getSetting again `fallback?: any` without overloads → red.
  const LIMIT = 8;
  const actual = count([/\bany\b/g]);
  assert.ok(actual <= LIMIT, `${actual} times any, allowed are ${LIMIT}`);
  if (actual < LIMIT) console.log(`  ℹ any (alle Formen): ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);

  // The same kind of count: the route sets the envelope of the response, a service
  // delivers the domain object. Left are row statuses in import reports, mail sending and the import progress (a stream format).
  // Counter-check (11.11.2026): in cancelJob() again `success: true` → red.
  const SUCCESS_LIMIT = 7;
  const success = count([/\bsuccess:\s*true\b/g], f =>
    /^src[\\/](?!contract[\\/]|http[\\/])/.test(path.relative(WEB, f)),
  );
  assert.ok(
    success <= SUCCESS_LIMIT,
    `${success} times success: true in src/ (without contract/, http/), allowed are ${SUCCESS_LIMIT}`,
  );
  if (success < SUCCESS_LIMIT)
    console.log(`  ℹ success in Diensten: ${success} (Schranke ${SUCCESS_LIMIT}) — Schranke nachziehen`);
  // Routes return their result, the contract router (endpunkt) sets the envelope. Left are
  // streams, callbacks after logout and whole responses of the login.
  // Counter-check (14.11.2026): in routes/api/sets.ts `return { set }` as `res.json({ success: true, set })` → red (11).
  const ROUTES_LIMIT = 10;
  const inRoutes = count([/\bsuccess:\s*true\b/g], f => /^routes[\\/]/.test(path.relative(WEB, f)));
  assert.ok(
    inRoutes > 0 && inRoutes <= ROUTES_LIMIT,
    `${inRoutes} times success: true in routes/, allowed are ${ROUTES_LIMIT}`,
  );
  if (inRoutes < ROUTES_LIMIT)
    console.log(`  ℹ success in Routen: ${inRoutes} (Schranke ${ROUTES_LIMIT}) — Schranke nachziehen`);
  // Routes pass req.eingabe/req.pfad through with the contract type, services take
  // domain types (Zustand, string). Exempt are the checkers for raw values
  // (src/contract, src/infra, src/http) and error parameters.
  // Counter-check (11.11.2026): `condition: unknown` back in deleteAlarmOfSets → red (75).
  const LIMIT_UNKNOWN = 61;
  const PATTERN = /(?<!catch\s*)[(,]\s*\.{0,3}(?!(?:e|err|error|fehler|grund)\b)\w+\??\s*:\s*unknown\s*(?=[,)=])/g;
  assert.equal(
    ('f(a: unknown, b?: unknown = 1)'.match(PATTERN) || []).length + ('catch (e: unknown)'.match(PATTERN) || []).length,
    2,
  );
  const withoutComments = require('./helpers/sources').withoutComments;
  const RAW = /[\\/]src[\\/](?:contract|infra|http)[\\/]/;
  const unknownOne = sources()
    .filter(f => /[\\/]src[\\/]/.test(f) && !RAW.test(f))
    .reduce((n, f) => n + (withoutComments(fs.readFileSync(f, 'utf8')).match(PATTERN) || []).length, 0);
  assert.ok(unknownOne > 20, `only ${unknownOne} unknown parameters found — does the search still apply?`);
  assert.ok(
    unknownOne <= LIMIT_UNKNOWN,
    `${unknownOne} parameters of type unknown in services, allowed are ${LIMIT_UNKNOWN}`,
  );
  if (unknownOne < LIMIT_UNKNOWN)
    console.log(`  ℹ unknown-Parameter: ${unknownOne} (Schranke ${LIMIT_UNKNOWN}) — Schranke nachziehen`);
});

test('direct clock calls in domain areas become fewer, never more', () => {
  // Time comes via k.uhr (src/infra/clock.ts): a test sets it instead of waiting.
  // Left are throttles with real timers, the session middleware (cookie deadlines) and
  // timestamps without context.
  // Counter-check (14.11.2026): `const x = Date.now();` in src/sets/service.ts → red.
  // (15.11.2026) throttles, attestation, portfolio take k.uhr; `Date.now()` back in
  // rateLimiter.ts (_schedule) → red (21 of 20).
  const LIMIT = 20;
  const CLOCK = /\bDate\.now\(\)|\bnew Date\(\)/g;
  assert.equal('Date.now(); new Date(); new Date(x); k.uhr.jetzt()'.match(CLOCK)?.length, 2, 'Selbstbeweis');
  const domainArea = (/** @type {string} */ f) =>
    /^(src[\\/](?!infra|http|contract)\w+|jobs)[\\/]/.test(path.relative(WEB, f));
  const actual = count([CLOCK], domainArea);
  assert.ok(actual <= LIMIT, `${actual} direct clock calls in domain areas and jobs, allowed are ${LIMIT}`);
  if (actual < LIMIT) console.log(`  ℹ Uhr-Aufrufe: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no test file checks REQUIRE_DB itself', () => {
  // The rule stands in test/helpers/db.js (dbOderSkip, keineDb,
  // missingPrecondition); an own version was copied 115 times.
  // Counter-check (11.11.2026): `if (process.env.REQUIRE_DB === '1') throw e;`
  // back in instruction-job-db.test.js → red.
  const owned = fs
    .readdirSync(__dirname)
    .filter(n => n.endsWith('.js') && n !== path.basename(__filename))
    .filter(n => /process\.env\.REQUIRE_DB|REQUIRE_DB=1, aber/.test(fs.readFileSync(path.join(__dirname, n), 'utf8')));
  assert.deepEqual(owned, [], 'test/helpers/db.js benutzen');
});

test('database rows are unknown without a type argument', () => {
  // Without a type argument a row was `any`, and type checking ended at the
  // database — exactly where numeric and bigint arrive as strings.
  // Counter-check (05.11.2026): `get<T = any>` in DbInterface → red.
  const source = ['database.ts', 'transaction.ts', 'types.ts']
    .map(n => fs.readFileSync(path.join(WEB, 'db', n), 'utf8'))
    .join('\n');
  assert.equal(
    (source.match(/\b(?:all|get)\s*(?::\s*)?<T = unknown>/g) || []).length,
    6,
    'all/get in interface, pool and transaction',
  );
  assert.doesNotMatch(source, /<T = any>|lastID/);
});

test('untyped database queries become fewer, never more', () => {
  // Allowed as long as nobody reads fields of the row — then the
  // compiler demands a type argument anyway.
  // Counter-check (05.11.2026): limit set to 68 → red. db/rows.ts binds row types to the schema.
  // (15.11.2026) in auftraege.ts writeProgress again `db.get(` without a type → red (4 of 3).
  const LIMIT = 3;
  const actual = count([/\b(?:db|tx|dbh|d)\.(?:get|all)\(/g]);
  assert.ok(actual <= LIMIT, `${actual} untyped db.get/all, allowed are ${LIMIT}`);
  if (actual < LIMIT) console.log(`  ℹ ungetypte Abfragen: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('raw req.body and req.query in routes become fewer, never more', () => {
  // A route reads req.eingabe and req.abfrage: checked and typed from the
  // contract. Left are the middleware before the check, the image proxy (without
  // contract) and routes/auth/registration.ts.
  // Counter-check (05.11.2026): a `req.body.storage` back in routes/api/sets.ts → red.
  const LIMIT = 4;
  let actual = 0;
  for (const f of sources().filter(f => /[\\/]routes[\\/]/.test(f)))
    actual += (
      require('./helpers/sources')
        .withoutComments(fs.readFileSync(f, 'utf8'))
        .match(/\breq\.(?:body|query)\b/g) || []
    ).length;
  assert.ok(actual <= LIMIT, `${actual} times req.body/req.query in routes/, allowed are ${LIMIT}`);
  if (actual < LIMIT)
    console.log(`  ℹ req.body/req.query in Routen: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('write targets in routes become fewer, never more', () => {
  // writeTarget() checks in the household for whom is written; better the
  // service takes the wish itself.
  // Counter-check (05.11.2026): limit set to 16 → red. It searched the German schreibziel(); since
  // 22.11.2026 writeTarget(): limit 12 → red (13 calls).
  const LIMIT = 13;
  let actual = 0;
  for (const f of sources().filter(f => /[\\/]routes[\\/]/.test(f)))
    actual += (
      require('./helpers/sources')
        .withoutComments(fs.readFileSync(f, 'utf8'))
        .match(/\bwriteTarget\(/g) || []
    ).length;
  assert.ok(actual <= LIMIT, `${actual} times writeTarget() in routes/, allowed are ${LIMIT}`);
  if (actual < LIMIT) console.log(`  ℹ writeTarget() in Routen: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

/**
 * Test files that only read source text and execute nothing. A regex on
 * the source text confirms that a line stands there — not that it works
 * (the signal error of 25.10. stood in the source text, only in the wrong
 * place). Structure checks may stay; new checks of behavior
 * belong in a test that runs the code.
 */
const READS_SOURCE =
  /readFileSync|(?:financeSource|handlerSource|viewSource|frontendSource|readsFromSource)\(|serverOnly|serverAll|i18nAll|localeSource|withoutComments/;
// The helpers for jsdom and Chrome execute the UI (as in audit report arch17-web-b, H1).
const LEADS_FROM =
  /buildAndRequire|testServer|spawn\(|spawnSync\(|execFileSync\(|fetch\(|jsdom|new Function|vm\.|= import\(|helpers\/(ui|app-browser)'/;
function pureSourceTextTests() {
  return fs
    .readdirSync(__dirname)
    .filter(n => n.endsWith('.test.js'))
    .filter(n => {
      const src = fs.readFileSync(path.join(__dirname, n), 'utf8');
      return READS_SOURCE.test(src) && !LEADS_FROM.test(src);
    });
}

test('import edges between views become fewer, never more', () => {
  // Views notify each other via events.js; what several share is a building block (BUILDING_BLOCKS).
  // Counter-check (15.11.2026): `import { loadGallery } from './sammlung.js';` back in lagerorte.js
  // → red (51 instead of 50).
  const { CORE, BUILDING_BLOCKS } = require('../scripts/build-frontend');
  const LIMIT = 50;
  const JS = path.join(WEB, 'public', 'js');
  const layer = new Set([...CORE, ...BUILDING_BLOCKS]);
  const views = fs.readdirSync(JS).filter(n => isAppModule(n) && !layer.has(n));
  assert.ok(views.length > 30, `only ${views.length} views — does the search still apply?`);
  const kanten = views.flatMap(n =>
    [...fs.readFileSync(path.join(JS, n), 'utf8').matchAll(/^\s*import\s[^;]*?from\s+'\.\/([\w-]+\.js)'/gms)]
      .map(m => m[1])
      .filter(z => views.includes(z))
      .map(z => `${n} → ${z}`),
  );
  assert.ok(kanten.length <= LIMIT, `${kanten.length} import edges between views, allowed ${LIMIT}`);
  if (kanten.length < LIMIT)
    console.log(`  ℹ Kanten zwischen Ansichten: ${kanten.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('test files are named after their function, not after a review round', () => {
  // A round name does not say what is red; one searches for the file by topic.
  // Counter-check (15.11.2026): security-server-limits-db.test.js back to
  // security-server-limits-db.test.js → red with this name.
  const ROUND = /runde\d|runde-|kleinbefunde|-befunde-/;
  assert.ok(ROUND.test('oberflaeche-runde25b-browser.test.js') && !ROUND.test('admin-hash-rounds-db.test.js'));
  assert.deepEqual(
    fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js') && ROUND.test(n)),
    [],
  );
});

test('pure source-text tests become fewer, never more', () => {
  const LIMIT = 32;
  const all = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js')).length;
  assert.ok(all >= 300, `only ${all} test files found — does the search still apply?`);
  const actual = pureSourceTextTests();
  assert.ok(
    actual.length <= LIMIT,
    `${actual.length} test files only read source text, allowed are ${LIMIT}. ` +
      'If the new test checks behaviour, it should run the code (buildAndRequire, ' +
      'testServer) instead of looking by regex whether a line is there.',
  );
  if (actual.length < LIMIT) {
    console.log(`  ℹ reine Quelltext-Tests: ${actual.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
  }
});

/**
 * Per test case instead of per file. A case executes if it calls an execution helper
 * (buildAndRequire/_req, testServer, startApp, spawn, fetch, jsdom, db.…) or
 * a name of the file that leads there (also via helpers and their helpers). A
 * mere `await` does not count: it waits just as well for fs.promises.readFile.
 */
const FALL_LEADS_FROM =
  /\bbuildAndRequire\(|\b_req\w*\(|\btest(?:Daten|Zugang|Dienste|Kontext|Bereich|Data|Access|Services|Context|Area)\(|\b(?:bildNotizen|imageNotes)\(|\b(?:areaPage|replaceServices)\(|\btestServer\(|\b(?:starteApp|startApp)\(|\b(?:spawn|spawnSync|execFileSync|execSync|execFile|fork)\(|\bfetch\(|\bJSDOM\b|new Function\(|\bvm\.\w+\(|\bimport\(|require\([^)]*\bdist\b|require\(\s*['"]\.\.\/(?!test\/|scripts\/)|\.request\(|\bagent\.\w+\(|\bseite\.\w+\(|\bpage\.\w+\(|\bdb\.\w+\(/;
const FALL_READS =
  /readFileSync|(?:financeSource|handlerSource|viewSource|frontendSource|readsFromSource)\(|serverOnly|serverAll|i18nAll|localeSource|withoutComments/;
/** Of helpers/sources only these execute; the others read source text. */
const SOURCES_LEADS_FROM = new Set([
  'buildAndRequire',
  'buildDist',
  'umgebung',
  'testData',
  'testAccess',
  'testServices',
  'testContext',
  'testArea',
  'imageNotes',
  'areaPage',
  'replaceServices',
]);
const HELP = /require\(\s*['"]\.\/helpers\/([\w-]+)['"]\s*\)/;

/** Whether a module under test/helpers executes something itself. */
function executingHelper() {
  const result = new Map();
  const d = path.join(__dirname, 'helpers');
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.js')))
    result.set(f.replace(/\.js$/, ''), FALL_LEADS_FROM.test(fs.readFileSync(path.join(d, f), 'utf8')));
  result.set('sources', false);
  return result;
}

/** Top-level statements: each up to the next line in column 0 that does not close a bracket. */
function instructions(/** @type {string} */ s) {
  const z = s.split('\n');
  const result = [];
  const next = (/** @type {string} */ x) => !x || /^[\s})\]]/.test(x);
  for (let i = 0; i < z.length; ) {
    if (next(z[i])) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < z.length && next(z[j])) j++;
    result.push(z.slice(i, j).join('\n'));
    i = j;
  }
  return result;
}

function declaredNames(/** @type {string} */ a) {
  let m = a.match(/^(?:async\s+)?function\s*\*?\s*(\w+)/);
  if (m) return [m[1]];
  m = a.match(/^(?:const|let|var)\s+\{([^}]*)\}\s*=/);
  if (m)
    return m[1]
      .split(',')
      .map(x => x.trim().split(':').pop()?.trim() ?? '')
      .filter(Boolean);
  m = a.match(/^(?:const|let|var)\s+(\w+)\s*=/);
  return m ? [m[1]] : [];
}

/** @returns {{ n: number, all: number, cases: string[] }} cases that read and execute nothing */
function sourceTextCasesIn(/** @type {string} */ raw, /** @type {Map<string, boolean>} */ helper) {
  const s = require('./helpers/sources').withoutComments(raw);
  const runs = new Set(),
    reads = new Set();
  /** @type {{ names: string[], text: string }[]} */
  const decl = [];
  for (const a of instructions(s)) {
    const names = declaredNames(a);
    if (!names.length) continue;
    const variable = /^(?:const|let|var)/.test(a);
    const text = variable ? a.slice(a.indexOf('=') + 1) : a;
    const help = a.match(HELP);
    if (help && variable && !FALL_LEADS_FROM.test(text)) {
      for (const n of names)
        if (help[1] === 'sources' ? SOURCES_LEADS_FROM.has(n) : helper.get(help[1])) runs.add(n);
        else if (help[1] === 'sources') reads.add(n);
      continue;
    }
    decl.push({ names, text });
  }
  const mentions = (/** @type {string} */ t, /** @type {Set<string>} */ m) =>
    [...m].some(n => new RegExp(`\\b${n}\\b`).test(t));
  for (let fresh = true; fresh; ) {
    fresh = false;
    for (const { names, text } of decl)
      for (const n of names) {
        if (!runs.has(n) && (FALL_LEADS_FROM.test(text) || mentions(text, runs))) fresh = !!runs.add(n);
        if (!reads.has(n) && (FALL_READS.test(text) || mentions(text, reads))) fresh = !!reads.add(n);
      }
  }
  const z = s.split('\n');
  let n = 0,
    all = 0;
  const cases = [];
  for (let i = 0; i < z.length; i++) {
    const head = z[i].match(/^(\s{0,4})(?:test|it)\(\s*['"`]/);
    if (!head) continue;
    let j = i + 1;
    for (; j < z.length; j++) {
      const t = z[j].trimStart();
      if (t && z[j].length - t.length <= head[1].length && !/^[})\]]/.test(t)) break;
    }
    const fall = z.slice(i, j).join('\n');
    all++;
    const helpers = [...fall.matchAll(new RegExp(HELP.source, 'g'))].map(m => m[1]);
    const executes = FALL_LEADS_FROM.test(fall) || mentions(fall, runs) || helpers.some(h => helper.get(h));
    if (!executes && (FALL_READS.test(fall) || mentions(fall, reads))) {
      n++;
      cases.push(z[i].trim());
    }
  }
  return { n, all: all, cases };
}

function sourceTextCases() {
  const helper = executingHelper();
  let n = 0,
    all = 0;
  /** @type {string[]} */
  const readers = [];
  for (const name of fs.readdirSync(__dirname).filter(x => x.endsWith('.test.js'))) {
    const r = sourceTextCasesIn(fs.readFileSync(path.join(__dirname, name), 'utf8'), helper);
    n += r.n;
    all += r.all;
    for (const f of r.cases) readers.push(`${name}: ${caseName(f)}`);
  }
  return { n, all: all, readers };
}

/** The name of a test case from its header line, as written (templates unexpanded). */
function caseName(/** @type {string} */ header) {
  const m = header.match(/^(?:test|it)\(\s*(['"`])(.*?)\1/);
  return m ? m[2] : header;
}

test('test cases that only read source text become fewer, never more', () => {
  // Structural detection: `await ` alone would take pure read cases for executing ones.
  // Counter-check (12.11.2026): `await ` back in FALL_LEADS_FROM → red „Selbstbeweis“.
  const probe = [
    "const _req = require('./helpers/sources').buildAndRequire();",
    "const { serverOnly } = require('./helpers/sources');",
    "const { testServer } = require('./helpers/server');",
    "const SRC = fs.readFileSync('x.ts', 'utf8');",
    "const modul = _req('src/infra/error.js');",
    'function start() {',
    '  return testServer();',
    '}',
    "test('only reads', async () => {",
    "  const t = await fs.promises.readFile('y', 'utf8');",
    '  assert.match(SRC + t, /x/);',
    '});',
    "test('reads via a helper', () => {",
    '  assert.match(serverOnly(), /x/);',
    '});',
    "test('runs via a function of the file', async () => {",
    '  await start();',
    '  assert.match(SRC, /x/);',
    '});',
    "test('runs the built module', () => {",
    '  assert.equal(modul.f(SRC), 1);',
    '});',
  ].join('\n');
  const helper = new Map([
    ['server', true],
    ['sources', false],
  ]);
  assert.deepEqual(
    sourceTextCasesIn(probe, helper).cases,
    ["test('only reads', async () => {", "test('reads via a helper', () => {"],
    'self-proof: a mere await runs nothing, a function of the file and a built module do',
  );
  const LIMIT = 295;
  const { n, all, readers } = sourceTextCases();
  assert.ok(all > 1500, `only ${all} test cases found — does the search still apply?`);
  assert.ok(
    n <= LIMIT,
    `${n} test cases only read source text, allowed are ${LIMIT}. ` +
      'Behaviour belongs in a test that runs the code (jsdom, buildAndRequire, testServer).',
  );
  if (n < LIMIT) console.log(`  ℹ Quelltext-Testfälle: ${n} (Schranke ${LIMIT}) — Schranke nachziehen`);
  behaviorChecksReadingSource(readers);
});

/** Of the reading cases, those outside the structure list are behavior checks — banned since 22.11.2026. */
function behaviorChecksReadingSource(/** @type {string[]} */ readers) {
  // Structure (helpers/structure-checks.js) may read source text; a behavior check runs the code.
  // Counter-checks: an entry of STRUCTURE_FILES removed → red (its cases count as behavior); an entry naming
  // a file without a reading case → red „without a reading case“.
  const { STRUCTURE_FILES, STRUCTURE_CHECKS } = require('./helpers/structure-checks');
  const behavior = readers.filter(r => !(r.split(': ')[0] in STRUCTURE_FILES) && !(r in STRUCTURE_CHECKS));
  assert.deepEqual(
    behavior,
    [],
    'These cases check behavior by reading source text. Run the code instead (buildAndRequire, testServer, ' +
      'openUi, DB); only real structure goes into helpers/structure-checks.js, with a reason',
  );
  const files = new Set(readers.map(r => r.split(': ')[0]));
  const stale = [
    ...Object.keys(STRUCTURE_FILES).filter(f => !files.has(f)),
    ...Object.keys(STRUCTURE_CHECKS).filter(c => !readers.includes(c)),
  ];
  assert.deepEqual(stale, [], 'entries in helpers/structure-checks.js without a reading case');
}

/** The facade `_req('db/database.js')` (and dbOderSkip, which delivered it) pretended
 * there was still a process access, and mixed test data with the code under test.
 * Test data takes testData()/dataOrSkip(), code under test testAccess()/accessOrSkip().
 * Single exports of the module (createDb, isReading) are no access and stay allowed. */
const USES_FACADE =
  /(?<!\}\s*=\s*)(?:_req\w*|buildAndRequire\(\))\(\s*['"]db\/database(?:\.js)?['"]\s*\)|\bdbOderSkip\(|\.standardDb\(/;
/** Substitute paths that may only sink. Whoever bends modules at load time checks a setup that does not
 * exist in operation, and silently grabs into nothing as soon as an import path changes; replacing
 * happens at the wiring (testImageWorker(), testSources(), replaceServices()). routerServer assembles
 * its own routers instead of buildApp, bypassing session and admin checks. */
const FALLBACKS = {
  'biegen Module um': { pattern: /\.prototype\.require\s*=|\._load\s*=/, limit: 11 },
  'nehmen routerServer statt testServer': { pattern: /\brouterServer\(/, limit: 13 },
};

test('tests use the real setup: no DB facade, substitute paths become fewer', () => {
  // The DB facade is replaced by testData()/testAccess(); bent require and
  // own routers (routerServer) become fewer.
  // Counter-checks (13.11.2026): in indexes-db.test.js again `_req('db/database.js')` → red
  // (facade); in image-queue-db.test.js `Module.prototype.require = r;` → red (15 instead of 14);
  // in app-chain-db.test.js testServer → routerServer → red (14 instead of 13).
  // Since 13.11.2026 test/helpers/ counts too (helpers/system-frame.js, the definition in
  // helpers/server.js; +1 each compared to counting only the test files); counter-check:
  // `Module._load = l;` in helpers/time.js → red (12 instead of 11).
  assert.ok(USES_FACADE.test("const db = _req('db/database.js');") && !USES_FACADE.test('accessOrSkip(t)'));
  assert.ok(!USES_FACADE.test("const { createDb } = _req('db/database.js');"), 'exports stay allowed');
  assert.ok(FALLBACKS['biegen Module um'].pattern.test('Module.prototype.require = function () {}'));
  const q = require('./helpers/sources');
  const tests = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js') && n !== 'ratschen.test.js');
  const helper = fs.readdirSync(path.join(__dirname, 'helpers')).map(n => path.join('helpers', n));
  assert.ok(tests.length > 500, `only ${tests.length} test files — does the search still apply?`);
  const read = (/** @type {string} */ n) => q.withoutComments(fs.readFileSync(path.join(__dirname, n), 'utf8'));
  assert.deepEqual(
    [...tests, ...helper].filter(n => USES_FACADE.test(read(n))),
    [],
    'test data via testData(), code under test via testAccess()',
  );
  // The helpers too: a bending in test/helpers/ would hit every file that loads it.
  for (const [was, { pattern, limit }] of Object.entries(FALLBACKS)) {
    const actual = [...tests, ...helper].filter(n => pattern.test(read(n))).length;
    assert.ok(actual > 0, `no file ${was} — does the pattern still apply? Then remove limit and entry`);
    assert.ok(actual <= limit, `${actual} test files ${was}, allowed are ${limit}`);
    if (actual < limit) console.log(`  ℹ ${actual} Testdateien ${was} (Schranke ${limit}) — Schranke nachziehen`);
  }
});

/**
 * Web tests read no Android source text: what the app needs from the server stands in
 * shared/app-interface.json (generated from its source text and checked in the Android run);
 * what only concerns the app is checked by the Android suite. The helpers are counted too.
 */
const READS_ANDROID = /require\(['"]\.\/helpers\/android['"]\)|['"`]Android-App['"`/]|\.kt['"`]/;

test('web tests do not read Android source code', () => {
  // Counter-check: `const k = 'x.kt';` in a11y.test.js → red (names a11y.test.js); the same in
  // test/helpers/contract.js → red (names helpers/contract.js).
  const LIMIT = 0;
  for (const probe of ["path.join(ROOT, '..', 'Android-App', 'x')", "'Theme.kt'", "require('./helpers/android')"])
    assert.ok(READS_ANDROID.test(probe), `the pattern no longer applies: ${probe}`);
  const fileList = [
    ...fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js') && n !== 'ratschen.test.js'),
    ...fs.readdirSync(path.join(__dirname, 'helpers')).map(n => path.join('helpers', n)),
  ];
  assert.ok(fileList.length > 500, `only ${fileList.length} files — does the search still apply?`);
  const readsOnly = fileList.filter(n => READS_ANDROID.test(fs.readFileSync(path.join(__dirname, n), 'utf8')));
  assert.ok(
    readsOnly.length <= LIMIT,
    `${readsOnly.length} web test files read Android sources, allowed are ${LIMIT}: ${readsOnly.join(', ')}. ` +
      'Check the server against shared/app-interface.json; what only concerns the app belongs in the Android suite.',
  );
});

/**
 * Fixed pauses from 100 ms on that stand as their own statement outside a loop (a loop
 * waits for a condition). Counted on the text in one line with emptied strings,
 * so that it does not matter how Biome wraps.
 */
function fixedWaitTimes(/** @type {string} */ text) {
  const q = require('./helpers/sources');
  const s = q
    .compact(q.withoutComments(text))
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, m => m[0] + '_'.repeat(m.length - 2) + m[0]);
  /** Opening bracket for the closing one at `closed`. */
  const opened = (/** @type {number} */ closed) => {
    for (let j = closed, t = 0; j >= 0; j--)
      if (s[j] === ')') t++;
      else if (s[j] === '(' && --t === 0) return j;
    return 0;
  };
  const loopHead = (/** @type {string} */ ago) =>
    ago.endsWith(')') && /\b(for|while)\s*$/.test(s.slice(0, opened(ago.length - 1)));
  /** Does `i` stand in a bracket, a loop body or behind a loop head? */
  const inLoop = (/** @type {number} */ i) => {
    if (loopHead(s.slice(0, i).trimEnd())) return true;
    for (let j = i - 1, depth = 0; j >= 0; j--) {
      const c = s[j];
      if (c === ')' || c === ']' || c === '}') depth++;
      else if (c === '(' || c === '[') {
        if (!depth) return true;
        depth--;
      } else if (c === '{') {
        if (depth) {
          depth--;
          continue;
        }
        const ago = s.slice(0, j).trimEnd();
        if (/\bdo$/.test(ago) || loopHead(ago)) return true;
        if (/=>$/.test(ago) || /\bfunction\b[^;{}]*\)$/.test(ago)) return false;
      }
    }
    return false;
  };
  let n = 0;
  for (const m of s.matchAll(
    /await (?:(?:sleep|tick)\(\d{3,}\)|new Promise\(\(?(r|resolve)\)? => setTimeout\(\1, \d{3,}\)\))/g,
  )) {
    const ago = s.slice(0, m.index).trimEnd();
    if ((!ago || /[;{}):]$|\belse$/.test(ago)) && !inLoop(m.index)) n++;
  }
  return n;
}

test('fixed waits in tests become fewer, never more', () => {
  // A fixed pause is too short under load and too long otherwise; waiting is done for
  // a condition (helpers/time.js until(), settle()). Left are pauses that show
  // that something does NOT happen, or that the code under test demands.
  // Counter-check (05.11.2026): `await sleep(500);` in history-browser.test.js → red.
  const LIMIT = 41;
  assert.equal(
    fixedWaitTimes(
      'for (;;) await sleep(250);\nwhile (x) {\n  await y();\n  await sleep(300);\n}\n' +
        "const go = async () => {\n  await b('{(');\n  await sleep(800);\n};\nawait sleep(50);\n" +
        'await new Promise(r =>\n  setTimeout(r, 1500),\n);',
    ),
    2,
    'self-proof: the pause after a statement and the wrapped one count, loops and short ones do not',
  );
  const OWN = /^\s*const (sleep|tick|waitFor|wait|delay)\s*=/;
  let actual = 0;
  const owned = [];
  for (const n of fs.readdirSync(__dirname).filter(x => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(__dirname, n), 'utf8');
    actual += fixedWaitTimes(text);
    if (text.split('\n').some(z => OWN.test(z))) owned.push(n);
  }
  assert.deepEqual(owned, [], 'own wait helpers: use test/helpers/time.js');
  assert.ok(actual <= LIMIT, `${actual} fixed waits of 100 ms or more, allowed are ${LIMIT}`);
  if (actual < LIMIT) console.log(`  ℹ feste Wartezeiten: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

/**
 * Inline styles in index.html. A data-style="…" (styles.js sets it as an
 * inline style) overrides every theme and every phone rule;
 * the same things therefore looked different in two places. Counted are
 * attributes outside of comments. display:none stays allowed: the
 * scripts toggle it.
 */
test('inline styles in index.html become fewer, never more', () => {
  const LIMIT = 32;
  const html = require('./helpers/sources').withoutHtmlComments(
    fs.readFileSync(path.join(WEB, 'public', 'index.html'), 'utf8'),
  );
  const stile = [...html.matchAll(/<[a-zA-Z][^>]*?\sdata-style="([^"]*)"/g)].map(m => m[1].trim().replace(/;$/, ''));
  assert.ok(stile.length > 50, 'no inline styles found — does the search still apply?');
  const actual = stile.filter(s => s !== 'display:none').length;
  assert.ok(
    actual <= LIMIT,
    `${actual} inline styles (without display:none) in index.html, allowed are ${LIMIT}. ` +
      'Styling belongs in styles.css; there every design and mobile.css see it.',
  );
  if (actual < LIMIT) console.log(`  ℹ Inline-Stile: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no reference to “Nachtrag N” under Web-App/', () => {
  // The history of a place stands in the commit (CLAUDE.md); a number in a
  // comment refers to a list that does not exist in the tree. Exempt:
  // docs/, CHANGELOG* and db/ (applied migrations must not change).
  // Counter-checks: an addendum number in src/account/deviceToken.ts → red; the same in
  // test/tab-layout.test.js and in public/index.html → red (05.11.2026).
  const OUT = new Set(['node_modules', 'dist', 'coverage', 'data', 'docs', 'CHANGELOG', 'db', '.git']);
  const hits = [];
  let fileList = 0;
  (function run(d) {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) {
        if (!OUT.has(n.name)) run(p);
        continue;
      }
      if (
        n.name.startsWith('CHANGELOG') ||
        !/\.(ts|js|html|css|sh|md|ya?ml|json|sql)$|^\.gitignore$|^Dockerfile$|^Caddyfile$/.test(n.name)
      )
        continue;
      if (n.name === 'app.bundle.js') continue;
      fileList++;
      for (const m of fs.readFileSync(p, 'utf8').match(/Nachtr(?:ag|äge|aege) \d+/g) || [])
        hits.push(`${path.relative(WEB, p)}: ${m}`);
    }
  })(WEB);
  assert.ok(fileList > 800, `only ${fileList} files searched — does the search still apply?`);
  assert.deepEqual(hits, []);
});

test('no module is imported twice in one file', () => {
  // One value import per module and at most one `import type`; nine lines for
  // nine names from the same file hide what is really needed.
  // Counter-check (05.11.2026): `import { fehlertext } from '../infra/fehler';`
  // additionally in src/finances/priceAlert.ts → red.
  const hits = [];
  for (const f of sources()) {
    const seenSet = new Set();
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import\s+(type\s+)?[^;]*?from\s*'([^']+)';/gm)) {
      const k = `${m[1] ? 'type ' : ''}${m[2]}`;
      if (seenSet.has(k)) hits.push(`${path.relative(WEB, f)}: ${k}`);
      seenSet.add(k);
    }
  }
  assert.deepEqual(hits, []);
});

test('the comment share in the server sinks, never rises', () => {
  // Counted in server.ts, routes/, src/ and jobs/, in Biome format.
  const LIMIT = 9.8;
  let lines = 0,
    comment = 0;
  for (const f of sources().filter(f => /[\\/](routes|src|jobs)[\\/]/.test(f) || /[\\/]server\.ts$/.test(f))) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      lines++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) comment++;
    }
  }
  assert.ok(lines > 10000, `only ${lines} lines found — does the search still apply?`);
  const share = Math.round((1000 * comment) / lines) / 10;
  assert.ok(share <= LIMIT, `${share} % comment lines, allowed are ${LIMIT} %`);
  if (share < LIMIT - 0.5) console.log(`  ℹ Kommentaranteil: ${share} % (Schranke ${LIMIT}) — Schranke nachziehen`);
});

/** Sources of the UI: public/js without bundle, plus i18n.js. */
function ui() {
  const js = path.join(WEB, 'public', 'js');
  return [
    ...fs
      .readdirSync(js)
      .filter(f => f.endsWith('.js') && f !== 'app.bundle.js')
      .map(f => path.join(js, f)),
    path.join(WEB, 'public', 'i18n.js'),
  ];
}

// Type annotations in JSDoc (@param, @type …) and pure delimiters (/**, */) are
// code for tsc, not narration; they count neither as a comment nor as a line.
const TYPE_LINE = /^(\/\*\*\s*)?\*?\s*@(param|type|returns?|typedef|template|this|property)\b|^\/\*\*$|^\*\/$|^\*$/;

test('the comment share of the UI sinks, never rises', () => {
  // Counted without type lines, in Biome format.
  // Counter-check: 300 comment lines appended to dom.js → red.
  const LIMIT = 14.2;
  let lines = 0,
    comment = 0;
  for (const f of ui()) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t || TYPE_LINE.test(t)) continue;
      lines++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) comment++;
    }
  }
  assert.ok(lines > 8000, `only ${lines} lines found — does the search still apply?`);
  const share = Math.round((1000 * comment) / lines) / 10;
  assert.ok(share <= LIMIT, `${share} % comment lines in the UI, allowed are ${LIMIT} %`);
  if (share < LIMIT - 0.5)
    console.log(`  ℹ Kommentaranteil Oberfläche: ${share} % (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('any in the UI type annotations becomes fewer, never more', () => {
  // noImplicitAny only forbids the silent any; a written-out one switches off
  // the check for this value just the same. Since the cleanup none stands there any more.
  // Counter-check: `/** @type {any} */ let x;` appended to api.js → red with 1.
  const LIMIT = 0;
  let actual = 0;
  for (const f of ui())
    for (const z of fs.readFileSync(f, 'utf8').split('\n'))
      if (z.includes('@') && (z.includes('/**') || z.trim().startsWith('*')))
        actual += (z.match(/\bany\b/g) || []).length;
  assert.ok(actual <= LIMIT, `${actual} times any in type annotations of the UI, allowed are ${LIMIT}`);
  if (actual < LIMIT) console.log(`  ℹ any in der Oberfläche: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no UI comment has more than five lines of prose', () => {
  // CLAUDE.md: a comment says why in two to five lines. JSDoc tags
  // (@param, @returns …) do not count.
  // Counter-check: a // block with six lines in dom.js → red with location.
  const lang = [];
  let blockList = 0;
  for (const f of ui()) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    for (let i = 0; i < z.length; i++) {
      const t = z[i].trim();
      let prose = null,
        j = i;
      if (t.startsWith('//')) {
        while (j + 1 < z.length && z[j + 1].trim().startsWith('//')) j++;
        prose = z.slice(i, j + 1).map(l => l.trim().replace(/^\/\/ ?/, ''));
      } else if (t.startsWith('/*') && !t.includes('*/')) {
        while (j + 1 < z.length && !z[j].includes('*/')) j++;
        const inner = [t.replace(/^\/\*\*?/, ''), ...z.slice(i + 1, j).map(l => l.trim().replace(/^\* ?/, ''))];
        const k = inner.findIndex(l => l.trim().startsWith('@'));
        prose = k < 0 ? inner : inner.slice(0, k);
      }
      if (!prose) continue;
      blockList++;
      if (prose.filter(l => l.trim()).length > 5) lang.push(`${path.relative(WEB, f)}:${i + 1}`);
      i = j;
    }
  }
  assert.ok(blockList > 300, `only ${blockList} comment blocks found — does the search still apply?`);
  assert.deepEqual(lang, [], 'long rationale: the why in the code (five lines at most), the history in the commit');
});

/** Functions with their length (declaration up to the closing bracket of the same indentation). */
function functionLengths(fileList = ui()) {
  const result = [];
  for (const f of fileList) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    z.forEach((l, i) => {
      const m = l.match(/^(\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[<(]/);
      if (!m || /\}\s*;?\s*$/.test(l)) return;
      const end = z.findIndex((x, j) => j > i && x.startsWith(m[1] + '}'));
      if (end > i) result.push({ location: `${path.relative(WEB, f)}:${i + 1} ${m[2]}`, lines: end - i + 1 });
    });
  }
  return result;
}

test('UI functions over 100 and over 80 lines become fewer, never more', () => {
  // In Biome format. Counter-check: loadFinance
  // in one piece again (before splitting) → red with „finanzen.js loadFinance“.
  const LIMIT_80 = 20;
  const KNOWN_100 = [
    'public/js/purchase-dialogs.js acqSave',
    'public/js/charts.js priceChartSVG',
    'public/js/charts.js portfolioChartSVG',
    'public/js/init.js plGenerate',
    'public/js/init.js plExportPdf',
    'public/js/minifigs.js renderFigs',
  ];
  const all = functionLengths();
  assert.ok(all.length > 500, `only ${all.length} functions found — does the search still apply?`);
  const over100 = all.filter(x => x.lines > 100).map(x => x.location.replace(/:\d+ /, ' '));
  assert.deepEqual(
    over100.filter(x => !KNOWN_100.includes(x)),
    [],
    'a function over 100 lines: split it into named parts',
  );
  if (over100.length < KNOWN_100.length)
    console.log(`  ℹ Funktionen über 100 Zeilen: ${over100.join(', ')} — KNOWN_100 nachziehen`);
  const over80 = all.filter(x => x.lines > 80);
  assert.ok(
    over80.length <= LIMIT_80,
    `${over80.length} functions over 80 lines, allowed are ${LIMIT_80}:\n${over80.map(x => x.location).join('\n')}`,
  );
  if (over80.length < LIMIT_80)
    console.log(`  ℹ Funktionen über 80 Zeilen: ${over80.length} (Schranke ${LIMIT_80}) — Schranke nachziehen`);
});

/** Code lines of the UI modules (public/js/NN-*.js) without comment lines, with location. */
function uiCode() {
  const js = path.join(WEB, 'public', 'js');
  const result = [];
  for (const f of fs.readdirSync(js).filter(n => isAppModule(n)))
    fs.readFileSync(path.join(js, f), 'utf8')
      .split('\n')
      .forEach((z, i) => {
        const t = z.trim();
        if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'))
          result.push({ location: `${f}:${i + 1}`, z });
      });
  return result;
}

test('markup only gets into the page via setHtml()/fuegeHtmlEin()', () => {
  // Only the two helpers in dom.js write markup; the log window (monitor.js) builds its own
  // document via document.write. Counter-check: in sammlung.js `grid.innerHTML = ''` → red with location.
  const ALLOWED = ['dom.js', 'dom.js', 'monitor.js'];
  const raw = uiCode().filter(x =>
    /\.(innerHTML|outerHTML)\s*\+?=(?!=)|insertAdjacentHTML\(|document\.write\(/.test(x.z),
  );
  assert.deepEqual(
    raw.map(x => x.location.split(':')[0]).sort(),
    ALLOWED,
    `Markup an setHtml() vorbei:\n${raw.map(x => x.location).join('\n')}`,
  );
});

/** The arguments of all rawHtml() calls in `text`, up to the closing bracket. */
function rawHtmlArguments(/** @type {string} */ text) {
  const result = [];
  for (const m of text.matchAll(/(?<![\w.])(?<!function )rawHtml\(/g)) {
    const ab = (m.index ?? 0) + m[0].length;
    let i = ab;
    for (let depth = 0; i < text.length; i++)
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && depth-- === 0) break;
    result.push(text.slice(ab, i));
  }
  return result;
}

test('rawHtml() becomes fewer, never more; no template with ${…} and no .join() in it', () => {
  // html`` escapes every inserted value; rawHtml() inserts a string as markup that
  // was already built escaped before the rebuild. Lists from html`` are joined by joinHtml() (escaping.js).
  // Counter-check (12.11.2026): in dom.js `${ungeprueft(`<b>${x}</b>`)}` → red „Template“;
  // `ungeprueft(a.join(''))` → red „join“; limit set to 124 → red.
  // Counter-check (13.11.2026, limit 87): in gutscheine.js a `${ungeprueft(COPY_ICON_SVG)}` back → red.
  const LIMIT = 83;
  assert.deepEqual(
    rawHtmlArguments("function rawHtml(t) {}\na(rawHtml(`<i>${b(c)}</i>`), rawHtml(d.map(e).join('')), x.rawHtml(f))"),
    ['`<i>${b(c)}</i>`', "d.map(e).join('')"],
    'Selbstbeweis',
  );
  const js = path.join(WEB, 'public', 'js');
  const argList = fs
    .readdirSync(js)
    .filter(n => isAppModule(n))
    .flatMap(f =>
      rawHtmlArguments(require('./helpers/sources').withoutComments(fs.readFileSync(path.join(js, f), 'utf8'))).map(
        a => ({ f, a }),
      ),
    );
  const actual = argList.length;
  assert.ok(actual > 0, 'no rawHtml() found — does the search still apply?');
  const template = argList.filter(x => /^\s*`[^`]*\$\{/.test(x.a));
  assert.deepEqual(
    template.map(x => `${x.f}: ${x.a.slice(0, 60)}`),
    [],
    'rawHtml() with a template and ${…}: use html``',
  );
  const connected = argList.filter(x => /\.join\(/.test(x.a));
  assert.deepEqual(
    connected.map(x => `${x.f}: ${x.a.slice(0, 60)}`),
    [],
    'rawHtml(… .join()): joinHtml() nehmen',
  );
  assert.ok(actual <= LIMIT, `${actual} times rawHtml(), allowed are ${LIMIT}`);
  if (actual < LIMIT) console.log(`  ℹ rawHtml(): ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no UI file over 1000 lines, the big ones become smaller', () => {
  // A collective file attracts new things because they already lie there (Biome format).
  // Counter-check (09.11.2026): blank lines appended to finanzen.js → red.
  const LIMIT_LARGEST = 771,
    LIMIT_VIA_600 = 11;
  const lengths = ui().map(f => ({
    f: path.relative(WEB, f),
    n: fs.readFileSync(f, 'utf8').split('\n').length,
  }));
  assert.ok(lengths.length > 40, `only ${lengths.length} files found — does the search still apply?`);
  const over1000 = lengths.filter(x => x.n > 1000).map(x => `${x.f} (${x.n})`);
  assert.deepEqual(over1000, [], 'a file over 1000 lines: split it by topic');
  const largest = Math.max(...lengths.map(x => x.n));
  const over600 = lengths.filter(x => x.n > 600).length;
  assert.ok(largest <= LIMIT_LARGEST, `largest file ${largest} lines, allowed are ${LIMIT_LARGEST}`);
  assert.ok(over600 <= LIMIT_VIA_600, `${over600} files over 600 lines, allowed are ${LIMIT_VIA_600}`);
  if (largest < LIMIT_LARGEST || over600 < LIMIT_VIA_600)
    console.log(`  ℹ Dateigrösse Oberfläche: grösste ${largest}, über 600: ${over600} — Schranke nachziehen`);
});

/** Top-level functions including arrow functions on const; it ends before the next line
 * without indentation (a closing bracket still belongs to it). */
function topLevelLengths(/** @type {string[]} */ fileList) {
  const result = [];
  for (const f of fileList) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    z.forEach((l, i) => {
      let name = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[<(]/.exec(l)?.[1];
      if (!name) {
        const m = /^(?:export\s+)?const\s+(\w+)\b/.exec(l);
        if (!m?.[1]) return;
        const head = z.slice(i, i + 15).join('\n');
        const rest = head.slice(head.indexOf('=', head.indexOf(m[1])) + 1);
        if (!/^\s*(async\s+)?(\(|\w+\s*=>|<|function\b)/.test(rest)) return;
        name = m[1];
      }
      let j = i + 1;
      while (j < z.length && !/^\S/.test(z[j] ?? '')) j++;
      let end = j < z.length && /^[})\]]/.test(z[j] ?? '') ? j : j - 1;
      while (end > i && !z[end]?.trim()) end--;
      result.push({ location: `${path.relative(WEB, f)} ${name}`, lines: end - i + 1 });
    });
  }
  return result;
}

test('server functions over 80/150 lines become fewer, never more', () => {
  // From 100 lines on top-level functions including arrow functions count; none is known.
  // Counter-checks: buildPdf in src/catalog/pdf/pdfDrawing.ts in one piece again → red „ab 100“ (13.11.2026);
  // createDb in db/database.ts again as one closure → red „ab 100“ and „über 150“ (14.11.2026).
  const LIMIT_80 = 17,
    LIMIT_150 = 0,
    KNOWN_100 = [];
  const fileList = sources().filter(
    f => /[\\/](src|routes|jobs|db|clients|startup)[\\/]/.test(f) || /[\\/]server\.ts$/.test(f),
  );
  // A router factory (baueXRouter) is the list of its routes like the module body used to be;
  // its handlers keep counting individually.
  const noFactory = x => !/ build\w*Router$/.test(x.location);
  const upper = topLevelLengths(fileList).filter(noFactory);
  assert.ok(upper.length > 1500, `only ${upper.length} top-level functions found — does the search still apply?`);
  const from100 = upper.filter(x => x.lines >= 100).map(x => x.location);
  assert.deepEqual(
    from100.filter(x => !KNOWN_100.includes(x)),
    [],
    'from 100 lines: split into named parts',
  );
  if (from100.length < KNOWN_100.length) console.log(`  ℹ ab 100 Zeilen: ${from100.join(', ')} — KNOWN_100 nachziehen`);
  const all = functionLengths(fileList).filter(noFactory);
  assert.ok(all.length > 1000, `only ${all.length} functions found — does the search still apply?`);
  const over = n => all.filter(x => x.lines > n);
  assert.ok(
    over(150).length <= LIMIT_150,
    `over 150 lines:\n${over(150)
      .map(x => x.location)
      .join('\n')}`,
  );
  assert.ok(over(80).length <= LIMIT_80, `${over(80).length} over 80 lines, allowed are ${LIMIT_80}`);
  if (over(80).length < LIMIT_80)
    console.log(`  ℹ Server-Funktionen über 80 Zeilen: ${over(80).length} — Schranke nachziehen`);
});

test('the comment share in db/, clients/ and scripts/ sinks, never rises', () => {
  // One limit per folder, in Biome format.
  // Counter-check: 40 comment lines appended to clients/ecb.ts → red (clients).
  const LIMIT = { db: 15.1, clients: 12.3, scripts: 19.2 };
  const toMuch = [];
  for (const [dir, limit] of Object.entries(LIMIT)) {
    let lines = 0,
      comment = 0;
    (function run(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const n = e.name;
        const p = path.join(d, n);
        if (e.isDirectory()) {
          if (n !== 'node_modules') run(p);
          continue;
        }
        if (!/\.(ts|js|sh)$/.test(n) || (n.endsWith('.js') && fs.existsSync(p.slice(0, -3) + '.ts'))) continue;
        for (const z of fs.readFileSync(p, 'utf8').split('\n')) {
          const t = z.trim();
          if (!t) continue;
          lines++;
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || (n.endsWith('.sh') && t.startsWith('#')))
            comment++;
        }
      }
    })(path.join(WEB, dir));
    assert.ok(lines > 500, `${dir}: only ${lines} lines found — does the search still apply?`);
    const share = Math.round((1000 * comment) / lines) / 10;
    if (share > limit) toMuch.push(`${dir}: ${share} % (erlaubt ${limit} %)`);
    else if (share < limit - 0.5)
      console.log(`  ℹ Kommentaranteil ${dir}: ${share} % (Schranke ${limit}) — Schranke nachziehen`);
  }
  assert.deepEqual(toMuch, []);
});

test('history in test comments becomes fewer, never more', () => {
  // A test header names what is checked and its counter-checks (CLAUDE.md);
  // where a test came from stands in the commit. Counted are comment lines with
  // the typical narrative markers, also „Gemessen … am <Datum>“.
  // Counter-check (05.11.2026): the old header of scope-reset.test.js back → red.
  // Counter-check (14.11.2026): a line `// Gemessen 7 am` with a date appended to this header → red.
  const LIMIT = 0;

  const MARK =
    /(Nachtr(ag|äge) [0-9]|Hier stand|Vorher stand|NACHGEMESSEN|kam(en)? am [0-9]|Gemessen\b[^.]*\bam [0-9]|Marcos (Frage|Wunsch|Bericht|Rückfrage|Konsole)|Addendum [0-9]|Measured\b[^.]*\bon [0-9]|Marco's (question|request|report|console))/;
  const fileList = [
    ...fs
      .readdirSync(__dirname)
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(__dirname, n)),
    ...fs
      .readdirSync(path.join(__dirname, 'helpers'))
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(__dirname, 'helpers', n)),
  ];
  let actual = 0;
  for (const f of fileList)
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if ((t.startsWith('//') || t.startsWith('*')) && MARK.test(t)) actual++;
    }
  // Self-proof without a real occurrence: the limit has reached 0.
  assert.ok(MARK.test('* Gemessen am 7.11.') && MARK.test('// Measured on 7.11.'), 'does the search still apply?');
  assert.ok(actual <= LIMIT, `${actual} comment lines with history in the tests, allowed are ${LIMIT}`);
  if (actual < LIMIT)
    console.log(`  ℹ Geschichte in Testkommentaren: ${actual} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('the comment share of the tests sinks, never rises', () => {
  // Own limit: test headers list their counter-checks (CLAUDE.md), the
  // share therefore lies higher than in the server. History belongs in the
  // commit here too. Counted in test/*.js and test/helpers/, in Biome format.
  // Counter-check: 300 comment lines appended to a test file → red.
  const LIMIT = 17;
  const fileList = [
    ...fs
      .readdirSync(__dirname)
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(__dirname, n)),
    ...fs
      .readdirSync(path.join(__dirname, 'helpers'))
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(__dirname, 'helpers', n)),
  ];
  let lines = 0,
    comment = 0;
  for (const f of fileList) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      lines++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) comment++;
    }
  }
  assert.ok(lines > 20000, `only ${lines} lines found — does the search still apply?`);
  const share = Math.round((1000 * comment) / lines) / 10;
  assert.ok(share <= LIMIT, `${share} % comment lines in the tests, allowed are ${LIMIT} %`);
  if (share < LIMIT - 0.5)
    console.log(`  ℹ Kommentaranteil Tests: ${share} % (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no reference to the former rationale archive', () => {
  // Long rationales do not stand in the tree (CLAUDE.md); the archive is reachable via git. Ratchet 0:
  // a reference to it pointed into nothing. The script finds the same references that it removes.
  // Counter-check (10.11.2026): `// Ausführlich: docs/…/x.md#a` (full path) in src/infra/appPaths.ts → red
  // with „src/infra/appPaths.ts“; the folder docs/begruendungen/ created again → red.
  assert.equal(
    fs.existsSync(path.join(WEB, 'docs', 'begruendungen')),
    false,
    'docs/begruendungen/ does not belong in the tree',
  );
  const r = require('node:child_process').spawnSync(
    process.execPath,
    [path.join(WEB, 'scripts', 'remove-rationales.js'), '--pruefen'],
    { encoding: 'utf8' },
  );
  assert.equal(
    r.status,
    0,
    `references into the former archive — \`node scripts/remove-rationales.js\` removes them:\n${r.stdout}${r.stderr}`,
  );
});

test('the comment share of the operations files sinks, never rises', () => {
  // Workflows, Dockerfile, compose.yaml, tsconfig.json: there too the why stands
  // in few lines, the history in the commit (CLAUDE.md). The Caddyfile does not count:
  // no block in it is longer than five lines.
  // Counter-check (04.11.2026): 60 comment lines appended to the Dockerfile → red.
  const LIMIT = 20.4;
  const wf = path.join(WEB, '..', '.github', 'workflows');
  const fileList = [
    ...fs
      .readdirSync(wf)
      .filter(f => /\.ya?ml$/.test(f))
      .map(f => path.join(wf, f)),
    ...['Dockerfile', 'compose.yaml', 'tsconfig.json'].map(f => path.join(WEB, f)),
  ];
  let lines = 0,
    comment = 0;
  for (const f of fileList) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      lines++;
      if (t.startsWith('#') || t.startsWith('//')) comment++;
    }
  }
  assert.ok(
    fileList.length >= 6 && lines > 1000,
    `only ${fileList.length} files, ${lines} lines — does the search still apply?`,
  );
  const share = Math.round((1000 * comment) / lines) / 10;
  assert.ok(share <= LIMIT, `${share} % comment lines in the operations files, allowed are ${LIMIT} %`);
  if (share < LIMIT - 0.5)
    console.log(`  ℹ Kommentaranteil Betrieb: ${share} % (Schranke ${LIMIT}) — Schranke nachziehen`);
});

/** Comment blocks with more than five lines of prose (before the first @ tag), counted as in the audit report.
 * A list of counter-checks does not count: according to CLAUDE.md it belongs in the header of a test. */
function longBlocks(/** @type {string} */ text) {
  const z = text.split('\n');
  const COUNTER_CHECKS = /^\s*(\*|\/\/)\s*(Gegenprobe|Counter-check)/i;
  let n = 0;
  for (let i = 0; i < z.length; i++) {
    const t = z[i].trim();
    let j = i;
    /** @type {string[] | null} */
    let prose = null;
    if (t.startsWith('//')) {
      while (j + 1 < z.length && z[j + 1].trim().startsWith('//')) j++;
      prose = z.slice(i, j + 1);
    } else if (t.startsWith('/*') && !t.includes('*/')) {
      while (j + 1 < z.length && !z[j].includes('*/')) j++;
      let inner = z.slice(i, j + 1);
      const tag = inner.findIndex(l => /^\s*\*\s*@/.test(l));
      if (tag > 0) inner = inner.slice(0, tag);
      prose = inner.filter(l => !/^\s*(\/\*\*?|\*\/)\s*$/.test(l));
    }
    const list = prose ? prose.findIndex(l => COUNTER_CHECKS.test(l)) : -1;
    if (prose && list >= 0) prose = prose.slice(0, list);
    if (prose) {
      if (prose.filter(l => l.replace(/^\s*(\/\/|\*|\/\*\*?)\s?/, '').trim()).length > 5) n++;
      i = j;
    }
  }
  return n;
}

test('long comments in tests, scripts and index.html become fewer, never more', () => {
  // In the code the why stands in few lines, the history in the commit (CLAUDE.md);
  // counter-check lists do not count.
  // Counter-check (06.11.2026): six lines of prose before the counter-check in the header of hsts.test.js → red (tests 75).
  const LIMIT = { tests: 48, scripts: 0, indexHtml: 162 };
  const js = (/** @type {string} */ d) =>
    fs
      .readdirSync(d)
      .filter(f => f.endsWith('.js'))
      .map(f => path.join(d, f));
  const count = (/** @type {string[]} */ l) => l.reduce((n, f) => n + longBlocks(fs.readFileSync(f, 'utf8')), 0);
  let html = 0;
  let open = false;
  for (const z of fs.readFileSync(path.join(WEB, 'public', 'index.html'), 'utf8').split('\n')) {
    if (z.includes('<!--')) open = true;
    if (open) html++;
    if (z.includes('-->')) open = false;
  }
  const actual = {
    tests: count([...js(__dirname), ...js(path.join(__dirname, 'helpers'))]),
    scripts: count(js(path.join(WEB, 'scripts'))),
    indexHtml: html,
  };
  assert.ok(actual.tests > 0 && actual.indexHtml > 0, 'nothing found — does the search still apply?');
  for (const [k, s] of Object.entries(LIMIT)) {
    assert.ok(actual[k] <= s, `${k}: ${actual[k]}, allowed are ${s}`);
    if (actual[k] < s) console.log(`  ℹ lange Kommentare ${k}: ${actual[k]} (Schranke ${s}) — Schranke nachziehen`);
  }
});

test('every test file names its counter-check', () => {
  // A test that was never red is unproven (CLAUDE.md); a fixed ban since every file names one.
  // Counter-check: the counter-check line removed from the header of asset-version.test.js → red with that file.
  const without = fs
    .readdirSync(__dirname)
    .filter(n => n.endsWith('.test.js'))
    .filter(n => !/Gegenprobe|counter-check/i.test(fs.readFileSync(path.join(__dirname, n), 'utf8')));
  assert.deepEqual(without, [], 'test files without a counter-check: run one, see it red, name it in the header');
});

test('paths named in test comments exist', () => {
  // A counter-check that names a vanished file cannot be repeated. Checked is every
  // comment line in test/ and test/helpers/; a .js path also counts if the .ts source for it exists.
  // Counter-check (10.11.2026): in acquisition-scope-db.test.js the path at schreibbereich reset to the former one of the
  // set routes → red with this line as location. Counter-check (14.11.2026): without a built
  // bundle and without ARTIFACTS → red (bundle-built.test.js); the same path with `app.bundle2.js` → red.
  const REPO = path.join(WEB, '..');
  const dir = [WEB, REPO]
    .flatMap(w =>
      fs
        .readdirSync(w, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name),
    )
    .filter(n => !['node_modules', 'dist', 'coverage', 'data', '.git'].includes(n));
  const PATH = new RegExp(
    `(?<![\\w./-])((?:${dir.map(n => n.replace('.', '\\.')).join('|')})/[\\w./-]*\\w\\.` +
      '(?:ts|js|sql|html|css|json|md|sh|ya?ml|kt|kts|xml|txt))\\b',
    'g',
  );
  // The bundle only arises with `npm run build`; a fresh checkout does not have it.
  const ARTIFACTS = new Set([`public/${require('../scripts/build-frontend').OUT_REL}`]);
  const exists = (/** @type {string} */ p) =>
    ARTIFACTS.has(p) ||
    [WEB, REPO].some(
      w => fs.existsSync(path.join(w, p)) || (p.endsWith('.js') && fs.existsSync(path.join(w, `${p.slice(0, -3)}.ts`))),
    );
  const fileList = [__dirname, path.join(__dirname, 'helpers')].flatMap(d =>
    fs
      .readdirSync(d)
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(d, n)),
  );
  const missing = [];
  let n = 0;
  for (const f of fileList) {
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .forEach((z, i) => {
        const t = z.trim();
        if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) return;
        for (const m of t.matchAll(PATH)) {
          n++;
          if (!exists(m[1])) missing.push(`${path.relative(WEB, f)}:${i + 1} ${m[1]}`);
        }
      });
  }
  assert.ok(n > 400, `only ${n} paths found — does the search still apply?`);
  assert.deepEqual(missing, [], "change the path to today's file; history belongs in the commit");
});

// ---- Language of the code: German identifiers per area ---------------------
// A fixed ban in the server and in the tests; NOT_OURS lists the stored and foreign names.
// Counter-checks (22.11.2026): `const fehlerZahl = 1;` added to src/infra/config.ts
// → "server" red (fehlerZahl); `const liesPause = 1;` there → red (the extended word
// list knows `lies`); `zeit` removed from STORED → red (src/images/imageDemandRun.ts);
// the word list emptied → the sample check red; `'Fehler'` only as a string → green.
// Counter-checks (23.11.2026): `const fehlerZahl = 1;` added to test/app-scrollbar.test.js → the
// test ban red (app-scrollbar.test.js: fehlerZahl); `getuid` taken out of EXTERNAL → red
// (backup-encrypted.test.js: getuid); `'zuLaden'` added to STORED → red „exception without an occurrence“.
// The helper reads nested templates and regex literals (samples below): before, both hid code.
test('German identifiers: none in the server, none in the tests', () => {
  const { germanIdentifiers, isGerman } = require('./helpers/german-identifiers');
  assert.ok(isGerman('backInDieTable') && isGerman('preiseNachladen') && isGerman('ladeAn'), 'sample German');
  assert.ok(isGerman('liesPause') && isGerman('fetchesJeMinute') && isGerman('planeNext'), 'sample German (round 31)');
  assert.ok(!isGerman('importStatus') && !isGerman('jobKinds') && !isGerman('settable'), 'sample English');
  assert.equal(germanIdentifiers("const x = 'Fehler'; // Fehler").size, 0, 'texts and comments do not count');
  assert.deepEqual(
    [...germanIdentifiers('const a = `x ${`y ${"z"}`} w`; const fehlerZahl = 1;')],
    ['fehlerZahl'],
    'a nested template does not end the outer one',
  );
  assert.deepEqual(
    [...germanIdentifiers("const r = /'/; const fehlerZahl = 1;")],
    ['fehlerZahl'],
    'regex with a quote',
  );
  const SKIP = new Set(['node_modules', 'dist', 'coverage', 'data', 'vendor', '.git']);
  const files = (/** @type {string} */ d, /** @type {string[]} */ out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) files(p, out);
      } else if (/\.(ts|js|mjs|cjs)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
    }
    return out;
  };
  const SERVER = ['src', 'routes', 'db', 'clients', 'startup', 'jobs', 'scripts'].filter(d =>
    fs.existsSync(path.join(WEB, d)),
  );
  /** Dictionaries of names that are not ours: v1 and the Kotlin types (Android), and the keys of
   * shared/design-tokens.json, which the Android build reads as well. */
  const NOT_OUR_FILES = new Set(['scripts/contract-kotlin-mapping.js', 'scripts/generate-design-tokens.js']);
  /** German names the server does not own, per group; each one is a value that lives outside the code. */
  const NOT_OURS = {
    /** Stored: database columns, JSON keys in run_state, job payloads, setting keys, session fields,
     * trash kinds. Renaming them voids what is already stored. */
    STORED: [
      'pruefsumme',
      'sitzungsVersion',
      'angemeldetAm',
      'eingabe',
      'nur_ausweichquelle',
      'versuch',
      'schritt',
      'geheimnisse',
      'vorschauen',
      'katalog',
      'anleitungen',
      'set_bilder',
      'kaufpreise',
      'einrichtung_erledigt',
      'gutschein_land',
      'figur',
      'teil',
      'nummern',
      'zeit',
      'ergebnis',
      // Payloads of queued jobs: csv_import (lauf, rows[].error.wert), price_refresh (items[].farbe).
      'lauf',
      'wert',
      'farbe',
    ],
    /** On the wire: a field the UI reads (contract.d.ts does not list it), a QR validity older pages send. */
    WIRE: ['abdeckung', 'unbegrenzt'],
    /** Names of others: Node's TLS option, operator environment variables, the keys of the JSON log
     * line (README) and of the security events in it, which log tools read. */
    EXTERNAL: ['servername', 'DB_LESEN_USER', 'TEST_NACHLAUF', 'stufe', 'kontext', 'ereignis', 'konto', 'zugang'],
  };
  const exempt = new Set(Object.values(NOT_OURS).flat());
  const server = [path.join(WEB, 'server.ts'), ...SERVER.flatMap(d => files(path.join(WEB, d)))].filter(
    f => !NOT_OUR_FILES.has(path.relative(WEB, f).split(path.sep).join('/')),
  );
  /** @type {Map<string, string>} */
  const found = new Map();
  const seen = new Set();
  for (const f of server)
    for (const id of germanIdentifiers(fs.readFileSync(f, 'utf8'))) {
      seen.add(id);
      if (!exempt.has(id) && !found.has(id)) found.set(id, path.relative(WEB, f));
    }
  assert.deepEqual(
    [...found].map(([id, f]) => `${f}: ${id}`),
    [],
    'identifiers in the server in English; a stored or foreign name belongs in NOT_OURS, with a reason',
  );
  const unused = [...exempt].filter(id => !seen.has(id));
  assert.deepEqual(unused, [], 'exception without an occurrence — remove it from NOT_OURS');

  // The tests set and read the stored and wire names of the server and the UI too (NOT_OURS,
  // NOT_OURS_UI); the names below only the tests handle.
  const NOT_OURS_IN_TESTS = {
    /** Environment variables that Caddy, compose, the operator scripts and the workflow steps read. */
    ENVIRONMENT: [
      'VORGELAGERTER_PROXY',
      'BRICK_TLS_AUSSTELLER',
      'BRICK_TLS_OPTIONEN',
      'BRICK_CA_EIGEN',
      'CA_ORDNER',
      'CA_OHNE_NAMENSBESCHRAENKUNG',
      'NEU',
      'WURZEL_SCHLUESSEL',
      'BACKUP_KLARTEXT',
      'BACKUP_AGE_EMPFAENGER',
      'BACKUP_AGE_IDENTITAET',
      'BACKUP_SCHLUESSEL_ZIEL',
      'SCHLUESSEL_ORDNER',
      'ALTER_SCHLUESSEL',
      'SCHLUESSEL_EIGNER',
      'ZIEL_UID',
      'MARKE',
      'BERICHT',
      'EINGABE',
      'AUS_LAUF',
      'LAUF_COMMIT',
      'LAUF_ID',
      'LAUF',
      'APK_SOLL',
      'BESCHREIBUNG_SOLL',
      'AAB_SOLL',
      'EREIGNIS',
      'ERGEBNIS',
      'TAG_EINGABE',
      'NUTZER',
      'UMGEBUNG',
    ],
    /** Old variable names the configuration still accepts and reports as renamed. */
    OLD_ENVIRONMENT: ['AUFTRAG_PARALLEL', 'ROLLE', 'APP_BASE_URL_FEHLT_OK'],
    /** Stored: a CSV column of older exports, the
     * old device settings theme-boot.js moves, and the design names (data-theme, kept per account). */
    STORED: [
      'erfassungsdatum',
      'bim_dunkel',
      'bim_lager_gallery',
      'bim_scope_merkliste',
      'bim_teile_ordnung',
      'bim_einst_abschnitt',
      'bim_alarm_marke_7',
      'noppe',
      'hochglanz',
      'werkbank',
    ],
    /** Keys of shared/setnummer-korpus.json and shared/design-tokens.json, which the Android build reads too. */
    SHARED_FILES: ['faelle', 'erwartet', 'warum', 'steine', 'werte', 'erbt'],
    /** Names of others: Node's process.getuid and Symbol.iterator, esbuild's sourcefile. */
    EXTERNAL: ['getuid', 'iterator', 'sourcefile'],
  };
  const ownExempt = Object.values(NOT_OURS_IN_TESTS).flat();
  // The published v1 contract keeps its German field names (src/contract/*.ts); the v1 tests read them.
  const contractDir = path.join(WEB, 'src', 'contract');
  const v1Names = fs
    .readdirSync(contractDir)
    .filter(n => n.endsWith('.ts'))
    .flatMap(n =>
      [...fs.readFileSync(path.join(contractDir, n), 'utf8').matchAll(/:\s*'([A-Za-z_]\w*)'/g)].map(m => m[1]),
    );
  const testExempt = new Set([...exempt, ...Object.values(NOT_OURS_UI).flat(), ...v1Names, ...ownExempt]);
  /** @type {Map<string, string>} */
  const inTests = new Map();
  const seenInTests = new Set();
  for (const f of files(__dirname))
    for (const id of germanIdentifiers(fs.readFileSync(f, 'utf8'))) {
      seenInTests.add(id);
      if (!testExempt.has(id) && !inTests.has(id)) inTests.set(id, path.relative(__dirname, f));
    }
  assert.ok(seenInTests.has('getuid'), 'the test search finds nothing — does it still read test/?');
  assert.deepEqual(
    [...inTests].map(([id, f]) => `${f}: ${id}`),
    [],
    'identifiers in the tests in English; a stored or foreign name belongs in NOT_OURS_IN_TESTS, with a reason',
  );
  assert.deepEqual(
    ownExempt.filter(id => !seenInTests.has(id)),
    [],
    'exception without an occurrence — remove it from NOT_OURS_IN_TESTS',
  );
});

test('no German assertion messages', () => {
  // Tests speak English (CLAUDE.md), as on Android; texts users read stay German and count only inside „…“.
  // Counter-checks (23.11.2026): `assert.ok(1, 'Die Liste fehlt')` added to app-scrollbar.test.js → red
  // (app-scrollbar.test.js: 'Die Liste fehlt'); the regex skip in helpers/assert-messages.js taken out →
  // „a regex with quotes“ red: a quote in the pattern split the arguments wrongly and hid the message.
  const { messages, isGermanMessage, germanMessages } = require('./helpers/assert-messages');
  assert.ok(messages(`assert${'.'}ok(x, 'Die Liste fehlt')`).some(isGermanMessage), 'self-proof: a German message');
  assert.ok(!isGermanMessage("'the list is missing'"), 'self-proof: an English message');
  assert.deepEqual(messages("assert.equal(title, 'Galerie')"), [], 'an expected value is no message');
  assert.deepEqual(
    messages(`assert${'.'}match(js, /'DELETE', \`\\/v2/, 'Die Liste fehlt');`),
    ["'Die Liste fehlt'"],
    'a regex with quotes does not end the arguments',
  );
  assert.deepEqual(germanMessages(__dirname), [], 'assertion messages in English; quote user texts in „…“');
});

// ── Language: no German names in the UI code ─────────────────────────────────────────────
// A fixed ban, not a count: identifiers, class names, IDs, data attributes, i18n keys and comments
// under public/ are English. Exempt are only texts users read (locale values, HTML text, colour words
// in i18n.js) and names the frontend does not own, listed here per group with their reason.
const NOT_OURS_UI = {
  /** Fields and values of the API that the contract (contract.d.ts, openapi.json) does not list. */
  API_VALUES: ['voll', 'abstand', 'konto', 'unveraendert', 'X-Gutschein-Befunde', 'abdeckung', 'kaufpreis'],
  /** Codes the server sends in monitor and log entries; the UI maps them to texts. */
  SERVER_CODES: [
    'images_reload',
    'catalog_followup',
    'rework',
    'images',
    'instructions',
    'followup',
    'prices',
    'price_refresh',
    'image_followup',
    'cleanup',
    'cleanup_daily',
    'account_files',
    'zuordnung',
    'gleich_vermerkt',
    'korrigiert',
  ],
  /** German server texts the job monitor recognises until the server sends codes for them. */
  SERVER_TEXTS: ['Alle', 'Bilder', 'Keine', 'bereit', 'zum', 'aktualisiert', 'Starte', 'gecacht', 'Fehler', 'erledigt'],
  /** Classes whose suffix is a job status from the server (mon-${status}). */
  STATUS_CLASSES: ['mon-fehler'],
  /** Addresses in the browser bar (#/sammlung?suche=…): bookmarks keep working. */
  ADDRESSES: [
    'sammlung',
    'minifiguren',
    'finanzen',
    'katalog',
    'hintergrund',
    'einstellungen',
    'gutscheine',
    'alarme',
    'lagerorte',
    'haushalt',
    'daten',
    'benutzer',
    'konfiguration',
    'suche',
    'sortierung',
    'von',
    'kategorie',
    'merkliste',
    'ersatz',
    'teile',
    'zustand',
    'ordnung',
    'farbe',
  ],
  /** Old device settings that theme-boot.js moves to their English keys once. */
  OLD_STORAGE: [
    'bim_rb_hinweis_weg',
    'bim_scope_merkliste',
    'bim_einst_abschnitt',
    'bim_dunkel',
    'immer',
    'bim_teile_ordnung',
    // Values of bim_teile_ordnung before the order became English; parts.js reads them once more.
    'farbe',
    'menge',
  ],
  /** File name users get when saving an instruction without a name of its own. */
  USER_TEXT: ['anleitung.pdf'],
  /** A constant of the Android app that a comment names; the app's own rename is its business. */
  ANDROID_NAMES: ['Alarmeingabe.RUHE_MS'],
};

test('no German names in the UI code', () => {
  // Counter-check (22.11.2026): `.fehler-hinweis` in styles.css and `let knopfLeiste` in public/js/dom.js
  // → red with both places; 'korrigiert' taken out of SERVER_CODES → red (wanted-xml.js).
  const { germanNames, contractNames, germanWords } = require('./helpers/german-names');
  assert.deepEqual(germanWords('fehlerZustand'), ['fehler', 'zustand'], 'the word list does not apply');
  assert.deepEqual(germanWords('errorState'), []);
  const allowed = new Set([...contractNames(), ...Object.values(NOT_OURS_UI).flat()]);
  assert.ok(allowed.has('tile_price'), 'the contract delivers no names — does the search still apply?');
  assert.deepEqual(germanNames(allowed), [], 'German names in the UI code: rename them to English');
});
