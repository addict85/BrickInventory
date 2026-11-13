/**
 * docker-publish.yml signiert genau das Manifest, das der Push erzeugt hat:
 * Der Digest kommt aus der Ausgabe von `imagetools create`, nicht aus einer
 * späteren Auflösung des Tags. Hier laufen die echten Skripte der Schritte
 * `manifest` und `signatur` in bash; `docker` und `cosign` sind Ersatz. Der …
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  im Schritt `signatur` wieder `DIGEST="$(docker buildx imagetools inspect
 *      "$TAG" --format …)"` → rot: „signiert wird der Digest aus dem Push“
 *   B  im Schritt `manifest` `--metadata-file …` gestrichen → rot: beide
 *      Fälle (der Hauptfall findet keinen Digest)
 * Tags erst nach Prüfung und Signatur (12.11.2026 gemessen, je einzeln):
 *   C  im Schritt `manifest` wieder die Tags aus DOCKER_METADATA_OUTPUT_JSON
 *      mitgegeben → rot: „vor der Signatur trägt das Image keinen Tag“
 *   D  den Abgleich `[ "$DIGEST" = "$SOLL" ]` gestrichen → rot: „ein anderer
 *      Digest als im Probelauf bricht ab“
 *   E  den Schritt `tags` vor „Lücken im veröffentlichten Digest“ verschoben
 *      → rot: „Tags kommen nach Trivy, Signatur und Bescheinigung“
 *   F  im Schritt `tags` die Nachprüfung (`[ "$IST" = … ]`) gestrichen → rot:
 *      „ein umgehängter Tag bricht ab“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const YML = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'workflows', 'docker-publish.yml'), 'utf8');
const IMAGE = 'addict85/brickinventory',
  CADDY = 'addict85/brickinventory-caddy';
// Der Probelauf gibt diesen Index aus; gepusht wird er unter seinem sha256.
const INDEX = '{"schemaVersion":2,"manifests":[]}';
const AUS_PUSH = `sha256:${crypto.createHash('sha256').update(INDEX).digest('hex')}`,
  UMGEHAENGT = 'sha256:' + 'b'.repeat(64);

/** Der run-Block des Schritts mit `id: <id>`. */
function skript(id) {
  const zeilen = YML.split('\n');
  const ab = zeilen.indexOf(`        id: ${id}`);
  assert.ok(ab >= 0, `Schritt ${id} nicht gefunden`);
  const start = zeilen.findIndex((z, i) => i > ab && z === '        run: |');
  const rumpf = [];
  for (const z of zeilen.slice(start + 1)) {
    if (z.trim() && !z.startsWith('          ')) break;
    rumpf.push(z.slice(10));
  }
  return rumpf.join('\n');
}

function sandkasten(t, metaMitDigest = true, { gepusht = AUS_PUSH, inspektion = UMGEHAENGT } = {}) {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'signatur-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const bin = path.join(ort, 'bin'),
    digests = path.join(ort, 'digests');
  fs.mkdirSync(bin);
  fs.mkdirSync(digests);
  fs.writeFileSync(path.join(digests, 'c'.repeat(64)), '');
  const meta = metaMitDigest ? JSON.stringify({ 'containerimage.descriptor': { digest: gepusht } }) : '{}';
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh
echo "docker $*" >> "${ort}/aufrufe"
if [ "$2" = imagetools ] && [ "$3" = create ]; then
  case " $* " in (*" --dry-run "*) printf '%s' '${INDEX}'; exit 0 ;; esac
  while [ $# -gt 0 ]; do [ "$1" = --metadata-file ] && printf '%s' '${meta}' > "$2"; shift; done
  exit 0
fi
if [ "$2" = imagetools ] && [ "$3" = inspect ]; then echo '{"digest":"${inspektion}"}'; exit 0; fi
exit 0
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'cosign'), `#!/bin/sh\necho "cosign $*" >> "${ort}/aufrufe"\n`, { mode: 0o755 });
  return { ort, bin, digests };
}

