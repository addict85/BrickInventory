/**
 * Bau-Image: keine Werkzeuge ohne Zweck.
 *
 * python3/make/g++ standen als Vorsorge für node-gyp im Build-Stage. Sie werden
 * gebraucht, sobald ein Paket eine native Erweiterung aus C++-Quellen baut —
 * und von nichts anderem. Dieser Test hält beides zusammen: Sie dürfen nur
 * dann fehlen, wenn auch wirklich nichts kompiliert.
 *
 * Kommt später eine Abhängigkeit dazu, die eine binding.gyp mitbringt, wird
 * dieser Test rot statt der Build. Ein `npm ci`, das mit „gyp ERR! find Python"
 * abbricht, ist deutlich schwerer zu deuten als eine Zeile hier.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('das Build-Stage installiert keine Compiler-Werkzeuge', () => {
  const df = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  // Kommentare zählen nicht — dort steht die Zeile als Hinweis für den Fall,
  // dass sie doch einmal gebraucht wird.
  const cmds = df.split('\n').filter(l => !l.trim().startsWith('#'));
  for (const tool of ['python3', 'make', 'g++']) {
    assert.ok(!cmds.some(l => l.includes('apk add') && l.includes(tool)),
      `${tool} wird installiert, obwohl nichts kompiliert`);
  }
});

test('und keine Abhängigkeit braucht sie', () => {
  // Zwei Belege, beide aus der Lockfile — sie gilt im Build (npm ci):
  //   1. kein Paket mit nativer Erweiterung
  //   2. die Pakete mit Install-Skript sind bekannt und harmlos
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const withScript = Object.entries(lock.packages || {})
    // Der leere Schlüssel ist das Projekt selbst — sein postinstall ist
    // scripts/bump-version.js und hat mit nativen Erweiterungen nichts zu tun.
    .filter(([k, v]) => k && v.hasInstallScript)
    .map(([k]) => k.replace(/^.*node_modules\//, ''));

  // esbuild lädt eine fertige Binärdatei für die Plattform, fsevents ist
  // macOS-only und wird auf Linux gar nicht erst installiert.
  const harmless = new Set(['esbuild', 'fsevents']);
  const unknown = [...new Set(withScript)].filter(p => !harmless.has(p));
  assert.deepEqual(unknown, [],
    `Neue Pakete mit Install-Skript: ${unknown.join(', ')} — prüfen, ob sie kompilieren. ` +
    'Falls ja, gehört `RUN apk add --no-cache python3 make g++` zurück ins Build-Stage.');
});
