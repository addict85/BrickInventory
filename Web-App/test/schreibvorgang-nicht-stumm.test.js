/**
 * Ein verschluckter SCHREIBVORGANG auf Nutzerdaten.
 * Ausführlich: docs/begruendungen/test/schreibvorgang-nicht-stumm.test.js.md#kopf
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Tabellen mit Daten, die der Nutzer selbst eingegeben hat. */
const NUTZERDATEN = [
  'sets', 'parts', 'minifigs',
  'set_acquisitions', 'part_acquisitions', 'minifig_acquisitions',
  'users', 'user_settings', 'account_links',
];

test('kein stiller catch auf einem Schreibvorgang mit Nutzerdaten', () => {
  /** @type {string[]} */
  const dateien = [];
  const sammle = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'coverage', 'public', 'test'].includes(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) sammle(p);
      else if (e.name.endsWith('.ts')) dateien.push(p);
    }
  };
  sammle(ROOT);
  assert.ok(dateien.length >= 60, `nur ${dateien.length} Dateien gefunden — der Pfad stimmt nicht`);

  // Warum hier geklammert und nicht nur ein Fenster gelesen wird
  // Ausführlich: docs/begruendungen/test/schreibvorgang-nicht-stumm.test.js.md#aufruf
  const aufruf = /\b(?:db|tx|dbh|client)\.(?:run|query)\(|\bpool\.query\(/g;
  const stillDanach = /^\s*\)?\s*\.catch\(\s*\(?\s*_?\w*\s*\)?\s*=>\s*(\{\s*\}|null|undefined)\s*\)/;
  const schreib = new RegExp(
    `\\b(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(${NUTZERDATEN.join('|')})\\b`, 'i');

  const ohneKommentare = (src) => src.split('\n')
    .map(z => { const t = z.trim(); return (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) ? '' : z; })
    .join('\n');

  const verstoesse = [];
  let geprueft = 0;
  for (const datei of dateien) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    aufruf.lastIndex = 0;
    let m;
    while ((m = aufruf.exec(src)) !== null) {
      // Bis zur schliessenden Klammer des Aufrufs
      let tiefe = 1, i = m.index + m[0].length;
      while (i < src.length && tiefe > 0) {
        const c = src[i];
        if (c === '(') tiefe++;
        else if (c === ')') tiefe--;
        i++;
      }
      const anweisung = src.slice(m.index, i);
      if (!schreib.test(anweisung)) continue;
      geprueft++;
      if (stillDanach.test(src.slice(i, i + 90))) {
        const zeile = src.slice(0, m.index).split('\n').length;
        verstoesse.push(`${path.relative(ROOT, datei)}:${zeile}`);
      }
    }
  }

  // Selbstbeweis: Findet das Muster keine schreibenden Aufrufe auf diesen
  // Tabellen, sagt ein leeres Ergebnis nichts.
  assert.ok(geprueft >= 30,
    `nur ${geprueft} schreibende Aufrufe auf Nutzerdaten gefunden — Muster veraltet`);

  assert.deepEqual(verstoesse, [],
    'Diese Schreibvorgaenge auf Nutzerdaten scheitern spurlos:\n  ' +
    verstoesse.join('\n  ') +
    '\nEntweder den Fehler weiterreichen (gar kein catch) oder ihn mit ' +
    'logAndContinue(kontext) protokollieren.');
});
