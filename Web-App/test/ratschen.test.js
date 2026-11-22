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
function quellen() {
  const raus = [];
  (function lauf(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) {
        if (['node_modules', 'dist', '.git', 'coverage', 'test'].includes(n)) continue;
        lauf(p);
      } else if (n.endsWith('.ts')) raus.push(p);
    }
  })(WEB);
  return raus;
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
 * Count hits — in the CODE, not in the explanations above it. With `marke`
 * `/**\/` stays at every comment place: a catch whose body names its
 * why is not silent, even if Biome puts the comment on its own line.
 */
function zaehle(muster, nur = (/** @type {string} */ _f) => true, marke = false) {
  const { ohneKommentare } = require('./helpers/sources');
  const ohne = marke
    ? (/** @type {string} */ s) =>
        s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '/**/').replace(/^[ \t]*\/\/[^\n]*$/gm, '/**/')
    : ohneKommentare;
  let n = 0;
  for (const f of quellen().filter(nur)) {
    const s = ohne(fs.readFileSync(f, 'utf8'));
    for (const m of muster) n += (s.match(m) || []).length;
  }
  return n;
}

test('the search finds the sources at all', () => {
  // ── The actual purpose of this check ────────────────────────────────
  //
  // If a folder is renamed or `quellen()` no longer applies, the ratchets
  // below count ZERO — and zero is smaller than any limit. They would
  // then be green forever without ever looking at anything again.
  const n = quellen().length;
  assert.ok(n >= 80, `Nur ${n} TypeScript-Quellen gefunden — greift die Suche noch?`);
});

