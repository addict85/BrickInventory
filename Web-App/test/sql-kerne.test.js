/**
 * Keine SQL-Anweisung steht in mehr als einer Datei.
 *
 * Gegenprobe (durchgefuehrt): eine der zusammengelegten Anweisungen in eine
 * zweite Datei zurueckkopiert -> rot, mit beiden Fundorten.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Anweisungen, die bewusst mehrfach dastehen duerfen — jede mit dem Grund.
 * Leer: Es gibt zurzeit keine.
 */
const ERLAUBT = new Map([]);

test('keine SQL-Anweisung steht in mehr als einer Datei', () => {
  // Gefunden, nicht aufgezaehlt.
  const dateien = [];
  const gehen = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'scripts', 'public', '.git'].includes(e.name)
          || e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) gehen(abs);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) dateien.push(abs);
    }
  };
  gehen(ROOT);
  assert.ok(dateien.length >= 60,
    `Nur ${dateien.length} Quelldateien gefunden — die Suche greift nicht mehr`);

  // Anweisungen aus Zeichenketten holen, Leerraum vereinheitlichen. Ein
  // Routenschlüssel des API-Vertrags ('DELETE /api/v1/…') ist kein SQL.
  const sql = /(['"`])((?:SELECT|INSERT|UPDATE|DELETE)\s(?!\/)[\s\S]*?)\1/g;
  const wo = new Map();
  let gefunden = 0;
  for (const f of dateien) {
    const code = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    for (const m of code.matchAll(sql)) {
      const k = m[2].replace(/\s+/g, ' ').trim();
      // Zu kurz, um etwas Eigenes zu bedeuten (`SELECT 1 FROM x WHERE id=$1`).
      if (k.length < 45) continue;
      gefunden++;
      if (!wo.has(k)) wo.set(k, new Set());
      wo.get(k).add(rel);
    }
  }
  // Selbstnachweis: Faende die Suche kaum Anweisungen, waere die Regel leer wahr.
  assert.ok(gefunden >= 300,
    `Nur ${gefunden} SQL-Anweisungen gefunden — die Suche greift nicht mehr`);

  const doppelt = [];
  const gebraucht = new Set();
  for (const [k, orte] of wo) {
    if (orte.size < 2) continue;
    // Verbuchen statt ueberspringen — sonst faellt nie auf, wenn ein Eintrag
    // gegenstandslos wird. Die Liste ist heute leer; die Pruefung steht
    // trotzdem hier, damit der erste Eintrag sie schon vorfindet.
    if (ERLAUBT.has(k)) { gebraucht.add(k); continue; }
    doppelt.push(`${[...orte].sort().join(' + ')}\n      ${k.slice(0, 130)}`);
  }
  const veraltet = [...ERLAUBT.keys()].filter(k => !gebraucht.has(k));
  assert.deepEqual(veraltet, [],
    'Diese Eintraege in ERLAUBT beschreiben keine Doppelung mehr — raus damit:\n  ' +
    veraltet.map(k => k.slice(0, 130)).join('\n  '));
  assert.deepEqual(doppelt, [],
    'Diese Anweisungen stehen in mehreren Dateien. Entweder gehoeren sie in ' +
    'eine gemeinsame Funktion, oder es gibt einen Grund — dann in ERLAUBT ' +
    'eintragen, damit der Naechste ihn nicht neu herleiten muss');
});
