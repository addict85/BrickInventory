/**
 * scripts/verweise-pruefen.js: Pfadverweise in Code-Kommentaren, README.md und
 * docs/ zeigen auf Dateien, die es gibt. Geprüft am echten Skript, einmal an
 * einem Probebaum mit bekannten toten Verweisen und einmal am Bestand.
 *
 * Gegenproben (13.11.2026, je einzeln):
 *   A  in public/js/passkeys.js Zeile 11 den früheren Routen-Pfad (passkeys.ts
 *      unter routes) zurückgesetzt → „der Bestand hat keine toten Verweise“ rot mit dieser Zeile
 *   B  kommentarJs() gibt die ganze Zeile zurück → „im Probebaum …“ rot
 *      (der Pfad im Zeichenkettenwert des Codes wurde gemeldet)
 *   C  docs/ nicht mehr gelesen → „im Probebaum …“ rot (der tote Verweis aus der Doku fehlt)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKRIPT = path.join(__dirname, '..', 'scripts', 'verweise-pruefen.js');

/** Repo/Web-App mit src/, docs/ und README.md; tote Verweise stehen nur in Kommentaren und Doku. */
function probebaum() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'verweise-'));
  const web = path.join(repo, 'Web-App');
  for (const d of ['src', 'docs', 'scripts']) fs.mkdirSync(path.join(web, d), { recursive: true });
  fs.writeFileSync(path.join(web, 'src', 'da.ts'), 'export const x = 1;\n');
  fs.writeFileSync(
    path.join(web, 'src', 'a.ts'),
    [
      '/** Siehe src/da.ts und src/weg.ts. */',
      "const p = 'src/auchweg.ts'; // gebaut als src/da.js",
      '// früher utils/alt.ts',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(web, 'scripts', 'b.sh'), 'cp src/codeweg.ts /tmp # aus src/shweg.ts\n');
  fs.writeFileSync(path.join(web, 'README.md'), 'Einstieg: src/da.ts, Plan: docs/plan.md\n');
  fs.writeFileSync(path.join(web, 'docs', 'x.md'), 'Siehe Web-App/src/da.ts und src/docweg.ts\n');
  return { repo, web };
}

const lauf = (/** @type {string} */ web) => spawnSync(process.execPath, [SKRIPT, web], { encoding: 'utf8' });

test('im Probebaum meldet das Skript genau die toten Verweise in Kommentaren und Doku', t => {
  const { repo, web } = probebaum();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const r = lauf(web);
  assert.equal(r.status, 1, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n').sort(), [
    'README.md:1 docs/plan.md',
    'docs/x.md:1 src/docweg.ts',
    'scripts/b.sh:1 src/shweg.ts',
    'src/a.ts:1 src/weg.ts',
    'src/a.ts:3 utils/alt.ts',
  ]);
});

test('der Bestand hat keine toten Verweise', () => {
  const r = lauf(path.join(__dirname, '..'));
  const gesehen = Number(/(\d+) Pfadverweise/.exec(r.stderr)?.[1]);
  assert.ok(gesehen > 200, `nur ${gesehen} Verweise gefunden — greift die Suche noch?\n${r.stderr}`);
  assert.equal(r.stdout, '', 'Pfad auf die heutige Datei ändern; Geschichte gehört in den Commit');
  assert.equal(r.status, 0);
});