test('silent catches (server, only reported, UI) become fewer, never more', () => {
  // The Rebrickable part mapping only catches 404, which rbGet() itself delivers as null.
  const LIMIT = 0;
  // Self-proof of the last pattern: it must find a substitute value without a report, not the report.
  const ersatz = SILENT_CATCHES[SILENT_CATCHES.length - 1];
  const trifft = s => (s.match(ersatz) || []).length;
  assert.equal(
    trifft('x.catch(() => [userId]);') + trifft('x.catch(() => new Map());') + trifft('x.catch(()=>VORGABE);'),
    3,
  );
  assert.equal(trifft("x.catch(reportAndDeliver('a', [1]));") + trifft('x.catch((e) => { reportError("a", e); });'), 0);
  const ist = zaehle(SILENT_CATCHES, undefined, true);
  assert.ok(
    ist <= LIMIT,
    `${ist} stille Faenge, erlaubt sind ${LIMIT}. Ein neuer \`catch {}\` ` +
      'verschluckt einen Fehler und laeuft weiter — im Betrieb sieht man dann ' +
      'ein Verhalten ohne Ursache. Entweder den Fehler behandeln, oder ihn ' +
      'wenigstens melden (reportError aus src/infra/errorTexts).',
  );
  if (ist < LIMIT) {
    console.log(`  ℹ stille Faenge: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
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
  const LIMITS = { logAndContinue: 67, reportAndDeliver: 7 };
  const AT_LEAST = { logAndContinue: 20, reportAndDeliver: 3 };
  const OUTSIDE_CATALOG = { logAndContinue: 37 };
  const inCatalog = (/** @type {string} */ f) => /[\\/]src[\\/]catalog[\\/]/.test(f);
  for (const [name, limit] of Object.entries(LIMITS)) {
    const muster = [new RegExp(`\\b${name}\\(`, 'g')];
    const ist = zaehle(muster);
    assert.ok(ist > AT_LEAST[name], `nur ${ist}-mal ${name} gefunden — greift die Suche noch?`);
    assert.ok(ist <= limit, `${ist}-mal ${name}, erlaubt sind ${limit}`);
    if (ist < limit) console.log(`  ℹ ${name}: ${ist} (Schranke ${limit}) — Schranke nachziehen`);
    const aussen = OUTSIDE_CATALOG[name];
    if (aussen === undefined) continue;
    const n = zaehle(muster, f => !inCatalog(f));
    assert.ok(n > 0 && n < ist, `ausserhalb src/catalog ${n} von ${ist} — greift die Trennung noch?`);
    assert.ok(n <= aussen, `${n}-mal ${name} ausserhalb src/catalog, erlaubt sind ${aussen}`);
    if (n < aussen) console.log(`  ℹ ${name} ausserhalb src/catalog: ${n} (Schranke ${aussen}) — Schranke nachziehen`);
  }
  const muster = /\b(?:logAndContinue|reportAndDeliver)\(/;
  const sets = quellen().filter(f => /[\\/]src[\\/]sets[\\/]/.test(f));
  assert.ok(sets.length > 10, 'src/sets nicht gefunden');
  const ohneKommentare = require('./helpers/sources').ohneKommentare;
  assert.deepEqual(
    sets.filter(f => muster.test(ohneKommentare(fs.readFileSync(f, 'utf8')))).map(f => path.relative(WEB, f)),
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
  const src = quellen().filter(f => /^src[\\/]/.test(path.relative(WEB, f)));
  const treffer = src.flatMap(f =>
    catches(fs.readFileSync(f, 'utf8'))
      .filter(onlyReported)
      .map(x => ({ ...x, wo: `${path.relative(WEB, f)}:${x.zeile}` })),
  );
  assert.ok(treffer.length > 20, `nur ${treffer.length} gemeldete Fänge gefunden — greift die Suche noch?`);
  assert.ok(treffer.length <= LIMIT, `${treffer.length} Fänge melden nur und laufen weiter, erlaubt sind ${LIMIT}`);
  if (treffer.length < LIMIT)
    console.log(`  ℹ nur gemeldete Fänge: ${treffer.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
  assert.deepEqual(
    treffer.filter(x => /\bconsole\./.test(x.rumpf) && !/Ausnahme:|Exception:/.test(x.roh)).map(x => x.wo),
    [],
    'ohne Ausnahme: direkt in die Konsole statt reportError',
  );
}

/** Silent catches of the UI become fewer, never more. */
function silentCatchesTheUi() {
  // A catch in public/js without throw, message (toast, zeige…, melde…, console) or visible text
  // swallows the error: the view then shows „empty“ instead of „failed“. Many are intended
  // (localStorage, aborted streams); new ones are not needed.
  // Counter-check (15.11.2026): in public/js/wanted.js on the alert when remembering again
  // `.catch(() => null)` → red (92 silent catches, 91 allowed).
  const { catches, stillImBrowser } = require('./helpers/catches');
  // 85 since public/js/format.js no longer has a raw quote in a regex: the mask read the catch in
  // browserWritesDateHowApp() as part of a string before; it is not new.
  const LIMIT = 85;
  const probe = (/** @type {string} */ q) => catches(q).filter(stillImBrowser).length;
  assert.equal(probe('a().catch(() => null); try { b(); } catch { /* weg */ } c.catch(() => {});'), 3);
  assert.equal(probe('a().catch(e => toast(e.message, "error")); try { b(); } catch (e) { showError(e); }'), 0);
  const ist = oberflaeche().reduce((n, f) => n + catches(fs.readFileSync(f, 'utf8')).filter(stillImBrowser).length, 0);
  assert.ok(ist > 30, `nur ${ist} stille Fänge in public/js — greift die Suche noch?`);
  assert.ok(ist <= LIMIT, `${ist} stille Fänge in public/js, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ stille Fänge der Oberfläche: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
}

/** The factory (createDb, dbConfigFromEnvironment) and types are no process access. */
const PROZESSZUGANG = new Set([
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
        .some(n => PROZESSZUGANG.has(n)),
  );
}

test('the compatibility path to the database and module-wide state become fewer, never more', () => {
  // db/database.ts has a factory (createDb); whoever still imports the functions of the
  // process access instead of being handed an access counts here.
  // Counter-checks: an `import * as db from '../../db/database'` in src/sets/rows.ts → red (09.11.2026);
  // `import { get as _probe } from '../../db/database'` in the same place → red with 1 (11.11.2026).
  // `import * as _probe from './database'` in db/txLock.ts → red with 1 (11.11.2026).
  const LIMIT = 0;
  const ist = quellen().filter(takesProcessAccess).length;
  // Self-proof: type imports from db/database do not count, but the search must still find them.
  const withTypes = quellen().filter(f =>
    /^import type \{[^}]*\} from '[./]+\/db\/database';/m.test(fs.readFileSync(f, 'utf8')),
  ).length;
  assert.ok(withTypes > 20, `nur ${withTypes} Typimporte aus db/database gefunden — greift die Suche noch?`);
  assert.ok(ist <= LIMIT, `${ist} Dateien nehmen den Prozesszugang aus db/database, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ Kompatibilitätsweg db/database: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);

  // Module-wide state (let and empty-created Map/Set/WeakMap/WeakSet): all accesses of a process
  // share it. An area keeps its own in compartments (src/infra/cache.ts),
  // deliberately process-wide state stands with a reason in src/infra/processWide.ts.
  // Counter-checks (13.11.2026): `const _probe = new Map<string, number>();` in src/catalog/context.ts
  // → red with 60; `let _probe = 0;` in the same place → red with 60. (14.11.2026) limit 2 (transaction guard,
  // savepoints in db/); `const sitzungen = new Map<string, Sitzung>();` back in
  // src/vouchers/balanceLookup.ts → red (3 of 2). Limit 1: the transaction guard
  // travels with the transaction in the call frame; left are the savepoints in db/.
  const STATE_LIMIT = 1;
  const ZUSTAND =
    /^(?:export )?(?:let |const \w+(?:: [^=\n]+)? = new (?:Map|Set|WeakMap|WeakSet)\b(?:<[^\n]*>)?\(\))/gm;
  const countState = s => (s.match(ZUSTAND) || []).length;
  // Self-proof: empty-created collections and let count, constants with content do not.
  assert.equal(
    countState(
      'let a = 0;\nconst b = new Map<string, number>();\nconst c: X = new WeakMap();\nconst d = new Set([1]);',
    ),
    3,
  );
  const zustand = quellen().reduce((n, f) => n + countState(fs.readFileSync(f, 'utf8')), 0);
  assert.ok(zustand > 0 && zustand <= STATE_LIMIT, `${zustand}-mal modulweiter Zustand, erlaubt sind ${STATE_LIMIT}`);
  if (zustand < STATE_LIMIT)
    console.log(`  ℹ modulweiter Zustand: ${zustand} (Schranke ${STATE_LIMIT}) — Schranke nachziehen`);
  routesAnDenContextsPast();
  bindingWithoutNamesAndProxy();
  konfigNurAmStart();
});

/** Paths around the contexts are forbidden (formerly a ratchet). */
function routesAnDenContextsPast() {
  // A service gets its dependencies via the context (src/<bereich>/kontext.ts);
  // a store of services in the process (getters xBereich(), facades from dienstePerAufruf)
  // no longer exists.
  // Counter-checks (14.11.2026): `export const sets = prozessStelle<SetsServices>('sets');` in
  // src/sets/read.ts → red (1 getter place); `import { readSets } from '../sets'` in
  // src/collection/deletion.ts (with `export const readSets = …` in src/sets/index.ts) → red (1 facade).
  const ohneKommentare = require('./helpers/sources').ohneKommentare;
  const src = path.join(WEB, 'src');
  const HOLER = /\b(?:prozessStelle|prozessDienste|dienstePerAufruf|verdrahteDienste)\b/;
  const holer = quellen().filter(f => HOLER.test(ohneKommentare(fs.readFileSync(f, 'utf8'))));
  assert.deepEqual(
    holer.map(f => path.relative(WEB, f)),
    [],
    'Dienste kommen über den Kontext oder als Parameter, nicht vom Prozess',
  );
  const factoryFile = b => ['bereich.ts', 'area.ts'].map(f => path.join(src, b, f)).find(p => fs.existsSync(p));
  const bereiche = fs.readdirSync(src).filter(b => factoryFile(b));
  assert.ok(bereiche.length >= 15, `nur ${bereiche.length} Bereiche gefunden — greift die Suche noch?`);
  // What an area binds as a service no index.ts may additionally export as a value.
  const dienste = new Map(
    bereiche.map(b => {
      const s = fs.readFileSync(factoryFile(b), 'utf8');
      const n = new Set();
      for (const m of s.matchAll(/^ {4,8}(\w+): /gm)) n.add(m[1]);
      return [b, n];
    }),
  );
  assert.ok(dienste.get('sets').has('readSets'), 'die Dienste der Bereiche werden nicht mehr gefunden');
  const facades = [];
  for (const f of quellen()) {
    const s = ohneKommentare(fs.readFileSync(f, 'utf8'));
    for (const m of s.matchAll(/^import \{([^}]*)\} from '([^']+)';/gm)) {
      const b = path.relative(src, path.resolve(path.dirname(f), m[2]));
      if (!dienste.has(b) || f.startsWith(path.join(src, b) + path.sep)) continue;
      for (const x of m[1].split(',').map(y => y.trim()))
        if (x && !x.startsWith('type ') && dienste.get(b).has(x.split(/\s+as\s+/)[0]))
          facades.push(`${path.relative(WEB, f)}: ${x}`);
    }
  }
  assert.deepEqual(facades, [], 'Dienste eines anderen Bereichs kommen über d oder den Kontext, nicht als Import');
}

/** The startup reads konfig(); domain areas, routes and jobs get the configuration handed in. */
function konfigNurAmStart() {
  // buildServices passes it as k.konfig, the startup as a parameter. Left are helpers of the process
  // (src/infra, src/http, db/) and the bcrypt pool built at load time; their number only sinks.
  // Counter-checks (14.11.2026): `const _k = konfig();` in src/sets/read.ts → red (domain area);
  // the same in src/http/csvResponse.ts → red (14 of 13).
  const LIMIT = 13;
  const EXCEPTION = ['src/account/bcryptLimit.ts'];
  const ohne = require('./helpers/sources').ohneKommentare;
  const rel = f => path.relative(WEB, f).split(path.sep).join('/');
  const lesend = quellen()
    .map(rel)
    .filter(r => !/^(startup\/|server\.ts$|src\/infra\/config\.ts$)/.test(r))
    .filter(r => /\bkonfig\(\)/.test(ohne(fs.readFileSync(path.join(WEB, r), 'utf8'))));
  assert.ok(lesend.length > 0, 'keine Leser von konfig() gefunden — greift die Suche noch?');
  const fach = lesend.filter(r => !/^(src\/infra|src\/http|db)\//.test(r) && !EXCEPTION.includes(r));
  assert.deepEqual(fach, [], 'Fachbereiche, Routen und Jobs nehmen k.konfig oder einen Parameter');
  assert.ok(lesend.length <= LIMIT, `${lesend.length} Dateien lesen konfig(), erlaubt sind ${LIMIT}`);
  if (lesend.length < LIMIT)
    console.log(`  ℹ konfig()-Leser: ${lesend.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
}

/** Areas bind without names and proxy; AsyncLocalStorage only in the call frame. */
function bindingWithoutNamesAndProxy() {
  // An area is a factory with a closure over k (src/infra/area.ts, mit()); the transaction
  // travels via `t` (tx.db), not via a proxy or a release in the call path.
  // Counter-checks (14.11.2026): `const _p = new Proxy({}, {});` in src/sets/read.ts → red (proxy);
  // `readSets: binde(sk, lesen, ['readSets', 'x'])` in src/sets/area.ts → red (name binding);
  // `new AsyncLocalStorage()` in db/transaction.ts → red (second channel).
  const ohne = require('./helpers/sources').ohneKommentare;
  const rel = f => path.relative(WEB, f).split(path.sep).join('/');
  const text = f => ohne(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(
    quellen()
      .filter(f => /\bnew Proxy\b/.test(text(f)))
      .map(rel),
    [],
    'kein Proxy im Server',
  );
  const NAMEN = /\bbinde\w*\(|\[\s*'\w+'(?:\s*,\s*'\w+')+\s*,?\s*\]/;
  assert.ok(NAMEN.test("bindeZugang(k, m, ['a', 'b'])") && NAMEN.test("x(k, ['a', 'b'])"), 'Selbstbeweis Namensliste');
  const factories = quellen().filter(f => /[\\/]src[\\/]\w+[\\/](bereich|kontext|area|context)\.ts$/.test(f));
  assert.ok(factories.length >= 30, `nur ${factories.length} Fabriken und Kontexte gefunden — greift die Suche noch?`);
  assert.deepEqual(factories.filter(f => NAMEN.test(text(f))).map(rel), [], 'Bindung über Namen statt mit()');
  assert.deepEqual(
    quellen()
      .filter(f => /\bAsyncLocalStorage\b/.test(text(f)))
      .map(rel),
    ['src/infra/accountContext.ts'],
    'Ein Kanal über den Aufrufpfad: der Aufrufrahmen (docs/architecture.md)',
  );
}

test('any becomes fewer, never more', () => {
  const LIMIT = 1;
  const ist = zaehle([/\bas any\b/g, /:\s*any\b/g]);
  assert.ok(
    ist <= LIMIT,
    `${ist}-mal \`any\`, erlaubt sind ${LIMIT}. Jedes davon schaltet den ` +
      'Typpruefer fuer diesen Ausdruck ab — in einem Baum, der sonst auf ' +
      'noImplicitAny mit leerer Ausnahmeliste steht.',
  );
  if (ist < LIMIT) {
    console.log(`  ℹ any: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
  }
});

test('any in all forms, unknown parameters and success in services become fewer, never more', () => {
  // Also Promise<any>, any[] and Record<string, any>: the narrow count above only saw
  // `as any` and `: any`.
  // Counter-check (05.11.2026): getSetting again `fallback?: any` without overloads → red.
  const LIMIT = 8;
  const ist = zaehle([/\bany\b/g]);
  assert.ok(ist <= LIMIT, `${ist}-mal any, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ any (alle Formen): ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);

  // The same kind of count: the route sets the envelope of the response, a service
  // delivers the domain object. Left are row statuses in import reports, mail sending and the import progress (a stream format).
  // Counter-check (11.11.2026): in auftragAbbrechen() again `success: true` → red.
  const SUCCESS_LIMIT = 7;
  const success = zaehle([/\bsuccess:\s*true\b/g], f =>
    /^src[\\/](?!contract[\\/]|http[\\/])/.test(path.relative(WEB, f)),
  );
  assert.ok(
    success <= SUCCESS_LIMIT,
    `${success}-mal success: true in src/ (ohne contract/, http/), erlaubt sind ${SUCCESS_LIMIT}`,
  );
  if (success < SUCCESS_LIMIT)
    console.log(`  ℹ success in Diensten: ${success} (Schranke ${SUCCESS_LIMIT}) — Schranke nachziehen`);
  // Routes return their result, the contract router (endpunkt) sets the envelope. Left are
  // streams, callbacks after logout and whole responses of the login.
  // Counter-check (14.11.2026): in routes/api_v1/sets.ts `return { set }` as `res.json({ success: true, set })` → red (11).
  const ROUTES_LIMIT = 10;
  const inRoutes = zaehle([/\bsuccess:\s*true\b/g], f => /^routes[\\/]/.test(path.relative(WEB, f)));
  assert.ok(
    inRoutes > 0 && inRoutes <= ROUTES_LIMIT,
    `${inRoutes}-mal success: true in routes/, erlaubt sind ${ROUTES_LIMIT}`,
  );
  if (inRoutes < ROUTES_LIMIT)
    console.log(`  ℹ success in Routen: ${inRoutes} (Schranke ${ROUTES_LIMIT}) — Schranke nachziehen`);
  // Routes pass req.eingabe/req.pfad through with the contract type, services take
  // domain types (Zustand, string). Exempt are the checkers for raw values
  // (src/contract, src/infra, src/http) and error parameters.
  // Counter-check (11.11.2026): `condition: unknown` back in deleteAlarmOfSets → red (75).
  const LIMIT_UNKNOWN = 63;
  const MUSTER = /(?<!catch\s*)[(,]\s*\.{0,3}(?!(?:e|err|error|fehler|grund)\b)\w+\??\s*:\s*unknown\s*(?=[,)=])/g;
  assert.equal(
    ('f(a: unknown, b?: unknown = 1)'.match(MUSTER) || []).length + ('catch (e: unknown)'.match(MUSTER) || []).length,
    2,
  );
  const ohneKommentare = require('./helpers/sources').ohneKommentare;
  const RAW = /[\\/]src[\\/](?:contract|infra|http)[\\/]/;
  const unbekannt = quellen()
    .filter(f => /[\\/]src[\\/]/.test(f) && !RAW.test(f))
    .reduce((n, f) => n + (ohneKommentare(fs.readFileSync(f, 'utf8')).match(MUSTER) || []).length, 0);
  assert.ok(unbekannt > 20, `nur ${unbekannt} unknown-Parameter gefunden — greift die Suche noch?`);
  assert.ok(
    unbekannt <= LIMIT_UNKNOWN,
    `${unbekannt} Parameter vom Typ unknown in Diensten, erlaubt sind ${LIMIT_UNKNOWN}`,
  );
  if (unbekannt < LIMIT_UNKNOWN)
    console.log(`  ℹ unknown-Parameter: ${unbekannt} (Schranke ${LIMIT_UNKNOWN}) — Schranke nachziehen`);
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
  const fach = (/** @type {string} */ f) =>
    /^(src[\\/](?!infra|http|vertrag)\w+|jobs)[\\/]/.test(path.relative(WEB, f));
  const ist = zaehle([CLOCK], fach);
  assert.ok(ist <= LIMIT, `${ist} direkte Uhr-Aufrufe in Fachbereichen und Jobs, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ Uhr-Aufrufe: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no test file checks REQUIRE_DB itself', () => {
  // The rule stands in test/helpers/db.js (dbOderSkip, keineDb,
  // missingPrecondition); an own version was copied 115 times.
  // Counter-check (11.11.2026): `if (process.env.REQUIRE_DB === '1') throw e;`
  // back in instruction-job-db.test.js → red.
  const eigene = fs
    .readdirSync(__dirname)
    .filter(n => n.endsWith('.js') && n !== path.basename(__filename))
    .filter(n => /process\.env\.REQUIRE_DB|REQUIRE_DB=1, aber/.test(fs.readFileSync(path.join(__dirname, n), 'utf8')));
  assert.deepEqual(eigene, [], 'test/helpers/db.js benutzen');
});

test('database rows are unknown without a type argument', () => {
  // Without a type argument a row was `any`, and type checking ended at the
  // database — exactly where numeric and bigint arrive as strings.
  // Counter-check (05.11.2026): `get<T = any>` in DbInterface → red.
  const quelle = ['database.ts', 'transaction.ts', 'types.ts']
    .map(n => fs.readFileSync(path.join(WEB, 'db', n), 'utf8'))
    .join('\n');
  assert.equal(
    (quelle.match(/\b(?:all|get)\s*(?::\s*)?<T = unknown>/g) || []).length,
    6,
    'all/get in Schnittstelle, Pool und Transaktion',
  );
  assert.doesNotMatch(quelle, /<T = any>|lastID/);
});

test('untyped database queries become fewer, never more', () => {
  // Allowed as long as nobody reads fields of the row — then the
  // compiler demands a type argument anyway.
  // Counter-check (05.11.2026): limit set to 68 → red. db/rows.ts binds row types to the schema.
  // (15.11.2026) in auftraege.ts writeProgress again `db.get(` without a type → red (4 of 3).
  const LIMIT = 3;
  const ist = zaehle([/\b(?:db|tx|dbh|d)\.(?:get|all)\(/g]);
  assert.ok(ist <= LIMIT, `${ist} ungetypte db.get/all, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ ungetypte Abfragen: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('raw req.body and req.query in routes become fewer, never more', () => {
  // A route reads req.eingabe and req.abfrage: checked and typed from the
  // contract. Left are the middleware before the check, the image proxy (without
  // contract) and routes/auth/registration.ts.
  // Counter-check (05.11.2026): a `req.body.storage` back in routes/api_v1/sets.ts → red.
  const LIMIT = 4;
  let ist = 0;
  for (const f of quellen().filter(f => /[\\/]routes[\\/]/.test(f)))
    ist += (
      require('./helpers/sources')
        .ohneKommentare(fs.readFileSync(f, 'utf8'))
        .match(/\breq\.(?:body|query)\b/g) || []
    ).length;
  assert.ok(ist <= LIMIT, `${ist}-mal req.body/req.query in routes/, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ req.body/req.query in Routen: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('write targets in routes become fewer, never more', () => {
  // schreibziel() checks in the household for whom is written; better the
  // service takes the wish itself.
  // Counter-check (05.11.2026): limit set to 16 → red.
  const LIMIT = 13;
  let ist = 0;
  for (const f of quellen().filter(f => /[\\/]routes[\\/]/.test(f)))
    ist += (
      require('./helpers/sources')
        .ohneKommentare(fs.readFileSync(f, 'utf8'))
        .match(/\bschreibziel\(/g) || []
    ).length;
  assert.ok(ist <= LIMIT, `${ist}-mal schreibziel() in routes/, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ schreibziel() in Routen: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

/**
 * Test files that only read source text and execute nothing. A regex on
 * the source text confirms that a line stands there — not that it works
 * (the signal error of 25.10. stood in the source text, only in the wrong
 * place). Structure checks may stay; new checks of behavior
 * belong in a test that runs the code.
 */
const READS_SOURCE = /readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare/;
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
  // Views notify each other via events.js; what several share is a building block (BAUSTEINE).
  // Counter-check (15.11.2026): `import { loadGallery } from './sammlung.js';` back in lagerorte.js
  // → red (51 instead of 50).
  const { KERN, BAUSTEINE } = require('../scripts/build-frontend');
  const LIMIT = 50;
  const JS = path.join(WEB, 'public', 'js');
  const layer = new Set([...KERN, ...BAUSTEINE]);
  const views = fs.readdirSync(JS).filter(n => isAppModule(n) && !layer.has(n));
  assert.ok(views.length > 30, `nur ${views.length} Ansichten — greift die Suche noch?`);
  const kanten = views.flatMap(n =>
    [...fs.readFileSync(path.join(JS, n), 'utf8').matchAll(/^\s*import\s[^;]*?from\s+'\.\/([\w-]+\.js)'/gms)]
      .map(m => m[1])
      .filter(z => views.includes(z))
      .map(z => `${n} → ${z}`),
  );
  assert.ok(kanten.length <= LIMIT, `${kanten.length} Importkanten zwischen Ansichten, erlaubt ${LIMIT}`);
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
  const LIMIT = 34;
  const alle = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js')).length;
  assert.ok(alle >= 300, `Nur ${alle} Testdateien gefunden — greift die Suche noch?`);
  const ist = pureSourceTextTests();
  assert.ok(
    ist.length <= LIMIT,
    `${ist.length} Testdateien lesen nur Quelltext, erlaubt sind ${LIMIT}. ` +
      'Prüft der neue Test Verhalten, soll er den Code ausführen (buildAndRequire, ' +
      'testServer) statt per Regex nachzusehen, ob eine Zeile dasteht.',
  );
  if (ist.length < LIMIT) {
    console.log(`  ℹ reine Quelltext-Tests: ${ist.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
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
const FALL_READS = /readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare/;
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
  const raus = new Map();
  const d = path.join(__dirname, 'helpers');
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.js')))
    raus.set(f.replace(/\.js$/, ''), FALL_LEADS_FROM.test(fs.readFileSync(path.join(d, f), 'utf8')));
  raus.set('sources', false);
  return raus;
}

/** Top-level statements: each up to the next line in column 0 that does not close a bracket. */
function instructions(/** @type {string} */ s) {
  const z = s.split('\n');
  const raus = [];
  const weiter = (/** @type {string} */ x) => !x || /^[\s})\]]/.test(x);
  for (let i = 0; i < z.length; ) {
    if (weiter(z[i])) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < z.length && weiter(z[j])) j++;
    raus.push(z.slice(i, j).join('\n'));
    i = j;
  }
  return raus;
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

/** @returns {{ n: number, alle: number, faelle: string[] }} cases that read and execute nothing */
function sourceTextCasesIn(/** @type {string} */ roh, /** @type {Map<string, boolean>} */ helper) {
  const s = require('./helpers/sources').ohneKommentare(roh);
  const fuehrt = new Set(),
    liest = new Set();
  /** @type {{ namen: string[], text: string }[]} */
  const dekl = [];
  for (const a of instructions(s)) {
    const namen = declaredNames(a);
    if (!namen.length) continue;
    const variable = /^(?:const|let|var)/.test(a);
    const text = variable ? a.slice(a.indexOf('=') + 1) : a;
    const help = a.match(HELP);
    if (help && variable && !FALL_LEADS_FROM.test(text)) {
      for (const n of namen)
        if (help[1] === 'sources' ? SOURCES_LEADS_FROM.has(n) : helper.get(help[1])) fuehrt.add(n);
        else if (help[1] === 'sources') liest.add(n);
      continue;
    }
    dekl.push({ namen, text });
  }
  const nennt = (/** @type {string} */ t, /** @type {Set<string>} */ m) =>
    [...m].some(n => new RegExp(`\\b${n}\\b`).test(t));
  for (let neu = true; neu; ) {
    neu = false;
    for (const { namen, text } of dekl)
      for (const n of namen) {
        if (!fuehrt.has(n) && (FALL_LEADS_FROM.test(text) || nennt(text, fuehrt))) neu = !!fuehrt.add(n);
        if (!liest.has(n) && (FALL_READS.test(text) || nennt(text, liest))) neu = !!liest.add(n);
      }
  }
  const z = s.split('\n');
  let n = 0,
    alle = 0;
  const faelle = [];
  for (let i = 0; i < z.length; i++) {
    const kopf = z[i].match(/^(\s{0,4})(?:test|it)\(\s*['"`]/);
    if (!kopf) continue;
    let j = i + 1;
    for (; j < z.length; j++) {
      const t = z[j].trimStart();
      if (t && z[j].length - t.length <= kopf[1].length && !/^[})\]]/.test(t)) break;
    }
    const fall = z.slice(i, j).join('\n');
    alle++;
    const helpers = [...fall.matchAll(new RegExp(HELP.source, 'g'))].map(m => m[1]);
    const ausf = FALL_LEADS_FROM.test(fall) || nennt(fall, fuehrt) || helpers.some(h => helper.get(h));
    if (!ausf && (FALL_READS.test(fall) || nennt(fall, liest))) {
      n++;
      faelle.push(z[i].trim());
    }
  }
  return { n, alle, faelle };
}

function sourceTextCases() {
  const helper = executingHelper();
  let n = 0,
    alle = 0;
  for (const name of fs.readdirSync(__dirname).filter(x => x.endsWith('.test.js'))) {
    const r = sourceTextCasesIn(fs.readFileSync(path.join(__dirname, name), 'utf8'), helper);
    n += r.n;
    alle += r.alle;
  }
  return { n, alle };
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
    'function starte() {',
    '  return testServer();',
    '}',
    "test('liest nur', async () => {",
    "  const t = await fs.promises.readFile('y', 'utf8');",
    '  assert.match(SRC + t, /x/);',
    '});',
    "test('liest über Helfer', () => {",
    '  assert.match(serverOnly(), /x/);',
    '});',
    "test('führt über eine Funktion der Datei aus', async () => {",
    '  await starte();',
    '  assert.match(SRC, /x/);',
    '});',
    "test('führt das gebaute Modul aus', () => {",
    '  assert.equal(modul.f(SRC), 1);',
    '});',
  ].join('\n');
  const helper = new Map([
    ['server', true],
    ['sources', false],
  ]);
  assert.deepEqual(
    sourceTextCasesIn(probe, helper).faelle,
    ["test('liest nur', async () => {", "test('liest über Helfer', () => {"],
    'Selbstbeweis: ein blosses await führt nichts aus, eine Funktion der Datei und ein gebautes Modul schon',
  );
  const LIMIT = 382;
  const { n, alle } = sourceTextCases();
  assert.ok(alle > 1500, `nur ${alle} Testfälle gefunden — greift die Suche noch?`);
  assert.ok(
    n <= LIMIT,
    `${n} Testfälle lesen nur Quelltext, erlaubt sind ${LIMIT}. ` +
      'Verhalten gehört in einen Test, der den Code ausführt (jsdom, buildAndRequire, testServer).',
  );
  if (n < LIMIT) console.log(`  ℹ Quelltext-Testfälle: ${n} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

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
  'biegen Module um': { muster: /\.prototype\.require\s*=|\._load\s*=/, limit: 11 },
  'nehmen routerServer statt testServer': { muster: /\brouterServer\(/, limit: 13 },
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
  assert.ok(!USES_FACADE.test("const { createDb } = _req('db/database.js');"), 'Exporte bleiben erlaubt');
  assert.ok(FALLBACKS['biegen Module um'].muster.test('Module.prototype.require = function () {}'));
  const q = require('./helpers/sources');
  const tests = fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js') && n !== 'ratschen.test.js');
  const helper = fs.readdirSync(path.join(__dirname, 'helpers')).map(n => path.join('helpers', n));
  assert.ok(tests.length > 500, `nur ${tests.length} Testdateien — greift die Suche noch?`);
  const lies = (/** @type {string} */ n) => q.ohneKommentare(fs.readFileSync(path.join(__dirname, n), 'utf8'));
  assert.deepEqual(
    [...tests, ...helper].filter(n => USES_FACADE.test(lies(n))),
    [],
    'Testdaten über testData(), Code unter Test über testAccess()',
  );
  // The helpers too: a bending in test/helpers/ would hit every file that loads it.
  for (const [was, { muster, limit }] of Object.entries(FALLBACKS)) {
    const ist = [...tests, ...helper].filter(n => muster.test(lies(n))).length;
    assert.ok(ist > 0, `keine Datei ${was} — greift das Muster noch? Dann Schranke und Eintrag entfernen`);
    assert.ok(ist <= limit, `${ist} Testdateien ${was}, erlaubt sind ${limit}`);
    if (ist < limit) console.log(`  ℹ ${ist} Testdateien ${was} (Schranke ${limit}) — Schranke nachziehen`);
  }
});

/**
 * Web tests read no Android source text: what the app needs from the server stands in
 * shared/app-schnittstelle.json (generated from its source text and checked in the Android run);
 * what only concerns the app is checked by the Android suite. The helpers are counted too.
 */
const READS_ANDROID = /require\(['"]\.\/helpers\/android['"]\)|['"`]Android-App['"`/]|\.kt['"`]/;

test('web tests do not read Android source code', () => {
  // Counter-check: `const k = 'x.kt';` in a11y.test.js → red (names a11y.test.js); the same in
  // test/helpers/contract.js → red (names helpers/contract.js).
  const LIMIT = 0;
  for (const probe of ["path.join(ROOT, '..', 'Android-App', 'x')", "'Theme.kt'", "require('./helpers/android')"])
    assert.ok(READS_ANDROID.test(probe), `das Muster greift nicht mehr: ${probe}`);
  const dateien = [
    ...fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js') && n !== 'ratschen.test.js'),
    ...fs.readdirSync(path.join(__dirname, 'helpers')).map(n => path.join('helpers', n)),
  ];
  assert.ok(dateien.length > 500, `nur ${dateien.length} Dateien — greift die Suche noch?`);
  const lesend = dateien.filter(n => READS_ANDROID.test(fs.readFileSync(path.join(__dirname, n), 'utf8')));
  assert.ok(
    lesend.length <= LIMIT,
    `${lesend.length} Web-Testdateien lesen Android-Quellen, erlaubt sind ${LIMIT}: ${lesend.join(', ')}. ` +
      'Den Server gegen shared/app-schnittstelle.json prüfen; was nur die App betrifft, gehört in die Android-Suite.',
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
    .kompakt(q.ohneKommentare(text))
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, m => m[0] + '_'.repeat(m.length - 2) + m[0]);
  /** Opening bracket for the closing one at `zu`. */
  const auf = (/** @type {number} */ zu) => {
    for (let j = zu, t = 0; j >= 0; j--)
      if (s[j] === ')') t++;
      else if (s[j] === '(' && --t === 0) return j;
    return 0;
  };
  const schleifenkopf = (/** @type {string} */ vor) =>
    vor.endsWith(')') && /\b(for|while)\s*$/.test(s.slice(0, auf(vor.length - 1)));
  /** Does `i` stand in a bracket, a loop body or behind a loop head? */
  const inLoop = (/** @type {number} */ i) => {
    if (schleifenkopf(s.slice(0, i).trimEnd())) return true;
    for (let j = i - 1, tiefe = 0; j >= 0; j--) {
      const c = s[j];
      if (c === ')' || c === ']' || c === '}') tiefe++;
      else if (c === '(' || c === '[') {
        if (!tiefe) return true;
        tiefe--;
      } else if (c === '{') {
        if (tiefe) {
          tiefe--;
          continue;
        }
        const vor = s.slice(0, j).trimEnd();
        if (/\bdo$/.test(vor) || schleifenkopf(vor)) return true;
        if (/=>$/.test(vor) || /\bfunction\b[^;{}]*\)$/.test(vor)) return false;
      }
    }
    return false;
  };
  let n = 0;
  for (const m of s.matchAll(
    /await (?:(?:warte|takt)\(\d{3,}\)|new Promise\(\(?(r|resolve)\)? => setTimeout\(\1, \d{3,}\)\))/g,
  )) {
    const vor = s.slice(0, m.index).trimEnd();
    if ((!vor || /[;{}):]$|\belse$/.test(vor)) && !inLoop(m.index)) n++;
  }
  return n;
}

test('fixed waits in tests become fewer, never more', () => {
  // A fixed pause is too short under load and too long otherwise; waiting is done for
  // a condition (helpers/time.js bis(), ruhig()). Left are pauses that show
  // that something does NOT happen, or that the code under test demands.
  // Counter-check (05.11.2026): `await warte(500);` in history-browser.test.js → red.
  const LIMIT = 40;
  assert.equal(
    fixedWaitTimes(
      'for (;;) await warte(250);\nwhile (x) {\n  await y();\n  await warte(300);\n}\n' +
        "const geh = async () => {\n  await b('{(');\n  await warte(800);\n};\nawait warte(50);\n" +
        'await new Promise(r =>\n  setTimeout(r, 1500),\n);',
    ),
    2,
    'Selbstbeweis: die Pause nach einer Anweisung und die umbrochene zählen, Schleifen und kurze nicht',
  );
  const OWN = /^\s*const (warte|takt|sleep|schlafe)\s*=/;
  let ist = 0;
  const eigene = [];
  for (const n of fs.readdirSync(__dirname).filter(x => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(__dirname, n), 'utf8');
    ist += fixedWaitTimes(text);
    if (text.split('\n').some(z => OWN.test(z))) eigene.push(n);
  }
  assert.deepEqual(eigene, [], 'eigene Warte-Helfer: test/helpers/time.js benutzen');
  assert.ok(ist <= LIMIT, `${ist} feste Wartezeiten ab 100 ms, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ feste Wartezeiten: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

/**
 * Inline styles in index.html. A data-stil="…" (styles.js sets it as an
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
  const stile = [...html.matchAll(/<[a-zA-Z][^>]*?\sdata-stil="([^"]*)"/g)].map(m => m[1].trim().replace(/;$/, ''));
  assert.ok(stile.length > 50, 'Keine Inline-Stile gefunden — greift die Suche noch?');
  const ist = stile.filter(s => s !== 'display:none').length;
  assert.ok(
    ist <= LIMIT,
    `${ist} Inline-Stile (ohne display:none) in index.html, erlaubt sind ${LIMIT}. ` +
      'Gestaltung gehört in styles.css; dort sieht sie jedes Design und mobile.css.',
  );
  if (ist < LIMIT) console.log(`  ℹ Inline-Stile: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no reference to “Nachtrag N” under Web-App/', () => {
  // The history of a place stands in the commit (CLAUDE.md); a number in a
  // comment refers to a list that does not exist in the tree. Exempt:
  // docs/, CHANGELOG* and db/ (applied migrations must not change).
  // Counter-checks: an addendum number in src/account/deviceToken.ts → red; the same in
  // test/tab-layout.test.js and in public/index.html → red (05.11.2026).
  const RAUS = new Set(['node_modules', 'dist', 'coverage', 'data', 'docs', 'CHANGELOG', 'db', '.git']);
  const treffer = [];
  let dateien = 0;
  (function lauf(d) {
    for (const n of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, n.name);
      if (n.isDirectory()) {
        if (!RAUS.has(n.name)) lauf(p);
        continue;
      }
      if (
        n.name.startsWith('CHANGELOG') ||
        !/\.(ts|js|html|css|sh|md|ya?ml|json|sql)$|^\.gitignore$|^Dockerfile$|^Caddyfile$/.test(n.name)
      )
        continue;
      if (n.name === 'app.bundle.js') continue;
      dateien++;
      for (const m of fs.readFileSync(p, 'utf8').match(/Nachtr(?:ag|äge|aege) \d+/g) || [])
        treffer.push(`${path.relative(WEB, p)}: ${m}`);
    }
  })(WEB);
  assert.ok(dateien > 800, `nur ${dateien} Dateien durchsucht — greift die Suche noch?`);
  assert.deepEqual(treffer, []);
});

test('no module is imported twice in one file', () => {
  // One value import per module and at most one `import type`; nine lines for
  // nine names from the same file hide what is really needed.
  // Counter-check (05.11.2026): `import { fehlertext } from '../infra/fehler';`
  // additionally in src/finances/priceAlert.ts → red.
  const treffer = [];
  for (const f of quellen()) {
    const gesehen = new Set();
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^import\s+(type\s+)?[^;]*?from\s*'([^']+)';/gm)) {
      const k = `${m[1] ? 'type ' : ''}${m[2]}`;
      if (gesehen.has(k)) treffer.push(`${path.relative(WEB, f)}: ${k}`);
      gesehen.add(k);
    }
  }
  assert.deepEqual(treffer, []);
});

test('the comment share in the server sinks, never rises', () => {
  // Counted in server.ts, routes/, src/ and jobs/, in Biome format.
  const LIMIT = 9.8;
  let zeilen = 0,
    comment = 0;
  for (const f of quellen().filter(f => /[\\/](routes|src|jobs)[\\/]/.test(f) || /[\\/]server\.ts$/.test(f))) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) comment++;
    }
  }
  assert.ok(zeilen > 10000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round((1000 * comment) / zeilen) / 10;
  assert.ok(anteil <= LIMIT, `${anteil} % Kommentarzeilen, erlaubt sind ${LIMIT} %`);
  if (anteil < LIMIT - 0.5) console.log(`  ℹ Kommentaranteil: ${anteil} % (Schranke ${LIMIT}) — Schranke nachziehen`);
});

