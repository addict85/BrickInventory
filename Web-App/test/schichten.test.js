/**
 * Die Abhängigkeiten zeigen nach innen.
 *
 *     server.ts, startup/    hängt alles ein
 *     routes/                HTTP: Eingabe prüfen, Dienst rufen, antworten
 *     jobs/                  Hintergrundarbeit, ruft Dienste
 *     src/<bereich>/         Dienste (Fachlogik) und repository (SQL)
 *     src/infra/             fachfreie Helfer
 *     clients/, db/          Aussenwelt (nur HTTP) und Datenbank
 *
 * Ausnahmen stehen namentlich in den Listen und dürfen nur kürzer werden.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Was noch aus einer Route nach innen geholt wird — und warum es noch steht.
 *
 * Die Liste ist LEER — und das ist das Ergebnis eines Durchgangs, nicht der
 * Ausgangszustand. Sie hatte acht Eintraege, und beim Aufloesen zeigte sich,
 * dass sie aus DREI verschiedenen Gruenden dort standen:
 *
 *   • Zwei UMWEGE: jobs/rebrickableCsvSync und src/teile/abfragen holten
 *     fetchMissingBlIds ueber routes/parts — die Route hatte sie selbst nur
 *     importiert und weiterexportiert. Kein Code am falschen Ort, nur ein
 *     Import am falschen Ort. Sie holen sie jetzt direkt aus utils/partsImport.
 *   • Zwei FEHLER IN DIESER REGEL: startup/ zaehlte hier zu den inneren
 *     Schichten, obwohl es nur von server.ts benutzt wird und damit
 *     ausgelagerter Serverstart ist. Siehe die Ordnerliste unten.
 *   • Vier ECHTE Faelle: die Marktpreise fuer Teile und Figuren, die
 *     Preisschaetzung aus Einzelteilen und die Rebrickable-Teileabfrage. Sie
 *     stehen jetzt in src/finanzen/marketPrice.ts (bei dem fuer Sets, wo sie
 *     hingehoerten) bzw. in clients/rebrickable.ts.
 *
 * Bleibt die Liste leer, ist das die Aussage. Wird ein Eintrag noetig, gehoert
 * er hierher — mit Grund, nicht als stille Duldung.
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
  // Gemeinsames gehört nach utils/ (manuelleTeile, manuelleFiguren). Eine
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
  // api_v1/index.ts. Gegenprobe (29.10.2026): `import { requireLogin } from
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
      if (voll.startsWith('routes/') && voll !== 'routes/api_v1/middleware') treffer.push(`${d} -> ${ziel}`);
    }
  assert.deepEqual(treffer, []);
});

test('kein Zustand auf global', () => {
  // Was Prozesse teilen, steht in einem Modul (src/infra/startZustand.ts) und
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
  // Was utils/ an Hintergrundarbeit anstösst, läuft über src/auftraege/nacharbeit.ts;
  // die Ausführung setzt jobs/verdrahtung.ts ein.
  // Gegenprobe (28.10.2026): require('../jobs/imageQueue') in merkliste.ts → rot.
  const treffer = [];
  for (const d of innereDateien().filter(f => /^(src|clients)\//.test(f)))
    for (const ziel of importe(d).filter(z => /jobs\//.test(z)))
      treffer.push(`${d} -> ${ziel}`);
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

test('keine Route führt SQL aus oder importiert die Datenbank', () => {
  // Routen lesen die Anfrage, rufen einen Dienst und schreiben die Antwort;
  // der Datenzugriff steht in utils/ (utils/dienste/ je Gebiet).
  // Gegenprobe (29.10.2026): `import * as db from '../../db/database'` und
  // eine db.get-Zeile zurück in routes/api_v1/catalog.ts → rot, beide Treffer.
  const dateien = routenDateien();
  assert.ok(dateien.length > 15, `nur ${dateien.length} Routendateien gefunden`);
  const treffer = [];
  for (const d of dateien) {
    for (const m of quelltext(d).matchAll(/\b(?:db|tx)\.(?:get|all|run|exec|transaction|pool)\b/g)) treffer.push(`${d}: ${m[0]}`);
    for (const ziel of importe(d).filter(z => /db\/database/.test(z))) treffer.push(`${d} -> ${ziel}`);
  }
  assert.deepEqual(treffer, []);
});

test('keine Route importiert aus jobs/ oder clients/', () => {
  // Jobs steuert eine Route über src/auftraege/nacharbeit.ts und die Auftragstabelle,
  // fremde Dienste erreicht sie über einen Dienst in utils/.
  // Gegenprobe (29.10.2026): `import { triggerNow } from '../../jobs/priceJob'`
  // in admin.ts und `import { getSetByEan } from '../../clients/brickset'` in
  // api_v1/sets.ts → rot, beide Treffer.
  const treffer = [];
  for (const d of routenDateien())
    for (const ziel of importe(d).filter(z => /(?:^|\/)(?:jobs|clients)\//.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('nur der Bild-Proxy ruft aus einer Route selbst ins Netz', () => {
  // Der Bild-Proxy reicht CDN-Antworten durch; das Durchreichen ist seine
  // Aufgabe. Jeder andere Abruf gehört in einen Client oder Dienst.
  // Gegenprobe (29.10.2026): `import https from 'https'` in api_v1/admin.ts → rot.
  const ERLAUBT = new Set(['routes/imgProxy.ts']);
  const treffer = [];
  for (const d of routenDateien().filter(d => !ERLAUBT.has(d)))
    for (const ziel of importe(d).filter(z => /^(?:node:)?https?$/.test(z))) treffer.push(`${d} -> ${ziel}`);
  assert.deepEqual(treffer, []);
  for (const d of ERLAUBT) assert.ok(fs.existsSync(path.join(ROOT, d)), `${d} gibt es nicht mehr — Ausnahme streichen`);
});

test('startup/ importiert nichts aus routes/', () => {
  // Was der Start anstösst (Aufräumläufe), steht in utils/; eine Route
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
  // zum Glücksspiel. `import type` zählt nicht, es verschwindet beim Übersetzen.
  // Gegenprobe (28.10.2026): marketPrice.ts wieder über financeCalc → rot
  // (bewertung → marketPrice → financeCalc → bewertung).
  const dateien = new Set(innereDateien());
  const kanten = new Map();
  for (const d of dateien) {
    const src = quelltext(d);
    const ziele = [...src.matchAll(/^\s*(import|export)\s(?!type\b)[^;]*?from\s+['"](\.[^'"]+)['"]|require\(\s*['"](\.[^'"]+)['"]/gm)]
      .map(m => path.posix.normalize(path.posix.join(path.posix.dirname(d), m[2] || m[3])).replace(/\.js$/, ''))
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
  // ── Woher diese Pruefung kommt ───────────────────────────────────────────
  // routes/thumbs.ts enthielt keine einzige Route. Der Ordnername sagte damit
  // etwas Falsches ueber den Inhalt — und weil die Datei dort lag, mussten
  // sechs Fachdateien aus der aeussersten Schicht importieren.
  //
  // Drei Dateien in routes/ definieren ebenfalls kein `router.<methode>`,
  // gehoeren aber dorthin, jede aus einem eigenen Grund. Sie stehen deshalb
  // hier mit Begruendung statt als stille Ausnahme.
  const erlaubtOhneRouter = {
    'imgProxy.ts':          'registriert seine Routen ueber app.get() statt router.get()',
    'mailer.ts':            'Mailversand, ausschliesslich von Routen benutzt — keine Schicht wird verletzt',
    'api_v1/middleware.ts': 'Waechter FUER Routen; ohne Routen sinnlos',
  };
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
    'in utils/, oder ihr Grund gehoert nach erlaubtOhneRouter — die stille Variante ' +
    'hat schon einmal neun Importe in die falsche Richtung erzeugt.');
});

// ── Fachbereiche: src/<bereich>/ mit repository (SQL), Dienst und Routen ───────

/** Liegt die Datei in einem Repository (src/<bereich>/repository.ts oder …/repository/…)? */
const istRepository = (rel) => /(^|\/)repository(\/|\.ts$)/.test(rel);
/** Der Fachbereich einer Datei unter src/, sonst null. */
const bereichVon = (rel) => (rel.match(/^src\/([^/]+)\//) || [])[1] || null;

/** Alle Ziele relativer Importe einer Datei, aufgelöst auf ROOT, mit `import type` und import(). */
function aufgeloesteImporte(rel) {
  // `import type` zählt nicht: Typen verschwinden beim Übersetzen.
  const src = quelltext(rel).replace(/^\s*(?:import|export) type\b[^;]*;/gm, '');
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
const hatSql = (rel) => { const s = quelltext(rel); return SQL_TEXT.test(s) || SQL_AUFRUF.test(s); };

/**
 * Dateien, in denen Fachlogik und SQL noch zusammenstehen. Die Liste darf nur
 * kürzer werden: Wer eine Datei teilt, streicht ihre Zeile.
 */
const SQL_NOCH_IM_DIENST = new Set([
    'jobs/csvImportWorker.ts',
    'jobs/imageQueue.ts',
    'jobs/partsCatalogEnrich.ts',
    'src/auftraege/bricksetAuftrag.ts',
    'src/auftraege/hintergrund.ts',
    'src/auftraege/importAuftrag.ts',
    'src/auftraege/pdfAuftraege.ts',
    'src/auftraege/zeitplan.ts',
    'src/bestand/acquisitions.ts',
    'src/bestand/bestandExport.ts',
    'src/bestand/erfassungen.ts',
    'src/bestand/gemeinsam.ts',
    'src/bestand/kennzahlen.ts',
    'src/bestand/lagerort.ts',
    'src/bestand/loeschen.ts',
    'src/bestand/papierkorb.ts',
    'src/figuren/abfragen.ts',
    'src/figuren/dienst.ts',
    'src/figuren/manuelleFiguren.ts',
    'src/finanzen/marketPrice.ts',
    'src/finanzen/portfolio/kurve.ts',
    'src/finanzen/portfolioHistory.ts',
    'src/finanzen/preisalarm.ts',
    'src/finanzen/priceHistory.ts',
    'src/finanzen/rechnung/abfragen.ts',
    'src/finanzen/rechnung/bewertung.ts',
    'src/finanzen/rechnung/gewinnVerlust.ts',
    'src/finanzen/rechnung/preise.ts',
    'src/finanzen/setValue.ts',
    'src/finanzen/wechselkurse.ts',
    'src/gutscheine/gutscheinGuthabenSchranke.ts',
    'src/infra/geheimnisAltbestand.ts',
    'src/infra/protokoll.ts',
    'src/katalog/apiKontingent.ts',
    'src/katalog/bilder/bildNachschlagen.ts',
    'src/katalog/bilder/bildbedarf.ts',
    'src/katalog/bilder/imageMisses.ts',
    'src/katalog/bilder/proxyThumbs.ts',
    'src/katalog/blZuordnung.ts',
    'src/katalog/bricklinkLink.ts',
    'src/katalog/dienst.ts',
    'src/katalog/farben.ts',
    'src/katalog/instructions.ts',
    'src/katalog/katalogPflege.ts',
    'src/katalog/minifigsImport.ts',
    'src/katalog/partsImport.ts',
    'src/katalog/rateLimiter.ts',
    'src/katalog/rbInventar.ts',
    'src/konto/auth.ts',
    'src/konto/indexHtml.ts',
    'src/konto/loginLimiter.ts',
    'src/konto/passkeys.ts',
    'src/konto/passwortBestaetigung.ts',
    'src/konto/zweiterFaktor.ts',
    'src/merkliste/merkliste.ts',
    'src/merkliste/wantedListe.ts',
    'src/sets/abfragen.ts',
    'src/sets/dienst.ts',
    'src/sets/setAdd.ts',
    'src/sets/setMove.ts',
    'src/sets/setService.ts',
    'src/teile/abfragen.ts',
    'src/teile/manuelleTeile.ts',
    'src/teile/partsSummary.ts',
    'src/teile/teilFarbeAendern.ts',
    'src/verwaltung/dienst.ts',
]);

test('SQL steht nur in Repositories und in db/', () => {
  // Gegenprobe (31.10.2026): `await db.get('SELECT 1')` in src/haushalt/haushalt.ts
  // → rot; die Zeile aus SQL_NOCH_IM_DIENST gestrichen, ohne die Datei zu teilen → rot.
  const dateien = tsUnter('src', 'jobs', 'clients', 'routes', 'startup').concat('server.ts');
  assert.ok(dateien.length > 150, `nur ${dateien.length} Dateien gefunden`);
  const mitSql = dateien.filter(d => !istRepository(d) && hatSql(d));
  const neu = mitSql.filter(d => !SQL_NOCH_IM_DIENST.has(d));
  assert.deepEqual(neu, [], 'SQL gehört in das Repository des Bereichs (src/<bereich>/repository…).');
  const erledigt = [...SQL_NOCH_IM_DIENST].filter(d => !mitSql.includes(d));
  assert.deepEqual(erledigt, [], 'Diese Dateien sind frei von SQL — Zeile streichen.');
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

test('ein Repository kennt keine Dienste', () => {
  // Gegenprobe (31.10.2026): `import { getSetting } from '../settings'` in
  // src/konto/repository/einstellungen.ts → rot.
  const treffer = [];
  for (const d of tsUnter('src').filter(istRepository))
    for (const z of aufgeloesteImporte(d))
      if (z.startsWith('src/') && !istRepository(z) && bereichVon(z) !== 'infra') treffer.push(`${d} -> ${z}`);
  assert.deepEqual(treffer, []);
});

/** Dienste, die noch am Request arbeiten: die Anmeldung über HTTP. */
const EXPRESS_IM_DIENST = new Map([
  ['src/konto/auth.ts', 'Sitzung anlegen und Anmeldung aus Cookie oder Token lesen'],
  ['src/konto/loginLimiter.ts', 'die Bremse zählt je Adresse des Requests'],
  ['src/konto/passwortBestaetigung.ts', 'antwortet bei Sperre selbst (429)'],
]);

test('Dienste importieren keine Express-Typen', () => {
  // src/infra/ trägt die HTTP-Helfer (Fehlerweg, Herkunft, Dateiauslieferung).
  // Gegenprobe (31.10.2026): `import type { Request } from 'express'` in
  // src/sets/setService.ts → rot.
  const treffer = tsUnter('src')
    .filter(d => bereichVon(d) !== 'infra' && !EXPRESS_IM_DIENST.has(d))
    .filter(d => /from\s+['"]express['"]|import\(\s*['"]express['"]\s*\)/.test(quelltext(d)));
  assert.deepEqual(treffer, []);
  for (const d of EXPRESS_IM_DIENST.keys())
    assert.match(quelltext(d), /['"]express['"]/, `${d} braucht Express nicht mehr — Eintrag streichen`);
});

/** Routen, die etwas anderes tun als antworten (Strom, Teilergebnis, Aufräumen) — je Datei die Zahl. */
const TRY_IN_ROUTEN = new Map([
  ['routes/auth.ts', 2], ['routes/imgProxy.ts', 3], ['routes/api_v1/vouchers.ts', 3],
  ['routes/api_v1/sets.ts', 2], ['routes/api_v1/wanted.ts', 3],
]);

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
