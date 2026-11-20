const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isAppModule } = require('../scripts/build-frontend');

const WEB = path.join(__dirname, '..');

/**
 * Ratschen: Ein gemessener Bestand darf sinken, nie steigen.
 */

/** Alle TypeScript-Quellen ohne Tests und ohne Erzeugnisse. */
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
  // Auch ein Text, eine Zahl oder ein Objekt als Ersatz verschluckt den Fehler.
  /\.catch\(\(\)\s*=>\s*(null|undefined|true|false|-?\d+|'[^']*'|"[^"]*"|\(\{[^()]*\}\))\)/g,
  // Eine leere Liste ist für den Leser keine Fehlermeldung, sondern „nichts da".
  /\.catch\(\(\)\s*=>\s*\[\]\)/g,
  // Jeder andere Ausdruck als Ersatz (Map, Liste mit Inhalt, Vorgabe): Bei einem
  // Datenbankfehler sähe die Antwort wie ein Ergebnis aus. reportAndDeliver liefert dasselbe mit Log.
  /\.catch\(\s*\(\s*\)\s*=>\s*(?!\{)(?!(?:null|undefined|true|false|-?\d+|'[^']*'|"[^"]*"|\[\])\s*\))\S/g,
];

/**
 * Treffer zaehlen — im CODE, nicht in den Erklaerungen darueber. Mit `marke`
 * bleibt an jeder Kommentarstelle `/**\/` stehen: Ein Fang, dessen Rumpf sein
 * Warum nennt, ist nicht still, auch wenn Biome den Kommentar auf eine eigene Zeile setzt.
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

test('die Suche findet die Quellen ueberhaupt', () => {
  // ── Der eigentliche Zweck dieser Pruefung ────────────────────────────────
  //
  // Wird ein Ordner umbenannt oder greift `quellen()` nicht mehr, zaehlen die
  // Ratschen unten NULL — und null ist kleiner als jede Schranke. Sie waeren
  // dann fuer immer gruen, ohne je wieder etwas anzusehen.
  const n = quellen().length;
  assert.ok(n >= 80, `Nur ${n} TypeScript-Quellen gefunden — greift die Suche noch?`);
});

test('stille Fänge (Server, nur gemeldete, Oberfläche) werden weniger, nie mehr', () => {
  // Die Rebrickable-Teilezuordnung fängt nur 404, das rbGet() selbst als null liefert.
  const LIMIT = 0;
  // Selbstbeweis des letzten Musters: Es muss einen Ersatzwert ohne Meldung finden, die Meldung nicht.
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
      'wenigstens melden (reportError aus src/infra/fehlerTexte).',
  );
  if (ist < LIMIT) {
    console.log(`  ℹ stille Faenge: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
  }
  onlyReportedCatches();
  silentCatchesTheUi();
});

test('„melden und weiter“ wird weniger, nie mehr; src/sets kommt ohne aus', () => {
  // Die Regel steht in docs/architektur.md („Fehler“): Schreibpfade werfen, Lesepfade nehmen
  // versuche()/Abstriche, logAndContinue nur für Nebenwirkungen ohne Folgen; ein Ersatzwert
  // (reportAndDeliver) begründet sich als „Ausnahme:“ im Code. Ausserhalb von src/catalog eigene Schranke.
  // Gegenproben: in src/catalog/colors.ts wieder `.catch(reportAndDeliver('x', []))` → rot (8, Schranke 7);
  // (14.11.2026) in routes/auth.ts beim Abmelden wieder `.catch(logAndContinue('x'))` → rot (86 von 85),
  // mit Gesamtschranke 200 → rot „ausserhalb src/catalog“ (40 von 39).
  // (15.11.2026) Katalog-Schreibwege werfen (Auftrag wiederholt); in teileAnreicherung.ts wieder
  // `.catch(logAndContinue('x'))` an rememberPart → rot (68 von 67).
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

/** Fänge, die nur melden und weiterlaufen, werden weniger, nie mehr. */
function onlyReportedCatches() {
  // Jede Form ohne throw: `catch (e) { reportError(…) }`, mit `return x`/`continue` danach, und
  // `.catch(e => console.warn(…))`. Sie verschweigen den Fehler dem Aufrufer wie reportAndDeliver,
  // nur ohne dessen Namen. Wer direkt in die Konsole schreibt statt reportError, nennt sein
  // Warum als „Ausnahme:“ im Fang. Nur src/: Routen fangen nicht, Jobs und db/ haben eigene Regeln.
  // Gegenproben (14.11.2026): in src/sets/dienst.ts den Zustandswechsel wieder in
  // `try { … } catch (e) { console.error(…) }` → rot (62 von 61); in src/mail/transport.ts die
  // „Ausnahme:“ am Fang gestrichen → rot „ohne Ausnahme: …“ (src/mail/transport.ts:155).
  // (15.11.2026) Kaufpreis-Nachtrag sammelt und wirft, Anleitungen eintragen wirft; in
  // instructions.ts das Eintragen wieder in try/catch mit reportError → rot (57 von 56).
  const { catches, onlyReported } = require('./helpers/faenge');
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

/** Stille Fänge der Oberfläche werden weniger, nie mehr. */
function silentCatchesTheUi() {
  // Ein Fang in public/js ohne throw, Meldung (toast, zeige…, melde…, console) oder sichtbaren Text
  // verschluckt den Fehler: Die Ansicht zeigt dann „leer“ statt „gescheitert“. Viele sind Absicht
  // (localStorage, abgebrochene Ströme); neue braucht es nicht.
  // Gegenprobe (15.11.2026): in public/js/wanted.js am Alarm beim Merken wieder
  // `.catch(() => null)` → rot (92 stille Fänge, erlaubt sind 91).
  const { catches, stillImBrowser } = require('./helpers/faenge');
  const LIMIT = 84;
  const probe = (/** @type {string} */ q) => catches(q).filter(stillImBrowser).length;
  assert.equal(probe('a().catch(() => null); try { b(); } catch { /* weg */ } c.catch(() => {});'), 3);
  assert.equal(probe('a().catch(e => toast(e.message, "error")); try { b(); } catch (e) { showError(e); }'), 0);
  const ist = oberflaeche().reduce((n, f) => n + catches(fs.readFileSync(f, 'utf8')).filter(stillImBrowser).length, 0);
  assert.ok(ist > 30, `nur ${ist} stille Fänge in public/js — greift die Suche noch?`);
  assert.ok(ist <= LIMIT, `${ist} stille Fänge in public/js, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ stille Fänge der Oberfläche: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
}

/** Die Fabrik (createDb, dbKonfigFromEnvironment) und Typen sind kein Prozesszugang. */
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
  // Auch innerhalb von db/ (`./database`): txLock und pgNotify gingen dort am Zähler vorbei.
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

test('der Kompatibilitätsweg zur Datenbank und modulweiter Zustand werden weniger, nie mehr', () => {
  // db/database.ts hat eine Fabrik (createDb); wer noch die Funktionen des
  // Prozesszugangs importiert, statt einen Zugang übergeben zu bekommen, zählt hier.
  // Gegenproben: ein `import * as db from '../../db/database'` in src/sets/zeilen.ts → rot (09.11.2026);
  // `import { get as _probe } from '../../db/database'` ebendort → rot mit 1 (11.11.2026).
  // `import * as _probe from './database'` in db/txLock.ts → rot mit 1 (11.11.2026).
  const LIMIT = 0;
  const ist = quellen().filter(takesProcessAccess).length;
  // Selbstbeweis: Typimporte aus db/database zählen nicht, finden muss die Suche sie trotzdem.
  const withTypes = quellen().filter(f =>
    /^import type \{[^}]*\} from '[./]+\/db\/database';/m.test(fs.readFileSync(f, 'utf8')),
  ).length;
  assert.ok(withTypes > 20, `nur ${withTypes} Typimporte aus db/database gefunden — greift die Suche noch?`);
  assert.ok(ist <= LIMIT, `${ist} Dateien nehmen den Prozesszugang aus db/database, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ Kompatibilitätsweg db/database: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);

  // Modulweiter Zustand (let und leer angelegte Map/Set/WeakMap/WeakSet): Ihn teilen alle
  // Zugänge eines Prozesses. Ein Bereich hält seinen in Fächern (src/infra/zwischenspeicher.ts),
  // bewusst prozessweiter steht mit Grund in src/infra/prozessweit.ts.
  // Gegenproben (13.11.2026): `const _probe = new Map<string, number>();` in src/catalog/context.ts
  // → rot mit 60; `let _probe = 0;` ebendort → rot mit 60. (14.11.2026) Schranke 2 (Transaktionswächter,
  // Sicherungspunkte in db/); `const sitzungen = new Map<string, Sitzung>();` zurück in
  // src/vouchers/balanceLookup.ts → rot (3 von 2). Schranke 1: Der Transaktionswächter
  // reist mit der Transaktion im Aufrufrahmen; übrig sind die Sicherungspunkte in db/.
  const STATE_LIMIT = 1;
  const ZUSTAND =
    /^(?:export )?(?:let |const \w+(?:: [^=\n]+)? = new (?:Map|Set|WeakMap|WeakSet)\b(?:<[^\n]*>)?\(\))/gm;
  const countState = s => (s.match(ZUSTAND) || []).length;
  // Selbstbeweis: Leer angelegte Sammlungen und let zählen, Konstanten mit Inhalt nicht.
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

/** Wege an den Kontexten vorbei sind verboten (früher eine Ratsche). */
function routesAnDenContextsPast() {
  // Ein Dienst bekommt seine Abhängigkeiten über den Kontext (src/<bereich>/kontext.ts);
  // einen Speicher der Dienste im Prozess (Holer xBereich(), Fassaden aus dienstePerAufruf)
  // gibt es nicht mehr.
  // Gegenproben (14.11.2026): `export const sets = prozessStelle<SetsServices>('sets');` in
  // src/sets/lesen.ts → rot (1 Holer-Stelle); `import { setsLesen } from '../sets'` in
  // src/collection/deletion.ts (mit `export const setsLesen = …` in src/sets/index.ts) → rot (1 Fassade).
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
  // Was ein Bereich als Dienst bindet, darf keine index.ts zusätzlich als Wert exportieren.
  const dienste = new Map(
    bereiche.map(b => {
      const s = fs.readFileSync(factoryFile(b), 'utf8');
      const n = new Set();
      for (const m of s.matchAll(/^ {4,8}(\w+): /gm)) n.add(m[1]);
      return [b, n];
    }),
  );
  assert.ok(dienste.get('sets').has('setsLesen'), 'die Dienste der Bereiche werden nicht mehr gefunden');
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

/** konfig() liest der Start; Fachbereiche, Routen und Jobs bekommen die Konfiguration gereicht. */
function konfigNurAmStart() {
  // buildServices reicht sie als k.konfig, der Start als Parameter. Übrig sind Helfer des Prozesses
  // (src/infra, src/http, db/) und der beim Laden gebaute bcrypt-Pool; ihre Zahl sinkt nur.
  // Gegenproben (14.11.2026): `const _k = konfig();` in src/sets/lesen.ts → rot (Fachbereich);
  // dasselbe in src/http/csvAntwort.ts → rot (14 von 13).
  const LIMIT = 13;
  const EXCEPTION = ['src/account/bcryptLimit.ts'];
  const ohne = require('./helpers/sources').ohneKommentare;
  const rel = f => path.relative(WEB, f).split(path.sep).join('/');
  const lesend = quellen()
    .map(rel)
    .filter(r => !/^(startup\/|server\.ts$|src\/infra\/konfig\.ts$)/.test(r))
    .filter(r => /\bkonfig\(\)/.test(ohne(fs.readFileSync(path.join(WEB, r), 'utf8'))));
  assert.ok(lesend.length > 0, 'keine Leser von konfig() gefunden — greift die Suche noch?');
  const fach = lesend.filter(r => !/^(src\/infra|src\/http|db)\//.test(r) && !EXCEPTION.includes(r));
  assert.deepEqual(fach, [], 'Fachbereiche, Routen und Jobs nehmen k.konfig oder einen Parameter');
  assert.ok(lesend.length <= LIMIT, `${lesend.length} Dateien lesen konfig(), erlaubt sind ${LIMIT}`);
  if (lesend.length < LIMIT)
    console.log(`  ℹ konfig()-Leser: ${lesend.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
}

/** Bereiche binden ohne Namen und Proxy; AsyncLocalStorage nur im Aufrufrahmen. */
function bindingWithoutNamesAndProxy() {
  // Ein Bereich ist eine Fabrik mit Closure über k (src/infra/bereich.ts, mit()); die Transaktion
  // reist über `t` (tx.db), nicht über einen Proxy oder eine Freigabe im Aufrufpfad.
  // Gegenproben (14.11.2026): `const _p = new Proxy({}, {});` in src/sets/lesen.ts → rot (Proxy);
  // `setsLesen: binde(sk, lesen, ['setsLesen', 'x'])` in src/sets/bereich.ts → rot (Namensbindung);
  // `new AsyncLocalStorage()` in db/transaktion.ts → rot (zweiter Kanal).
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
    ['src/infra/kontoKontext.ts'],
    'Ein Kanal über den Aufrufpfad: der Aufrufrahmen (docs/architektur.md)',
  );
}

test('any wird weniger, nie mehr', () => {
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

test('any in allen Formen, unknown-Parameter und success in Diensten werden weniger, nie mehr', () => {
  // Auch Promise<any>, any[] und Record<string, any>: Die enge Zählung oben sah
  // nur `as any` und `: any`.
  // Gegenprobe (05.11.2026): getSetting wieder `fallback?: any` ohne Überladungen → rot.
  const LIMIT = 8;
  const ist = zaehle([/\bany\b/g]);
  assert.ok(ist <= LIMIT, `${ist}-mal any, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ any (alle Formen): ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);

  // Dieselbe Art Zählung: Die Hülle der Antwort setzt die Route, ein Dienst
  // liefert das Fachobjekt. Übrig sind Zeilenstatus in Importberichten, Mailversand und der Import-Fortschritt (ein Strom-Format) bleiben.
  // Gegenprobe (11.11.2026): in auftragAbbrechen() wieder `success: true` → rot.
  const SUCCESS_LIMIT = 7;
  const success = zaehle([/\bsuccess:\s*true\b/g], f =>
    /^src[\\/](?!contract[\\/]|http[\\/])/.test(path.relative(WEB, f)),
  );
  assert.ok(
    success <= SUCCESS_LIMIT,
    `${success}-mal success: true in src/ (ohne vertrag/, http/), erlaubt sind ${SUCCESS_LIMIT}`,
  );
  if (success < SUCCESS_LIMIT)
    console.log(`  ℹ success in Diensten: ${success} (Schranke ${SUCCESS_LIMIT}) — Schranke nachziehen`);
  // Routen geben ihr Ergebnis zurück, die Hülle setzt der Vertragsrouter (endpunkt). Übrig sind
  // Ströme, Rückrufe nach dem Abmelden und ganze Antworten der Anmeldung.
  // Gegenprobe (14.11.2026): in routes/api_v1/sets.ts `return { set }` als `res.json({ success: true, set })` → rot (11).
  const ROUTES_LIMIT = 10;
  const inRoutes = zaehle([/\bsuccess:\s*true\b/g], f => /^routes[\\/]/.test(path.relative(WEB, f)));
  assert.ok(
    inRoutes > 0 && inRoutes <= ROUTES_LIMIT,
    `${inRoutes}-mal success: true in routes/, erlaubt sind ${ROUTES_LIMIT}`,
  );
  if (inRoutes < ROUTES_LIMIT)
    console.log(`  ℹ success in Routen: ${inRoutes} (Schranke ${ROUTES_LIMIT}) — Schranke nachziehen`);
  // Routen reichen req.eingabe/req.pfad mit Vertragstyp durch, Dienste nehmen
  // Fachtypen (Zustand, string). Ausgenommen sind die Prüfer für Rohwerte
  // (src/contract, src/infra, src/http) und Fehlerparameter.
  // Gegenprobe (11.11.2026): `condition: unknown` zurück in deleteAlarmOfSets → rot (75).
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

test('direkte Uhr-Aufrufe in Fachbereichen werden weniger, nie mehr', () => {
  // Die Zeit kommt über k.uhr (src/infra/uhr.ts): Ein Test stellt sie, statt zu warten.
  // Übrig sind Drosseln mit echten Zeitgebern, die Sitzungsmiddleware (Fristen des Kekses) und
  // Zeitstempel ohne Kontext.
  // Gegenprobe (14.11.2026): `const x = Date.now();` in src/sets/dienst.ts → rot.
  // (15.11.2026) Drosseln, Attestation, Portfolio nehmen k.uhr; `Date.now()` zurück in
  // rateLimiter.ts (_schedule) → rot (21 von 20).
  const LIMIT = 20;
  const CLOCK = /\bDate\.now\(\)|\bnew Date\(\)/g;
  assert.equal('Date.now(); new Date(); new Date(x); k.uhr.jetzt()'.match(CLOCK)?.length, 2, 'Selbstbeweis');
  const fach = (/** @type {string} */ f) =>
    /^(src[\\/](?!infra|http|vertrag)\w+|jobs)[\\/]/.test(path.relative(WEB, f));
  const ist = zaehle([CLOCK], fach);
  assert.ok(ist <= LIMIT, `${ist} direkte Uhr-Aufrufe in Fachbereichen und Jobs, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ Uhr-Aufrufe: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('keine Testdatei prüft REQUIRE_DB selbst', () => {
  // Die Regel steht in test/helpers/db.js (dbOderSkip, keineDb,
  // missingPrecondition); eine eigene Fassung war 115-mal kopiert.
  // Gegenprobe (11.11.2026): `if (process.env.REQUIRE_DB === '1') throw e;`
  // zurück in anleitung-auftrag-db.test.js → rot.
  const eigene = fs
    .readdirSync(__dirname)
    .filter(n => n.endsWith('.js') && n !== path.basename(__filename))
    .filter(n => /process\.env\.REQUIRE_DB|REQUIRE_DB=1, aber/.test(fs.readFileSync(path.join(__dirname, n), 'utf8')));
  assert.deepEqual(eigene, [], 'test/helpers/db.js benutzen');
});

test('Datenbankzeilen sind ohne Typargument unknown', () => {
  // Ohne Angabe war eine Zeile `any`, und die Typprüfung endete an der
  // Datenbank — dort, wo numeric und bigint als Zeichenkette ankommen.
  // Gegenprobe (05.11.2026): `get<T = any>` in DbInterface → rot.
  const quelle = ['database.ts', 'transaktion.ts', 'typen.ts']
    .map(n => fs.readFileSync(path.join(WEB, 'db', n), 'utf8'))
    .join('\n');
  assert.equal(
    (quelle.match(/\b(?:all|get)\s*(?::\s*)?<T = unknown>/g) || []).length,
    6,
    'all/get in Schnittstelle, Pool und Transaktion',
  );
  assert.doesNotMatch(quelle, /<T = any>|lastID/);
});

test('ungetypte Datenbankabfragen werden weniger, nie mehr', () => {
  // Erlaubt, solange niemand Felder der Zeile liest — dann verlangt der
  // Übersetzer ohnehin ein Typargument.
  // Gegenprobe (05.11.2026): Schranke auf 68 → rot. Zeilentypen bindet db/zeilen.ts ans Schema.
  // (15.11.2026) in auftraege.ts writeProgress wieder `db.get(` ohne Typ → rot (4 von 3).
  const LIMIT = 3;
  const ist = zaehle([/\b(?:db|tx|dbh|d)\.(?:get|all)\(/g]);
  assert.ok(ist <= LIMIT, `${ist} ungetypte db.get/all, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ ungetypte Abfragen: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('rohe req.body und req.query in Routen werden weniger, nie mehr', () => {
  // Eine Route liest req.eingabe und req.abfrage: geprüft und getypt aus dem
  // Vertrag. Übrig sind die Middleware vor der Prüfung, der Bild-Proxy (ohne
  // Vertrag) und routes/auth/registrierung.ts.
  // Gegenprobe (05.11.2026): in routes/api_v1/sets.ts ein `req.body.storage` zurück → rot.
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

test('Schreibziele in Routen werden weniger, nie mehr', () => {
  // schreibziel() prüft im Haushalt, für wen geschrieben wird; besser nimmt der
  // Dienst den Wunsch selbst entgegen.
  // Gegenprobe (05.11.2026): Schranke auf 16 → rot.
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
 * Testdateien, die nur Quelltext lesen und nichts ausführen. Eine Regex auf
 * den Quelltext bestätigt, dass eine Zeile dasteht — nicht, dass sie wirkt
 * (der Signal-Fehler vom 25.10. stand im Quelltext, nur an der falschen
 * Stelle). Strukturprüfungen dürfen bleiben; neue Prüfungen von Verhalten
 * gehören in einen Test, der den Code laufen lässt.
 */
const READS_SOURCE = /readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare/;
// Die Hilfen für jsdom und Chrome führen die Oberfläche aus (wie im Prüfbericht arch17-web-b, H1).
const LEADS_FROM =
  /buildAndRequire|testServer|spawn\(|spawnSync\(|execFileSync\(|fetch\(|jsdom|new Function|vm\.|= import\(|helpers\/(oberflaeche|app-browser)'/;
function pureSourceTextTests() {
  return fs
    .readdirSync(__dirname)
    .filter(n => n.endsWith('.test.js'))
    .filter(n => {
      const src = fs.readFileSync(path.join(__dirname, n), 'utf8');
      return READS_SOURCE.test(src) && !LEADS_FROM.test(src);
    });
}

test('Importkanten zwischen Ansichten werden weniger, nie mehr', () => {
  // Ansichten melden einander über events.js; was mehrere teilen, ist Baustein (BAUSTEINE).
  // Gegenprobe (15.11.2026): `import { loadGallery } from './sammlung.js';` zurück in lagerorte.js
  // → rot (51 statt 50).
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

// Dateien unter public/js, die Phase 2b bewusst auf Englisch umbenannt hat (Datei, Bezeichner,
// Kommentare): Ihre englischen Namen sind dort Absicht, nicht die Sorte Einzelfund, die
// englischeDateinamen() zählt. Wer eine weitere Datei dieser Phase umstellt, trägt sie hier ein
// und zieht die LIMIT unten NICHT hoch — die zusätzliche Datei fällt aus der Zählung heraus.
const UI_ENGLISH_CONVERTED = [
  'settings.js',
  'wanted.js',
  'user-management.js',
  'collection.js',
  'finances.js',
  'setup-status.js',
  'logviewer.js',
  'mobile.js',
  'theme-boot.js',
  'pdfjs-boot.js',
  'set-csv-import.js',
  'sets-tabelle.js',
  'set-detail.js',
  'manuell-detail.js',
];

test('englische Dateinamen der Oberfläche werden weniger, nie mehr', () => {
  // Innen heissen die Dinge deutsch (docs/architektur.md, „Namen“); übrig sind Begriffe der
  // Technik (api, dom, router …). Gezählt wird ein englisches Wort im Dateinamen.
  // Gegenprobe (15.11.2026): public/js/collection.js zurück auf gallery.js → rot (22 statt 21).
  const ENGLISH =
    /^(?:.*-)?(?:gallery|catalog|parts|finance|settings|actions|scope|scrollbar|acquisition|modals?|admin|init|main|mobile|monitor|registry|router|boot|viewer|logviewer|pdfviewer|detail|import|wanted|sets|api|dom|format|passkeys|minifigs|theme)(?:-.*)?\.js$/;
  const LIMIT = 13;
  assert.ok(ENGLISH.test('set-detail.js') && ENGLISH.test('gallery.js') && !ENGLISH.test('sammlung.js'));
  const english = fs
    .readdirSync(path.join(WEB, 'public', 'js'))
    .filter(n => isAppModule(n) || ['main.js', 'logviewer.js', 'pdfjs-boot.js'].includes(n))
    .filter(n => ENGLISH.test(n))
    .filter(n => !UI_ENGLISH_CONVERTED.includes(n));
  assert.ok(english.length <= LIMIT, `${english.length} englische Dateinamen in public/js: ${english.join(', ')}`);
  if (english.length < LIMIT)
    console.log(`  ℹ englische Dateinamen: ${english.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('Testdateien heissen nach ihrer Funktion, nicht nach einer Prüfrunde', () => {
  // Ein Rundenname sagt nicht, was rot ist; man sucht die Datei über das Thema.
  // Gegenprobe (15.11.2026): sicherheit-server-grenzen-db.test.js zurück auf
  // sicherheit-runde11-db.test.js → rot mit diesem Namen.
  const ROUND = /runde\d|runde-|kleinbefunde|-befunde-/;
  assert.ok(ROUND.test('oberflaeche-runde25b-browser.test.js') && !ROUND.test('admin-hash-runden-db.test.js'));
  assert.deepEqual(
    fs.readdirSync(__dirname).filter(n => n.endsWith('.test.js') && ROUND.test(n)),
    [],
  );
});

test('reine Quelltext-Tests werden weniger, nie mehr', () => {
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
 * Je Testfall statt je Datei. Ein Fall führt aus, wenn er einen Ausführungs-Helfer
 * ruft (buildAndRequire/_req, testServer, startApp, spawn, fetch, jsdom, db.…) oder
 * einen Namen der Datei, der dahin führt (auch über Helfer und deren Helfer). Ein
 * blosses `await` zählt nicht: Es wartet ebenso auf fs.promises.readFile.
 */
const FALL_LEADS_FROM =
  /\bbuildAndRequire\(|\b_req\w*\(|\btest(?:Daten|Zugang|Dienste|Kontext|Bereich|Data|Access|Services|Context|Area)\(|\b(?:bildNotizen|imageNotes)\(|\b(?:areaPage|replaceServices)\(|\btestServer\(|\b(?:starteApp|startApp)\(|\b(?:spawn|spawnSync|execFileSync|execSync|execFile|fork)\(|\bfetch\(|\bJSDOM\b|new Function\(|\bvm\.\w+\(|\bimport\(|require\([^)]*\bdist\b|require\(\s*['"]\.\.\/(?!test\/|scripts\/)|\.request\(|\bagent\.\w+\(|\bseite\.\w+\(|\bpage\.\w+\(|\bdb\.\w+\(/;
const FALL_READS = /readFileSync|Quelle\(|serverOnly|serverAll|i18nAll|localeSource|ohneKommentare/;
/** Aus helpers/sources führen nur diese aus; die übrigen lesen Quelltext. */
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

/** Ob ein Modul unter test/helpers selbst etwas ausführt. */
function executingHelper() {
  const raus = new Map();
  const d = path.join(__dirname, 'helpers');
  for (const f of fs.readdirSync(d).filter(x => x.endsWith('.js')))
    raus.set(f.replace(/\.js$/, ''), FALL_LEADS_FROM.test(fs.readFileSync(path.join(d, f), 'utf8')));
  raus.set('sources', false);
  return raus;
}

/** Anweisungen auf oberster Ebene: jeweils bis zur nächsten Zeile in Spalte 0, die keine Klammer schliesst. */
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

/** @returns {{ n: number, alle: number, faelle: string[] }} Fälle, die lesen und nichts ausführen */
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

test('Testfälle, die nur Quelltext lesen, werden weniger, nie mehr', () => {
  // Strukturelle Erkennung: `await ` allein hielte reine Lesefälle für ausführend.
  // Gegenprobe (12.11.2026): `await ` wieder in FALL_LEADS_FROM → rot „Selbstbeweis“.
  const probe = [
    "const _req = require('./helpers/sources').buildAndRequire();",
    "const { serverOnly } = require('./helpers/sources');",
    "const { testServer } = require('./helpers/server');",
    "const SRC = fs.readFileSync('x.ts', 'utf8');",
    "const modul = _req('src/infra/fehler.js');",
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

/** Die Fassade `_req('db/database.js')` (und dbOderSkip, das sie lieferte) tat so, als gäbe
 * es noch einen Zugang des Prozesses, und mischte Testdaten mit dem Code unter Test.
 * Testdaten nehmen testData()/dataOrSkip(), Code unter Test testAccess()/accessOrSkip().
 * Einzelne Exporte des Moduls (createDb, isReading) sind kein Zugang und bleiben erlaubt. */
const USES_FACADE =
  /(?<!\}\s*=\s*)(?:_req\w*|buildAndRequire\(\))\(\s*['"]db\/database(?:\.js)?['"]\s*\)|\bdbOderSkip\(|\.standardDb\(/;
/** Ersatzwege, die nur sinken dürfen. Wer Module beim Laden umbiegt, prüft einen Aufbau, den es
 * im Betrieb nicht gibt, und greift still ins Leere, sobald sich ein Importpfad ändert; ersetzt
 * wird an der Verdrahtung (testImageWorker(), testSources(), replaceServices()). routerServer steckt
 * eigene Router zusammen statt baueApp, an Sitzungs- und Verwalterprüfungen vorbei. */
const FALLBACKS = {
  'biegen Module um': { muster: /\.prototype\.require\s*=|\._load\s*=/, limit: 11 },
  'nehmen routerServer statt testServer': { muster: /\brouterServer\(/, limit: 13 },
};

test('Tests benutzen den echten Aufbau: keine DB-Fassade, Ersatzwege werden weniger', () => {
  // Die DB-Fassade ist durch testData()/testAccess() ersetzt; umgebogene require und
  // eigene Router (routerServer) werden weniger.
  // Gegenproben (13.11.2026): in indizes-db.test.js wieder `_req('db/database.js')` → rot
  // (Fassade); in image-queue-db.test.js `Module.prototype.require = r;` → rot (15 statt 14);
  // in app-kette-db.test.js testServer → routerServer → rot (14 statt 13).
  // Seit dem 13.11.2026 zählt test/helpers/ mit (helpers/systemrahmen.js, die Definition in
  // helpers/server.js; je +1 gegenüber der Zählung nur der Testdateien); Gegenprobe:
  // `Module._load = l;` in helpers/zeit.js → rot (12 statt 11).
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
  // Auch die Helfer: Ein Umbiegen in test/helpers/ träfe jede Datei, die ihn lädt.
  for (const [was, { muster, limit }] of Object.entries(FALLBACKS)) {
    const ist = [...tests, ...helper].filter(n => muster.test(lies(n))).length;
    assert.ok(ist > 0, `keine Datei ${was} — greift das Muster noch? Dann Schranke und Eintrag entfernen`);
    assert.ok(ist <= limit, `${ist} Testdateien ${was}, erlaubt sind ${limit}`);
    if (ist < limit) console.log(`  ℹ ${ist} Testdateien ${was} (Schranke ${limit}) — Schranke nachziehen`);
  }
});

/**
 * Web-Tests lesen keinen Android-Quelltext: Was die App vom Server braucht, steht in
 * shared/app-schnittstelle.json (im Android-Lauf aus ihrem Quelltext erzeugt und geprüft);
 * was nur die App betrifft, prüft die Android-Suite. Gezählt werden auch die Helfer.
 */
const READS_ANDROID = /require\(['"]\.\/helpers\/android['"]\)|['"`]Android-App['"`/]|\.kt['"`]/;

test('Web-Tests lesen keinen Android-Quelltext', () => {
  // Gegenprobe: `const k = 'x.kt';` in a11y.test.js → rot (nennt a11y.test.js); dasselbe in
  // test/helpers/vertrag.js → rot (nennt helpers/vertrag.js).
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
 * Feste Pausen ab 100 ms, die als eigene Anweisung ausserhalb einer Schleife stehen (eine Schleife
 * wartet auf eine Bedingung). Gezählt auf dem Text in einer Zeile mit geleerten Zeichenketten,
 * damit es nicht darauf ankommt, wie Biome umbricht.
 */
function fixedWaitTimes(/** @type {string} */ text) {
  const q = require('./helpers/sources');
  const s = q
    .kompakt(q.ohneKommentare(text))
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, m => m[0] + '_'.repeat(m.length - 2) + m[0]);
  /** Öffnende Klammer zur schliessenden an `zu`. */
  const auf = (/** @type {number} */ zu) => {
    for (let j = zu, t = 0; j >= 0; j--)
      if (s[j] === ')') t++;
      else if (s[j] === '(' && --t === 0) return j;
    return 0;
  };
  const schleifenkopf = (/** @type {string} */ vor) =>
    vor.endsWith(')') && /\b(for|while)\s*$/.test(s.slice(0, auf(vor.length - 1)));
  /** Steht `i` in einer Klammer, einem Schleifenrumpf oder hinter einem Schleifenkopf? */
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

test('feste Wartezeiten in Tests werden weniger, nie mehr', () => {
  // Eine feste Pause ist unter Last zu kurz und sonst zu lang; gewartet wird auf
  // eine Bedingung (helpers/zeit.js bis(), ruhig()). Übrig sind Pausen, die zeigen,
  // dass etwas NICHT geschieht, oder die der geprüfte Code verlangt.
  // Gegenprobe (05.11.2026): `await warte(500);` in verlauf-browser.test.js → rot.
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
  assert.deepEqual(eigene, [], 'eigene Warte-Helfer: test/helpers/zeit.js benutzen');
  assert.ok(ist <= LIMIT, `${ist} feste Wartezeiten ab 100 ms, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ feste Wartezeiten: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

/**
 * Inline-Stile in index.html. Ein data-stil="…" (styles.js setzt es als
 * Inline-Stil) setzt sich über jedes Design und jede Telefonregel hinweg;
 * gleiche Dinge sahen deshalb an zwei Stellen verschieden aus. Gezählt werden
 * Attribute ausserhalb von Kommentaren. display:none bleibt erlaubt: Die
 * Skripte schalten es um.
 */
test('Inline-Stile in index.html werden weniger, nie mehr', () => {
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

test('kein Verweis auf „Nachtrag N" unter Web-App/', () => {
  // Die Geschichte einer Stelle steht im Commit (CLAUDE.md); eine Nummer im
  // Kommentar verweist auf eine Liste, die es im Baum nicht gibt. Ausgenommen:
  // docs/, CHANGELOG* und db/ (angewandte Migrationen dürfen sich nicht ändern).
  // Gegenproben: eine Nachtragsnummer in src/account/deviceToken.ts → rot; dasselbe in
  // test/tab-layout.test.js und in public/index.html → rot (05.11.2026).
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

test('kein Modul wird in einer Datei zweimal importiert', () => {
  // Je Modul ein Wert-Import und höchstens ein `import type`; neun Zeilen für
  // neun Namen aus derselben Datei verdecken, was wirklich gebraucht wird.
  // Gegenprobe (05.11.2026): `import { fehlertext } from '../infra/fehler';`
  // zusätzlich in src/finances/priceAlert.ts → rot.
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

test('der Kommentaranteil im Server sinkt, nie steigt', () => {
  // Gezählt in server.ts, routes/, src/ und jobs/, im Biome-Format.
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

/** Quellen der Oberfläche: public/js ohne Bündel, dazu i18n.js. */
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

// Typangaben in JSDoc (@param, @type …) und reine Begrenzer (/**, */) sind
// Code für tsc, keine Erzählung; sie zählen weder als Kommentar noch als Zeile.
const TYPZEILE = /^(\/\*\*\s*)?\*?\s*@(param|type|returns?|typedef|template|this|property)\b|^\/\*\*$|^\*\/$|^\*$/;

test('der Kommentaranteil der Oberfläche sinkt, nie steigt', () => {
  // Ohne Typzeilen gezählt, im Biome-Format.
  // Gegenprobe: 300 Kommentarzeilen an dom.js → rot.
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

test('any in den Typangaben der Oberfläche wird weniger, nie mehr', () => {
  // noImplicitAny verbietet nur das stille any; ein ausgeschriebenes schaltet
  // die Prüfung für diesen Wert genauso ab. Seit dem Abbau steht keines mehr da.
  // Gegenprobe: an api.js `/** @type {any} */ let x;` angehängt → rot mit 1.
  const LIMIT = 0;
  let ist = 0;
  for (const f of oberflaeche())
    for (const z of fs.readFileSync(f, 'utf8').split('\n'))
      if (z.includes('@') && (z.includes('/**') || z.trim().startsWith('*'))) ist += (z.match(/\bany\b/g) || []).length;
  assert.ok(ist <= LIMIT, `${ist}-mal any in Typangaben der Oberfläche, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ any in der Oberfläche: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('kein Kommentar der Oberfläche hat mehr als fünf Zeilen Prosa', () => {
  // CLAUDE.md: Ein Kommentar sagt in zwei bis fünf Zeilen, warum. JSDoc-Tags
  // (@param, @returns …) zählen nicht mit.
  // Gegenprobe: ein //-Block mit sechs Zeilen in dom.js → rot mit Fundstelle.
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

/** Funktionen mit ihrer Länge (Deklaration bis zur schliessenden Klammer gleicher Einrückung). */
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

test('Funktionen der Oberfläche über 100 und über 80 Zeilen werden weniger, nie mehr', () => {
  // Im Biome-Format. Gegenprobe: loadFinance
  // wieder in einem Stück (vor dem Aufteilen) → rot mit „finanzen.js loadFinance“.
  const LIMIT_80 = 20;
  const KNOWN_100 = [
    'public/js/kauf-dialoge.js acqSave',
    'public/js/diagramme.js priceChartSVG',
    'public/js/diagramme.js portfolioChartSVG',
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

/** Code-Zeilen der Oberflächenmodule (public/js/NN-*.js) ohne Kommentarzeilen, mit Fundort. */
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

test('Markup kommt nur über setzeHtml()/fuegeHtmlEin() in die Seite', () => {
  // Nur die beiden Helfer in dom.js schreiben Markup; das Protokollfenster (monitor.js) baut ein eigenes
  // Dokument per document.write. Gegenprobe: in sammlung.js `grid.innerHTML = ''` → rot mit Fundort.
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

/** Die Argumente aller rawHtml()-Aufrufe in `text`, bis zur schliessenden Klammer. */
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

test('rawHtml() wird weniger, nie mehr; kein Template mit ${…} und kein .join() darin', () => {
  // html`` maskiert jeden eingesetzten Wert; rawHtml() setzt eine Zeichenkette als Markup ein, die
  // vor dem Umbau schon maskiert gebaut wurde. Listen aus html`` verbindet joinHtml() (escaping.js).
  // Gegenprobe (12.11.2026): in dom.js `${ungeprueft(`<b>${x}</b>`)}` → rot „Template“;
  // `ungeprueft(a.join(''))` → rot „join“; Schranke auf 124 → rot.
  // Gegenprobe (13.11.2026, Schranke 87): in gutscheine.js ein `${ungeprueft(COPY_ICON_SVG)}` zurück → rot.
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

test('keine Datei der Oberfläche über 1000 Zeilen, die grossen werden kleiner', () => {
  // Eine Sammeldatei zieht Neues an, weil es dort schon liegt (Biome-Format).
  // Gegenprobe (09.11.2026): an finanzen.js Leerzeilen gehängt → rot.
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

/** Top-Level-Funktionen samt Pfeilfunktionen an const; sie endet vor der nächsten Zeile
 * ohne Einzug (eine schliessende Klammer gehört noch dazu). */
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
  // Ab 100 Zeilen zählen Top-Level-Funktionen samt Pfeilfunktionen; keine ist bekannt.
  // Gegenproben: buildPdf in src/catalog/pdf/pdfDrawing.ts wieder in einem Stück → rot „ab 100“ (13.11.2026);
  // createDb in db/database.ts wieder als eine Closure → rot „ab 100“ und „über 150“ (14.11.2026).
  const LIMIT_80 = 17,
    LIMIT_150 = 0,
    KNOWN_100 = [];
  const dateien = quellen().filter(
    f => /[\\/](src|routes|jobs|db|clients|startup)[\\/]/.test(f) || /[\\/]server\.ts$/.test(f),
  );
  // Eine Router-Fabrik (baueXRouter) ist die Liste ihrer Routen wie früher der Modulrumpf;
  // ihre Handler zählen einzeln weiter.
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

test('der Kommentaranteil in db/, clients/ und scripts/ sinkt, nie steigt', () => {
  // Je Ordner eine Schranke, im Biome-Format.
  // Gegenprobe: 40 Kommentarzeilen an clients/ezb.ts gehängt → rot (clients).
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

test('Geschichte in Testkommentaren wird weniger, nie mehr', () => {
  // Ein Testkopf nennt, was geprüft wird, und seine Gegenproben (CLAUDE.md);
  // woher ein Test kam, steht im Commit. Gezählt werden Kommentarzeilen mit
  // den typischen Erzählmarken, auch „Gemessen … am <Datum>“.
  // Gegenprobe (05.11.2026): den alten Kopf von scope-reset.test.js zurück → rot.
  // Gegenprobe (14.11.2026): eine Zeile `// Gemessen 7 am` samt Datum an diesen Kopf gehängt → rot (4 von 3).
  const LIMIT = 3;

  const MARKE =
    /(Nachtr(ag|äge) [0-9]|Hier stand|Vorher stand|NACHGEMESSEN|kam(en)? am [0-9]|Gemessen\b[^.]*\bam [0-9]|Marcos (Frage|Wunsch|Bericht|Rückfrage|Konsole))/;
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
  assert.ok(ist > 0, 'keine Marke gefunden — greift die Suche noch?');
  assert.ok(ist <= LIMIT, `${ist} Kommentarzeilen mit Geschichte in den Tests, erlaubt sind ${LIMIT}`);
  if (ist < LIMIT) console.log(`  ℹ Geschichte in Testkommentaren: ${ist} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('der Kommentaranteil der Tests sinkt, nie steigt', () => {
  // Eigene Schranke: Testköpfe zählen ihre Gegenproben auf (CLAUDE.md), der
  // Anteil liegt deshalb höher als im Server. Geschichte gehört auch hier in
  // den Commit. Gezählt in test/*.js und test/helpers/, im Biome-Format.
  // Gegenprobe: 300 Kommentarzeilen an eine Testdatei gehängt → rot.
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

test('kein Verweis auf das frühere Begründungsarchiv', () => {
  // Lange Begründungen stehen nicht im Baum (CLAUDE.md); das Archiv ist über git erreichbar. Ratsche 0:
  // Ein Verweis darauf zeigte ins Leere. Das Skript findet dieselben Verweise, die es entfernt.
  // Gegenprobe (10.11.2026): `// Ausführlich: docs/…/x.md#a` (voller Pfad) in src/infra/appPaths.ts → rot
  // mit „src/infra/appPaths.ts“; den Ordner docs/begruendungen/ wieder angelegt → rot.
  assert.equal(
    fs.existsSync(path.join(WEB, 'docs', 'begruendungen')),
    false,
    'docs/begruendungen/ gehört nicht in den Baum',
  );
  const r = require('node:child_process').spawnSync(
    process.execPath,
    [path.join(WEB, 'scripts', 'begruendungen-entfernen.js'), '--pruefen'],
    { encoding: 'utf8' },
  );
  assert.equal(
    r.status,
    0,
    `Verweise ins frühere Archiv — \`node scripts/begruendungen-entfernen.js\` entfernt sie:\n${r.stdout}${r.stderr}`,
  );
});

test('der Kommentaranteil der Betriebsdateien sinkt, nie steigt', () => {
  // Workflows, Dockerfile, compose.yaml, tsconfig.json: Auch dort steht das
  // Warum in wenigen Zeilen, die Geschichte im Commit (CLAUDE.md). Das Caddyfile zählt nicht mit:
  // Kein Block darin ist länger als fünf Zeilen.
  // Gegenprobe (04.11.2026): 60 Kommentarzeilen an das Dockerfile → rot.
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

/** Kommentarblöcke mit mehr als fünf Zeilen Prosa (vor dem ersten @-Tag), wie im Prüfbericht gezählt.
 * Eine Liste der Gegenproben zählt nicht mit: Sie gehört nach CLAUDE.md in den Kopf eines Tests. */
function longBlocks(/** @type {string} */ text) {
  const z = text.split('\n');
  const COUNTER_CHECKS = /^\s*(\*|\/\/)\s*Gegenprobe/;
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

test('lange Kommentare in Tests, Skripten und index.html werden weniger, nie mehr', () => {
  // Im Code steht das Warum in wenigen Zeilen, die Geschichte im Commit (CLAUDE.md);
  // Gegenprobenlisten zählen nicht.
  // Gegenprobe (06.11.2026): sechs Zeilen Prosa vor die Gegenprobe im Kopf von hsts.test.js → rot (Tests 75).
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

test('Testdateien ohne Gegenprobe werden weniger, nie mehr', () => {
  // Jeder Test nennt im Kopf seine Gegenprobe (CLAUDE.md); die älteren ohne
  // werden beim Anfassen nachgetragen.
  // Gegenprobe (05.11.2026): in lint-ratsche.test.js „Gegenproben“ umbenannt → rot (112).
  const LIMIT = 70;
  const ohne = fs
    .readdirSync(__dirname)
    .filter(n => n.endsWith('.test.js'))
    .filter(n => !fs.readFileSync(path.join(__dirname, n), 'utf8').includes('Gegenprobe'));
  assert.ok(ohne.length <= LIMIT, `${ohne.length} Testdateien ohne Gegenprobe, erlaubt sind ${LIMIT}`);
  if (ohne.length < LIMIT)
    console.log(`  ℹ Testdateien ohne Gegenprobe: ${ohne.length} (Schranke ${LIMIT}) — Schranke nachziehen`);
});

test('in Testkommentaren genannte Pfade gibt es', () => {
  // Eine Gegenprobe, die eine verschwundene Datei nennt, lässt sich nicht wiederholen. Geprüft wird jede
  // Kommentarzeile in test/ und test/helpers/; ein .js-Pfad gilt auch, wenn die .ts-Quelle dazu existiert.
  // Gegenprobe (10.11.2026): in acquisition-scope-db.test.js den Pfad bei schreibbereich auf den früheren der
  // Set-Routen zurückgesetzt → rot mit dieser Zeile als Fundstelle. Gegenprobe (14.11.2026): ohne gebautes
  // Bündel und ohne ARTIFACTS → rot (buendel-gebaut.test.js); derselbe Pfad mit `app.bundle2.js` → rot.
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
  // Das Bündel entsteht erst mit `npm run build`; ein frischer Checkout hat es nicht.
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
