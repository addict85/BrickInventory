'use strict';
/**
 * Das Schema steht an EINER Stelle — nicht im Anfragepfad.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Der Anfragepfad — hier wird geprüft. */
const ANFRAGEPFAD = [
  'routes' + path.sep,
  path.join('src', 'sets', 'lesen.ts'),
  path.join('src', 'sets', 'loeschen.ts'),
  path.join('src', 'teile', 'abfragen.ts'),
  path.join('src', 'figuren', 'abfragen.ts'),
  path.join('src', 'bestand', 'gemeinsam.ts'),
  path.join('src', 'bestand', 'kennzahlen.ts'),
];

/** Schema-Anweisungen. Nur in echtem SQL, nicht in Prosa. */
const MUSTER = /\b(CREATE\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|ALTER\s+TABLE)\b/i;

/** @param {string} quelle */
function ohneKommentare(quelle) {
  return quelle
    .split('\n')
    .map(z => {
      const t = z.trim();
      return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#')) ? '' : z;
    })
    .join('\n');
}

/** @param {string} verz @param {string[]} raus */
function sammle(verz, raus) {
  for (const eintrag of fs.readdirSync(verz, { withFileTypes: true })) {
    const p = path.join(verz, eintrag.name);
    if (eintrag.isDirectory()) sammle(p, raus);
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
  if (fs.statSync(verz).isDirectory()) sammle(verz, dateien);
  else dateien.push(verz);
}

// Untergrenze: Findet der Dateilauf zu wenig, wäre die Prüfung still grün.
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

// Der Selbstbeweis, und warum er JEDEN Teil einzeln prüft
const migVerz = path.join(ROOT, 'db/migrations');
const bekannt = ohneKommentare(fs.readdirSync(migVerz).filter(f => f.endsWith('.sql'))
  .map(f => fs.readFileSync(path.join(migVerz, f), 'utf8')).join('\n'));

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
// Regel 2 — jede Tabelle und jeder Index wird an GENAU EINER Stelle angelegt
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Absichtlich doppelt, mit Grund. Die Liste darf nur KÜRZER werden.
 * @type {Map<string, string>}
 */
const DOPPELT_ERLAUBT = new Map([]);

/** @type {string[]} */
const alleQuellen = [];
for (const teil of ['db', 'routes', 'src', 'jobs', 'clients', 'scripts']) {
  const verz = path.join(ROOT, teil);
  if (fs.existsSync(verz)) sammleAlle(verz, alleQuellen);
}
if (fs.existsSync(path.join(ROOT, 'server.ts'))) alleQuellen.push(path.join(ROOT, 'server.ts'));

/** @param {string} verz @param {string[]} raus */
function sammleAlle(verz, raus) {
  for (const eintrag of fs.readdirSync(verz, { withFileTypes: true })) {
    const p = path.join(verz, eintrag.name);
    if (eintrag.isDirectory()) sammleAlle(p, raus);
    // schema-stand.sql und basis.sql sind erzeugte Abbilder, keine Quellen —
    // sie nennen jede Tabelle ein zweites Mal, und zwar mit Absicht.
    else if (/\.(ts|js|sql)$/.test(eintrag.name) && !['schema-stand.sql', 'basis.sql'].includes(eintrag.name)) raus.push(p);
  }
  return raus;
}

if (alleQuellen.length < 100) {
  console.error(`ROT — nur ${alleQuellen.length} Quelldateien gefunden; der Pfad stimmt nicht.`);
  process.exit(1);
}

/** @type {Map<string, string[]>} */
const angelegt = new Map();
for (const datei of alleQuellen) {
  const rel = path.relative(ROOT, datei);
  const text = ohneKommentare(fs.readFileSync(datei, 'utf8'));
  const re = /CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX)(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/gi;
  for (const m of text.matchAll(re)) {
    // m[1] ist unter noUncheckedIndexedAccess moeglicherweise undefined —
    // die Gruppe ist im Muster zwar nicht optional, aber das weiss der
    // Typpruefer nicht. Ein leerer Name faellt hier still durch statt zu werfen.
    const name = (m[1] || '').toLowerCase();
    if (!name) continue;
    const wo = angelegt.get(name) || [];
    if (!wo.includes(rel)) wo.push(rel);
    angelegt.set(name, wo);
  }
}

// Selbstbeweis: Eine bekannte Tabelle MUSS gefunden werden. Sonst ist das
// Muster veraltet und "nichts doppelt" bedeutet nichts.
if (!angelegt.has('price_alerts')) {
  console.error('ROT — price_alerts wird nirgends angelegt gefunden. Das Muster ist veraltet;');
  console.error('ein leeres Ergebnis unten waere dann wertlos.');
  process.exit(1);
}

/** @type {string[]} */
const mehrfach = [];
for (const [name, orte] of angelegt) {
  if (orte.length < 2) continue;
  if (DOPPELT_ERLAUBT.has(name)) continue;
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
  console.error('DOPPELT_ERLAUBT in dieser Datei.');
  process.exit(1);
}

console.log(`GRUEN — ${dateien.length} Dateien im Anfragepfad ohne Schema-Anweisung, ` +
            `${angelegt.size} Tabellen/Indizes je genau einmal angelegt`);
