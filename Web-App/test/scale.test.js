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

function files() {
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
  const levels = new Set([...css.matchAll(/--fs-(\d+):/g)].map(m => m[1]));
  assert.ok(levels.size >= 8, `Only ${levels.size} levels found in styles.css — does the search still work?`);
  const free = [],
    missing = [];
  for (const f of files()) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((z, i) => {
      const location = `${path.relative(PUB, f)}:${i + 1}`;
      for (const m of z.matchAll(/font-size:\s*[0-9]*\.?[0-9]+rem/g)) free.push(`${location}  ${m[0]}`);
      for (const m of z.matchAll(/var\(--fs-(\d+)\)/g))
        if (!levels.has(m[1])) missing.push(`${location}  --fs-${m[1]}`);
    });
  }
  assert.deepEqual(free, [], 'Font sizes outside the scale — please use var(--fs-0 … 8):\n  ' + free.join('\n  '));
  assert.deepEqual(missing, [], 'level missing in styles.css:\n  ' + missing.join('\n  '));
});
