/**
 * Die Abhängigkeiten zeigen nach innen.
 * Ausführlich: docs/begruendungen/test/schichten.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Was noch aus einer Route nach innen geholt wird — und warum es noch steht.
 * Ausführlich: docs/begruendungen/test/schichten.test.js.md#ausnahmen
 */
const AUSNAHMEN = new Set([]);

/** Quelltext ohne Kommentare — zeilenweise, siehe test/baumbruecken.test.js. */
function ohneKommentare(s) {
  const zeilen = [];
  let imBlock = false;
  for (const z of String(s).split('\n')) {
    const t = z.trim();
    if (imBlock) { zeilen.push(''); if (t.endsWith('*/')) imBlock = false; continue; }
    if (t.startsWith('/*')) { zeilen.push(''); if (!t.includes('*/')) imBlock = true; continue; }
    zeilen.push(t.startsWith('//') || t.startsWith('*') ? '' : z);
  }
  return zeilen.join('\n');
}

/** Alle .ts-Dateien der inneren Schichten. */
function innereDateien() {
  const gefunden = [];
  const lauf = (rel) => {
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
function quelltext(rel) {
  return ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

/** Alle Ziele von import/require einer Datei (relativ zu ROOT), roh. */
function importe(rel) {
  const src = quelltext(rel);
  return [...src.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
}

/** Importe und require() aus routes/, je Datei. */
function nachAussen(rel) {
  const treffer = new Set();
  for (const ziel of importe(rel).filter(z => /routes\//.test(z)))
    treffer.add(ziel.replace(/^.*?(routes\/)/, '$1').replace(/\.js$/, ''));
  return [...treffer];
}

test('keine Fachschicht importiert aus routes/ — ausser den benannten Faellen', () => {
  const dateien = innereDateien();
  // Selbstbeweis: Findet die Suche keine Dateien, waere die Pruefung darunter
  // still gruen. GEMESSEN sind es ueber sechzig.
  assert.ok(dateien.length > 40,
    `Nur ${dateien.length} Dateien in den inneren Schichten gefunden — Ordner umbenannt?`);

  const neu = [];
  for (const d of dateien)
    for (const ziel of nachAussen(d)) {
      const marke = `${d} -> ${ziel}`;
      if (!AUSNAHMEN.has(marke)) neu.push(marke);
    }
  assert.deepEqual(neu, [],
    'Neue Abhaengigkeit von einer Fachdatei auf eine ROUTE. Die Funktion gehoert ' +
    'in die Schicht, die sie braucht — sonst zieht jeder Nutzer den HTTP-Apparat ' +
    'mit. Kommt sie nicht anders unter, gehoert sie oben in AUSNAHMEN, mit Grund.');
});

test('eine v1-Route importiert keine andere Routendatei', () => {
  // Gemeinsames gehört nach src/<bereich>/ (manuelleTeile, manuelleFiguren). Eine
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
  // api_v1/index.ts und auth.ts (aus routes/auth/). Gegenprobe (29.10.2026): `import { requireLogin } from
  // './auth'` zurück in routes/minifigs.ts → rot.
  const dateien = [];
  const lauf = (rel) => {
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
      if (voll.startsWith('routes/') && voll !== 'routes/api_v1/middleware'
          && !(d === 'routes/auth.ts' && voll.startsWith('routes/auth/'))) treffer.push(`${d} -> ${ziel}`);
    }
  assert.deepEqual(treffer, []);
});

test('kein Zustand auf global', () => {
  // Was Prozesse teilen, steht in einem Modul (src/auftraege/startZustand.ts) und
  // ist über den Import zu finden. Gegenprobe (29.10.2026): eine Zeile
  // `global.startupStatus = …` in server.ts → rot.
  const treffer = [];
  for (const d of ['server.ts', ...innereDateien(), ...fs.readdirSync(path.join(ROOT, 'startup')).map(f => `startup/${f}`),
                   ...fs.readdirSync(path.join(ROOT, 'routes')).filter(f => f.endsWith('.ts')).map(f => `routes/${f}`)])
    for (const m of quelltext(d).matchAll(/\b(?:global|globalThis)\s*(?:as\s+\w+\s*\)\s*)?\.\s*\w+\s*=[^=]|\(\s*(?:global|globalThis)\s+as\s+any\s*\)/g))
      treffer.push(`${d}: ${m[0].trim()}`);
  assert.deepEqual(treffer, []);
});

test('src/ und clients/ importieren nichts aus jobs/', () => {
  // Was src/ an Hintergrundarbeit anstösst, läuft über src/auftraege/nacharbeit.ts;
  // die Ausführung setzt jobs/verdrahtung.ts ein.
  // Gegenprobe (28.10.2026): require('../jobs/imageQueue') in merkliste.ts → rot.
  const treffer = [];
  for (const d of innereDateien().filter(f => /^(src|clients)\//.test(f)))
    for (const ziel of importe(d).filter(z => /jobs\//.test(z)))
      treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('db/, clients/ und jobs/ kennen keine HTTP-Antwort', () => {
  // Fehler melden sie über src/infra/fehler.ts; den Weg zur Antwort kennt nur
  // die HTTP-Seite (src/http/httpAntwort.ts, Routen).
  // Gegenprobe (05.11.2026): `import { fehlertext } from '../src/http/httpAntwort'`
  // in db/migrate.ts → rot.
  const treffer = [];
  for (const d of innereDateien().filter(f => /^(db|clients|jobs)\//.test(f)))
    for (const ziel of importe(d).filter(z => /httpAntwort|^express$/.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('db/ importiert nichts aus jobs/', () => {
  // Die Datenbankschicht ist die unterste; die Bilddienste startet
  // startup/datenbank.ts. Gegenprobe (28.10.2026): der Import von
  // initImageQueue zurück in db/database.ts → rot.
  const treffer = [];
  for (const d of innereDateien().filter(f => f.startsWith('db/')))
    for (const ziel of importe(d).filter(z => /jobs\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

/** Alle .ts-Dateien unter routes/, relativ zu ROOT. */
function routenDateien() {
  const dateien = [];
  const lauf = (rel) => {
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
  const dateien = routenDateien();
  assert.ok(dateien.length > 15, `nur ${dateien.length} Routendateien gefunden`);
  const treffer = [];
  for (const d of dateien) {
    for (const m of quelltext(d).matchAll(/\b(?:db|tx)\.(?:get|all|run|exec|transaction|pool)\b/g)) treffer.push(`${d}: ${m[0]}`);
    for (const ziel of importe(d).filter(z => /(?:^|\/)db\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  }
  assert.deepEqual(treffer, []);
});

test('keine Route importiert aus jobs/ oder clients/', () => {
  // Jobs steuert eine Route über src/auftraege/nacharbeit.ts und die Auftragstabelle,
  // fremde Dienste erreicht sie über einen Dienst in src/<bereich>/.
  // Gegenprobe (29.10.2026): `import { triggerNow } from '../../jobs/priceJob'`
  // in admin.ts und `import { getSetByEan } from '../../clients/brickset'` in
  // api_v1/sets.ts → rot, beide Treffer.
  const treffer = [];
  for (const d of routenDateien())
    for (const ziel of importe(d).filter(z => /(?:^|\/)(?:jobs|clients)\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('ins Netz geht nur clients/ über src/infra/abruf.ts', () => {
  // Host-Liste, Grössendeckel, Frist und Abbruch stehen in abruf.ts; die Klienten
  // legen Hosts und Kopfzeilen fest. Ein Abruf daneben hätte nichts davon.
  // Gegenprobe (05.11.2026): `import { holeHttps } from '../infra/abruf'` in
  // src/katalog/partsImport.ts zurück → rot: „src/katalog/partsImport.ts“.
  const ERLAUBT = new Set(['src/infra/abruf.ts']);
  const treffer = tsUnter('src', 'routes', 'jobs', 'startup', 'db').concat('server.ts')
    .filter(d => !ERLAUBT.has(d))
    .filter(d => /\b(holeHttps|oeffneHttps)\b|from '(?:node:)?https'|\bfetch\(/.test(quelltext(d)));
  assert.deepEqual(treffer, []);
});

test('startup/ importiert nichts aus routes/', () => {
  // Was der Start anstösst (Aufräumläufe), steht in src/; eine Route
  // gehört nur in server.ts.
  // Gegenprobe (29.10.2026): startPdfJobCleanup wieder aus
  // '../routes/api_v1/pdf' in startup/backgroundJobs.ts → rot.
  const treffer = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'startup')).filter(f => f.endsWith('.ts')))
    for (const ziel of importe(`startup/${f}`).filter(z => /routes\//.test(z))) treffer.push(`startup/${f} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('keine Importzyklen in den inneren Schichten', () => {
  // Ein Zyklus zwingt zu verzögertem require() und macht die Ladereihenfolge
  // zum Glücksspiel. `import type` zählt mit: Ein Typzyklus ist dieselbe
  // Verflechtung, nur ohne Folgen beim Laden.
  // Gegenproben: marketPrice.ts wieder über financeCalc → rot (28.10.2026);
  // (05.11.2026) `import type { SetStamm } from '../dienst'` in
  // src/sets/repository/setDetail.ts → rot (setDetail → dienst → setDetail).
  // (08.11.2026) `import('./database')` als Typ in db/migrate.ts → rot (migrate ↔ database).
  const dateien = new Set(innereDateien());
  const kanten = new Map();
  for (const d of dateien) {
    const src = quelltext(d);
    // Zwei getrennte Suchen: `import … from` nur am Zeilenanfang, `require(…)`/`import(…)` überall.
    const kopf = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]/gm)].map(m => m[1]);
    const aufruf = [...src.matchAll(/(?:require|import)\(\s*['"](\.[^'"]+)['"]\s*\)?/g)].map(m => m[1]);
    const ziele = [...kopf, ...aufruf]
      .map(r => path.posix.normalize(path.posix.join(path.posix.dirname(d), r)).replace(/\.js$/, ''))
      .flatMap(z => [z + '.ts', z + '/index.ts']).filter(z => dateien.has(z));
    kanten.set(d, ziele);
  }
  const zyklen = [];
  const zustand = new Map();   // 1 = auf dem Pfad, 2 = fertig
  const pfad = [];
  const besuche = (d) => {
    zustand.set(d, 1); pfad.push(d);
    for (const z of kanten.get(d) || []) {
      if (zustand.get(z) === 1) zyklen.push(pfad.slice(pfad.indexOf(z)).concat(z).join(' → '));
      else if (!zustand.has(z)) besuche(z);
    }
    pfad.pop(); zustand.set(d, 2);
  };
  for (const d of dateien) if (!zustand.has(d)) besuche(d);
  assert.deepEqual(zyklen, []);
});

test('die Ausnahmeliste bleibt ehrlich — jeder Eintrag hat noch einen Fall', () => {
  // ── Warum es diese zweite Haelfte braucht ─────────────────────────────────
  // Eine Ausnahmeliste, die nie schrumpft, ist keine Liste offener Punkte
  // mehr, sondern Tapete. Faellt ein Fall weg, muss der Eintrag mit — sonst
  // steht hier in einem Jahr eine Sammlung von Behauptungen ueber Code, den es
  // nicht mehr gibt.
  const lebend = new Set();
  for (const d of innereDateien())
    for (const ziel of nachAussen(d)) lebend.add(`${d} -> ${ziel}`);

  const tot = [...AUSNAHMEN].filter(a => !lebend.has(a));
  assert.deepEqual(tot, [],
    'Diese Ausnahmen treffen auf nichts mehr zu — bitte aus der Liste streichen');
});

test('in routes/ liegt nichts, was keine Route ist', () => {
  // Woher diese Pruefung kommt
  // Ausführlich: docs/begruendungen/test/schichten.test.js.md#erlaubtohnerouter
  const erlaubtOhneRouter = {
    'imgProxy.ts':          'registriert seine Routen ueber app.get() statt router.get()',
    'api_v1/middleware.ts': 'Waechter FUER Routen; ohne Routen sinnlos',
  };
  // Wie bei AUSNAHMEN: Ein Eintrag ohne Datei ist tot.
  // Gegenprobe: 'mailer.ts' wieder eingetragen → rot.
  assert.deepEqual(Object.keys(erlaubtOhneRouter).filter(d => !fs.existsSync(path.join(ROOT, 'routes', d))), [],
    'erlaubtOhneRouter nennt Dateien, die es nicht mehr gibt');
  const dateien = [];
  const lauf = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind);
      else if (e.name.endsWith('.ts')) dateien.push(kind);
    }
  };
  lauf('routes');
  assert.ok(dateien.length > 5, `Nur ${dateien.length} Routendateien — Ordner umbenannt?`);

  const ohneRoute = dateien.filter(d => {
    const src = ohneKommentare(fs.readFileSync(path.join(ROOT, d), 'utf8'));
    if (/\b(router|app)\.(get|post|put|delete|patch|use)\s*\(/.test(src)) return false;
    return !erlaubtOhneRouter[d.replace(/^routes\//, '')];
  });
  assert.deepEqual(ohneRoute, [],
    'Diese Datei liegt in routes/, definiert aber keine Route. Entweder sie gehoert ' +
    'nach src/<bereich>/, oder ihr Grund gehoert nach erlaubtOhneRouter — die stille Variante ' +
    'hat schon einmal neun Importe in die falsche Richtung erzeugt.');
});

// ── Fachbereiche: src/<bereich>/ mit repository (SQL), Dienst und Routen ───────

/** Liegt die Datei in einem Repository (src/<bereich>/repository.ts oder …/repository/…)? */
const istRepository = (rel) => /(^|\/)repository(\/|\.ts$)/.test(rel);
/** Der Fachbereich einer Datei unter src/, sonst null. */
const bereichVon = (rel) => (rel.match(/^src\/([^/]+)\//) || [])[1] || null;

/** Alle Ziele relativer Importe einer Datei, aufgelöst auf ROOT, mit import().
 * `import type` nur mit `mitTypen`: Für die Ladereihenfolge verschwinden Typen
 * beim Übersetzen, für die Abhängigkeit zwischen Schichten nicht. */
function aufgeloesteImporte(rel, { mitTypen = false } = {}) {
  const roh = quelltext(rel);
  const src = mitTypen ? roh : roh.replace(/^\s*(?:import|export) type\b[^;]*;/gm, '');
  return [...src.matchAll(/(?:from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)]
    .map(m => path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1])).replace(/\.js$/, ''));
}

/** Alle .ts-Dateien unter den Ordnern, relativ zu ROOT. */
function tsUnter(...ordner) {
  const raus = [];
  const lauf = (rel) => {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const kind = path.posix.join(rel, e.name);
      if (e.isDirectory()) lauf(kind); else if (e.name.endsWith('.ts')) raus.push(kind);
    }
  };
  ordner.forEach(lauf);
  return raus;
}

/** SQL im Code: eine Anweisung als Zeichenkette oder ein Aufruf auf einer Verbindung. */
const SQL_TEXT = /[`'"]\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+(?:\w+\s+)?SET|DELETE\s+FROM|WITH\s+(?:RECURSIVE\s+)?\w+|CREATE\s+(?:TABLE|INDEX|UNIQUE)|ALTER\s+TABLE|DROP\s|TRUNCATE|LISTEN|NOTIFY|UNLISTEN|SET\s+LOCAL|LOCK\s+TABLE|ANALYZE|VACUUM)\b/;
const SQL_AUFRUF = /\b(?:db|tx|client|pool)\.(?:run|get|all|query|exec)\s*(?:<[^>]*>)?\(/;
/** Auch ein Fragment mitten in einer Zeichenkette, etwa `EXISTS (SELECT 1 FROM …)`. */
const SQL_FRAGMENT = /\bSELECT\b[^;`'"]*\bFROM\b/;
const hatSql = (rel) => { const s = quelltext(rel); return SQL_TEXT.test(s) || SQL_AUFRUF.test(s) || SQL_FRAGMENT.test(s); };

test('SQL steht nur in Repositories und in db/', () => {
  // Ein Verbot, keine Ratsche mehr: Die Liste der Ausnahmen ist seit dem
  // 31.10.2026 leer. Gegenproben (31.10.2026): `await db.get('SELECT 1')` in
  // src/haushalt/haushalt.ts → rot; `'SELECT 1'` in jobs/aufraeumen.ts → rot;
  // (05.11.2026) das EXISTS-Fragment zurück nach src/finanzen/preisalarm.ts → rot.
  const dateien = tsUnter('src', 'jobs', 'clients', 'routes', 'startup').concat('server.ts');
  assert.ok(dateien.length > 150, `nur ${dateien.length} Dateien gefunden`);
  assert.deepEqual(dateien.filter(d => !istRepository(d) && hatSql(d)), [],
    'SQL gehört in das Repository des Bereichs (src/<bereich>/repository…).');
  assert.ok(tsUnter('src').filter(istRepository).every(hatSql), 'ein Repository ohne SQL ist keines');
});

test('Routen, Aufträge und Clients importieren keine Repositories', () => {
  // Gegenprobe (31.10.2026): `import * as r from '../../src/konto/repository/konten'`
  // in routes/api_v1/admin.ts → rot.
  const treffer = [];
  for (const d of tsUnter('routes', 'jobs', 'clients', 'startup').concat('server.ts'))
    for (const z of aufgeloesteImporte(d)) if (istRepository(z)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);
});

test('ein Fachbereich greift auf einen anderen nur über dessen Dienste zu', () => {
  // Das Repository eines Bereichs ist sein Inneres; andere Bereiche nutzen die
  // Dienste. Gegenprobe (31.10.2026): `import { kontoKurz } from
  // '../konto/repository/konten'` in src/haushalt/haushalt.ts → rot.
  const treffer = [];
  const dateien = tsUnter('src');
  assert.ok(dateien.filter(istRepository).length >= 10, 'zu wenige Repositories gefunden');
  for (const d of dateien)
    for (const z of aufgeloesteImporte(d))
      if (istRepository(z) && bereichVon(z) !== bereichVon(d)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);
});

/** Ein Modul ohne relative Importe (Zeilentypen, Konstanten) hängt an nichts. */
const istBlatt = (rel) => !/(?:from\s+|import\(\s*)['"]\./.test(quelltext(rel + '.ts'));

test('ein Repository kennt keine Dienste, auch nicht deren Typen', () => {
  // Gegenproben: `import { getSetting } from '../settings'` in
  // src/einstellungen/repository.ts → rot (31.10.2026); (05.11.2026)
  // `import type { SetStamm } from '../dienst'` zurück in
  // src/sets/repository/setDetail.ts → rot.
  const treffer = [];
  for (const d of tsUnter('src').filter(istRepository))
    for (const z of aufgeloesteImporte(d, { mitTypen: true }))
      if (z.startsWith('src/') && !istRepository(z) && bereichVon(z) !== 'infra' && !istBlatt(z)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);
});

test('Routen lösen keine Konten auf — das tun die Dienste', () => {
  // Eine Route gibt die Sicht (sichtVon) oder den Wunsch weiter; die Regeln des
  // Haushalts stehen in src/haushalt und den Diensten, die sie anwenden.
  // Gegenprobe (05.11.2026): `await scopeIds(req.apiUser.user_id)` zurück in
  // routes/api_v1/misc.ts → rot.
  const AUFLOESUNG = /\b(?:scopeIds|writableIds|resolveWriteTarget|parseScopeMode|canWriteFor|asIds|lagerKonten|blickfeldAus|schreibbereichAus)\s*\(/;
  const dateien = tsUnter('routes');
  assert.ok(dateien.length > 15, 'zu wenige Routendateien gefunden');
  assert.deepEqual(dateien.filter(d => AUFLOESUNG.test(quelltext(d))), []);
});

/** Die HTTP-Seite eines Bereichs (Middleware, Sitzung): src/<bereich>/http/. */
const istHttp = (rel) => /^src\/[^/]+\/http\//.test(rel);

test('Dienste importieren keine Express-Typen', () => {
  // Express kennen nur src/http/ (Fehlerweg, Herkunft, Dateiauslieferung),
  // src/infra/ (Anfragekonto, Proxy-Vertrauen), src/vertrag/ (Prüf-Middleware)
  // und die HTTP-Seiten der Bereiche. Gegenprobe (31.10.2026): `import type {
  // Request } from 'express'` in src/sets/setService.ts → rot; dasselbe in
  // src/konto/loginLimiter.ts → rot. (08.11.2026): dasselbe in src/infra/geld.ts → rot.
  const nutztExpress = d => /from\s+['"]express['"]|import\(\s*['"]express['"]\s*\)/.test(quelltext(d));
  const treffer = tsUnter('src')
    .filter(d => !['infra', 'http', 'vertrag'].includes(bereichVon(d)) && !istHttp(d))
    .filter(nutztExpress);
  assert.deepEqual(treffer, []);
  // Eine neue Datei in infra, die Express kennt, ist eine bewusste Entscheidung: hier eintragen.
  const EXPRESS_IN_INFRA = ['anfrageKonto', 'proxyVertrauen'].map(n => `src/infra/${n}.ts`);
  assert.deepEqual(tsUnter('src/infra').filter(nutztExpress).sort(), EXPRESS_IN_INFRA.sort());
  assert.ok(tsUnter('src').some(istHttp), 'keine HTTP-Seite unter src/<bereich>/http/ gefunden');
});

test('nur Routen, Server und HTTP-Seiten importieren eine HTTP-Seite oder src/http', () => {
  // Ein Dienst, der die HTTP-Seite importiert, hängt wieder am Request.
  // Gegenprobe (31.10.2026): `import { adresse } from './http/anmeldung'` in
  // src/konto/auth.ts → rot.
  const treffer = [];
  for (const d of tsUnter('src', 'jobs', 'clients').filter(d => !istHttp(d)))
    for (const z of aufgeloesteImporte(d)) if (istHttp(z)) treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);

  // Dasselbe für src/http/: Die gemeinsamen Helfer hängen am Request, ein Dienst,
  // der sie holt, hinge es auch; umgekehrt kennt src/http nur src/infra.
  // Gegenproben (08.11.2026): `import { fehlerAntwort } from '../http/httpAntwort'`
  // in src/konto/auth.ts → rot; `import { setKey } from '../sets/setService'` in
  // src/http/httpAntwort.ts → rot.
  const http = tsUnter('src').filter(d => bereichVon(d) === 'http');
  assert.ok(http.length >= 8, `nur ${http.length} Dateien unter src/http`);
  const nachHttp = (z) => bereichVon(z) === 'http';
  const hinein = tsUnter('src', 'jobs', 'clients', 'db')
    .filter(d => !nachHttp(d) && !istHttp(d) && bereichVon(d) !== 'vertrag')
    .flatMap(d => aufgeloesteImporte(d, { mitTypen: true }).filter(nachHttp).map(z => `${d} -> ${z}`));
  assert.deepEqual(hinein, []);
  const hinauf = http.flatMap(d => aufgeloesteImporte(d, { mitTypen: true })
    .filter(z => z.startsWith('src/') && !['http', 'infra'].includes(bereichVon(z))).map(z => `${d} -> ${z}`));
  assert.deepEqual(hinauf, []);
});

/** Routen fangen nichts: Ströme reichen ihren Fehler mit .then(…, …) als letztes Ereignis weiter. */
const TRY_IN_ROUTEN = new Map([]);

test('Routen fangen keine Fehler — der Fehlerweg des Routers antwortet', () => {
  // Gegenprobe (31.10.2026): eine Route in routes/api_v1/minifigs.ts wieder in
  // `try { … } catch (e) { handleRouteError(res, e, undefined, req); }` gehüllt → rot.
  const ist = new Map();
  for (const d of tsUnter('routes')) {
    const n = (quelltext(d).match(/\btry\s*\{/g) || []).length;
    if (n) ist.set(d, n);
  }
  assert.deepEqual(Object.fromEntries(ist), Object.fromEntries(TRY_IN_ROUTEN));
  for (const d of tsUnter('routes').filter(d => /router\.(get|post|put|delete|patch)\(/.test(quelltext(d))))
    assert.match(quelltext(d), /router\.use\(fehlerAntwort\)/, `${d} endet nicht mit dem Fehlerweg`);
});

// ── Rangfolge der Bereiche ──────────────────────────────────────────────────

/** Von unten nach oben. Ein Bereich importiert nur Bereiche tieferer Stufen;
 * Bereiche derselben Stufe kennen einander nicht. Ein neuer Ordner braucht
 * eine Stufe, sonst ist der Test rot. */
const STUFEN = [
  ['src/infra'],
  ['src/http'],
  ['src/vertrag'],
  ['db', 'clients'],
  ['src/einstellungen'],
  ['src/mail'],
  ['src/auftraege'],
  ['src/haushalt'],
  ['src/konto'],
  ['src/idempotenz', 'src/katalog'],
  ['src/finanzen'],
  ['src/bestand'],
  ['src/sets'],
  ['src/teile', 'src/figuren', 'src/merkliste', 'src/gutscheine'],
  ['src/sammlung', 'src/verwaltung'],
  ['jobs', 'routes'],
  ['startup'],
  ['server.ts'],
];
const stufeVon = new Map(STUFEN.flatMap((s, i) => s.map(b => [b, i])));
const bereichsName = (rel) => rel.startsWith('src/') ? rel.split('/').slice(0, 2).join('/') : rel.split('/')[0];

/** Laufzeit-Kanten zwischen Bereichen: `import type` zählt nicht, import() und `export … from` schon. */
function bereichsKanten() {
  const kanten = [];
  const alle = tsUnter('src', 'db', 'clients', 'jobs', 'routes', 'startup').concat('server.ts');
  const bekannt = new Set(alle);
  for (const d of alle) {
    const von = bereichsName(d);
    for (const z of aufgeloesteImporte(d)) {
      const ziel = [z + '.ts', z + '/index.ts', z].find(k => bekannt.has(k));
      if (!ziel) continue;
      const nach = bereichsName(ziel);
      if (nach !== von) kanten.push({ d, ziel, von, nach });
    }
  }
  return kanten;
}

test('jeder Bereich importiert nur Bereiche tieferer Stufen', () => {
  // Gegenproben (05.11.2026): `import { getSetting } from '../src/einstellungen/settings'`
  // in clients/brickset.ts → rot (clients → src/einstellungen); dasselbe mit
  // `import { mitVersion } from '../sets/setNummer'` in src/katalog/dienst.ts,
  // nachdem setNummer wieder unter src/sets lag → rot (katalog → sets).
  const kanten = bereichsKanten();
  assert.ok(kanten.length > 500, `nur ${kanten.length} Kanten gefunden — greift die Suche noch?`);
  const ohneStufe = [...new Set(kanten.flatMap(k => [k.von, k.nach]))].filter(b => !stufeVon.has(b));
  assert.deepEqual(ohneStufe, [], 'Bereich ohne Stufe: in STUFEN eintragen');
  const falsch = kanten.filter(k => stufeVon.get(k.nach) >= stufeVon.get(k.von))
    .map(k => `${k.d} -> ${k.ziel} (${k.von} → ${k.nach})`);
  assert.deepEqual(falsch, []);
});

test('Klienten erreicht man nur über src/katalog/quellen.ts', () => {
  // Dort bekommen sie Schlüssel, Kontingent und Drossel; ein Weg daran vorbei
  // fände keinen Schlüssel. `import type` ist erlaubt.
  // Gegenprobe (05.11.2026): `import { lookupPart } from '../../clients/rebrickable'`
  // in src/teile/manuelleTeile.ts → rot.
  const kanten = bereichsKanten();
  const treffer = kanten.filter(k => k.nach === 'clients' && k.von !== 'clients' && k.d !== 'src/katalog/quellen.ts')
    .map(k => `${k.d} -> ${k.ziel}`);
  assert.deepEqual(treffer, []);
  assert.ok(kanten.some(k => k.d === 'src/katalog/quellen.ts' && k.nach === 'clients'), 'quellen.ts holt keinen Klienten mehr?');
});

test('docs/architektur.md nennt die Rangfolge der Bereiche wie STUFEN', () => {
  // Gegenprobe: in der Tabelle `src/mail` und `src/einstellungen` vertauscht → rot.
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'architektur.md'), 'utf8');
  const tabelle = doc.slice(doc.indexOf('## Rangfolge der Bereiche'), doc.indexOf('## API-Vertrag'));
  const stufen = [...tabelle.matchAll(/^\| (\d+) \| (.+) \|$/gm)].map(m => [...m[2].matchAll(/`([^`]+)`/g)].map(b => b[1]));
  assert.ok(stufen.length > 5, 'Die Tabelle der Rangfolge ist nicht zu finden');
  assert.deepEqual(stufen, STUFEN);
});
