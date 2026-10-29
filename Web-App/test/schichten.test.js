/**
 * Die Abhaengigkeiten zeigen nach INNEN, nicht nach aussen.
 *
 * ── Die Schichten dieses Baums ──────────────────────────────────────────────
 *
 *     server.ts          haengt alles ein
 *     routes/            HTTP: Anfrage lesen, Antwort schreiben
 *     utils/, jobs/      Fachlogik und Hintergrundarbeit
 *     clients/, db/      Aussenwelt und Datenbank
 *
 * Ein Import darf nach innen zeigen. Zeigt er nach aussen — holt sich also
 * eine Fachfunktion etwas aus einer ROUTE —, dann steht die Funktion am
 * falschen Ort, und jeder, der sie braucht, zieht den HTTP-Apparat mit.
 *
 * ── Woher diese Pruefung kommt ──────────────────────────────────────────────
 * Nachgemessen wurden zehn solche Importe. Der mit Abstand haeufigste Fall war
 * routes/thumbs.ts: eine Datei im Routen-Ordner, die KEINE Route enthielt —
 * kein `router.get`, kein `app.get`, nur drei Funktionen. generateThumb()
 * wurde von neun Stellen gebraucht, verteilt auf sechs Nicht-Route-Dateien.
 * Sie liegt jetzt in utils/.
 *
 * Die verbleibenden Faelle stehen unten NAMENTLICH. Das ist der Punkt dieser
 * Liste: Eine Ausnahme, die man aufschreiben muss, faellt auf; eine, die
 * niemand zaehlt, wird zur Regel. Genau so ist der Baum an diese Stelle
 * gekommen.
 *
 * Ausfuehren: npm test
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
 *   • Zwei UMWEGE: jobs/rebrickableCsvSync und utils/handlers/parts holten
 *     fetchMissingBlIds ueber routes/parts — die Route hatte sie selbst nur
 *     importiert und weiterexportiert. Kein Code am falschen Ort, nur ein
 *     Import am falschen Ort. Sie holen sie jetzt direkt aus utils/partsImport.
 *   • Zwei FEHLER IN DIESER REGEL: startup/ zaehlte hier zu den inneren
 *     Schichten, obwohl es nur von server.ts benutzt wird und damit
 *     ausgelagerter Serverstart ist. Siehe die Ordnerliste unten.
 *   • Vier ECHTE Faelle: die Marktpreise fuer Teile und Figuren, die
 *     Preisschaetzung aus Einzelteilen und die Rebrickable-Teileabfrage. Sie
 *     stehen jetzt in utils/marketPrice.ts (bei dem fuer Sets, wo sie
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
  // startup/ steht NICHT in dieser Liste — und das ist eine Berichtigung.
  //
  // Der erste Entwurf zaehlte es zu den inneren Schichten, weil es kein
  // „routes" im Namen traegt. Nachgemessen: startup/backgroundJobs.ts wird von
  // GENAU EINER Datei benutzt, naemlich server.ts. Es ist ausgelagerter
  // Serverstart, also dieselbe Schicht wie server.ts selbst — dass es Routen
  // anfasst (startImgCacheCleanup, startPdfJobCleanup), ist sein Zweck und
  // kein Verstoss.
  //
  // Eine Regel, die Gesundes als Verstoss fuehrt, ist schlimmer als keine: Sie
  // erzieht dazu, die Ausnahmeliste fuer normal zu halten. Zwei der acht
  // Eintraege standen nur wegen dieses Fehlers dort.
  ['utils', 'jobs', 'clients', 'db'].forEach(lauf);
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
  const ordner = path.join(ROOT, 'routes', 'api_v1');
  const dateien = fs.readdirSync(ordner).filter(f => f.endsWith('.ts'));
  assert.ok(dateien.length > 10, `nur ${dateien.length} v1-Dateien gefunden`);
  const treffer = [];
  for (const f of dateien)
    for (const ziel of importe(`routes/api_v1/${f}`).filter(z => /^\.\.\/[^.]/.test(z)))
      treffer.push(`api_v1/${f} -> ${ziel}`);
  assert.deepEqual(treffer, []);
});

test('utils/ und clients/ importieren nichts aus jobs/', () => {
  // Was utils/ an Hintergrundarbeit anstösst, läuft über utils/nacharbeit.ts;
  // die Ausführung setzt jobs/verdrahtung.ts ein.
  // Gegenprobe (28.10.2026): require('../jobs/imageQueue') in merkliste.ts → rot.
  const treffer = [];
  for (const d of innereDateien().filter(f => /^(utils|clients)\//.test(f)))
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

test('routes/auth.ts und routes/api_v1/admin.ts führen kein SQL aus', () => {
  // Ihr Datenzugriff steht in utils/konten.ts und utils/verwaltung.ts; die
  // Routen prüfen Eingaben und Rechte und schreiben die Antwort.
  // Gegenprobe (28.10.2026): eine db.get-Zeile samt Import zurück in
  // admin.ts → rot (beide Treffer gemeldet).
  const treffer = [];
  for (const d of ['routes/auth.ts', 'routes/api_v1/admin.ts']) {
    for (const m of quelltext(d).matchAll(/\bdb\.\w+\s*\(/g)) treffer.push(`${d}: ${m[0]}`);
    for (const ziel of importe(d).filter(z => /db\/database/.test(z))) treffer.push(`${d} -> ${ziel}`);
  }
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
