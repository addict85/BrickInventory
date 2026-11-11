/**
 * Der freie Tag beim Handstart von docker-publish.yml (inputs.tag) gelangt
 * nur geprüft in tags und build-args: Der Prüfschritt liest ihn über env,
 * lässt nur die Docker-Tag-Form zu und reicht ihn als Ausgabe weiter. Hier
 * läuft das echte Skript des Schritts in bash, mit verschiedenen Eingaben.
 *
 * Gegenproben (01.11.2026 gemessen, je einzeln):
 *   A  die Regex-Prüfung im Schritt gestrichen → rot: „abgewiesen: zwei Zeilen"
 *      (und die übrigen bösen Eingaben)
 *   B  im merge-Job wieder `${{ inputs.tag }}` statt der Ausgabe → rot:
 *      „inputs.tag steht nur in env"
 * Der Handstart baut nur auf main und nur mit grünem CI-Lauf auf dem Commit
 * (`gh` ist hier ein Ersatz, der die Zahl grüner Läufe nennt; `git` ebenso,
 * damit der Test keinen Git-Arbeitsbaum braucht).
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   C  die Abfrage der grünen CI gestrichen → rot: „ohne grüne CI kein Image"
 *   D  die Prüfung auf refs/heads/main gestrichen → rot: „Handstart auf einem
 *      Nebenzweig"
 *   E  (04.11.2026) im git-Ersatz eine andere Kurzform → rot: „der Commit
 *      kommt aus git rev-parse“. In einer Kopie ohne .git grün; die Fassung
 *      vor dem Ersatz war dort rot („gültige Tags gehen als Ausgabe weiter“).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const YML = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'docker-publish.yml'), 'utf8');

/** Den run-Block des Schritts `id: p` ausschneiden (Einrückung zehn Leerzeichen). */
function pruefSkript() {
  const schritt = YML.split('\n      - id: p\n')[1]?.split(/\n {6}- /)[0] ?? '';
  const zeilen = schritt.split('\n');
  const start = zeilen.findIndex(z => z === '        run: |');
  assert.ok(start >= 0, 'run-Block des Prüfschritts nicht gefunden');
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
  // git ebenso als Ersatz: Der Schritt fragt nur nach dem Commit, und der Test
  // soll auch in einer Kopie ohne .git laufen.
  fs.writeFileSync(path.join(path.dirname(aus), 'git'), `#!/bin/sh
case "$*" in
  "rev-parse HEAD") echo ${'a1'.repeat(20)} ;;
  "rev-parse --short=7 HEAD") echo a1a1a1a ;;
  *) echo "git-Ersatz kennt: $*" >&2; exit 2 ;;
esac
`, { mode: 0o755 });
  const r = spawnSync('bash', ['-e', '-c', pruefSkript()], { encoding: 'utf8', cwd: __dirname,
    env: { ...process.env, PATH: `${path.dirname(aus)}:${process.env.PATH}`, GITHUB_OUTPUT: aus,
      EREIGNIS: 'workflow_dispatch', ERGEBNIS: '', TAG_EINGABE: tag, REF: ref, REPO: 'probe/probe' } });
  const ausgabe = fs.readFileSync(aus, 'utf8');
  fs.rmSync(path.dirname(aus), { recursive: true, force: true });
  return { status: r.status, ausgabe };
}

test('gültige Tags gehen als Ausgabe weiter', () => {
  for (const tag of ['2026.11.01', 'v1_2-rc.3', '']) {
    const r = lauf(tag);
    assert.equal(r.status, 0, `„${tag}" abgewiesen`);
    assert.match(r.ausgabe, new RegExp(`^tag=${tag.replace(/\./g, '\\.')}$`, 'm'));
    assert.match(r.ausgabe, /^bauen=true$/m);
    assert.match(r.ausgabe, /^kurz=a1a1a1a$/m, 'der Commit kommt aus git rev-parse');
  }
});

const BOESE = {
  'zwei Zeilen': 'gut\ntype=raw,value=latest',
  'Leerzeichen': 'a b',
  'Strichpunkt': 'a;b',
  'Bindestrich vorn': '-a',
  'Umlaut': 'ä',
  'zu lang': 'a'.repeat(129),
  'Wagenrücklauf': 'gut\r',
};
for (const [fall, tag] of Object.entries(BOESE)) {
  test(`abgewiesen: ${fall}`, () => {
    const r = lauf(tag);
    assert.notEqual(r.status, 0, `abgewiesen: ${fall}`);
    assert.doesNotMatch(r.ausgabe, /^tag=/m);
  });
}

test('ohne grüne CI kein Image', () => {
  for (const [fall, gruen] of [['keiner grün', '0'], ['Abfrage gescheitert', null], ['Unsinn', 'x']]) {
    const r = lauf('', { gruen });
    assert.notEqual(r.status, 0, `ohne grüne CI kein Image: ${fall}`);
    assert.doesNotMatch(r.ausgabe, /^bauen=true$/m, fall);
  }
});

test('Handstart auf einem Nebenzweig', () => {
  const r = lauf('', { ref: 'refs/heads/probe' });
  assert.notEqual(r.status, 0, 'Handstart auf einem Nebenzweig');
  assert.doesNotMatch(r.ausgabe, /^bauen=true$/m);
});

test('inputs.tag steht nur in env', () => {
  const ohneKommentare = YML.split('\n').filter(z => !z.trimStart().startsWith('#')).join('\n');
  const stellen = ohneKommentare.match(/.*inputs\.tag.*/g) || [];
  assert.deepEqual(stellen.map(s => s.trim()), ['TAG_EINGABE: ${{ inputs.tag }}'], 'inputs.tag steht nur in env');
  assert.match(ohneKommentare, /APP_VERSION=\$\{\{ needs\.pruefen\.outputs\.tag/);
  assert.match(ohneKommentare, /type=raw,value=\$\{\{ needs\.pruefen\.outputs\.tag \}\}/);
});
