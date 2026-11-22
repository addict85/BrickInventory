/**
 * scripts/check-references.js: path references in code comments, README.md and
 * docs/ point to files that exist. Checked on the real script, once on
 * a sample tree with known dead references and once on the codebase.
 *
 * Counter-checks (13.11.2026, each on its own):
 *   A  in public/js/passkeys.js line 11 the former route path (passkeys.ts
 *      under routes) reset → “the codebase has no dead references” red with this line
 *   B  commentJs() returns the whole line → “in the sample tree …” red
 *      (the path in the string value of the code was reported)
 *   C  docs/ no longer read → “in the sample tree …” red (the dead reference from the docs is missing)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-references.js');

/** Repo/Web-App with src/, docs/ and README.md; dead references only stand in comments and docs. */
function probeTree() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'verweise-'));
  const web = path.join(repo, 'Web-App');
  for (const d of ['src', 'docs', 'scripts']) fs.mkdirSync(path.join(web, d), { recursive: true });
  fs.writeFileSync(path.join(web, 'src', 'da.ts'), 'export const x = 1;\n');
  fs.writeFileSync(
    path.join(web, 'src', 'a.ts'),
    [
      '/** Siehe src/da.ts und src/weg.ts. */',
      'const p = `src/auchweg.ts`; // gebaut als src/da.js',
      '// früher utils/alt.ts',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(web, 'scripts', 'b.sh'), 'cp src/codeweg.ts /tmp # aus src/shweg.ts\n');
  fs.writeFileSync(path.join(web, 'README.md'), 'Einstieg: src/da.ts, Plan: docs/plan.md\n');
  fs.writeFileSync(path.join(web, 'docs', 'x.md'), 'Siehe Web-App/src/da.ts und src/docweg.ts\n');
  return { repo, web };
}

const lauf = (/** @type {string} */ web) => spawnSync(process.execPath, [SCRIPT, web], { encoding: 'utf8' });

test('in the sample tree the script reports exactly the dead references in comments and docs', t => {
  const { repo, web } = probeTree();
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

test('the codebase has no dead references', () => {
  const r = lauf(path.join(__dirname, '..'));
  const gesehen = Number(/(\d+) Pfadverweise/.exec(r.stderr)?.[1]);
  assert.ok(gesehen > 200, `nur ${gesehen} Verweise gefunden — greift die Suche noch?\n${r.stderr}`);
  assert.equal(r.stdout, '', 'Pfad auf die heutige Datei ändern; Geschichte gehört in den Commit');
  assert.equal(r.status, 0);
});
