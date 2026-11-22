/**
 * Font sizes come from the scale (--fs-0 … --fs-8 in styles.css).
 *
 * Free rem values (.72, .73, .75 …) are differences that nobody sees but
 * everybody reinvents. Checked are styles, markup and the templates in public/js;
 * the themes in public/themes bring their own typography.
 *
 * Counter-checks (measured on 25.10.):
 *   A  a `font-size:.78rem` inserted in index.html → red, with location
 *   B  `var(--fs-9)` (does not exist) inserted         → red: „Stufe fehlt"
 */
const { isAppModule } = require('../scripts/build-frontend');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

function dateien() {
  const js = path.join(PUB, 'js');
  return [
    path.join(PUB, 'styles.css'),
    path.join(PUB, 'mobile.css'),
    path.join(PUB, 'index.html'),
    ...fs
      .readdirSync(js)
      .filter(n => isAppModule(n))
      .map(n => path.join(js, n)),
  ];
}

test('every font size takes a step of the scale', () => {
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  const stufen = new Set([...css.matchAll(/--fs-(\d+):/g)].map(m => m[1]));
  assert.ok(stufen.size >= 8, `Nur ${stufen.size} Stufen in styles.css gefunden — greift die Suche noch?`);
  const frei = [],
    fehlt = [];
  for (const f of dateien()) {
    const zeilen = fs.readFileSync(f, 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      const ort = `${path.relative(PUB, f)}:${i + 1}`;
      for (const m of z.matchAll(/font-size:\s*[0-9]*\.?[0-9]+rem/g)) frei.push(`${ort}  ${m[0]}`);
      for (const m of z.matchAll(/var\(--fs-(\d+)\)/g)) if (!stufen.has(m[1])) fehlt.push(`${ort}  --fs-${m[1]}`);
    });
  }
  assert.deepEqual(
    frei,
    [],
    'Schriftgrössen ausserhalb der Skala — bitte var(--fs-0 … 8) nehmen:\n  ' + frei.join('\n  '),
  );
  assert.deepEqual(fehlt, [], 'Stufe fehlt in styles.css:\n  ' + fehlt.join('\n  '));
});
