/**
 * Jede versionierte Referenz in index.html trägt die Version aus package.json.
 *
 * ── Warum das zählt ─────────────────────────────────────────────────────────
 *
 * server.ts liefert alles unter public/ mit `maxAge: '7d'` aus und begründet
 * das dort ausdrücklich: „index.html bekommt no-cache, damit Deploys sofort
 * sichtbar sind — die versionierten Referenzen darin ziehen dann frische
 * Assets nach."
 *
 * Der Satz stimmt nur, solange die `?v=` auch wirklich wechseln. Bleibt eine
 * zurück, holt der Browser genau diese Datei bis zu sieben Tage lang aus dem
 * Cache — und der Deploy ist für sie wirkungslos. Nichts hat das bisher
 * geprüft; die acht Werte standen von Hand da und mussten von Hand
 * mitgeändert werden.
 *
 * NACHGEMESSEN aufgefallen ist es beim Ergänzen der Sprachdateien (Nachtrag
 * 142): Neue Schlüssel in locales/de.js hätten zurückkehrende Browser erst mit
 * der nächsten Versionsänderung erreicht — und ohne Prüfung merkt das niemand,
 * weil ein frisch geleerter Cache alles richtig zeigt.
 *
 * ── Was der Test NICHT prüft ────────────────────────────────────────────────
 *
 * Ob die Version überhaupt erhöht WURDE, nachdem sich eine Datei geändert hat.
 * Das ist eine Freigabe-Entscheidung und keine Eigenschaft des Quelltextes.
 * Geprüft wird nur, dass die acht Verweise unter sich und mit package.json
 * einig sind — der Teil, der still falsch werden kann.
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
