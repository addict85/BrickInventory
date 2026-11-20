/**
 * Eine verlorene Erfassung verschwindet nicht stillschweigend.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('kein stiller catch an einer Erfassung', () => {
  const ROOT = path.join(__dirname, '..');
  const ordner = ['routes', 'src', 'jobs'];

  /** @type {string[]} */
  const dateien = [];
  const collect = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) collect(p);
      else if (e.name.endsWith('.ts')) dateien.push(p);
    }
  };
  for (const o of ordner) {
    const p = path.join(ROOT, o);
    assert.ok(fs.existsSync(p), `${o}/ gibt es nicht — ohne den Ordner prüft dieser Test nichts`);
    collect(p);
  }
  assert.ok(dateien.length >= 30, `nur ${dateien.length} Dateien gefunden — der Pfad stimmt nicht`);

  const violations = [];
  let aufrufe = 0;
  for (const datei of dateien) {
    const src = fs.readFileSync(datei, 'utf8');
    // Innen heisst die Buchung addPurchaseAtTag, im Dienstsatz bookDailyEntry.
    for (const m of src.matchAll(/\b(?:addPurchaseAtTag|bookDailyEntry)\(/g)) {
      const i = m.index ?? 0;
      if (!/\bfunction\s+addPurchaseAtTag/.test(src.slice(Math.max(0, i - 40), i + 24))) {
        aufrufe++;
        // Das Fenster nach dem Aufruf: bis zum Ende der Anweisung.
        const fenster = src.slice(i, i + 400);
        if (/\)\s*\.catch\(\s*\(\s*_?\s*\)\s*=>\s*\{\s*\}\s*\)/.test(fenster)) {
          const zeile = src.slice(0, i).split('\n').length;
          violations.push(`${path.relative(ROOT, datei)}:${zeile}`);
        }
      }
    }
  }

  // Selbstbeweis: Findet das Muster keine Aufrufe, sagt ein leeres Ergebnis
  // nichts. Es gibt derer deutlich mehr als fünf.
  assert.ok(aufrufe >= 5, `nur ${aufrufe} Aufruf(e) von addPurchaseAtTag gefunden — Muster veraltet?`);

  assert.deepEqual(
    violations,
    [],
    'Diese Erfassungen verschwinden bei einem Fehler ohne Spur:\n  ' +
      violations.join('\n  ') +
      '\nEntweder den Fehler weiterreichen (gar kein catch) oder ihn mit ' +
      'logAndContinue(kontext) protokollieren.',
  );
});
