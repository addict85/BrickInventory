/**
 * The free tag on a manual start of docker-publish.yml (inputs.tag) only gets
 * into tags and build-args after checking: the check step reads it via env,
 * allows only the Docker tag form and passes it on as output. Here
 * the real script of the step runs in bash, with different inputs.
 *
 * Counter-checks (measured 01.11.2026, each individually):
 *   A  the regex check in the step deleted → red: “rejected: …” (two lines)
 *      (and the other malicious inputs)
 *   B  in the merge job again `${{ inputs.tag }}` instead of the output → red:
 *      „inputs.tag steht nur in env"
 * The manual start only builds on main and only with a green CI run on the commit
 * (`gh` is a stand-in here that names the number of green runs; `git` likewise,
 * so that the test needs no Git working tree).
 * Counter-checks (measured 03.11.2026, each individually):
 *   C  the query of the green CI deleted → red: „ohne grüne CI kein Image"
 *   D  the check for refs/heads/main deleted → red: „Handstart auf einem
 *      Nebenzweig"
 *   E  (04.11.2026) a different short form in the git stand-in → red: „der Commit
 *      kommt aus git rev-parse“. Green in a copy without .git; the version
 *      before the stand-in was red there (“valid tags go on as output”).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const YML = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'docker-publish.yml'), 'utf8');

/** Cut out the run block of the step `id: p` (indentation ten spaces). */
function checkScript() {
  const schritt = YML.split('\n      - id: p\n')[1]?.split(/\n {6}- /)[0] ?? '';
  const zeilen = schritt.split('\n');
  const start = zeilen.indexOf('        run: |');
  assert.ok(start >= 0, 'run block of the check step not found');
  const rumpf = [];
  for (const z of zeilen.slice(start + 1)) {
    if (z.trim() && !z.startsWith('          ')) break;
    rumpf.push(z.slice(10));
  }
  return rumpf.join('\n');
}

function lauf(tag, { ref = 'refs/heads/main', gruen = '1' } = {}) {
  const aus = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wf-tag-')), 'ausgabe');
  fs.writeFileSync(aus, '');
  const gh = path.join(path.dirname(aus), 'gh');
  fs.writeFileSync(gh, gruen === null ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\necho ${gruen}\n`, { mode: 0o755 });
  // git as a stand-in too: the step only asks for the commit, and the test
  // should also run in a copy without .git.
  fs.writeFileSync(
    path.join(path.dirname(aus), 'git'),
    `#!/bin/sh
case "$*" in
  "rev-parse HEAD") echo ${'a1'.repeat(20)} ;;
  "rev-parse --short=7 HEAD") echo a1a1a1a ;;
  *) echo "git-Ersatz kennt: $*" >&2; exit 2 ;;
esac
`,
    { mode: 0o755 },
  );
  const r = spawnSync('bash', ['-e', '-c', checkScript()], {
    encoding: 'utf8',
    cwd: __dirname,
    env: {
      ...process.env,
      PATH: `${path.dirname(aus)}:${process.env.PATH}`,
      GITHUB_OUTPUT: aus,
      EREIGNIS: 'workflow_dispatch',
      ERGEBNIS: '',
      TAG_EINGABE: tag,
      REF: ref,
      REPO: 'probe/probe',
    },
  });
  const output = fs.readFileSync(aus, 'utf8');
  fs.rmSync(path.dirname(aus), { recursive: true, force: true });
  return { status: r.status, output };
}

test('valid tags go on as output', () => {
  for (const tag of ['2026.11.01', 'v1_2-rc.3', '']) {
    const r = lauf(tag);
    assert.equal(r.status, 0, `„${tag}" rejected`);
    assert.match(r.output, new RegExp(`^tag=${tag.replace(/\./g, '\\.')}$`, 'm'));
    assert.match(r.output, /^bauen=true$/m);
    assert.match(r.output, /^kurz=a1a1a1a$/m, 'the commit comes from git rev-parse');
  }
});

const BOESE = {
  'zwei Zeilen': 'gut\ntype=raw,value=latest',
  Leerzeichen: 'a b',
  Semicolon: 'a;b',
  'Bindestrich vorn': '-a',
  Umlaut: 'ä',
  'zu lang': 'a'.repeat(129),
  CarriageReturn: 'gut\r',
};
for (const [fall, tag] of Object.entries(BOESE)) {
  test(`rejected: ${fall}`, () => {
    const r = lauf(tag);
    assert.notEqual(r.status, 0, `rejected: ${fall}`);
    assert.doesNotMatch(r.output, /^tag=/m);
  });
}

test('without green CI no image', () => {
  for (const [fall, gruen] of [
    ['keiner grün', '0'],
    ['Abfrage gescheitert', null],
    ['Unsinn', 'x'],
  ]) {
    const r = lauf('', { gruen });
    assert.notEqual(r.status, 0, `without green CI no image: ${fall}`);
    assert.doesNotMatch(r.output, /^bauen=true$/m, fall);
  }
});

test('manual start on a side branch', () => {
  const r = lauf('', { ref: 'refs/heads/probe' });
  assert.notEqual(r.status, 0, 'Handstart auf einem Nebenzweig');
  assert.doesNotMatch(r.output, /^bauen=true$/m);
});

test('inputs.tag is only in env', () => {
  const ohneKommentare = YML.split('\n')
    .filter(z => !z.trimStart().startsWith('#'))
    .join('\n');
  const placeList = ohneKommentare.match(/.*inputs\.tag.*/g) || [];
  assert.deepEqual(
    placeList.map(s => s.trim()),
    ['TAG_EINGABE: ${{ inputs.tag }}'],
    'inputs.tag is only in env',
  );
  assert.match(ohneKommentare, /APP_VERSION=\$\{\{ needs\.pruefen\.outputs\.tag/);
  assert.match(ohneKommentare, /type=raw,value=\$\{\{ needs\.pruefen\.outputs\.tag \}\}/);
});
