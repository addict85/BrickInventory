/**
 * Ein Funktionsname bedeutet eine Sache.
 *
 * ── Der Anlass ──────────────────────────────────────────────────────────────
 * `effectiveCondition` gab es ZWEIMAL, und die beiden beantworteten
 * verschiedene Fragen:
 *
 *     utils/financeCalc.ts   Welchen Zustand hat dieses SET?
 *                            (die Erfassungen schlagen den gespeicherten Wert)
 *     utils/settings.ts      Welchen Standardzustand hat dieser NUTZER?
 *                            (die Nutzereinstellung schlaegt den globalen)
 *
 * Genau diese Verwechslung — der Zustand eines Stuecks gegen die Vorgabe fuer
 * den Preis — hat in diesem Baum ACHT Fehler erzeugt. Und der Name stoerte
 * schon aktiv: DREI Dateien benannten den Import beim Holen um, um an ihrer
 * eigenen lokalen Variablen vorbeizukommen, jeweils mit einem Kommentar
 * „Alias wegen der lokalen effectiveCondition". Ein Name, um den herum drei
 * Dateien ausweichen muessen, ist der falsche Name. Die settings-Fassung
 * heisst jetzt nutzerStandardZustand().
 *
 * ── Was hier geprueft wird ──────────────────────────────────────────────────
 * Gefunden, nicht aufgezaehlt: Alle Funktionsnamen des Baums werden gesammelt;
 * steht einer in mehreren Dateien, muss er in ERLAUBT stehen — mit dem Grund.
 *
 * Die Liste ist bewusst nicht leer: Ein gleicher Name ist nicht per se falsch.
 * `start` in drei Jobs oder `get` im Datenbankmodul und im Job-Monitor sind
 * dieselbe Sache in verschiedenen Zusammenhaengen. Falsch wird es, wenn
 * derselbe Name VERSCHIEDENE Fragen beantwortet — und genau dafuer zwingt die
 * Liste dazu, den Grund hinzuschreiben.
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
  ['get',   'db/database (eine Zeile holen) und utils/jobMonitor (einen Job-Stand holen) — ' +
            'dieselbe Sache, verschiedene Speicher.'],
  ['all',   'wie get.'],
  ['run',   'db/database und drei Jobs: „ausfuehren". In den Jobs ist es der Einstieg, ' +
            'in der Datenbank die Anweisung — gleicher Begriff, kein gemeinsamer Gegenstand.'],
  ['start', 'drei Jobs, jeder startet SEINEN Job. Gleicher Name, gleiche Bedeutung, ' +
            'verschiedene Gegenstaende.'],
  ['log',   'drei Jobs, jeder schreibt mit seinem eigenen Praefix.'],
  ['scheduleNext', 'zwei Jobs, jeder plant SEINEN naechsten Lauf.'],
  ['getSetInfo',   'clients/brickset und clients/rebrickable — dieselbe Frage an ZWEI ' +
                   'verschiedene Dienste. Der Dateiname sagt, welcher gemeint ist.'],
  ['httpsGet',     'clients/bricklink und clients/brickset — jeder mit der Signatur seines ' +
                   'Dienstes (BrickLink braucht einen Authorization-Kopf, Brickset nicht).'],
  ['schreibePuffer', 'jobs/imageQueue und utils/imageMisses — jeder schreibt SEINEN Puffer.'],
]);

test('ein Funktionsname bedeutet eine Sache', () => {
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

  const wo = new Map();
  let gefunden = 0;
  for (const f of dateien) {
    const code = fs.readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    const rel = path.relative(ROOT, f);
    for (const m of code.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)) {
      gefunden++;
      if (!wo.has(m[1])) wo.set(m[1], new Set());
      wo.get(m[1]).add(rel);
    }
  }
  // Selbstnachweis: Faende die Suche kaum Funktionen, waere die Regel leer wahr.
  assert.ok(gefunden >= 300,
    `Nur ${gefunden} Funktionen gefunden — die Suche greift nicht mehr`);

  const doppelt = [];
  for (const [name, orte] of wo) {
    if (orte.size < 2 || ERLAUBT.has(name)) continue;
    doppelt.push(`${name}: ${[...orte].sort().join(', ')}`);
  }
  assert.deepEqual(doppelt.sort(), [],
    'Diese Namen stehen in mehreren Dateien. Entweder meinen sie dasselbe — dann ' +
    'gehoeren sie in eine gemeinsame Funktion —, oder sie meinen VERSCHIEDENES, ' +
    'dann braucht einer einen anderen Namen. Ist beides nicht der Fall, in ERLAUBT ' +
    'eintragen, mit dem Grund');
});
