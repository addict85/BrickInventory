/**
 * Every versioned reference in index.html carries the version from package.json.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('all ?v= references in index.html carry the version from package.json', () => {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(/^[\w.-]+$/.test(version || ''), `Unbrauchbare Version: ${version}`);

  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const references = [...html.matchAll(/(?:src|href)="([^"]*\?v=([^"&]*))"/g)];
  // Self-proof: if the pattern finds nothing, the check below would be silently
  // green. MEASURED there are eight.
  assert.ok(references.length >= 5, `Nur ${references.length} versionierte Verweise gefunden — Muster veraltet?`);

  const falsch = references.filter(m => m[2] !== version).map(m => `${m[1]}   (erwartet ?v=${version})`);
  assert.deepEqual(
    falsch,
    [],
    'Diese Verweise tragen eine andere Version als package.json:\n  ' +
      falsch.join('\n  ') +
      '\nDer Browser holt sie bis zu sieben Tage lang aus dem Cache (server.ts, ' +
      'maxAge 7d) — der Deploy bliebe für genau diese Datei wirkungslos.',
  );
});
