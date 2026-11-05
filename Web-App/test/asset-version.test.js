/**
 * Jede versionierte Referenz in index.html trägt die Version aus package.json.
 * Ausführlich: docs/begruendungen/test/asset-version.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('alle ?v=-Verweise in index.html tragen die Version aus package.json', () => {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(/^[\w.-]+$/.test(version || ''), `Unbrauchbare Version: ${version}`);

  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  const verweise = [...html.matchAll(/(?:src|href)="([^"]*\?v=([^"&]*))"/g)];
  // Selbstbeweis: Findet das Muster nichts, wäre die Prüfung darunter still
  // grün. GEMESSEN sind es acht.
  assert.ok(verweise.length >= 5,
    `Nur ${verweise.length} versionierte Verweise gefunden — Muster veraltet?`);

  const falsch = verweise
    .filter(m => m[2] !== version)
    .map(m => `${m[1]}   (erwartet ?v=${version})`);
  assert.deepEqual(falsch, [],
    'Diese Verweise tragen eine andere Version als package.json:\n  ' +
    falsch.join('\n  ') +
    '\nDer Browser holt sie bis zu sieben Tage lang aus dem Cache (server.ts, ' +
    'maxAge 7d) — der Deploy bliebe für genau diese Datei wirkungslos.');
});
