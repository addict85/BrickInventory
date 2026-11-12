/**
 * Ein Funktionsname bedeutet eine Sache.
 *
 * Gegenprobe (durchgefuehrt): einen Namen aus ERLAUBT entfernt -> rot; die
 * settings-Fassung wieder effectiveCondition genannt -> rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Name -> warum er mehrfach vorkommen darf. */
const ERLAUBT = new Map([
  [
    'run',
    'db/database und drei Jobs: „ausfuehren". In den Jobs ist es der Einstieg, ' +
      'in der Datenbank die Anweisung — gleicher Begriff, kein gemeinsamer Gegenstand.',
  ],
  ['log', 'drei Jobs, jeder schreibt mit seinem eigenen Praefix.'],
  [
    'getSetInfo',
    'clients/brickset und src/katalog/rebrickableKatalog — dieselbe Frage an ZWEI ' +
      'verschiedene Dienste. Der Dateiname sagt, welcher gemeint ist.',
  ],
  [
    'httpsGet',
    'clients/bricklink und clients/brickset — jeder mit der Signatur seines ' +
      'Dienstes (BrickLink braucht einen Authorization-Kopf, Brickset nicht).',
  ],
  [
    'schreibePuffer',
    'src/katalog/bilder/bildbedarfLauf und src/katalog/bilder/imageMisses — jeder schreibt SEINEN Puffer.',
  ],
]);

test('ein Funktionsname bedeutet eine Sache', () => {
  const dateien = [];
  const gehen = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'scripts', 'public', '.git'].includes(e.name) || e.name.startsWith('.'))
        continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  gehen(ROOT);
  assert.ok(dateien.length >= 60, `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  const wo = new Map();
  let gefunden = 0;
  for (const f of dateien) {
    const code = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    // Auch generische Funktionen (`function all<T = any>(`).
    for (const m of code.matchAll(/^(?:export )?(?:async )?function (\w+)(?:<[^>(]*>)?\(/gm)) {
      gefunden++;
      if (!wo.has(m[1])) wo.set(m[1], new Set());
      wo.get(m[1]).add(rel);
    }
  }
  // Selbstnachweis: Faende die Suche kaum Funktionen, waere die Regel leer wahr.
  assert.ok(gefunden >= 300, `Nur ${gefunden} Funktionen gefunden — die Suche greift nicht mehr`);

  const doppelt = [];
  const gebraucht = new Set();
  for (const [name, orte] of wo) {
    if (orte.size < 2) continue;
    // Ein erlaubter Name wird nicht uebersprungen, sondern VERBUCHT: Nur so
    // faellt auf, wenn er laengst nur noch an einer Stelle steht und der
    // Eintrag nichts mehr beschreibt. Ein toter Eintrag sieht aus wie eine
    // Entscheidung und ist doch bloss eine Vermutung, sobald keiner nachsieht.
    if (ERLAUBT.has(name)) {
      gebraucht.add(name);
      continue;
    }
    doppelt.push(`${name}: ${[...orte].sort().join(', ')}`);
  }
  const veraltet = [...ERLAUBT.keys()].filter(k => !gebraucht.has(k)).sort();
  assert.deepEqual(
    veraltet,
    [],
    'Diese Eintraege in ERLAUBT beschreiben keine Doppelung mehr:\n  ' +
      veraltet.join('\n  ') +
      '\nDer Name steht nur noch an einer Stelle — raus damit.',
  );
  assert.deepEqual(
    doppelt.sort(),
    [],
    'Diese Namen stehen in mehreren Dateien. Entweder meinen sie dasselbe — dann ' +
      'gehoeren sie in eine gemeinsame Funktion —, oder sie meinen VERSCHIEDENES, ' +
      'dann braucht einer einen anderen Namen. Ist beides nicht der Fall, in ERLAUBT ' +
      'eintragen, mit dem Grund',
  );
});
