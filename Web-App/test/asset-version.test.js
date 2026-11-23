/**
 * Every versioned reference in index.html carries the version from package.json.
 *
 * Counter-check: the ?v= of tokens.css in index.html set to an older version → red “all ?v= references in index.html carry the version from package.json”.
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
  assert.ok(references.length >= 5, `Only ${references.length} versioned references found — pattern outdated?`);

  const wrong = references.filter(m => m[2] !== version).map(m => `${m[1]}   (erwartet ?v=${version})`);
  assert.deepEqual(
    wrong,
    [],
    `These references carry a different version than package.json:\n  ${wrong.join('\n  ')}\nThe browser takes them from its cache for up to seven days (server.ts, maxAge 7d) — the deploy would have no effect for exactly this file.`,
  );
});
