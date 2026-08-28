/**
 * Späte require()-Aufrufe: Holt irgendwo jemand einen Namen, den das Modul gar
 * nicht exportiert?
 *
 * ── Warum es diesen Test braucht ────────────────────────────────────────────
 * Das Projekt löst Require-Zyklen mit späten `require()`-Aufrufen mitten im
 * Code — rund 340 Stück. Für `import`-Zeilen prüft TypeScript, ob es den Namen
 * gibt; für `require()` NICHT: Das Ergebnis ist `any`, ein falscher Name wird
 * schlicht `undefined` und fällt erst beim Aufruf auf — als TypeError, oft in
 * einem selten begangenen Zweig.
 *
 * Genau so lagen zwei Fehler jahrelang unbemerkt im Baum:
 *   - utils/handlers.ts holte `fetchRebrickableParts` aus routes/parts.ts, das
 *     diesen Namen nie exportiert hat. Die Teile-Rückfallebene für Sets ohne
 *     CSV-Eintrag endete deshalb immer in einem 500er.
 *   - routes/api_v1/sets.ts holte `getSetByItemNumber` aus clients/brickset.ts;
 *     die Funktion dort heisst `getSetByBarcode`. Die Bestellnummern-Suche der
 *     App antwortete mit 500 statt in die Rückfallebene zu gehen.
 *
 * Der Test lädt jedes Zielmodul aus dist/ und schaut nach, ob der geholte Name
 * wirklich existiert. Das ist keine Textprüfung, sondern die Frage, die im
 * Betrieb zählt: Was liefert require() tatsächlich?
 *
 * Zielmodule anzufassen ist unbedenklich — sie legen beim Laden keine Zeitgeber
 * an und verbinden sich nicht von selbst zur Datenbank (start() bzw. der erste
 * Aufruf tun das, und die ruft hier niemand).
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { ROOT, buildAndRequire, ohneKommentare } = require('./helpers/sources');
const DIST = path.join(ROOT, 'dist');

/** Alle .ts-Quellen des Servers (ohne Tests, Skripte und Frontend). */
function quellDateien() {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'public', 'test', 'scripts', 'types'].includes(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith('.ts')) out.push(abs);
    }
  })(ROOT);
  return out;
}

/**
 * Namen, die eine Datei aus einem anderen Modul per require() holt.
 * Erfasst beide Schreibweisen: `const { a, b } = require('./x')` und
 * `require('./x').a`. Kommentare vorher ausblenden — sonst würde der
 * Erklärtext oben („holte `getSetByItemNumber` aus…") mitgezählt.
 */
function geholteNamen(src) {
  const bereinigt = ohneKommentare(src);
  const map = new Map();
  const merke = (modul, name) => {
    if (!modul.startsWith('.')) return;
    if (!map.has(modul)) map.set(modul, new Set());
    map.get(modul).add(name);
  };
  for (const m of bereinigt.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(['"]([^'"]+)['"]\)/g)) {
    m[1].split(',')
      .map(s => s.split(':')[0].trim())
      .filter(n => /^[A-Za-z_$][\w$]*$/.test(n))
      .forEach(n => merke(m[2], n));
  }
  for (const m of bereinigt.matchAll(/require\(['"]([^'"]+)['"]\)\.([A-Za-z_$][\w$]*)/g)) {
    merke(m[1], m[2]);
  }
  return map;
}

test('jedes späte require() holt einen Namen, den es wirklich gibt', () => {
  buildAndRequire();   // stellt sicher, dass dist/ zur Quelle passt

  const dateien = quellDateien();
  assert.ok(dateien.length > 20, `Nur ${dateien.length} Quelldateien gefunden — die Prüfung liefe ins Leere`);

  const fehlend = [];
  let geprueft = 0;

  for (const datei of dateien) {
    const rel = path.relative(ROOT, datei);
    for (const [modPfad, namen] of geholteNamen(fs.readFileSync(datei, 'utf8'))) {
      const zielTs = path.join(path.dirname(datei), modPfad).replace(/\.js$/, '');
      const zielJs = path.join(DIST, path.relative(ROOT, zielTs)) + '.js';
      if (!fs.existsSync(zielJs)) continue;   // package.json u. ä. — kein Servermodul
      let mod;
      try { mod = require(zielJs); }
      catch (e) { fehlend.push(`${rel}: ${modPfad} nicht ladbar (${e.message})`); continue; }
      for (const n of namen) {
        geprueft++;
        if (mod == null || mod[n] === undefined) fehlend.push(`${rel}: ${modPfad} exportiert '${n}' nicht`);
      }
    }
  }

  // ── Zur Schwelle (Nachtrag 132) ──────────────────────────────────────────
  //
  // Sie ist ein Selbstschutz: Bricht das Muster oben, prüfte dieser Test
  // stillschweigend nichts mehr und bliebe grün. Sie war 100, als es rund 340
  // späte require() gab.
  //
  // Beim Umbau auf echte `import` fiel die Zahl planmässig auf unter hundert —
  // und die Schwelle schlug an. Das ist genau ihr Zweck, hier aber ein
  // Fehlalarm: Was der Test bewacht, WANDERT ja gerade dorthin, wo tsc es
  // besser prüft. Die Schwelle sinkt deshalb mit; sie darf nicht auf 0 fallen,
  // sonst wäre der Selbstschutz weg.
  assert.ok(geprueft > 60, `Nur ${geprueft} Namen geprüft — das Muster greift nicht mehr`);
  assert.deepEqual(fehlend, [], `require() ohne passenden Export:\n  ${fehlend.join('\n  ')}`);
});
