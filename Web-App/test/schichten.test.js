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
