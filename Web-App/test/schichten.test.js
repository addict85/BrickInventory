/**
 * Die Abhängigkeiten zeigen nach innen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Was noch aus einer Route nach innen geholt wird — und warum es noch steht.
 */
const EXCEPTIONS = new Set([]);

/** Quelltext ohne Kommentare, zeilenweise: Ein Regex hielte das /* in '/data/x/*' für einen Kommentar. */
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

/** Alle .ts-Dateien der inneren Schichten. */
function innerFiles() {
  const gefunden = [];
  const lauf = rel => {
    const voll = path.join(ROOT, rel);
    if (!fs.existsSync(voll)) return;
    for (const e of fs.readdirSync(voll, { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind);
      else if (e.name.endsWith('.ts')) gefunden.push(kind);
    }
  };
  // startup/ ist ausgelagerter Serverstart (nur server.ts benutzt es) und
  // zählt zur äusseren Schicht; seine eigene Regel steht weiter unten.
  ['src', 'jobs', 'clients', 'db'].forEach(lauf);
  return gefunden;
}

/** Quelltext einer Datei (relativ zu ROOT) ohne Kommentare. */
function sourceText(rel) {
  return ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

/** Alle Ziele von import/require einer Datei (relativ zu ROOT), roh. */
function importe(rel) {
  const src = sourceText(rel);
  return [...src.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
}

/** Importe und require() aus routes/, je Datei. */
function afterOuter(rel) {
  const treffer = new Set();
  for (const ziel of importe(rel).filter(z => /routes\//.test(z)))
    treffer.add(ziel.replace(/^.*?(routes\/)/, '$1').replace(/\.js$/, ''));
  return [...treffer];
}

test('keine Fachschicht importiert aus routes/ — ausser den benannten Faellen', () => {
  const dateien = innerFiles();
  // Selbstbeweis: Findet die Suche keine Dateien, waere die Pruefung darunter
  // still gruen. GEMESSEN sind es ueber sechzig.
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

test('eine v1-Route importiert keine andere Routendatei', () => {
  // Gemeinsames gehört nach src/<bereich>/ (manualParts, manualMinifigs). Eine
  // Route, die eine Route importiert, zieht deren Router samt Middleware mit.
  // Gegenprobe (28.10.2026): require('../parts') in wanted.ts → rot.
  const ordner = path.join(ROOT, 'routes/api_v1');
  const dateien = fs.readdirSync(ordner).filter(f => f.endsWith('.ts'));
  assert.ok(dateien.length > 10, `nur ${dateien.length} v1-Dateien gefunden`);
  const treffer = [];
  for (const f of dateien)
    for (const ziel of importe(`routes/api_v1/${f}`).filter(z => /^\.\.\/[^.]/.test(z)))
      treffer.push(`api_v1/${f} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('keine Route importiert eine andere Routendatei', () => {
  // Erlaubt sind nur der Wächter (api_v1/middleware) und der Zusammenbau in
  // api_v1/index.ts, auth.ts (aus routes/auth/) und api_v1/settings.ts (settingsGlobal hinter requireLogin).
  // Gegenprobe (10.11.2026): `import { requireLogin } from '../auth'` in routes/api_v1/minifigs.ts → rot;
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

test('kein Zustand auf global', () => {
  // Was Prozesse teilen, steht in einem Modul (src/jobQueue/startState.ts) und
  // ist über den Import zu finden. Gegenprobe (29.10.2026): eine Zeile
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
  // Die Oberfläche teilt Zustand über public/js/state.js, nicht über `window._…`.
  // Gegenprobe (15.11.2026): `window._finGrandTotal = kopfWert` zurück in finanzen.js → rot.
  const js = path.join(ROOT, 'public', 'js');
  for (const f of fs.readdirSync(js).filter(f => f.endsWith('.js') && !f.includes('bundle')))
    for (const m of ohneKommentare(fs.readFileSync(path.join(js, f), 'utf8')).matchAll(/\bwindow\._[a-zA-Z]\w*/g))
      treffer.push(`public/js/${f}: ${m[0]}`);
  assert.deepEqual(treffer, []);
});

test('src/ und clients/ importieren nichts aus jobs/', () => {
  // Was src/ an Hintergrundarbeit anstösst, stellt es als Auftrag ein (src/jobQueue);
  // die Ausführung setzt startup/verdrahtung.ts ein.
  // Gegenprobe (28.10.2026): require('../jobs/imageQueue') in wanted.ts → rot.
  const treffer = [];
  for (const d of innerFiles().filter(f => /^(src|clients)\//.test(f)))
    for (const ziel of importe(d).filter(z => /jobs\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('db/, clients/ und jobs/ kennen keine HTTP-Antwort', () => {
  // Fehler melden sie über src/infra/fehler.ts; den Weg zur Antwort kennt nur
  // die HTTP-Seite (src/http/httpAntwort.ts, Routen).
  // Gegenprobe (05.11.2026): `import { fehlertext } from '../src/http/httpAntwort'`
  // in db/migrate.ts → rot.
  const treffer = [];
  for (const d of innerFiles().filter(f => /^(db|clients|jobs)\//.test(f)))
    for (const ziel of importe(d).filter(z => /httpAntwort|^express$/.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

/** Codezeilen ohne Leerzeilen und Kommentare. */
const codeRows = rel =>
  sourceText(rel)
    .split('\n')
    .filter(z => z.trim()).length;

test('jobs/ führt Aufträge aus, die Arbeit eines Auftrags steht in src/', () => {
  // jobs/ hält den Worker (Pacht, Wiederholung, Abbruch), die Bearbeitertabelle
  // und den Einstieg des Importprozesses; was ein Auftrag fachlich tut, liegt in src/<bereich>/.
  // Codezeilen im Biome-Format (Zeilenbreite 120).
  // Gegenproben (09.11.2026): `import * as db from '../db/database'` in jobs/auftraegeStarten.ts → rot
  // (db/); fetchAndCachePrice und statesJeSet zurück nach jobs/auftraegeStarten.ts → rot (113
  // Zeilen); `import { STAPEL } from '../src/images/imageDemand'` in jobs/auftragsWorker.ts → rot.
  const KERN = 'jobs/auftragsWorker.ts';
  const dateien = tsBelow('jobs');
  assert.ok(
    dateien.includes(KERN) && dateien.includes('jobs/auftraegeStarten.ts'),
    'Worker oder Bearbeitertabelle fehlt',
  );
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

test('db/ importiert nichts aus jobs/', () => {
  // Die Datenbankschicht ist die unterste; die Bilddienste startet
  // startup/datenbank.ts. Gegenprobe (28.10.2026): der Import von
  // setUpImageDemand zurück in db/database.ts → rot.
  const treffer = [];
  for (const d of innerFiles().filter(f => f.startsWith('db/')))
    for (const ziel of importe(d).filter(z => /jobs\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

/** Alle .ts-Dateien unter routes/, relativ zu ROOT. */
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

test('keine Route führt SQL aus oder importiert aus db/', () => {
  // Routen lesen die Anfrage, rufen einen Dienst und schreiben die Antwort;
  // Datenzugriff, Sperren und Benachrichtigungen stehen hinter src/<bereich>/.
  // Gegenproben: `import * as db from '../../db/database'` und eine db.get-Zeile
  // in routes/api_v1/catalog.ts → rot, beide Treffer (29.10.2026);
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

test('keine Route importiert aus jobs/ oder clients/', () => {
  // Jobs steuert eine Route über die Dienste von src/jobQueue und die Auftragstabelle,
  // fremde Dienste erreicht sie über einen Dienst in src/<bereich>/.
  // Gegenprobe (29.10.2026): `import { triggerNow } from '../../jobs/priceJob'`
  // in admin.ts und `import { getSetByEan } from '../../clients/brickset'` in
  // api_v1/sets.ts → rot, beide Treffer.
  const treffer = [];
  for (const d of routesFiles())
    for (const ziel of importe(d).filter(z => /(?:^|\/)(?:jobs|clients)\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('ins Netz geht nur clients/ über src/infra/abruf.ts', () => {
  // Host-Liste, Grössendeckel, Frist und Abbruch stehen in abruf.ts; die Klienten
  // legen Hosts und Kopfzeilen fest. Ein Abruf daneben hätte nichts davon.
  // Gegenprobe (05.11.2026): `import { holeHttps } from '../infra/abruf'` in
  // src/catalog/partsImport.ts zurück → rot: „src/catalog/partsImport.ts“.
  const ALLOWED = new Set(['src/infra/abruf.ts']);
  const treffer = tsBelow('src', 'routes', 'jobs', 'startup', 'db')
    .concat('server.ts')
    .filter(d => !ALLOWED.has(d))
    .filter(d => /\b(holeHttps|openHttps)\b|from '(?:node:)?https'|\bfetch\(/.test(sourceText(d)));
  assert.deepEqual(treffer, []);
});

test('startup/ und routes/ kennen einander nur in einer Richtung, Routerfabriken nehmen Pick<Dienste, …>', () => {
  // Was der Start anstösst (Aufräumläufe), steht in src/; eine Route gehört nur in
  // den Zusammenbau der App (startup/app.ts). Umgekehrt hängen routes/ und jobs/ nicht
  // an startup/: Den Typ Dienste gibt es in src/dienste.ts, und jede Routerfabrik
  // verengt ihn auf die Bereiche, die sie ruft.
  // Gegenproben: `import { startPdfJobCleanup } from '../routes/api_v1/pdf'` in
  // startup/jobsProzess.ts → rot (10.11.2026); `import type { Dienste } from
  // '../../startup/verdrahtung'` zurück in routes/api_v1/catalog.ts → rot mit dieser Datei,
  // `buildCatalogRouter(d: Dienste)` ebendort → rot mit „buildCatalogRouter“ (14.11.2026).
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

test('keine Importzyklen in den inneren Schichten', () => {
  // Ein Zyklus zwingt zu verzögertem require() und macht die Ladereihenfolge
  // zum Glücksspiel. `import type` zählt mit: Ein Typzyklus ist dieselbe
  // Verflechtung, nur ohne Folgen beim Laden.
  // Gegenproben: marketPrice.ts wieder über financeCalc → rot (28.10.2026);
  // (05.11.2026) `import type { SetMaster } from '../dienst'` in
  // src/sets/repository/setDetail.ts → rot (setDetail → dienst → setDetail).
  // (08.11.2026) `import('./database')` als Typ in db/migrate.ts → rot (migrate ↔ database).
  const dateien = new Set(innerFiles());
  const kanten = new Map();
  for (const d of dateien) {
    const src = sourceText(d);
    // Zwei getrennte Suchen: `import … from` nur am Zeilenanfang, `require(…)`/`import(…)` überall.
    const kopf = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]/gm)].map(m => m[1]);
    const call = [...src.matchAll(/(?:require|import)\(\s*['"](\.[^'"]+)['"]\s*\)?/g)].map(m => m[1]);
    const ziele = [...kopf, ...call]
      .map(r => path.posix.normalize(path.posix.join(path.posix.dirname(d), r)).replace(/\.js$/, ''))
      .flatMap(z => [z + '.ts', z + '/index.ts'])
      .filter(z => dateien.has(z));
    kanten.set(d, ziele);
  }
  const cycles = [];
  const zustand = new Map(); // 1 = auf dem Pfad, 2 = fertig
  const pfad = [];
  const visit = d => {
    zustand.set(d, 1);
    pfad.push(d);
    for (const z of kanten.get(d) || []) {
      if (zustand.get(z) === 1) cycles.push(pfad.slice(pfad.indexOf(z)).concat(z).join(' → '));
      else if (!zustand.has(z)) visit(z);
    }
    pfad.pop();
    zustand.set(d, 2);
  };
  for (const d of dateien) if (!zustand.has(d)) visit(d);
  assert.deepEqual(cycles, []);
});

test('die Ausnahmeliste bleibt ehrlich — jeder Eintrag hat noch einen Fall', () => {
  // ── Warum es diese zweite Haelfte braucht ─────────────────────────────────
  // Eine Ausnahmeliste, die nie schrumpft, ist keine Liste offener Punkte
  // mehr, sondern Tapete. Faellt ein Fall weg, muss der Eintrag mit — sonst
  // steht hier in einem Jahr eine Sammlung von Behauptungen ueber Code, den es
  // nicht mehr gibt.
  const alive = new Set();
  for (const d of innerFiles()) for (const ziel of afterOuter(d)) alive.add(`${d} -> ${ziel}`);

  const tot = [...EXCEPTIONS].filter(a => !alive.has(a));
  assert.deepEqual(tot, [], 'Diese Ausnahmen treffen auf nichts mehr zu — bitte aus der Liste streichen');
});

test('in routes/ liegt nichts, was keine Route ist', () => {
  // Woher diese Pruefung kommt
  const allowedWithoutRouter = {
    'imgProxy.ts': 'registriert seine Routen ueber app.get() statt router.get()',
    'api_v1/middleware.ts': 'Waechter FUER Routen; ohne Routen sinnlos',
  };
  // Wie bei EXCEPTIONS: Ein Eintrag ohne Datei ist tot.
  // Gegenprobe: 'mailer.ts' wieder eingetragen → rot.
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
    if (/\b(router|app)\.(get|post|put|delete|patch|use|endpunkt|attachOne)\s*\(/.test(src)) return false;
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

// ── Fachbereiche: src/<bereich>/ mit repository (SQL), Dienst und Routen ───────

/** Liegt die Datei in einem Repository (src/<bereich>/repository.ts oder …/repository/…)? */
const isRepository = rel => /(^|\/)repository(\/|\.ts$)/.test(rel);
/** Der Fachbereich einer Datei unter src/, sonst null. */
const areaOf = rel => (rel.match(/^src\/([^/]+)\//) || [])[1] || null;

/** Alle Ziele relativer Importe einer Datei, aufgelöst auf ROOT, mit import().
 * `import type` nur mit `withTypes`: Für die Ladereihenfolge verschwinden Typen
 * beim Übersetzen, für die Abhängigkeit zwischen Schichten nicht. */
function resolvedImports(rel, { withTypes = false } = {}) {
  const roh = sourceText(rel);
  const src = withTypes ? roh : roh.replace(/^\s*(?:import|export) type\b[^;]*;/gm, '');
  return [...src.matchAll(/(?:from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)].map(m =>
    path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])).replace(/\.js$/, ''),
  );
}

/** Alle .ts-Dateien unter den Ordnern, relativ zu ROOT. */
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

/** SQL im Code: eine Anweisung als Zeichenkette oder ein Aufruf auf einer Verbindung. */
const SQL_TEXT =
  /[`'"]\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+(?:\w+\s+)?SET|DELETE\s+FROM|WITH\s+(?:RECURSIVE\s+)?\w+|CREATE\s+(?:TABLE|INDEX|UNIQUE)|ALTER\s+TABLE|DROP\s|TRUNCATE|LISTEN|NOTIFY|UNLISTEN|SET\s+LOCAL|LOCK\s+TABLE|ANALYZE|VACUUM)\b/;
const SQL_AUFRUF = /\b(?:db|tx|client|pool)\.(?:run|get|all|query|exec)\s*(?:<[^>]*>)?\(/;
/** Auch ein Fragment mitten in einer Zeichenkette, etwa `EXISTS (SELECT 1 FROM …)`. */
const SQL_FRAGMENT = /\bSELECT\b[^;`'"]*\bFROM\b/;
/** Ein Stück einer Anweisung in einer Zeichenkette: Sortierung, Bedingung, Upsert, Join. */
const SQL_CLAUSE =
  /[`'"][^`'"\n]*\b(?:ILIKE|COALESCE\(|ON CONFLICT|EXCLUDED\.|NULLS (?:LAST|FIRST)|ORDER BY|GROUP BY|(?:LEFT |INNER )?JOIN \w+ \w+ ON|RETURNING|WHERE \w)/;
const hatSql = rel => {
  const s = sourceText(rel);
  return SQL_TEXT.test(s) || SQL_AUFRUF.test(s) || SQL_FRAGMENT.test(s) || SQL_CLAUSE.test(s);
};

test('SQL steht nur in Repositories und in db/', () => {
  // Ein Verbot, keine Ratsche mehr: Die Liste der Ausnahmen ist seit dem
  // 31.10.2026 leer. Gegenproben (31.10.2026): `await db.get('SELECT 1')` in
  // src/household/household.ts → rot; `'SELECT 1'` in src/management/cleanup.ts → rot;
  // (05.11.2026) das EXISTS-Fragment zurück nach src/finances/priceAlert.ts → rot.
  const dateien = tsBelow('src', 'jobs', 'clients', 'routes', 'startup').concat('server.ts');
  assert.ok(dateien.length > 150, `nur ${dateien.length} Dateien gefunden`);
  assert.deepEqual(
    dateien.filter(d => !isRepository(d) && hatSql(d)),
    [],
    'SQL gehört in das Repository des Bereichs (src/<bereich>/repository…).',
  );
  assert.ok(tsBelow('src').filter(isRepository).every(hatSql), 'ein Repository ohne SQL ist keines');
  // Die Klauselsuche muss in den Repositories greifen, sonst sähe sie auch draussen nichts.
  assert.ok(
    tsBelow('src')
      .filter(isRepository)
      .filter(d => SQL_CLAUSE.test(sourceText(d))).length > 30,
  );
});

/** Was ein Dienst aus db/database nehmen darf: die Arbeitseinheit und den Betrieb, keine Abfrage. */
// Seit 09.11.2026 auch das Anlegen des Zugangs (createDb …): Das tun nur server.ts und startup/;
// seit 10.11.2026 der Typ Db (Kontext eines Bereichs); standardDb() gibt es seit 11.11.2026 nicht mehr.
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
  'dbKonfigFromEnvironment',
  'TxOptions',
  'TxGriff',
]);

test('ausserhalb von repository/ und db/ fragt niemand die Datenbank ab', () => {
  // Die SQL-Suche oben liest Text; ein Aufruf unter anderem Namen (`datenbank.all(SQL)` mit dem
  // Text aus einem Repository) ginge an ihr vorbei. Gegenproben (09.11.2026):
  // `import * as datenbank from '../../db/database'` und `datenbank.all(repo.SQL)` in
  // src/sets/loeschen.ts → rot „src/sets/loeschen.ts: all“, die Prüfung oben blieb grün;
  // die Merklisten-Sortierung (COALESCE … NULLS LAST) zurück in src/wanted/wanted.ts → rot oben.
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

test('Routen, Aufträge und Clients importieren keine Repositories', () => {
  // Gegenprobe (31.10.2026): `import * as r from '../../src/account/repository/accounts'`
  // in routes/api_v1/admin.ts → rot.
  const treffer = [];
  for (const d of tsBelow('routes', 'jobs', 'clients', 'startup').concat('server.ts'))
    for (const z of resolvedImports(d)) if (isRepository(z)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);

  // xBereich() liefert gebundene Repositories und den Zugang (db); eine Route nimmt
  // die Dienste, die der Bereich in seiner index.ts anbietet. Gegenproben (13.11.2026):
  // `await kontoBereich().protokoll.protokolliere(…)` zurück in routes/auth/benutzer.ts
  // → rot „routes/auth/benutzer.ts: kontoBereich()“; `gutscheineBereich` als Import in
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
    CALL.test('await kontoBereich().konten.accountShort(1)') && tsBelow('routes').length > 15,
    'Selbstbeweis: das Muster findet einen Aufruf, und es gibt Routen',
  );
  assert.deepEqual(treffer, []);
  routesOnlyViaFactory();
  routesWithoutSlotFlow();
});

/** Fachabläufe (Mail, Token-Hash, Design-Cache) stehen in Diensten, nicht in Routen. */
function routesWithoutSlotFlow() {
  // Eine Route liest die Anfrage, ruft d und antwortet; wer src/mail, tokenDigest oder
  // forgetTheme importiert oder einen Bereich als Namensraum, baut den Ablauf selbst.
  // Gegenproben (14.11.2026): `import { tokenDigest } from '../../src/account'` in
  // routes/api_v1/settings.ts → rot; `import * as sets from '../../src/sets'` in
  // routes/api_v1/sets.ts → rot; `import { createMail } from '../../src/mail'` in
  // routes/auth/registrierung.ts → rot.
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

/** Die gebundenen Dienste je Bereich, wie src/<bereich>/bereich.ts sie anbietet. */
function boundServices() {
  const raus = new Map();
  for (const b of fs.readdirSync(path.join(ROOT, 'src'))) {
    const f = ['bereich.ts', 'area.ts'].map(n => path.join(ROOT, 'src', b, n)).find(p => fs.existsSync(p));
    if (!f) continue;
    const s = fs.readFileSync(f, 'utf8');
    const namen = new Set();
    for (const m of s.matchAll(/^ {4,8}(\w+): (?:mit\(|imSystem\(|\(\(|\(<)/gm)) namen.add(m[1]);
    raus.set(b, namen);
  }
  return raus;
}

/** Routen nehmen Dienste nur über ihre Fabrik (baueXRouter(d)). */
function routesOnlyViaFactory() {
  // Ein Import aus der index.ts liefe über die Fassade des Prozesses; die Route sähe
  // nicht, welche Dienste sie braucht. Ausgenommen: die Wächter vor allen Routern.
  // Gegenprobe (13.11.2026): `import { readParts } from '../../src/parts'` in
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

/** Dienste, die noch einen rohen Griff nehmen; die Liste darf nur schrumpfen. Der Katalog
 * wird gerade geteilt (eigener Zweig): dort folgt die Umstellung auf `t`. */
const RAW_HANDLE_STILL = new Set(['src/catalog/catalogMaintenance.ts']);

/** Eine Arbeitseinheit steht am Aufrufort: k.transaktion(t => …). */
function workUnitAtCallLocation() {
  // Eine Transaktionsform: Dienste öffnen sie mit k.transaktion, der Rumpf bekommt den
  // Kontext der Transaktion (t); Repositories nehmen den tx des Aufrufers. `.transaction(`
  // steht nur in src/infra/bereich.ts und db/.
  // Gegenproben: (13.11.2026) in src/collection/deletion.ts wieder `k.db.transaction(async tx =>`
  // → rot; (13.11.2026) ebenso in src/inventory/setStorageLocation.ts und in
  // src/factors/repository/secondFactor.ts → rot „…: .transaction(“.
  // Ebenso db/txLock.ts: Bestandssperren sind eine Option von k.transaktion, kein eigener
  // Weg mit rohem tx; und kein Dienst nimmt einen rohen Griff (tx/dbh), er nimmt `t`.
  // Gegenproben (14.11.2026): eine Funktion mit `z.transaction(` in db/txLock.ts → rot
  // „db/txLock.ts: .transaction(“; `export async function probe(tx: DbInterface, …)` in
  // src/inventory/trash.ts → rot „…: Dienst mit rohem Griff probe“.
  const treffer = [];
  const alle = [...tsBelow('src', 'routes', 'jobs', 'clients', 'startup'), 'server.ts', 'db/txLock.ts'];
  for (const d of alle) {
    const s = sourceText(d);
    if (d !== 'src/infra/bereich.ts' && /\.transaction\s*(?:<[^>]*>)?\(/.test(s)) treffer.push(`${d}: .transaction(`);
    if (/transaktion\(\s*(?:async\s*)?\(\)/.test(s)) treffer.push(`${d}: transaktion ohne Kontext`);
    if (d.startsWith('src/') && !isRepository(d) && !RAW_HANDLE_STILL.has(d))
      for (const m of s.matchAll(/export\s+(?:async\s+)?function\s+(\w+)[^(]*\(([^)]*)\)/g))
        if (/\b(?:tx|dbh)\??\s*:\s*(?:Pick<\s*)?(?:DbInterface|Db|Schreiber)\b/.test(m[2]))
          treffer.push(`${d}: Dienst mit rohem Griff ${m[1]}`);
  }
  assert.ok(
    tsBelow('src').some(d => /\.transaktion\(async t\b/.test(sourceText(d))) &&
      /\.transaction\(/.test(sourceText('src/infra/bereich.ts')),
    'Selbstbeweis: es gibt Arbeitseinheiten, und die Suche findet die eine Stelle',
  );
  assert.deepEqual(treffer, []);
}

test('ein Fachbereich greift auf einen anderen nur über dessen Dienste und index.ts zu', () => {
  // Das Repository eines Bereichs ist sein Inneres; andere Bereiche nutzen die
  // Dienste. Gegenprobe (31.10.2026): `import { accountShort } from
  // '../konto/repository/konten'` in src/household/household.ts → rot.
  const treffer = [];
  const dateien = tsBelow('src');
  assert.ok(dateien.filter(isRepository).length >= 10, 'zu wenige Repositories gefunden');
  for (const d of dateien)
    for (const z of resolvedImports(d)) if (isRepository(z) && areaOf(z) !== areaOf(d)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);

  // Und auch die Dienste nur über die index.ts des Bereichs:
  // Wie ein Bereich seine Dateien schneidet, bleibt so seine Sache. Ausgenommen
  // sind die Helfer ohne Fachbereich (infra, vertrag, http) und die HTTP-Seiten
  // unter src/<bereich>/http/, die nur Routen und der Zusammenbau holen.
  // Gegenprobe (11.11.2026): `export { catalogPart as _probe } from '../katalog/katalogPflege'`
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
  const tiefe = dateien =>
    dateien.flatMap(d =>
      resolvedImports(d, { withTypes: true })
        .filter(z => tief(d, z))
        .map(z => `${d} -> ${z}`),
    );
  // Gegenprobe (11.11.2026): `import { USERNAME_RE } from '../../src/account/nameRules'`
  // in routes/auth/benutzer.ts → rot.
  assert.deepEqual(tiefe(tsBelow('src', 'jobs', 'startup', 'routes').concat('server.ts')), []);
  const indizes = tsBelow('src').filter(d => /^src\/[^/]+\/index\.ts$/.test(d));
  assert.ok(indizes.length >= 15, `nur ${indizes.length} index.ts gefunden`);
  indexWithoutAccess(indizes);
});

/** Mit Zugang: ein Datenbankzugang, Kontext oder Dienstesatz als Parameter, oder asynchron (Netz, Dateien). */
const ACCESS_PARAMETER = /\b(?:Db|DbInterface|Pool|PoolClient|ClientBase|\w+Kontext|\w+Dienste)\b/;

/** Die Deklaration eines exportierten Namens, auch über `export { … } from` und Importe weiter. */
function declaration(rel, name, tiefe = 0) {
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
      if (b === name && tiefe < 3) return declaration(path.posix.join(path.posix.dirname(voll), m[2]), a, tiefe + 1);
    }
  return null;
}

/** Was eine index.ts als Wert hergibt, ausser der Fabrik (erzeugeX), samt Zugang. */
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

/** Ein Bereich gibt über index.ts nur Typen, seine Fabrik und reine Funktionen her: Was Datenbank,
 * Netz oder Dateien braucht, ruft ein anderer Bereich über den Kontext (`k.<bereich>.…`), damit es
 * in einer Transaktion über `t` läuft und ein Test es an der Verdrahtung ersetzt. */
function indexWithoutAccess(indizes) {
  // Gegenproben (14.11.2026): `export { catalogStatus } from './setStamm'` zurück in
  // src/catalog/index.ts → rot (src/catalog.catalogStatus); `export { vorschauErzeugenAus } from './thumbs'`
  // in src/images/index.ts → rot (asynchron).
  const alle = indizes.filter(i => !/^src\/(?:infra|contract|http)\//.test(i)).flatMap(valueExports);
  assert.ok(alle.length > 50, `nur ${alle.length} Wertexporte gefunden — greift die Suche noch?`);
  assert.ok(
    alle.some(x => x.name === 'src/household.asIds' && !x.zugang) &&
      declaration('src/sets/lesen', 'setsLesen')?.zugang &&
      declaration('src/images/thumbs', 'vorschauErzeugenAus')?.zugang,
    'Selbstbeweis: asIds ist rein, setsLesen (Kontext) und vorschauErzeugenAus (asynchron) haben Zugang',
  );
  assert.deepEqual(
    alle.filter(x => x.zugang).map(x => x.name),
    [],
    'Über den Kontext reichen (Dienst des Bereichs), nicht als Import',
  );
}

/** Ein Modul ohne relative Importe (Zeilentypen, Konstanten) hängt an nichts. */
const isSheet = rel => !/(?:from\s+|import\(\s*)['"]\./.test(sourceText(rel + '.ts'));

test('ein Repository kennt keine Dienste, auch nicht deren Typen', () => {
  // Gegenproben: `import { getSetting } from '../settings'` in
  // src/settings/repository/values.ts → rot (31.10.2026); (05.11.2026)
  // `import type { SetMaster } from '../dienst'` zurück in
  // src/sets/repository/setDetail.ts → rot.
  const treffer = [];
  for (const d of tsBelow('src').filter(isRepository))
    for (const z of resolvedImports(d, { withTypes: true }))
      if (z.startsWith('src/') && !isRepository(z) && areaOf(z) !== 'infra' && !isSheet(z))
        treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);
});

test('Routen lösen keine Konten auf — das tun die Dienste', () => {
  // Eine Route gibt die Sicht (viewOf) oder den Wunsch weiter; die Regeln des
  // Haushalts stehen in src/household und den Diensten, die sie anwenden.
  // Gegenprobe (05.11.2026): `await scopeIds(req.apiUser.user_id)` zurück in
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

/** Die HTTP-Seite eines Bereichs (Middleware, Sitzung): src/<bereich>/http/. */
const isHttp = rel => /^src\/[^/]+\/http\//.test(rel);

test('Express kennen nur src/http, die HTTP-Seiten der Bereiche und die Routen', () => {
  // Gegenproben (31.10.2026): `import type { Request } from 'express'` in
  // src/sets/dienst.ts → rot; dasselbe in src/account/loginLimiter.ts → rot.
  // (10.11.2026): dasselbe in src/infra/geld.ts, src/contract/base.ts und
  // db/txLock.ts → rot.
  const usesExpress = d =>
    /from\s+['"]express['"]|import\(\s*['"]express['"]\s*\)|require\(\s*['"]express['"]\s*\)/.test(sourceText(d));
  // startup/app.ts baut die App zusammen, wie zuvor server.ts.
  const treffer = tsBelow('src', 'db', 'clients', 'jobs', 'startup')
    .filter(d => areaOf(d) !== 'http' && !isHttp(d) && d !== 'startup/app.ts')
    .filter(usesExpress);
  assert.deepEqual(treffer, []);
  assert.ok(tsBelow('src/http').filter(usesExpress).length >= 8, 'die Suche findet Express in src/http nicht mehr');
  assert.ok(tsBelow('src').some(isHttp), 'keine HTTP-Seite unter src/<bereich>/http/ gefunden');

  // Dienste antworten mit einer Fehlerart, nicht mit einem HTTP-Status; clients/
  // spricht selbst HTTP nach aussen. Gegenprobe (10.11.2026): in
  // src/account/passwordConfirmation.ts wieder `return { status: 429, ...gesperrt }` → rot.
  const STATUS = /\bstatus\s*:\s*[1-5]\d\d\b|\bres\.status\(/;
  // Gegenprobe (11.11.2026): `res.status(304)` zurück in src/images/imgCacheServe.ts → rot.
  const withStatus = tsBelow('src', 'db', 'jobs')
    .filter(d => areaOf(d) !== 'http' && !isHttp(d))
    .filter(d => STATUS.test(sourceText(d)));
  assert.deepEqual(withStatus, []);
});

test('nur Routen, Server und HTTP-Seiten importieren eine HTTP-Seite oder src/http', () => {
  // Ein Dienst, der die HTTP-Seite importiert, hängt wieder am Request.
  // Gegenprobe (31.10.2026): `import { adresse } from './http/anmeldung'` in
  // src/account/deviceToken.ts → rot.
  const treffer = [];
  for (const d of tsBelow('src', 'jobs', 'clients').filter(d => !isHttp(d)))
    for (const z of resolvedImports(d)) if (isHttp(z)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);

  // Dasselbe für src/http/: Die gemeinsamen Helfer hängen am Request, ein Dienst,
  // der sie holt, hinge es auch; umgekehrt kennt src/http nur src/infra.
  // Gegenproben (08.11.2026): `import { errorResponse } from '../http/httpAntwort'`
  // in src/account/deviceToken.ts → rot; `import { setKey } from '../sets/dienst'` in
  // src/http/httpAntwort.ts → rot.
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

/** Routen fangen nichts: Ströme reichen ihren Fehler mit .then(…, …) als letztes Ereignis weiter. */
const TRY_IN_ROUTES = new Map([]);
/** Wo eine Route doch selbst antwortet, mit Grund. Sonst wirft sie (`fachfehler`, `notFound`). */
const SEND_ERROR_IN_ROUTES = new Map([
  // bodyDeadline: Die Uhr läuft nach next(); ein Wurf erreichte keinen Fehlerweg mehr.
  ['routes/api_v1/middleware.ts', 1],
]);

test('Routen fangen keine Fehler — der Fehlerweg des Routers antwortet', () => {
  // Gegenproben: eine Route in routes/api_v1/minifigs.ts wieder in `try { … } catch (e) {
  // handleRouteError(res, e, undefined, req); }` gehüllt → rot (31.10.2026). In parts.ts
  // `return sendError(req, res, 404, 'teil_nicht_manuell')` statt notFound → rot
  // „sendError in Routen“; in settings.ts wieder `String(req.eingabe.condition ?? '')` → rot
  // „Umwandlungen geprüfter Eingaben“ (14.11.2026). Absagen der Dienste (15.11.2026): in
  // routes/auth/benutzer.ts wieder `if (r === LAST_ADMIN) fachfehler(…)` → rot „Route
  // übersetzt eine Absage“; ebenso `if ((await d.konto.kontoEntfernen(uid, null)) !== 'entfernt')
  // fachfehler(…)` in routes/auth.ts → rot.
  const ist = new Map();
  const senden = new Map();
  const conversions = [];
  const rejections = [];
  for (const d of tsBelow('routes')) {
    const q = sourceText(d);
    // Eine Absage wirft der Dienst (fachfehler); ein Zustand, der die Antwort formt, bleibt erlaubt.
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
  // Der Vertrag liefert das Fachformat (z.transform); eine Route wandelt nicht nach.
  assert.deepEqual(conversions, [], 'Umwandlungen geprüfter Eingaben in Routen');
  assert.deepEqual(rejections, [], 'Route übersetzt eine Absage des Dienstes');
});

// ── Rangfolge der Bereiche ──────────────────────────────────────────────────

/** Von unten nach oben. Ein Bereich importiert nur Bereiche tieferer Stufen;
 * Bereiche derselben Stufe kennen einander nicht. Ein neuer Ordner braucht
 * eine Stufe, sonst ist der Test rot. */
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
  ['src/dienste.ts'],
  ['jobs', 'routes'],
  ['startup'],
  ['server.ts'],
];
const levelOf = new Map(LEVELS.flatMap((s, i) => s.map(b => [b, i])));
const areaName = rel => (rel.startsWith('src/') ? rel.split('/').slice(0, 2).join('/') : rel.split('/')[0]);

/** Je Datei, wer sie importiert, wie der Übersetzer es auflöst: auch `import type`, import()
 * und `export … from`. Eine Regex verfehlte Typimporte und Pfade über index.ts. */
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
/** Kanten zwischen Bereichen aus tsc --explainFiles über tsconfig.json; einmal je Lauf. */
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

test('jeder Bereich importiert nur Bereiche tieferer Stufen', () => {
  // Gegenproben (05.11.2026): `import { getSetting } from '../src/settings/settings'`
  // in clients/brickset.ts → rot (clients → src/settings); dasselbe mit
  // `import { withVersion } from '../sets/setNummer'` in src/catalog/service.ts,
  // nachdem setNummer wieder unter src/sets lag → rot (katalog → sets).
  // Gegenproben (15.11.2026, Übersetzer statt Regex): `import type { Db } from '../../db/database'`
  // in src/infra/bereich.ts → rot (src/infra → db); die Stufe von src/dienste.ts gestrichen
  // → rot „Bereich ohne Stufe“; die späte Bindung `d().katalog.…` zurück in verdrahtung.ts → rot.
  assert.deepEqual(
    translatorEdges("a.ts\n   Imported via './a' from file 'b.ts'\nc.ts\n   Matched by include pattern"),
    [{ d: 'b.ts', ziel: 'a.ts' }],
    'Selbstbeweis: die Ausgabe von --explainFiles wird gelesen',
  );
  // Ein höherer Bereich horcht auf ein Ereignis des tieferen; späte Bindung umginge die Stufen.
  assert.doesNotMatch(sourceText('startup/verdrahtung.ts'), /\bd\(\)\.\w+/, 'späte Bindung in der Verdrahtung');
  const kanten = areaEdges();
  assert.ok(kanten.length > 500, `nur ${kanten.length} Kanten gefunden — greift die Suche noch?`);
  const withoutLevel = [...new Set(kanten.flatMap(k => [k.von, k.nach]))].filter(b => !levelOf.has(b));
  assert.deepEqual(withoutLevel, [], 'Bereich ohne Stufe: in LEVELS eintragen');
  const falsch = kanten
    .filter(k => levelOf.get(k.nach) >= levelOf.get(k.von))
    .map(k => `${k.d} -> ${k.ziel} (${k.von} → ${k.nach})`);
  assert.deepEqual(falsch, []);
});

test('Klienten erreicht man nur über src/externalSources/sources.ts', () => {
  // Dort bekommen sie Schlüssel, Kontingent und Drossel ihres Zugangs; ein Weg daran
  // vorbei fände keinen Schlüssel. Auch `import type` zählt, Ausnahmen gibt es keine.
  // Gegenproben: `import { lookupPart } from '../../clients/rebrickable'` in
  // src/parts/manualParts.ts → rot (05.11.2026); `import { createBrickset } from
  // '../clients/brickset'` in startup/verdrahtung.ts → rot (14.11.2026).
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

test('docs/architektur.md nennt die Rangfolge der Bereiche wie LEVELS', () => {
  // Gegenprobe: in der Tabelle `src/mail` und `src/settings` vertauscht → rot.
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architektur.md'), 'utf8');
  const tabelle = doc.slice(doc.indexOf('## Rangfolge der Bereiche'), doc.indexOf('## API-Vertrag'));
  const stufen = [...tabelle.matchAll(/^\| (\d+) \| (.+) \|$/gm)].map(m =>
    [...m[2].matchAll(/`([^`]+)`/g)].map(b => b[1]),
  );
  assert.ok(stufen.length > 5, 'Die Tabelle der Rangfolge ist nicht zu finden');
  assert.deepEqual(stufen, LEVELS);
});

test('die Warteschlange kennt keine Fachbereiche und Nutzlastformen, Ereignisse laufen über ereignis.ts', () => {
  // Gegenproben (15.11.2026): `import type { CatalogServices } from '../katalog'` in
  // src/jobQueue/service.ts → rot (Kante src/jobQueue → src/catalog); `const P = z.object({})` in
  // src/jobQueue/kinds.ts → rot (Nutzlastform); `'brickset'` zurück in src/jobQueue/service.ts → rot.
  const ALLOWED = new Set(['src/infra', 'src/settings', 'db']);
  const fremd = areaEdges()
    .filter(k => k.von === 'src/jobQueue' && !ALLOWED.has(k.nach))
    .map(k => `${k.d} -> ${k.ziel}`);
  assert.deepEqual(fremd, [], 'src/jobQueue importiert einen Fachbereich');

  const dateien = tsBelow('src/jobQueue');
  const shapes = dateien.filter(d => /\bz\.(?:object|enum|array|union|discriminatedUnion)\(/.test(sourceText(d)));
  assert.deepEqual(shapes, [], 'Nutzlastform in src/jobQueue: in den Bereich, der die Art anmeldet');

  // Die Arten stehen dort, wo die Bereiche ihre Nutzlast melden (declare module … JobPayloads).
  const arten = tsBelow('src')
    .flatMap(d => [...sourceText(d).matchAll(/interface JobPayloads \{([^}]*)\}/g)])
    .flatMap(m => [...m[1].matchAll(/^\s*(\w+):/gm)].map(a => a[1]));
  assert.ok(arten.length > 15, `nur ${arten.length} angemeldete Arten gefunden — greift die Suche noch?`);
  const literale = dateien.flatMap(d =>
    [...sourceText(d).matchAll(/['"`](\w+)['"`]/g)].filter(m => arten.includes(m[1])).map(m => `${d}: ${m[1]}`),
  );
  assert.deepEqual(literale, [], 'src/jobQueue nennt eine Auftragsart');

  // Ereignisse laufen über src/infra/ereignis.ts, nicht über eigene Horcher.
  // Gegenproben (15.11.2026): in src/settings/userSetting.ts wieder
  // `fach('currencyChange', () => new Set<() => void>())` → rot (eigene Horcher);
  // in src/jobQueue/importJob.ts wieder `k.db.notification.listen('csv_import_progress', f)`
  // → rot (NOTIFY von Hand); `new EventEmitter()` zurück in importAuftrag.ts → rot.
  const EREIGNIS = 'src/infra/ereignis.ts';
  const alle = tsBelow('src', 'routes', 'jobs').filter(d => d !== EREIGNIS);
  const treffer = muster =>
    alle.flatMap(d => [...sourceText(d).matchAll(muster)].map(m => `${d}: ${m[0].replace(/\s+/g, ' ')}`));
  assert.ok(/new Set<Listener<A>>/.test(sourceText(EREIGNIS)), 'Selbstbeweis: die Horcher stehen in ereignis.ts');
  assert.deepEqual(treffer(/new Set<\s*(?:\(|\w*(?:Horcher|Listener)\b)/g), [], 'eigene Horcher: ereignis() nehmen');
  assert.deepEqual(treffer(/\bbenachrichtigung\s*\.\s*(?:listen|unlisten|notify)\(/g), [], 'NOTIFY von Hand');
  assert.deepEqual(treffer(/\bnew EventEmitter\b/g), [], 'eigener Ereignisbus');
});
