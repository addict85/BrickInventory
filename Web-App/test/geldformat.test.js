/**
 * Wer Geld formatiert, sagt auch WELCHES.
 *
 * ── Der Befund ──────────────────────────────────────────────────────────────
 *
 * `fmtN(v, cur)` (01-core.js) formatiert einen Geldbetrag. Das zweite Argument
 * war optional und fiel auf 'EUR' zurück. NACHGEMESSEN: 30 Aufrufstellen, 28
 * übergeben eine Währung — und die zwei übrigen wollten überhaupt keinen
 * Betrag formatieren, sondern eine ANZAHL:
 *
 *     fmtN(item?.total_quantity || 0)   im Teile-Detail
 *     fmtN(s.quantity)                  in der Liste „Verwendet in"
 *
 * Angezeigt wurde damit „EUR 6.00×" statt „6×" — Marcos Befund. Zwei Fehler in
 * einem: die falsche Formatierungsart UND, für alle, die nicht in Euro rechnen,
 * die falsche Währung.
 *
 * ── Warum die Regel am AUFRUF hängt und nicht am Rückfall ───────────────────
 *
 * Der Rückfall ist mit korrigiert (jetzt `CURRENCY` statt 'EUR'), aber das ist
 * die zweite Verteidigungslinie. Die erste ist: Ein Aufruf ohne Währung ist
 * fast immer ein Aufruf, der gar kein Geld meint. Genau das soll auffallen.
 *
 * Anzahlen schreibt dieser Baum als `(n||0).toLocaleString(locale())` — so
 * steht es auf der Teilekachel (03-parts.js) und an sieben weiteren Stellen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const JS = path.join(ROOT, 'public', 'js');

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
 * Und der Rückfall nennt nicht mehr eine feste Währung.
 *
 * Zweite Verteidigungslinie: Sollte doch einmal ein Aufruf ohne Währung
 * entstehen, zeigt er die EINGESTELLTE — nicht Euro für jemanden, der in
 * Franken rechnet.
 */
test('der Rückfall von fmtN ist die eingestellte Währung', () => {
  const core = fs.readFileSync(path.join(JS, '01-core.js'), 'utf8');
  const i = core.indexOf('export function fmtN(');
  assert.ok(i > 0, 'fmtN nicht gefunden');
  const rumpf = core.slice(i, core.indexOf('\n}', i));
  assert.match(rumpf, /cur\s*\|\|\s*CURRENCY/,
    'fmtN fällt nicht auf CURRENCY zurück — ein vergessenes Argument zeigt ' +
    'dann wieder eine fest verdrahtete Währung.');
});
