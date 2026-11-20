'use strict';
/**
 * The schema stands in ONE place — not in the request path.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** The request path — this is where checking happens. */
const ANFRAGEPFAD = [
  'routes' + path.sep,
  path.join('src', 'sets', 'read.ts'),
  path.join('src', 'sets', 'delete.ts'),
  path.join('src', 'parts', 'queries.ts'),
  path.join('src', 'minifigs', 'queries.ts'),
  path.join('src', 'inventory', 'shared.ts'),
  path.join('src', 'inventory', 'metrics.ts'),
];

/** Schema statements. Only in real SQL, not in prose. */
const MUSTER = /\b(CREATE\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE)\b/i;

/** @param {string} quelle */
function ohneKommentare(quelle) {
  return quelle
    .split('\n')
    .map(z => {
      const t = z.trim();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#') ? '' : z;
    })
    .join('\n');
}

/** @param {string} verz @param {string[]} raus */
function collect(verz, raus) {
  for (const eintrag of fs.readdirSync(verz, { withFileTypes: true })) {
    const p = path.join(verz, eintrag.name);
    if (eintrag.isDirectory()) collect(p, raus);
    else if (/\.(ts|js)$/.test(eintrag.name)) raus.push(p);
  }
  return raus;
}

/** @type {string[]} */
const dateien = [];
for (const teil of ANFRAGEPFAD) {
  const verz = path.join(ROOT, teil);
  if (!fs.existsSync(verz)) {
    console.error(`ROT — ${teil} gibt es nicht (mehr). Umbenannt? Ohne diesen Ordner`);
    console.error('prüft die Suche nichts und wäre trotzdem grün.');
    process.exit(1);
  }
  if (fs.statSync(verz).isDirectory()) collect(verz, dateien);
  else dateien.push(verz);
}

// Lower bound: if the file walk finds too little, the check would be silently green.
if (dateien.length < 20) {
  console.error(`ROT — nur ${dateien.length} Dateien im Anfragepfad gefunden.`);
  console.error('Das ist zu wenig; vermutlich stimmt der Pfad nicht mehr.');
  process.exit(1);
}

/** @type {string[]} */
const treffer = [];
for (const datei of dateien) {
  const rel = path.relative(ROOT, datei);
  const zeilen = ohneKommentare(fs.readFileSync(datei, 'utf8')).split('\n');
  zeilen.forEach((z, i) => {
    if (MUSTER.test(z)) treffer.push(`${rel}:${i + 1}  ${z.trim().slice(0, 90)}`);
  });
}

// The self-proof, and why it checks EVERY part individually
const migVerz = path.join(ROOT, 'db/migrations');
const bekannt = ohneKommentare(
  fs
    .readdirSync(migVerz)
    .filter(f => f.endsWith('.sql'))
    .map(f => fs.readFileSync(path.join(migVerz, f), 'utf8'))
    .join('\n'),
);

for (const teil of [/\bCREATE\s+TABLE\b/i, /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i, /\bALTER\s+TABLE\b/i]) {
  if (!teil.test(bekannt)) {
    console.error(`ROT — das Teilmuster ${teil} findet in db/ nichts.`);
    console.error('Dann ist es veraltet, und ein leeres Ergebnis oben sagt nichts.');
    process.exit(1);
  }
}

if (treffer.length) {
  console.error(`ROT — Schema-Anweisungen im Anfragepfad (${treffer.length}):`);
  for (const t of treffer) console.error('  ' + t);
  console.error('');
  console.error('Das Schema gehört nach db/migrations/ —');
  console.error('nicht in eine Route.');
  console.error('DDL im Anfragepfad kostet je Anfrage einen Katalog-Zugriff und verteilt');
  console.error('das Schema über die Codebasis. Und eine zweite Fassung fällt nicht auf,');
  console.error('solange sie zufällig dasselbe will.');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// Rule 2 — every table and every index is created in EXACTLY ONE place
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deliberately duplicated, with a reason. The list may only get SHORTER.
 * @type {Map<string, string>}
 */
const DUPLICATE_ALLOWED = new Map([]);

/** @type {string[]} */
const allSources = [];
for (const teil of ['db', 'routes', 'src', 'jobs', 'clients', 'scripts']) {
  const verz = path.join(ROOT, teil);
  if (fs.existsSync(verz)) collectAll(verz, allSources);
}
if (fs.existsSync(path.join(ROOT, 'server.ts'))) allSources.push(path.join(ROOT, 'server.ts'));

/** @param {string} verz @param {string[]} raus */
function collectAll(verz, raus) {
  for (const eintrag of fs.readdirSync(verz, { withFileTypes: true })) {
    const p = path.join(verz, eintrag.name);
    if (eintrag.isDirectory()) collectAll(p, raus);
    // schema-stand.sql and basis.sql are generated copies, not sources —
    // they name every table a second time, and deliberately so.
    else if (/\.(ts|js|sql)$/.test(eintrag.name) && !['schema-stand.sql', 'basis.sql'].includes(eintrag.name))
      raus.push(p);
  }
  return raus;
}

if (allSources.length < 100) {
  console.error(`ROT — nur ${allSources.length} Quelldateien gefunden; der Pfad stimmt nicht.`);
  process.exit(1);
}

/** @type {Map<string, string[]>} */
const angelegt = new Map();
for (const datei of allSources) {
  const rel = path.relative(ROOT, datei);
  const text = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const re = /CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/gi;
  for (const m of text.matchAll(re)) {
    // m[1] is possibly undefined under noUncheckedIndexedAccess —
    // the group is not optional in the pattern, but the type checker
    // does not know that. An empty name silently falls through here instead of throwing.
    const name = (m[1] || '').toLowerCase();
    if (!name) continue;
    const wo = angelegt.get(name) || [];
    if (!wo.includes(rel)) wo.push(rel);
    angelegt.set(name, wo);
  }
}

// Self-proof: a known table MUST be found. Otherwise the
// pattern is outdated and "nothing duplicated" means nothing.
if (!angelegt.has('price_alerts')) {
  console.error('ROT — price_alerts wird nirgends angelegt gefunden. Das Muster ist veraltet;');
  console.error('ein leeres Ergebnis unten waere dann wertlos.');
  process.exit(1);
}

/** @type {string[]} */
const mehrfach = [];
for (const [name, orte] of angelegt) {
  if (orte.length < 2) continue;
  if (DUPLICATE_ALLOWED.has(name)) continue;
  mehrfach.push(`${name}  —  ${orte.join(', ')}`);
}

if (mehrfach.length) {
  console.error(`ROT — mehrfach angelegt (${mehrfach.length}):`);
  for (const t of mehrfach) console.error('  ' + t);
  console.error('');
  console.error('Eine Tabelle gehoert an EINE Stelle. Zwei Fassungen fallen nicht auf,');
  console.error('solange sie dasselbe wollen — und CREATE TABLE IF NOT EXISTS meldet');
  console.error('einen Unterschied nicht, es tut dann einfach nichts.');
  console.error('Ist die Doppelung unvermeidlich, gehoert sie mit Grund in');
  console.error('DUPLICATE_ALLOWED in dieser Datei.');
  process.exit(1);
}

console.log(
  `GRUEN — ${dateien.length} Dateien im Anfragepfad ohne Schema-Anweisung, ` +
    `${angelegt.size} Tabellen/Indizes je genau einmal angelegt`,
);
