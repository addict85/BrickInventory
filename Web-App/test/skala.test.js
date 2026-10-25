/**
 * Schriftgrössen kommen aus der Skala (--fs-0 … --fs-8 in styles.css).
 *
 * Vorher standen 45 verschiedene rem-Werte an gut 400 Stellen (.72, .73,
 * .75, .76, .77, .78 …) — Unterschiede, die niemand sieht, aber jeder
 * neu erfindet. Geprüft werden Stile, Markup und die Vorlagen in public/js;
 * die Designs in public/themes bringen eigene Typografie mit.
 *
 * Gegenproben (am 25.10. gemessen):
 *   A  in index.html ein `font-size:.78rem` eingesetzt → rot, mit Fundstelle
 *   B  `var(--fs-9)` (gibt es nicht) eingesetzt        → rot: „Stufe fehlt"
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

function dateien() {
  const js = path.join(PUB, 'js');
  return [path.join(PUB, 'styles.css'), path.join(PUB, 'mobile.css'), path.join(PUB, 'index.html'),
    ...fs.readdirSync(js).filter(n => /^\d\d-.*\.js$/.test(n)).map(n => path.join(js, n))];
}

test('jede Schriftgrösse nimmt eine Stufe der Skala', () => {
  const css = fs.readFileSync(path.join(PUB, 'styles.css'), 'utf8');
  const stufen = new Set([...css.matchAll(/--fs-(\d+):/g)].map(m => m[1]));
  assert.ok(stufen.size >= 8, `Nur ${stufen.size} Stufen in styles.css gefunden — greift die Suche noch?`);
  const frei = [], fehlt = [];
  for (const f of dateien()) {
    const zeilen = fs.readFileSync(f, 'utf8').split('\n');
    zeilen.forEach((z, i) => {
      const ort = `${path.relative(PUB, f)}:${i + 1}`;
      for (const m of z.matchAll(/font-size:\s*[0-9]*\.?[0-9]+rem/g)) frei.push(`${ort}  ${m[0]}`);
      for (const m of z.matchAll(/var\(--fs-(\d+)\)/g)) if (!stufen.has(m[1])) fehlt.push(`${ort}  --fs-${m[1]}`);
    });
  }
  assert.deepEqual(frei, [], 'Schriftgrössen ausserhalb der Skala — bitte var(--fs-0 … 8) nehmen:\n  ' + frei.join('\n  '));
  assert.deepEqual(fehlt, [], 'Stufe fehlt in styles.css:\n  ' + fehlt.join('\n  '));
});