/** Sources of the UI: public/js without bundle, plus i18n.js. */
function oberflaeche() {
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
const TYPZEILE = /^(\/\*\*\s*)?\*?\s*@(param|type|returns?|typedef|template|this|property)\b|^\/\*\*$|^\*\/$|^\*$/;

test('the comment share of the UI sinks, never rises', () => {
  // Counted without type lines, in Biome format.
  // Counter-check: 300 comment lines appended to dom.js → red.
  const LIMIT = 14.2;
  let zeilen = 0,
    comment = 0;
  for (const f of oberflaeche()) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t || TYPZEILE.test(t)) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) comment++;
    }
  }
  assert.ok(zeilen > 8000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round((1000 * comment) / zeilen) / 10;
  assert.ok(anteil <= LIMIT, `${anteil} % Kommentarzeilen in der Oberfläche, erlaubt sind ${LIMIT} %`);
  if (anteil < LIMIT - 0.5)
    console.log(`  ℹ Kommentaranteil Oberfläche: ${anteil} % (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('any in the UI type annotations becomes fewer, never more', () => {
  // noImplicitAny only forbids the silent any; a written-out one switches off
  // the check for this value just the same. Since the cleanup none stands there any more.
  // Counter-check: `/** @type {any} */ let x;` appended to api.js → red with 1.
  const LIMIT = 0;
  let ist = 0;
  for (const f of oberflaeche())
    for (const z of fs.readFileSync(f, 'utf8').split('\n'))
      if (z.includes('@') && (z.includes('/**') || z.trim().startsWith('*'))) ist += (z.match(/\bany\b/g) || []).length;
  assert.ok(ist <= LIMIT, `${ist}-mal any in Typangaben der Oberfläche, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ any in der Oberfläche: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no UI comment has more than five lines of prose', () => {
  // CLAUDE.md: a comment says why in two to five lines. JSDoc tags
  // (@param, @returns …) do not count.
  // Counter-check: a // block with six lines in dom.js → red with location.
  const lang = [];
  let bloecke = 0;
  for (const f of oberflaeche()) {
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
        const innen = [t.replace(/^\/\*\*?/, ''), ...z.slice(i + 1, j).map(l => l.trim().replace(/^\* ?/, ''))];
        const k = innen.findIndex(l => l.trim().startsWith('@'));
        prose = k < 0 ? innen : innen.slice(0, k);
      }
      if (!prose) continue;
      bloecke++;
      if (prose.filter(l => l.trim()).length > 5) lang.push(`${path.relative(WEB, f)}:${i + 1}`);
      i = j;
    }
  }
  assert.ok(bloecke > 300, `nur ${bloecke} Kommentarblöcke gefunden — greift die Suche noch?`);
  assert.deepEqual(lang, [], 'Lange Begründung: Warum in den Code (höchstens fünf Zeilen), Geschichte in den Commit');
});