function lauf(s, id, ersatz = {}, mehrEnv = {}) {
  let text = skript(id).replaceAll('${{ env.IMAGE }}', IMAGE).replaceAll(`$\{{ env.CADDY_IMAGE }}`, CADDY);
  for (const [k, v] of Object.entries(ersatz)) text = text.replaceAll(k, v);
  const ausgabe = path.join(s.ort, `ausgabe-${id}`);
  fs.writeFileSync(ausgabe, '');
  const r = spawnSync('bash', ['-c', text], {
    cwd: s.digests,
    encoding: 'utf8',
    env: {
      PATH: `${s.bin}:${process.env.PATH}`,
      RUNNER_TEMP: s.ort,
      GITHUB_OUTPUT: ausgabe,
      GITHUB_STEP_SUMMARY: path.join(s.ort, 'summary'),
      DOCKER_METADATA_OUTPUT_JSON: JSON.stringify({ tags: [`${IMAGE}:latest`, `${IMAGE}:sha-1a2b3c4`] }),
      ...mehrEnv,
    },
  });
  const aus = Object.fromEntries(
    fs
      .readFileSync(ausgabe, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(z => z.split('=')),
  );
  return { code: r.status, log: r.stdout + r.stderr, aus };
}

test('signiert wird der Digest aus dem Push, nicht der umgehängte Tag', t => {
  const s = sandkasten(t);
  const m = lauf(s, 'manifest');
  assert.equal(m.code, 0, m.log);
  assert.equal(m.aus.digest, AUS_PUSH);
  const sig = lauf(s, 'signatur', { '${{ steps.manifest.outputs.digest }}': m.aus.digest });
  assert.equal(sig.code, 0, sig.log);
  const signiert = fs
    .readFileSync(path.join(s.ort, 'aufrufe'), 'utf8')
    .split('\n')
    .filter(z => z.startsWith('cosign sign'));
  assert.deepEqual(signiert, [`cosign sign --yes --recursive ${IMAGE}@${AUS_PUSH}`]);
  assert.equal(sig.aus.digest, AUS_PUSH, 'die Nachweise hängen am selben Digest');
});

test('ohne Digest aus dem Push bricht der Schritt ab', t => {
  const s = sandkasten(t, false);
  const m = lauf(s, 'manifest');
  assert.equal(m.code, 1, m.log);
  assert.match(m.log, /Kein Digest in der Ausgabe des Pushs/);
});

/** Der Block eines Schritts, gesucht über seinen Namen, bis zum nächsten Schritt. */
function schritt(name) {
  const ab = YML.indexOf(`      - name: ${name}\n`);
  assert.ok(ab >= 0, `Schritt „${name}“ nicht gefunden`);
  const ende = YML.indexOf('\n      - ', ab + 1);
  return YML.slice(ab, ende < 0 ? undefined : ende);
}

/** Muster des App-Downloads und Name der Caddy-Artefakte (ohne Plattform). */
function artefakte() {
  return {
    muster: YML.match(/path: \/tmp\/digests\n\s+pattern: (\S+)/)?.[1],
    caddy: YML.match(/name: (\S*)\$\{\{ env\.PAAR \}\}\n\s+path: \/tmp\/digests-caddy/)?.[1],
  };
}

const aufrufeIn = s => fs.readFileSync(path.join(s.ort, 'aufrufe'), 'utf8').split('\n');

// Gegenproben (11.11.2026 gemessen, je einzeln): im Schritt `signatur-caddy`
// `${{ env.IMAGE }}` statt `${{ env.CADDY_IMAGE }}` → rot „signiert wird das
// Caddy-Image …“; bei „Caddy-Herkunft bescheinigen“ `steps.signatur.outputs.digest`
// → rot „… am signierten Caddy-Digest“; den Caddy-Artefakten den Namen
// `digest-caddy-…` gegeben → rot „das App-Manifest mischt die Caddy-Digests“.
test('Caddy wird wie das App-Image gebaut, signiert und bescheinigt, am Digest aus seinem Push', t => {
  const s = sandkasten(t);
  const m = lauf(s, 'manifest-caddy', {}, { META: JSON.stringify({ tags: [`${CADDY}:latest`] }) });
  assert.equal(m.code, 0, m.log);
  assert.equal(m.aus.digest, AUS_PUSH);
  const aufrufe = () => aufrufeIn(s);
  assert.ok(
    aufrufe().some(
      z =>
        z.startsWith(`docker buildx imagetools create --metadata-file`) &&
        z.includes(`-t ${CADDY}@${AUS_PUSH}`) &&
        z.includes(`${CADDY}@sha256:${'c'.repeat(64)}`),
    ),
    aufrufe().join('\n'),
  );
  const sig = lauf(s, 'signatur-caddy', { '${{ steps.manifest-caddy.outputs.digest }}': m.aus.digest });
  assert.equal(sig.code, 0, sig.log);
  assert.deepEqual(
    aufrufe().filter(z => z.startsWith('cosign sign')),
    [`cosign sign --yes --recursive ${CADDY}@${AUS_PUSH}`],
    'signiert wird das Caddy-Image am Digest aus seinem Push',
  );
  for (const name of ['Caddy-Herkunft bescheinigen', 'Caddy-Stückliste bescheinigen']) {
    const b = schritt(name);
    assert.match(b, /subject-name: index\.docker\.io\/\$\{\{ env\.CADDY_IMAGE \}\}/, name);
    assert.match(
      b,
      /subject-digest: \$\{\{ steps\.signatur-caddy\.outputs\.digest \}\}/,
      `${name}: nicht am signierten Caddy-Digest`,
    );
  }
  const bau = schritt('Caddy bauen und als Digest hochladen');
  for (const zeile of [
    /file: \$\{\{ env\.CONTEXT \}\}\/Dockerfile\.caddy/,
    /no-cache: true/,
    /provenance: mode=max/,
    /sbom: generator=\S+@sha256:[0-9a-f]{64}/,
  ])
    assert.match(bau, zeile);
  // Das App-Manifest sammelt seine Digests über ein Muster; die Caddy-Artefakte dürfen nicht darunter fallen.
  const { muster, caddy: caddyName } = artefakte();
  assert.ok(muster && caddyName, `${muster} / ${caddyName}`);
  assert.equal(path.matchesGlob(`${caddyName}linux-amd64`, muster), false, 'das App-Manifest mischt die Caddy-Digests');
  assert.equal(path.matchesGlob('digest-linux-amd64', muster), true);
});

/** Die `-t`-Ziele aller echten (nicht Probe-)Aufrufe von `imagetools create`. */
function tagsInPush(s) {
  return aufrufeIn(s)
    .filter(z => z.startsWith('docker buildx imagetools create') && !z.includes('--dry-run'))
    .flatMap(z => [...z.matchAll(/-t (\S+)/g)].map(m => m[1]));
}

test('vor der Signatur trägt das Image keinen Tag', t => {
  for (const [id, img] of [
    ['manifest', IMAGE],
    ['manifest-caddy', CADDY],
  ]) {
    const s = sandkasten(t);
    const m = lauf(s, id, {}, { META: JSON.stringify({ tags: [`${img}:latest`] }) });
    assert.equal(m.code, 0, m.log);
    assert.deepEqual(tagsInPush(s), [`${img}@${AUS_PUSH}`], `${id}: vor der Signatur trägt das Image keinen Tag`);
  }
});

test('ein anderer Digest als im Probelauf bricht ab', t => {
  for (const id of ['manifest', 'manifest-caddy']) {
    const s = sandkasten(t, true, { gepusht: UMGEHAENGT });
    const m = lauf(s, id);
    assert.equal(m.code, 1, `${id}: ein anderer Digest als im Probelauf bricht ab\n${m.log}`);
    assert.equal(m.aus.digest, undefined);
  }
});

/** Position eines Schritts im Workflow, gesucht über `id:` oder `name:`. */
const stelle = marke => {
  const i = YML.indexOf(marke);
  assert.ok(i >= 0, `${marke} nicht gefunden`);
  return i;
};

test('Tags kommen nach Trivy, Signatur und Bescheinigung', t => {
  for (const [id, sig, img, vorher] of [
    ['tags', 'signatur', IMAGE, ['Lücken im veröffentlichten Digest', 'Image signieren', 'Stückliste bescheinigen']],
    [
      'tags-caddy',
      'signatur-caddy',
      CADDY,
      ['Lücken im veröffentlichten Caddy-Digest', 'Caddy signieren', 'Caddy-Stückliste bescheinigen'],
    ],
  ]) {
    for (const name of vorher)
      assert.ok(
        stelle(`        id: ${id}\n`) > stelle(`      - name: ${name}\n`),
        `${id}: Tags kommen nach Trivy, Signatur und Bescheinigung (${name})`,
      );
    const s = sandkasten(t, true, { inspektion: AUS_PUSH });
    const tags = [`${img}:latest`, `${img}:sha-1a2b3c4`];
    const r = lauf(s, id, { [`\${{ steps.${sig}.outputs.digest }}`]: AUS_PUSH }, { META: JSON.stringify({ tags }) });
    assert.equal(r.code, 0, r.log);
    const aufruf = aufrufeIn(s).find(z => z.startsWith('docker buildx imagetools create'));
    assert.equal(aufruf, `docker buildx imagetools create ${tags.map(x => `-t ${x}`).join(' ')} ${img}@${AUS_PUSH}`);
  }
});

test('ein umgehängter Tag bricht ab', t => {
  const s = sandkasten(t, true, { inspektion: UMGEHAENGT });
  const r = lauf(
    s,
    'tags',
    { '${{ steps.signatur.outputs.digest }}': AUS_PUSH },
    { META: JSON.stringify({ tags: [`${IMAGE}:latest`] }) },
  );
  assert.equal(r.code, 1, `ein umgehängter Tag bricht ab\n${r.log}`);
  assert.match(r.log, /zeigt auf sha256:b+ statt auf/);
});

// Jeder Job, der die Docker-Hub-Zugangsdaten liest, läuft in der geschützten Umgebung; die Prüfung im
// Build-Job verweist auf deren Secrets. Gegenproben (13.11.2026 gemessen, je einzeln): `environment:
// docker-hub` im Job build gestrichen → rot „build liest DOCKERHUB_* ohne Umgebung docker-hub“; die
// Meldung wieder auf „Secrets and variables -> Actions“ → rot „… nennt die Environment-Secrets“.
test('Docker-Hub-Zugangsdaten nur in Jobs mit der Umgebung docker-hub', () => {
  const jobs = YML.slice(YML.indexOf('\njobs:\n'));
  const bloecke = jobs.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1);
  const mitSecret = bloecke.filter(b => /secrets\.DOCKERHUB_/.test(b));
  assert.ok(mitSecret.length >= 2, `zu wenige Jobs mit DOCKERHUB_* gefunden (${mitSecret.length})`);
  for (const b of mitSecret) {
    const name = b.split(':')[0];
    assert.match(b, /^ {4}environment: docker-hub\s*$/m, `${name} liest DOCKERHUB_* ohne Umgebung docker-hub`);
  }
  const zeilen = YML.split('\n');
  const ab = zeilen.findIndex(z => z.trim() === '- name: Zugangsdaten vorhanden?');
  const run = zeilen.findIndex((z, i) => i > ab && z.trim() === 'run: |');
  const rumpf = [];
  for (let i = run + 1; i < zeilen.length && (zeilen[i].startsWith('          ') || !zeilen[i].trim()); i++)
    rumpf.push(zeilen[i].slice(10));
  const pruefe = (nutzer, token) =>
    spawnSync('bash', ['-c', rumpf.join('\n')], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NUTZER: nutzer, TOKEN: token },
    });
  assert.equal(pruefe('n', 't').status, 0, 'mit beiden Secrets geht es weiter');
  const ohne = pruefe('', '');
  assert.equal(ohne.status, 1, 'ohne Secrets bricht der Schritt ab');
  assert.match(ohne.stdout, /Environments -> docker-hub/, 'die Meldung nennt die Environment-Secrets');
});
