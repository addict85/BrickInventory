/**
 * Funktionen ohne Aufrufer.
 *
 * ── Warum es diesen Test braucht ────────────────────────────────────────────
 * In drei Durchgängen hintereinander war toter Code der Ausgangspunkt eines
 * echten Fehlers: Eine 90-zeilige Zweitfassung des Rebrickable-Teileabrufs
 * lief am Tageskontingent vorbei, `getSetByBarcode` lag unbenutzt daneben
 * während die Route einen Namen aufrief, den es nicht gab, und im CSV-Abgleich
 * standen zwei vollständige Zweitfassungen des Download-Wegs samt eigener
 * CSV-Zerlegung. Solche Fassungen altern unbemerkt mit: Sie bekommen keine
 * Korrekturen, keine Sperren, keine Kontingentprüfung — und irgendwann ruft
 * sie doch jemand auf.
 *
 * Der Test ist bewusst grob: Er zählt Vorkommen des Namens im ganzen
 * Serverbaum plus Tests. Wer eine Funktion exportiert, „benutzt" sie damit
 * (die Exportzeile zählt) — das ist die Grenze dieses Tests und der Preis
 * dafür, dass er keine falschen Alarme schlägt.
 */
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const { ROOT, ohneKommentare } = require('./helpers/sources');

/** Alle .ts-Quellen des Servers plus die Tests als Referenzkorpus. */
function dateien(unterordner, endung) {
  const out = [];
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', 'public'].includes(e.name)) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(endung)) out.push(abs);
    }
  })(path.join(ROOT, unterordner));
  return out;
}

test('keine Funktion ohne einen einzigen Aufrufer', () => {
  const quellen = ['routes', 'utils', 'jobs', 'db'].flatMap(d => dateien(d, '.ts'))
    .concat([path.join(ROOT, 'server.ts')]);
  const korpus = quellen.concat(dateien('test', '.js'))
    .map(f => ohneKommentare(fs.readFileSync(f, 'utf8')))
    .join('\n');

  assert.ok(quellen.length > 20, `nur ${quellen.length} Quelldateien gefunden — die Prüfung liefe ins Leere`);

  const tot = [];
  let geprueft = 0;
  for (const datei of quellen) {
    const src = ohneKommentare(fs.readFileSync(datei, 'utf8'));
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
      const name = m[1];
      geprueft++;
      const treffer = (korpus.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
      // 1 Treffer = nur die Deklaration selbst.
      if (treffer <= 1) tot.push(`${path.relative(ROOT, datei)}: ${name}`);
    }
  }

  assert.ok(geprueft > 100, `nur ${geprueft} Funktionen geprüft — das Muster greift nicht mehr`);
  assert.deepEqual(tot, [], `Funktionen ohne Aufrufer:\n  ${tot.join('\n  ')}`);
});
