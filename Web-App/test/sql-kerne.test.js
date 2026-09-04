/**
 * Keine SQL-Anweisung steht in mehr als einer Datei.
 *
 * ── Warum diese Regel ───────────────────────────────────────────────────────
 * Der rote Faden dieser ganzen Arbeit: Was zweimal dasteht, laeuft irgendwann
 * auseinander. Diese Prueflung ist die Messung, mit der die Fundstellen
 * gefunden wurden — jetzt als Regel, damit die naechste Abschrift beim
 * Entstehen auffaellt statt beim Suchen.
 *
 * Sie hat in dieser Fassung 16 Kerne gemeldet. Vier davon trugen einen echten,
 * gemessenen Fehler:
 *
 *   price_cache/price_history  Der Nachtjob schrieb die Null-Zeile nicht und
 *                              kostete dauerhaft zwei BrickLink-Abrufe je Set.
 *   rb_inventories             Vier Kandidatenregeln, zwei davon fanden eine
 *                              blank abgelegte Zeile nicht.
 *   catalog_cache              Zwei Schluessel fuer dieselbe Markierung — drei
 *                              Abrufe fuer ein Set ohne Preis.
 *   sets.condition             Ein neues Exemplar bekam den Neupreis fuer ein
 *                              gebrauchtes Set.
 *
 * Bei zwei weiteren wurde AUSDRUECKLICH kein Unterschied gemessen
 * (shared_instructions, der Loeschweg fuer manuelle Stuecke). Die sind
 * trotzdem zusammengelegt: nicht wegen eines Fehlers, sondern damit die
 * naechste Aenderung an einer Stelle stattfindet.
 *
 * ── Was sie NICHT prueft ────────────────────────────────────────────────────
 * Nur wortgleiche Anweisungen ueber Dateigrenzen. Dieselbe Frage in zwei
 * verschiedenen Formulierungen findet sie nicht — genau daran ist meine
 * Setnummer-Regel einmal vorbeigelaufen (siehe
 * test/setnummer-schreibweise-db.test.js). Sie ist ein Netz, kein Beweis.
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

  // Anweisungen aus Zeichenketten holen, Leerraum vereinheitlichen.
  const sql = /(['"`])((?:SELECT|INSERT|UPDATE|DELETE)\s[\s\S]*?)\1/g;
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
  for (const [k, orte] of wo) {
    if (orte.size < 2 || ERLAUBT.has(k)) continue;
    doppelt.push(`${[...orte].sort().join(' + ')}\n      ${k.slice(0, 130)}`);
  }
  assert.deepEqual(doppelt, [],
    'Diese Anweisungen stehen in mehreren Dateien. Entweder gehoeren sie in ' +
    'eine gemeinsame Funktion, oder es gibt einen Grund — dann in ERLAUBT ' +
    'eintragen, damit der Naechste ihn nicht neu herleiten muss');
});
