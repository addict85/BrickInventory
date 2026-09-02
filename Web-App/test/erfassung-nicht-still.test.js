/**
 * Eine verlorene Erfassung verschwindet nicht stillschweigend.
 *
 * ── Woher diese Prüfung kommt ───────────────────────────────────────────────
 * `recordAcquisitionForDay()` schreibt die Kaufhistorie: Menge, Preis, Zustand,
 * Datum. Schlägt der Aufruf fehl, steht der Artikel in der Sammlung, aber in
 * der Historie klafft ein Loch — und die Finanzansicht rechnet mit einer
 * Erfassung weniger.
 *
 * Drei der Aufrufe fingen den Fehler mit `.catch(()=>{})` ab, also ohne jede
 * Spur. Und zwar über Kreuz, was zeigt, dass es niemand entschieden hat:
 *
 *   routes/parts.ts     manuelles Anlegen  protokolliert
 *   routes/parts.ts     CSV-Import         STILL
 *   routes/minifigs.ts  manuelles Anlegen  STILL
 *   routes/minifigs.ts  CSV-Import         protokolliert
 *
 * Genau bei einem dieser stillen Aufrufe wäre der Datumsfehler aus demselben
 * Durchgang unsichtbar geblieben: Ein Datum mit Tag über 12 lässt Postgres
 * abbrechen, und der stille catch hätte es verschluckt.
 *
 * ── Was geprüft wird ────────────────────────────────────────────────────────
 * Kein Aufruf von recordAcquisitionForDay darf einen leeren catch tragen. Ohne
 * catch ist in Ordnung — dann trägt der Aufrufer den Fehler weiter, meist
 * innerhalb einer Transaktion. Gesucht wird also nur der LEERE.
 *
 * Die Aufrufer werden gefunden, nicht aufgezählt.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('kein stiller catch an einer Erfassung', () => {
  const ROOT = path.join(__dirname, '..');
  const ordner = ['routes', 'utils', 'jobs'];

  /** @type {string[]} */
  const dateien = [];
  const sammle = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) sammle(p);
      else if (e.name.endsWith('.ts')) dateien.push(p);
    }
  };
  for (const o of ordner) {
    const p = path.join(ROOT, o);
    assert.ok(fs.existsSync(p), `${o}/ gibt es nicht — ohne den Ordner prüft dieser Test nichts`);
    sammle(p);
  }
  assert.ok(dateien.length >= 30,
    `nur ${dateien.length} Dateien gefunden — der Pfad stimmt nicht`);

  const verstoesse = [];
  let aufrufe = 0;
  for (const datei of dateien) {
    const src = fs.readFileSync(datei, 'utf8');
    let i = 0;
    while ((i = src.indexOf('recordAcquisitionForDay(', i)) !== -1) {
      if (!/\bfunction\s+recordAcquisitionForDay/.test(src.slice(Math.max(0, i - 40), i + 24))) {
        aufrufe++;
        // Das Fenster nach dem Aufruf: bis zum Ende der Anweisung.
        const fenster = src.slice(i, i + 400);
        if (/\)\s*\.catch\(\s*\(\s*_?\s*\)\s*=>\s*\{\s*\}\s*\)/.test(fenster)) {
          const zeile = src.slice(0, i).split('\n').length;
          verstoesse.push(`${path.relative(ROOT, datei)}:${zeile}`);
        }
      }
      i += 24;
    }
  }

  // Selbstbeweis: Findet das Muster keine Aufrufe, sagt ein leeres Ergebnis
  // nichts. Es gibt derer deutlich mehr als fünf.
  assert.ok(aufrufe >= 5,
    `nur ${aufrufe} Aufruf(e) von recordAcquisitionForDay gefunden — Muster veraltet?`);

  assert.deepEqual(verstoesse, [],
    'Diese Erfassungen verschwinden bei einem Fehler ohne Spur:\n  ' +
    verstoesse.join('\n  ') +
    '\nEntweder den Fehler weiterreichen (gar kein catch) oder ihn mit ' +
    'logAndContinue(kontext) protokollieren.');
});
