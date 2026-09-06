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
 * Alle verbliebenen Faelle sind FACHLOGIK, die in einer Routendatei wohnt:
 * Marktpreise, Katalogabfragen, Aufraeumjob-Starter. Sie herauszuloesen ist
 * kein Verschieben, sondern ein Umbau — die Funktionen greifen auf
 * modul-lokale Helfer ihrer Datei zu. Deshalb hier benannt statt still
 * geduldet.
 */
const AUSNAHMEN = new Set([
  'jobs/rebrickableCsvSync.ts -> routes/parts',
  'utils/handlers/parts.ts -> routes/parts',
  'jobs/purchasePriceBackfill.ts -> routes/parts',
  'jobs/purchasePriceBackfill.ts -> routes/minifigs',
  'utils/financeCalc.ts -> routes/minifigs',
  'startup/backgroundJobs.ts -> routes/imgProxy',
  'startup/backgroundJobs.ts -> routes/api_v1/pdf',
]);

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
  ['utils', 'jobs', 'clients', 'db', 'startup'].forEach(lauf);
  return gefunden;
}

/** Importe und require() aus routes/, je Datei. */
function nachAussen(rel) {
  const src = ohneKommentare(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const treffer = new Set();
  for (const m of src.matchAll(/(?:from\s+|require\()\s*['"]([^'"]*routes\/[^'"]+)['"]/g))
    treffer.add(m[1].replace(/^.*?(routes\/)/, '$1').replace(/\.js$/, ''));
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
