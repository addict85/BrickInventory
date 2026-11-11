/**
 * Wer Geld formatiert, sagt auch WELCHES.
 *
 * Gegenprobe (08.11.2026 gemessen): in fmtN `cur||CURRENCY||'EUR'` →
 * `cur||'EUR'` → rot: „der Rückfall von fmtN ist die eingestellte Währung“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');
const { baueTestbuendel } = require('./helpers/buendel');
process.env.TEST_BUENDEL = baueTestbuendel('geldformat', "import { fmtN } from './01-format.js';\nwindow.__fmtN = fmtN;\n");
const { oeffneOberflaeche, ANMELDUNG, warte } = require('./helpers/oberflaeche');

/**
 * Hat dieser Aufruf ein ZWEITES Argument?
 *
 * Ein Muster wie /fmtN\([^)]*,/ reicht nicht: Die Argumente enthalten selbst
 * Klammern (`fmtN(v.total_value, v.currency || CURRENCY)`) und Aufrufe. Deshalb
 * wird die Klammertiefe mitgezählt und nur ein Komma auf Ebene 1 gewertet.
 */
function hatZweitesArgument(src, ab) {
  let tiefe = 0;
  for (let i = ab; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') tiefe++;
    else if (c === ')' || c === ']' || c === '}') { tiefe--; if (tiefe === 0) return false; }
    else if (c === ',' && tiefe === 1) return true;
  }
  return false;
}

test('jeder fmtN-Aufruf nennt die Währung', () => {
  const dateien = fs.readdirSync(JS)
    .filter(f => f.endsWith('.js') && f !== 'app.bundle.js')
    .map(f => [f, fs.readFileSync(path.join(JS, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
  assert.ok(dateien.length >= 10, `Nur ${dateien.length} Skriptdateien gefunden`);

  let gefunden = 0;
  const ohne = [];
  for (const [rel, src] of dateien)
    for (const m of src.matchAll(/\bfmtN\(/g)) {
      // Die Definition selbst ist kein Aufruf.
      if (/function\s+fmtN\($/.test(src.slice(0, m.index + 5))) continue;
      gefunden++;
      if (!hatZweitesArgument(src, m.index + 4)) {
        const zeile = src.slice(0, m.index).split('\n').length;
        ohne.push(`${rel}:${zeile}  ${src.slice(m.index, m.index + 46).split('\n')[0]}`);
      }
    }
  // Selbstbeweis: Findet das Muster nichts, wäre die Liste leer und der Test
  // grün, ohne etwas geprüft zu haben. GEMESSEN sind es 30 Aufrufe.
  assert.ok(gefunden >= 20, `Nur ${gefunden} fmtN-Aufrufe gefunden — Muster veraltet?`);

  assert.deepEqual(ohne.sort(), [],
    'Diese fmtN-Aufrufe nennen keine Währung:\n  ' + ohne.join('\n  ') +
    '\nEntweder fehlt sie (dann steht dort die Währung eines anderen Nutzers), ' +
    'oder es ist gar kein Geldbetrag — dann gehört dorthin ' +
    '`(n||0).toLocaleString(locale())`, wie auf der Teilekachel.');
});

/**
 * Zweite Verteidigungslinie: Sollte doch einmal ein Aufruf ohne Währung
 * entstehen, zeigt er die EINGESTELLTE — nicht Euro für jemanden, der in
 * Franken rechnet. Am Bündel in jsdom, mit Franken in den Einstellungen.
 */
test('der Rückfall von fmtN ist die eingestellte Währung', async () => {
  const { w } = await oeffneOberflaeche({
    '/v1/settings/raw': { success: true, settings: { ...ANMELDUNG['/v1/settings/raw'].settings, currency: 'CHF' } },
  });
  try {
    assert.ok(await warte(() => /CHF/.test(w.__fmtN(12.5))), `ohne Währung: ${w.__fmtN(12.5)}`);
    assert.match(w.__fmtN(12.5, 'USD'), /\$|USD/, 'Die genannte Währung gewinnt');
  } finally { w.close(); }
});
