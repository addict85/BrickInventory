/**
 * Das eingecheckte Bündel (public/js/app.bundle.js) passt zu den Quellen.
 *
 * Browser-Tests und Auslieferung laden das Bündel, nicht public/js/*.js. Ein
 * vergessenes `npm run build:frontend` hiesse: Die Tests prüfen den alten
 * Stand, und ausgeliefert wird er auch. Gebaut wird in ein Zeitverzeichnis,
 * das eingecheckte Bündel bleibt unberührt.
 *
 * Gegenprobe (gemessen): an 01-core.js `console.log(1);` angehängt, ohne neu
 * zu bauen → rot: „Bündel veraltet“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { OUT_REL } = require('../scripts/build-frontend');

test('das eingecheckte Bündel entspricht einem frischen Bau der Quellen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buendel-'));
  try {
    const frisch = path.join(dir, 'app.bundle.js');
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-frontend.js'), `--outfile=${frisch}`]);
    const gebaut = fs.readFileSync(frisch, 'utf8');
    assert.ok(gebaut.length > 100_000, `nur ${gebaut.length} Zeichen gebaut — greift der Bau noch?`);
    const eingecheckt = fs.readFileSync(path.join(__dirname, '..', 'public', OUT_REL), 'utf8');
    assert.ok(gebaut === eingecheckt, 'Bündel veraltet: `npm run build:frontend` ausführen und public/js/app.bundle.js mitcommitten');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
