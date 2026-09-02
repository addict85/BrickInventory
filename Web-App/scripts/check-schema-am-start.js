'use strict';
/**
 * Das Schema steht an EINER Stelle — nicht im Anfragepfad.
 *
 * ── Woher diese Prüfung kommt ───────────────────────────────────────────────
 * `db/database.ts` trägt seit der Umstellung eine Etappe namens
 * `frueherZurLaufzeitAngelegt()` mit dem Kommentar:
 *
 *     „csv_import_jobs entstand per ensureJobTable() bei jedem Aufruf des
 *      CSV-Status-Endpunkts, qr_login_tokens per ensureQrTable() bei jedem
 *      QR-Token. DDL im Request-Pfad ist aus zwei Gründen unschön: Sie kostet
 *      bei jeder Anfrage einen Katalog-Zugriff, und sie verteilt das Schema
 *      über die Codebasis, sodass niemand mehr an einer Stelle sehen kann, wie
 *      die Datenbank aussieht. Beide gehören hierher."
 *
 * Die zentrale Fassung kam dazu — die alte blieb stehen. `ensureJobTable()`
 * lief weiterhin vor jedem Import und jedem Abbruch, `ensureQrTable()` bei
 * jeder Token-Erzeugung und jeder Einlösung. Der Satz „Beide gehören hierher"
 * stimmte also nicht, und zwar unbemerkt, weil beide Fassungen zeichengleich
 * waren.
 *
 * Genau das ist das Tückische: Zwei Fassungen einer Regel fallen nicht auf,
 * solange sie dasselbe wollen. Wer die zentrale um eine Spalte erweitert,
 * bekommt bei einer NEUINSTALLATION je nach Reihenfolge die alte Tabelle —
 * und `CREATE TABLE IF NOT EXISTS` meldet das nicht, es tut einfach nichts.
 *
 * ── Was geprüft wird, und was bewusst NICHT ─────────────────────────────────
 * Geprüft wird der ANFRAGEPFAD: `routes/` und `utils/handlers/`. Dort darf
 * keine Schema-Anweisung stehen (CREATE TABLE / CREATE INDEX / ALTER TABLE).
 *
 * Sicher ist das, weil `server.ts` `app.listen()` erst im `then()` von
 * `initSchemaOnce()` aufruft — wenn die erste Anfrage ankommt, steht das
 * Schema bereits.
 *
 * NICHT geprüft werden `jobs/` und `utils/partsSummary.ts`. Der erste Entwurf
 * dieser Prüfung verlangte „DDL nur unter db/" und meldete zwanzig weitere
 * Stellen — alle ausserhalb des Anfragepfads, keine davon der beschriebene
 * Fehler. Eine Regel, die zu weit greift, ist so wenig wert wie eine, die zu
 * eng greift: Sie wird abgeschaltet statt befolgt.
 *
 * (`initPartsSummary()` läuft aus `db/database.ts` beim Start; der
 * Katalog-Abgleich in `jobs/` ist ein Hintergrundlauf. Beide sind nachgesehen,
 * nicht angenommen.)
 *
 * ── Ein Fehlalarm, der beinahe einer geworden wäre ──────────────────────────
 * Beim Vergleich der doppelt definierten Tabellen sah `rb_colors` zunächst
 * auseinandergelaufen aus: Der Job legt sie mit `bl_color_id` an,
 * `db/schema.sql` ohne. Die Spalte kommt dort aber eine Zeile später per
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Wer nur das CREATE vergleicht,
 * meldet einen Fehler, den es nicht gibt — der Endzustand zählt, nicht die
 * erste Anweisung.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Der Anfragepfad — hier wird geprüft. */
const ANFRAGEPFAD = [
  'routes' + path.sep,
  path.join('utils', 'handlers') + path.sep,
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
  sammle(verz, dateien);
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

// ── Der Selbstbeweis, und warum er JEDEN Teil einzeln prüft ─────────────────
// Die Prüfung muss sich an einer bekannten Stelle beweisen: db/ MUSS alle drei
// Arten von Schema-Anweisungen enthalten. Sonst ist das Muster veraltet, und
// ein leeres Ergebnis oben sagt nichts.
//
// Der erste Entwurf prüfte MUSTER als Ganzes gegen db/database.ts — und blieb
// grün, als in einer Gegenprobe „CREATE TABLE" zu „CREATE TABEL" verstümmelt
// wurde: „CREATE INDEX" traf ja weiterhin. Ein Selbstbeweis, den eine kaputte
// Hälfte besteht, beweist die andere Hälfte nicht.
const bekannt = ohneKommentare(
  fs.readFileSync(path.join(ROOT, 'db', 'database.ts'), 'utf8') + '\n' +
  fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));

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
  console.error('Das Schema gehört nach db/schema.sql, db/migrations/ oder db/database.ts —');
  console.error('nicht in eine Route.');
  console.error('DDL im Anfragepfad kostet je Anfrage einen Katalog-Zugriff und verteilt');
  console.error('das Schema über die Codebasis. Und eine zweite Fassung fällt nicht auf,');
  console.error('solange sie zufällig dasselbe will.');
  process.exit(1);
}

console.log(`GRUEN — ${dateien.length} Dateien im Anfragepfad, keine Schema-Anweisung darin`);