/** Functions with their length (declaration up to the closing bracket of the same indentation). */
function functionLengths(dateien = oberflaeche()) {
  const raus = [];
  for (const f of dateien) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    z.forEach((l, i) => {
      const m = l.match(/^(\s*)(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[<(]/);
      if (!m || /\}\s*;?\s*$/.test(l)) return;
      const ende = z.findIndex((x, j) => j > i && x.startsWith(m[1] + '}'));
      if (ende > i) raus.push({ ort: `${path.relative(WEB, f)}:${i + 1} ${m[2]}`, zeilen: ende - i + 1 });
    });
  }
  return raus;
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
  const alle = functionLengths();
  assert.ok(alle.length > 500, `nur ${alle.length} Funktionen gefunden — greift die Suche noch?`);
  const ueber100 = alle.filter(x => x.zeilen > 100).map(x => x.ort.replace(/:\d+ /, ' '));
  assert.deepEqual(
    ueber100.filter(x => !KNOWN_100.includes(x)),
    [],
    'Eine Funktion über 100 Zeilen: in benannte Teile zerlegen',
  );
  if (ueber100.length < KNOWN_100.length)
    console.log(`  ℹ Funktionen über 100 Zeilen: ${ueber100.join(', ')} — KNOWN_100 nachziehen`);
  const ueber80 = alle.filter(x => x.zeilen > 80);
  assert.ok(
    ueber80.length <= LIMIT_80,
    `${ueber80.length} Funktionen über 80 Zeilen, erlaubt sind ${LIMIT_80}:\n${ueber80.map(x => x.ort).join('\n')}`,
  );
  if (ueber80.length < LIMIT_80)
    console.log(`  ℹ Funktionen über 80 Zeilen: ${ueber80.length} (Schranke ${LIMIT_80}) — Schranke nachziehen`);
});

