/**
 * docker-publish.yml signiert genau das Manifest, das der Push erzeugt hat:
 * Der Digest kommt aus der Ausgabe von `imagetools create`, nicht aus einer
 * späteren Auflösung des Tags. Hier laufen die echten Skripte der Schritte
 * `manifest` und `signatur` in bash; `docker` und `cosign` sind Ersatz. Der
 * docker-Ersatz meldet beim Auflösen des Tags einen ANDEREN Digest, als hätte
 * jemand den Tag zwischen Push und Signatur umgehängt.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  im Schritt `signatur` wieder `DIGEST="$(docker buildx imagetools inspect
 *      "$TAG" --format …)"` → rot: „signiert wird der Digest aus dem Push“
 *   B  im Schritt `manifest` `--metadata-file …` gestrichen → rot: beide
 *      Fälle (der Hauptfall findet keinen Digest)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const YML = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'docker-publish.yml'), 'utf8');
const IMAGE = 'addict85/brickinventory';
const AUS_PUSH = 'sha256:' + 'a'.repeat(64), UMGEHAENGT = 'sha256:' + 'b'.repeat(64);

/** Der run-Block des Schritts mit `id: <id>`. */
function skript(id) {
  const zeilen = YML.split('\n');
  const ab = zeilen.findIndex(z => z === `        id: ${id}`);
  assert.ok(ab >= 0, `Schritt ${id} nicht gefunden`);
  const start = zeilen.findIndex((z, i) => i > ab && z === '        run: |');
  const rumpf = [];
  for (const z of zeilen.slice(start + 1)) {
    if (z.trim() && !z.startsWith('          ')) break;
    rumpf.push(z.slice(10));
  }
  return rumpf.join('\n');
}

function sandkasten(t, metaMitDigest = true) {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'signatur-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const bin = path.join(ort, 'bin'), digests = path.join(ort, 'digests');
  fs.mkdirSync(bin); fs.mkdirSync(digests);
  fs.writeFileSync(path.join(digests, 'c'.repeat(64)), '');
  const meta = metaMitDigest ? JSON.stringify({ 'containerimage.descriptor': { digest: AUS_PUSH } }) : '{}';
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
echo "docker $*" >> "${ort}/aufrufe"
if [ "$2" = imagetools ] && [ "$3" = create ]; then
  while [ $# -gt 0 ]; do [ "$1" = --metadata-file ] && printf '%s' '${meta}' > "$2"; shift; done
  exit 0
fi
if [ "$2" = imagetools ] && [ "$3" = inspect ]; then echo '{"digest":"${UMGEHAENGT}"}'; exit 0; fi
exit 0
`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'cosign'), `#!/bin/sh\necho "cosign $*" >> "${ort}/aufrufe"\n`, { mode: 0o755 });
  return { ort, bin, digests };
}

function lauf(s, id, ersatz = {}) {
  let text = skript(id).replaceAll('${{ env.IMAGE }}', IMAGE);
  for (const [k, v] of Object.entries(ersatz)) text = text.replaceAll(k, v);
  const ausgabe = path.join(s.ort, `ausgabe-${id}`);
  fs.writeFileSync(ausgabe, '');
  const r = spawnSync('bash', ['-c', text], { cwd: s.digests, encoding: 'utf8', env: {
    PATH: `${s.bin}:${process.env.PATH}`, RUNNER_TEMP: s.ort, GITHUB_OUTPUT: ausgabe,
    GITHUB_STEP_SUMMARY: path.join(s.ort, 'summary'),
    DOCKER_METADATA_OUTPUT_JSON: JSON.stringify({ tags: [`${IMAGE}:latest`, `${IMAGE}:sha-1a2b3c4`] }) } });
  const aus = Object.fromEntries(fs.readFileSync(ausgabe, 'utf8').split('\n').filter(Boolean).map(z => z.split('=')));
  return { code: r.status, log: r.stdout + r.stderr, aus };
}

test('signiert wird der Digest aus dem Push, nicht der umgehängte Tag', (t) => {
  const s = sandkasten(t);
  const m = lauf(s, 'manifest');
  assert.equal(m.code, 0, m.log);
  assert.equal(m.aus.digest, AUS_PUSH);
  const sig = lauf(s, 'signatur', { '${{ steps.manifest.outputs.digest }}': m.aus.digest });
  assert.equal(sig.code, 0, sig.log);
  const signiert = fs.readFileSync(path.join(s.ort, 'aufrufe'), 'utf8').split('\n').filter(z => z.startsWith('cosign sign'));
  assert.deepEqual(signiert, [`cosign sign --yes --recursive ${IMAGE}@${AUS_PUSH}`]);
  assert.equal(sig.aus.digest, AUS_PUSH, 'die Nachweise hängen am selben Digest');
});

test('ohne Digest aus dem Push bricht der Schritt ab', (t) => {
  const s = sandkasten(t, false);
  const m = lauf(s, 'manifest');
  assert.equal(m.code, 1, m.log);
  assert.match(m.log, /Kein Digest in der Ausgabe des Pushs/);
});