/** Code lines of the UI modules (public/js/NN-*.js) without comment lines, with location. */
function uisCode() {
  const js = path.join(WEB, 'public', 'js');
  const raus = [];
  for (const f of fs.readdirSync(js).filter(n => isAppModule(n)))
    fs.readFileSync(path.join(js, f), 'utf8')
      .split('\n')
      .forEach((z, i) => {
        const t = z.trim();
        if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) raus.push({ ort: `${f}:${i + 1}`, z });
      });
  return raus;
}

test('markup only gets into the page via setzeHtml()/fuegeHtmlEin()', () => {
  // Only the two helpers in dom.js write markup; the log window (monitor.js) builds its own
  // document via document.write. Counter-check: in sammlung.js `grid.innerHTML = ''` → red with location.
  const ALLOWED = ['dom.js', 'dom.js', 'monitor.js'];
  const roh = uisCode().filter(x =>
    /\.(innerHTML|outerHTML)\s*\+?=(?!=)|insertAdjacentHTML\(|document\.write\(/.test(x.z),
  );
  assert.deepEqual(
    roh.map(x => x.ort.split(':')[0]).sort(),
    ALLOWED,
    `Markup an setzeHtml() vorbei:\n${roh.map(x => x.ort).join('\n')}`,
  );
});

/** The arguments of all rawHtml() calls in `text`, up to the closing bracket. */
function rawHtmlArguments(/** @type {string} */ text) {
  const raus = [];
  for (const m of text.matchAll(/(?<![\w.])(?<!function )rawHtml\(/g)) {
    const ab = (m.index ?? 0) + m[0].length;
    let i = ab;
    for (let tiefe = 0; i < text.length; i++)
      if (text[i] === '(') tiefe++;
      else if (text[i] === ')' && tiefe-- === 0) break;
    raus.push(text.slice(ab, i));
  }
  return raus;
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
  const argumente = fs
    .readdirSync(js)
    .filter(n => isAppModule(n))
    .flatMap(f =>
      rawHtmlArguments(require('./helpers/sources').ohneKommentare(fs.readFileSync(path.join(js, f), 'utf8'))).map(
        a => ({ f, a }),
      ),
    );
  const ist = argumente.length;
  assert.ok(ist > 0, 'kein rawHtml() gefunden — greift die Suche noch?');
  const vorlage = argumente.filter(x => /^\s*`[^`]*\$\{/.test(x.a));
  assert.deepEqual(
    vorlage.map(x => `${x.f}: ${x.a.slice(0, 60)}`),
    [],
    'rawHtml() mit Template und ${…}: html`` nehmen',
  );
  const verbunden = argumente.filter(x => /\.join\(/.test(x.a));
  assert.deepEqual(
    verbunden.map(x => `${x.f}: ${x.a.slice(0, 60)}`),
    [],
    'rawHtml(… .join()): joinHtml() nehmen',
  );
  assert.ok(ist <= LIMIT, `${ist}-mal rawHtml(), erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ rawHtml(): ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no UI file over 1000 lines, the big ones become smaller', () => {
  // A collective file attracts new things because they already lie there (Biome format).
  // Counter-check (09.11.2026): blank lines appended to finanzen.js → red.
  const LIMIT_LARGEST = 771,
    LIMIT_VIA_600 = 11;
  const lengths = oberflaeche().map(f => ({
    f: path.relative(WEB, f),
    n: fs.readFileSync(f, 'utf8').split('\n').length,
  }));
  assert.ok(lengths.length > 40, `nur ${lengths.length} Dateien gefunden — greift die Suche noch?`);
  const ueber1000 = lengths.filter(x => x.n > 1000).map(x => `${x.f} (${x.n})`);
  assert.deepEqual(ueber1000, [], 'Eine Datei über 1000 Zeilen: nach Themen teilen');
  const largest = Math.max(...lengths.map(x => x.n));
  const ueber600 = lengths.filter(x => x.n > 600).length;
  assert.ok(largest <= LIMIT_LARGEST, `grösste Datei ${largest} Zeilen, erlaubt sind ${LIMIT_LARGEST}`);
  assert.ok(ueber600 <= LIMIT_VIA_600, `${ueber600} Dateien über 600 Zeilen, erlaubt sind ${LIMIT_VIA_600}`);
  if (largest < LIMIT_LARGEST || ueber600 < LIMIT_VIA_600)
    console.log(`  ℹ Dateigrösse Oberfläche: grösste ${largest}, über 600: ${ueber600} — Schranke nachziehen`);
});

/** Top-level functions including arrow functions on const; it ends before the next line
 * without indentation (a closing bracket still belongs to it). */
function topLevelLengths(/** @type {string[]} */ dateien) {
  const raus = [];
  for (const f of dateien) {
    const z = fs.readFileSync(f, 'utf8').split('\n');
    z.forEach((l, i) => {
      let name = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[<(]/.exec(l)?.[1];
      if (!name) {
        const m = /^(?:export\s+)?const\s+(\w+)\b/.exec(l);
        if (!m?.[1]) return;
        const kopf = z.slice(i, i + 15).join('\n');
        const rest = kopf.slice(kopf.indexOf('=', kopf.indexOf(m[1])) + 1);
        if (!/^\s*(async\s+)?(\(|\w+\s*=>|<|function\b)/.test(rest)) return;
        name = m[1];
      }
      let j = i + 1;
      while (j < z.length && !/^\S/.test(z[j] ?? '')) j++;
      let ende = j < z.length && /^[})\]]/.test(z[j] ?? '') ? j : j - 1;
      while (ende > i && !z[ende]?.trim()) ende--;
      raus.push({ ort: `${path.relative(WEB, f)} ${name}`, zeilen: ende - i + 1 });
    });
  }
  return raus;
}

test('server functions over 80/150 lines become fewer, never more', () => {
  // From 100 lines on top-level functions including arrow functions count; none is known.
  // Counter-checks: buildPdf in src/catalog/pdf/pdfDrawing.ts in one piece again → red „ab 100“ (13.11.2026);
  // createDb in db/database.ts again as one closure → red „ab 100“ and „über 150“ (14.11.2026).
  const LIMIT_80 = 17,
    LIMIT_150 = 0,
    KNOWN_100 = [];
  const dateien = quellen().filter(
    f => /[\\/](src|routes|jobs|db|clients|startup)[\\/]/.test(f) || /[\\/]server\.ts$/.test(f),
  );
  // A router factory (baueXRouter) is the list of its routes like the module body used to be;
  // its handlers keep counting individually.
  const noFactory = x => !/ build\w*Router$/.test(x.ort);
  const oben = topLevelLengths(dateien).filter(noFactory);
  assert.ok(oben.length > 1500, `nur ${oben.length} Top-Level-Funktionen gefunden — greift die Suche noch?`);
  const ab100 = oben.filter(x => x.zeilen >= 100).map(x => x.ort);
  assert.deepEqual(
    ab100.filter(x => !KNOWN_100.includes(x)),
    [],
    'ab 100 Zeilen: in benannte Teile zerlegen',
  );
  if (ab100.length < KNOWN_100.length) console.log(`  ℹ ab 100 Zeilen: ${ab100.join(', ')} — KNOWN_100 nachziehen`);
  const alle = functionLengths(dateien).filter(noFactory);
  assert.ok(alle.length > 1000, `nur ${alle.length} Funktionen gefunden — greift die Suche noch?`);
  const ueber = n => alle.filter(x => x.zeilen > n);
  assert.ok(
    ueber(150).length <= LIMIT_150,
    `über 150 Zeilen:\n${ueber(150)
      .map(x => x.ort)
      .join('\n')}`,
  );
  assert.ok(ueber(80).length <= LIMIT_80, `${ueber(80).length} über 80 Zeilen, erlaubt sind ${LIMIT_80}`);
  if (ueber(80).length < LIMIT_80)
    console.log(`  ℹ Server-Funktionen über 80 Zeilen: ${ueber(80).length} — Schranke nachziehen`);
});

test('the comment share in db/, clients/ and scripts/ sinks, never rises', () => {
  // One limit per folder, in Biome format.
  // Counter-check: 40 comment lines appended to clients/ecb.ts → red (clients).
  const LIMIT = { db: 15.1, clients: 12.3, scripts: 19.2 };
  const toMuch = [];
  for (const [ordner, limit] of Object.entries(LIMIT)) {
    let zeilen = 0,
      comment = 0;
    (function lauf(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const n = e.name;
        const p = path.join(d, n);
        if (e.isDirectory()) {
          if (n !== 'node_modules') lauf(p);
          continue;
        }
        if (!/\.(ts|js|sh)$/.test(n) || (n.endsWith('.js') && fs.existsSync(p.slice(0, -3) + '.ts'))) continue;
        for (const z of fs.readFileSync(p, 'utf8').split('\n')) {
          const t = z.trim();
          if (!t) continue;
          zeilen++;
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || (n.endsWith('.sh') && t.startsWith('#')))
            comment++;
        }
      }
    })(path.join(WEB, ordner));
    assert.ok(zeilen > 500, `${ordner}: nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
    const anteil = Math.round((1000 * comment) / zeilen) / 10;
    if (anteil > limit) toMuch.push(`${ordner}: ${anteil} % (erlaubt ${limit} %)`);
    else if (anteil < limit - 0.5)
      console.log(`  ℹ Kommentaranteil ${ordner}: ${anteil} % (Schranke ${limit}) — Schranke nachziehen`);
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

  const MARKE =
    /(Nachtr(ag|äge) [0-9]|Hier stand|Vorher stand|NACHGEMESSEN|kam(en)? am [0-9]|Gemessen\b[^.]*\bam [0-9]|Marcos (Frage|Wunsch|Bericht|Rückfrage|Konsole)|Addendum [0-9]|Measured\b[^.]*\bon [0-9]|Marco's (question|request|report|console))/;
  const dateien = [
    ...fs
      .readdirSync(__dirname)
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(__dirname, n)),
    ...fs
      .readdirSync(path.join(__dirname, 'helpers'))
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(__dirname, 'helpers', n)),
  ];
  let ist = 0;
  for (const f of dateien)
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if ((t.startsWith('//') || t.startsWith('*')) && MARKE.test(t)) ist++;
    }
  // Self-proof without a real occurrence: the limit has reached 0.
  assert.ok(MARKE.test('* Gemessen am 7.11.') && MARKE.test('// Measured on 7.11.'), 'greift die Suche noch?');
  assert.ok(ist <= LIMIT, `${ist} Kommentarzeilen mit Geschichte in den Tests, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ Geschichte in Testkommentaren: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('the comment share of the tests sinks, never rises', () => {
  // Own limit: test headers list their counter-checks (CLAUDE.md), the
  // share therefore lies higher than in the server. History belongs in the
  // commit here too. Counted in test/*.js and test/helpers/, in Biome format.
  // Counter-check: 300 comment lines appended to a test file → red.
  const LIMIT = 17;
  const dateien = [
    ...fs
      .readdirSync(__dirname)
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(__dirname, n)),
    ...fs
      .readdirSync(path.join(__dirname, 'helpers'))
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(__dirname, 'helpers', n)),
  ];
  let zeilen = 0,
    comment = 0;
  for (const f of dateien) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) comment++;
    }
  }
  assert.ok(zeilen > 20000, `nur ${zeilen} Zeilen gefunden — greift die Suche noch?`);
  const anteil = Math.round((1000 * comment) / zeilen) / 10;
  assert.ok(anteil <= LIMIT, `${anteil} % Kommentarzeilen in den Tests, erlaubt sind ${LIMIT} %`);
  if (anteil < LIMIT - 0.5)
    console.log(`  ℹ Kommentaranteil Tests: ${anteil} % (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('no reference to the former rationale archive', () => {
  // Long rationales do not stand in the tree (CLAUDE.md); the archive is reachable via git. Ratchet 0:
  // a reference to it pointed into nothing. The script finds the same references that it removes.
  // Counter-check (10.11.2026): `// Ausführlich: docs/…/x.md#a` (full path) in src/infra/appPaths.ts → red
  // with „src/infra/appPaths.ts“; the folder docs/begruendungen/ created again → red.
  assert.equal(
    fs.existsSync(path.join(WEB, 'docs', 'begruendungen')),
    false,
    'docs/begruendungen/ gehört nicht in den Baum',
  );
  const r = require('node:child_process').spawnSync(
    process.execPath,
    [path.join(WEB, 'scripts', 'remove-rationales.js'), '--pruefen'],
    { encoding: 'utf8' },
  );
  assert.equal(
    r.status,
    0,
    `Verweise ins frühere Archiv — \`node scripts/remove-rationales.js\` entfernt sie:\n${r.stdout}${r.stderr}`,
  );
});

test('the comment share of the operations files sinks, never rises', () => {
  // Workflows, Dockerfile, compose.yaml, tsconfig.json: there too the why stands
  // in few lines, the history in the commit (CLAUDE.md). The Caddyfile does not count:
  // no block in it is longer than five lines.
  // Counter-check (04.11.2026): 60 comment lines appended to the Dockerfile → red.
  const LIMIT = 20.4;
  const wf = path.join(WEB, '..', '.github', 'workflows');
  const dateien = [
    ...fs
      .readdirSync(wf)
      .filter(f => /\.ya?ml$/.test(f))
      .map(f => path.join(wf, f)),
    ...['Dockerfile', 'compose.yaml', 'tsconfig.json'].map(f => path.join(WEB, f)),
  ];
  let zeilen = 0,
    comment = 0;
  for (const f of dateien) {
    for (const z of fs.readFileSync(f, 'utf8').split('\n')) {
      const t = z.trim();
      if (!t) continue;
      zeilen++;
      if (t.startsWith('#') || t.startsWith('//')) comment++;
    }
  }
  assert.ok(
    dateien.length >= 6 && zeilen > 1000,
    `nur ${dateien.length} Dateien, ${zeilen} Zeilen — greift die Suche noch?`,
  );
  const anteil = Math.round((1000 * comment) / zeilen) / 10;
  assert.ok(anteil <= LIMIT, `${anteil} % Kommentarzeilen in den Betriebsdateien, erlaubt sind ${LIMIT} %`);
  if (anteil < LIMIT - 0.5)
    console.log(`  ℹ Kommentaranteil Betrieb: ${anteil} % (Schranke ${LIMIT}) — Schranke nachziehen`);
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
      let innen = z.slice(i, j + 1);
      const tag = innen.findIndex(l => /^\s*\*\s*@/.test(l));
      if (tag > 0) innen = innen.slice(0, tag);
      prose = innen.filter(l => !/^\s*(\/\*\*?|\*\/)\s*$/.test(l));
    }
    const liste = prose ? prose.findIndex(l => COUNTER_CHECKS.test(l)) : -1;
    if (prose && liste >= 0) prose = prose.slice(0, liste);
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
  const LIMIT = { tests: 49, scripts: 0, indexHtml: 162 };
  const js = (/** @type {string} */ d) =>
    fs
      .readdirSync(d)
      .filter(f => f.endsWith('.js'))
      .map(f => path.join(d, f));
  const zaehle = (/** @type {string[]} */ l) => l.reduce((n, f) => n + longBlocks(fs.readFileSync(f, 'utf8')), 0);
  let html = 0;
  let offen = false;
  for (const z of fs.readFileSync(path.join(WEB, 'public', 'index.html'), 'utf8').split('\n')) {
    if (z.includes('<!--')) offen = true;
    if (offen) html++;
    if (z.includes('-->')) offen = false;
  }
  const ist = {
    tests: zaehle([...js(__dirname), ...js(path.join(__dirname, 'helpers'))]),
    scripts: zaehle(js(path.join(WEB, 'scripts'))),
    indexHtml: html,
  };
  assert.ok(ist.tests > 0 && ist.indexHtml > 0, 'nichts gefunden — greift die Suche noch?');
  for (const [k, s] of Object.entries(LIMIT)) {
    assert.ok(ist[k] <= s, `${k}: ${ist[k]}, erlaubt sind ${s}`);
    if (ist[k] < s) console.log(`  ℹ lange Kommentare ${k}: ${ist[k]} (Schranke ${s}) — Schranke nachziehen`);
  }
});

test('test files without a counter-check become fewer, never more', () => {
  // Every test names its counter-check in the header (CLAUDE.md); the older ones without
  // get it added when touched.
  // Counter-check (05.11.2026): „Gegenproben“ renamed in lint-ratchet.test.js → red (112).
  const LIMIT = 70;
  const ohne = fs
    .readdirSync(__dirname)
    .filter(n => n.endsWith('.test.js'))
    .filter(n => !/Gegenprobe|counter-check/i.test(fs.readFileSync(path.join(__dirname, n), 'utf8')));
  assert.ok(ohne.length <= LIMIT, `${ohne.length} Testdateien ohne Gegenprobe, erlaubt sind ${LIMIT}`);
  if (ohne.length < LIMIT)
    console.log(`  ℹ Testdateien ohne Gegenprobe: ${ohne.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('paths named in test comments exist', () => {
  // A counter-check that names a vanished file cannot be repeated. Checked is every
  // comment line in test/ and test/helpers/; a .js path also counts if the .ts source for it exists.
  // Counter-check (10.11.2026): in acquisition-scope-db.test.js the path at schreibbereich reset to the former one of the
  // set routes → red with this line as location. Counter-check (14.11.2026): without a built
  // bundle and without ARTIFACTS → red (bundle-built.test.js); the same path with `app.bundle2.js` → red.
  const REPO = path.join(WEB, '..');
  const ordner = [WEB, REPO]
    .flatMap(w =>
      fs
        .readdirSync(w, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name),
    )
    .filter(n => !['node_modules', 'dist', 'coverage', 'data', '.git'].includes(n));
  const PATH = new RegExp(
    `(?<![\\w./-])((?:${ordner.map(n => n.replace('.', '\\.')).join('|')})/[\\w./-]*\\w\\.` +
      '(?:ts|js|sql|html|css|json|md|sh|ya?ml|kt|kts|xml|txt))\\b',
    'g',
  );
  // The bundle only arises with `npm run build`; a fresh checkout does not have it.
  const ARTIFACTS = new Set([`public/${require('../scripts/build-frontend').OUT_REL}`]);
  const gibt = (/** @type {string} */ p) =>
    ARTIFACTS.has(p) ||
    [WEB, REPO].some(
      w => fs.existsSync(path.join(w, p)) || (p.endsWith('.js') && fs.existsSync(path.join(w, `${p.slice(0, -3)}.ts`))),
    );
  const dateien = [__dirname, path.join(__dirname, 'helpers')].flatMap(d =>
    fs
      .readdirSync(d)
      .filter(n => n.endsWith('.js'))
      .map(n => path.join(d, n)),
  );
  const fehlt = [];
  let n = 0;
  for (const f of dateien) {
    fs.readFileSync(f, 'utf8')
      .split('\n')
      .forEach((z, i) => {
        const t = z.trim();
        if (!t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')) return;
        for (const m of t.matchAll(PATH)) {
          n++;
          if (!gibt(m[1])) fehlt.push(`${path.relative(WEB, f)}:${i + 1} ${m[1]}`);
        }
      });
  }
  assert.ok(n > 400, `nur ${n} Pfade gefunden — greift die Suche noch?`);
  assert.deepEqual(fehlt, [], 'Pfad auf die heutige Datei ändern; Geschichte gehört in den Commit');
});

// ---- Language of the code: German identifiers per area ---------------------
// Counter-checks (22.11.2026): `const fehlerZahl = 1;` added to src/infra/config.ts
// → "server" red (953 > 952); the word list emptied → the sample check red;
// `'Fehler'` only as a string → stays green (texts are not code).
test('German identifiers become fewer, never more (server, tests, public separately)', () => {
  const { germanIdentifiers, isGerman } = require('./helpers/german-identifiers');
  assert.ok(isGerman('backInDieTable') && isGerman('preiseNachladen') && isGerman('ladeAn'), 'Stichprobe deutsch');
  assert.ok(!isGerman('importStatus') && !isGerman('jobKinds') && !isGerman('settable'), 'Stichprobe englisch');
  assert.equal(germanIdentifiers("const x = 'Fehler'; // Fehler").size, 0, 'Texte und Kommentare zählen nicht');
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
  const AREAS = {
    server: [path.join(WEB, 'server.ts'), ...SERVER.flatMap(d => files(path.join(WEB, d)))],
    test: files(__dirname),
    public: files(path.join(WEB, 'public')),
  };
  // Distinct names per area; the goal for "server" is 0.
  const LIMITS = { server: 952, test: 1494, public: 564 };
  for (const [area, list] of Object.entries(AREAS)) {
    const found = new Set();
    for (const f of list) for (const id of germanIdentifiers(fs.readFileSync(f, 'utf8'))) found.add(id);
    const limit = LIMITS[/** @type {keyof typeof LIMITS} */ (area)];
    assert.ok(found.size <= limit, `${found.size} deutsche Bezeichner in ${area}, erlaubt sind ${limit}`);
    if (found.size < limit)
      console.log(`  ℹ deutsche Bezeichner ${area}: ${found.size} (Schranke ${limit}) — Schranke nachziehen`);
  }
});
