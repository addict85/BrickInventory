/**
 * docker-publish.yml signs exactly the manifest the push created:
 * the digest comes from the output of `imagetools create`, not from a
 * later resolution of the tag. Here the real scripts of the steps
 * `manifest` and `signatur` run in bash; `docker` and `cosign` are stand-ins. The …
 *
 * Counter-checks (measured 05.11.2026, each individually):
 *   A  in the step `signatur` again `DIGEST="$(docker buildx imagetools inspect
 *      "$TAG" --format …)"` → red: “the digest from the push is signed …”
 *   B  in the step `manifest` `--metadata-file …` deleted → red: both
 *      cases (the main case finds no digest)
 * Tags only after check and signature (measured 12.11.2026, each individually):
 *   C  in the step `manifest` the tags from DOCKER_METADATA_OUTPUT_JSON passed
 *      again → red: „vor der Signatur trägt das Image keinen Tag“
 *   D  the comparison `[ "$DIGEST" = "$SOLL" ]` deleted → red: „ein anderer
 *      Digest als im Probelauf bricht ab“
 *   E  the step `tags` moved before „Lücken im veröffentlichten Digest“
 *      → red: „Tags kommen nach Trivy, Signatur und Bescheinigung“
 *   F  in the step `tags` the re-check (`[ "$IST" = … ]`) deleted → red:
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
// The dry run outputs this index; it is pushed under its sha256.
const INDEX = '{"schemaVersion":2,"manifests":[]}';
const FROM_PUSH = `sha256:${crypto.createHash('sha256').update(INDEX).digest('hex')}`,
  REASSIGNED = 'sha256:' + 'b'.repeat(64);

/** The run block of the step with `id: <id>`. */
function script(id) {
  const zeilen = YML.split('\n');
  const ab = zeilen.indexOf(`        id: ${id}`);
  assert.ok(ab >= 0, `step ${id} not found`);
  const start = zeilen.findIndex((z, i) => i > ab && z === '        run: |');
  const rumpf = [];
  for (const z of zeilen.slice(start + 1)) {
    if (z.trim() && !z.startsWith('          ')) break;
    rumpf.push(z.slice(10));
  }
  return rumpf.join('\n');
}

function sandbox(t, metaWithDigest = true, { pushed = FROM_PUSH, inspection = REASSIGNED } = {}) {
  const location = fs.mkdtempSync(path.join(os.tmpdir(), 'signatur-'));
  t.after(() => fs.rmSync(location, { recursive: true, force: true }));
  const bin = path.join(location, 'bin'),
    digests = path.join(location, 'digests');
  fs.mkdirSync(bin);
  fs.mkdirSync(digests);
  fs.writeFileSync(path.join(digests, 'c'.repeat(64)), '');
  const meta = metaWithDigest ? JSON.stringify({ 'containerimage.descriptor': { digest: pushed } }) : '{}';
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh
echo "docker $*" >> "${location}/aufrufe"
if [ "$2" = imagetools ] && [ "$3" = create ]; then
  case " $* " in (*" --dry-run "*) printf '%s' '${INDEX}'; exit 0 ;; esac
  while [ $# -gt 0 ]; do [ "$1" = --metadata-file ] && printf '%s' '${meta}' > "$2"; shift; done
  exit 0
fi
if [ "$2" = imagetools ] && [ "$3" = inspect ]; then echo '{"digest":"${inspection}"}'; exit 0; fi
exit 0
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'cosign'), `#!/bin/sh\necho "cosign $*" >> "${location}/aufrufe"\n`, { mode: 0o755 });
  return { location, bin, digests };
}

function lauf(s, id, ersatz = {}, moreEnv = {}) {
  let text = script(id).replaceAll('${{ env.IMAGE }}', IMAGE).replaceAll(`$\{{ env.CADDY_IMAGE }}`, CADDY);
  for (const [k, v] of Object.entries(ersatz)) text = text.replaceAll(k, v);
  const output = path.join(s.location, `ausgabe-${id}`);
  fs.writeFileSync(output, '');
  const r = spawnSync('bash', ['-c', text], {
    cwd: s.digests,
    encoding: 'utf8',
    env: {
      PATH: `${s.bin}:${process.env.PATH}`,
      RUNNER_TEMP: s.location,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: path.join(s.location, 'summary'),
      DOCKER_METADATA_OUTPUT_JSON: JSON.stringify({ tags: [`${IMAGE}:latest`, `${IMAGE}:sha-1a2b3c4`] }),
      ...moreEnv,
    },
  });
  const aus = Object.fromEntries(
    fs
      .readFileSync(output, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(z => z.split('=')),
  );
  return { code: r.status, log: r.stdout + r.stderr, aus };
}

test('the digest from the push is signed, not the moved tag', t => {
  const s = sandbox(t);
  const m = lauf(s, 'manifest');
  assert.equal(m.code, 0, m.log);
  assert.equal(m.aus.digest, FROM_PUSH);
  const sig = lauf(s, 'signatur', { '${{ steps.manifest.outputs.digest }}': m.aus.digest });
  assert.equal(sig.code, 0, sig.log);
  const signiert = fs
    .readFileSync(path.join(s.location, 'aufrufe'), 'utf8')
    .split('\n')
    .filter(z => z.startsWith('cosign sign'));
  assert.deepEqual(signiert, [`cosign sign --yes --recursive ${IMAGE}@${FROM_PUSH}`]);
  assert.equal(sig.aus.digest, FROM_PUSH, 'the attestations hang on the same digest');
});

test('without a digest from the push the step aborts', t => {
  const s = sandbox(t, false);
  const m = lauf(s, 'manifest');
  assert.equal(m.code, 1, m.log);
  assert.match(m.log, /Kein Digest in der Ausgabe des Pushs/);
});

/** The block of a step, looked up by its name, up to the next step. */
function schritt(name) {
  const ab = YML.indexOf(`      - name: ${name}\n`);
  assert.ok(ab >= 0, `step „${name}“ not found`);
  const ende = YML.indexOf('\n      - ', ab + 1);
  return YML.slice(ab, ende < 0 ? undefined : ende);
}

/** Pattern of the app download and name of the Caddy artifacts (without platform). */
function artifacts() {
  return {
    muster: YML.match(/path: \/tmp\/digests\n\s+pattern: (\S+)/)?.[1],
    caddy: YML.match(/name: (\S*)\$\{\{ env\.PAAR \}\}\n\s+path: \/tmp\/digests-caddy/)?.[1],
  };
}

const callsIn = s => fs.readFileSync(path.join(s.location, 'aufrufe'), 'utf8').split('\n');

// Counter-checks (measured 11.11.2026, each individually): in the step `signatur-caddy`
// `${{ env.IMAGE }}` instead of `${{ env.CADDY_IMAGE }}` → red „signiert wird das
// Caddy-Image …“; at „Caddy-Herkunft bescheinigen“ `steps.signatur.outputs.digest`
// → red „… am signierten Caddy-Digest“; given the Caddy artifacts the name
// `digest-caddy-…` → red „das App-Manifest mischt die Caddy-Digests“.
test('Caddy is built, signed and attested like the app image, on the digest from its push', t => {
  const s = sandbox(t);
  const m = lauf(s, 'manifest-caddy', {}, { META: JSON.stringify({ tags: [`${CADDY}:latest`] }) });
  assert.equal(m.code, 0, m.log);
  assert.equal(m.aus.digest, FROM_PUSH);
  const aufrufe = () => callsIn(s);
  assert.ok(
    aufrufe().some(
      z =>
        z.startsWith(`docker buildx imagetools create --metadata-file`) &&
        z.includes(`-t ${CADDY}@${FROM_PUSH}`) &&
        z.includes(`${CADDY}@sha256:${'c'.repeat(64)}`),
    ),
    aufrufe().join('\n'),
  );
  const sig = lauf(s, 'signatur-caddy', { '${{ steps.manifest-caddy.outputs.digest }}': m.aus.digest });
  assert.equal(sig.code, 0, sig.log);
  assert.deepEqual(
    aufrufe().filter(z => z.startsWith('cosign sign')),
    [`cosign sign --yes --recursive ${CADDY}@${FROM_PUSH}`],
    'the Caddy image is signed at the digest from its push',
  );
  for (const name of ['Caddy-Herkunft bescheinigen', 'Caddy-Stückliste bescheinigen']) {
    const b = schritt(name);
    assert.match(b, /subject-name: index\.docker\.io\/\$\{\{ env\.CADDY_IMAGE \}\}/, name);
    assert.match(
      b,
      /subject-digest: \$\{\{ steps\.signatur-caddy\.outputs\.digest \}\}/,
      `${name}: not at the signed Caddy digest`,
    );
  }
  const bau = schritt('Caddy bauen und als Digest hochladen');
  for (const row of [
    /file: \$\{\{ env\.CONTEXT \}\}\/Dockerfile\.caddy/,
    /no-cache: true/,
    /provenance: mode=max/,
    /sbom: generator=\S+@sha256:[0-9a-f]{64}/,
  ])
    assert.match(bau, row);
  // The app manifest collects its digests via a pattern; the Caddy artifacts must not fall under it.
  const { muster, caddy: caddyName } = artifacts();
  assert.ok(muster && caddyName, `${muster} / ${caddyName}`);
  assert.equal(path.matchesGlob(`${caddyName}linux-amd64`, muster), false, 'the app manifest mixes the Caddy digests');
  assert.equal(path.matchesGlob('digest-linux-amd64', muster), true);
});

/** The `-t` targets of all real (not dry-run) calls of `imagetools create`. */
function tagsInPush(s) {
  return callsIn(s)
    .filter(z => z.startsWith('docker buildx imagetools create') && !z.includes('--dry-run'))
    .flatMap(z => [...z.matchAll(/-t (\S+)/g)].map(m => m[1]));
}

test('before the signature the image carries no tag', t => {
  for (const [id, img] of [
    ['manifest', IMAGE],
    ['manifest-caddy', CADDY],
  ]) {
    const s = sandbox(t);
    const m = lauf(s, id, {}, { META: JSON.stringify({ tags: [`${img}:latest`] }) });
    assert.equal(m.code, 0, m.log);
    assert.deepEqual(tagsInPush(s), [`${img}@${FROM_PUSH}`], `${id}: before the signature the image carries no tag`);
  }
});

test('a digest other than in the dry run aborts', t => {
  for (const id of ['manifest', 'manifest-caddy']) {
    const s = sandbox(t, true, { pushed: REASSIGNED });
    const m = lauf(s, id);
    assert.equal(m.code, 1, `${id}: a digest different from the dry run aborts\n${m.log}`);
    assert.equal(m.aus.digest, undefined);
  }
});

/** Position of a step in the workflow, looked up via `id:` or `name:`. */
const place = marke => {
  const i = YML.indexOf(marke);
  assert.ok(i >= 0, `${marke} not found`);
  return i;
};

test('tags come after Trivy, signature and attestation', t => {
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
        place(`        id: ${id}\n`) > place(`      - name: ${name}\n`),
        `${id}: tags come after Trivy, signature and attestation (${name})`,
      );
    const s = sandbox(t, true, { inspection: FROM_PUSH });
    const tags = [`${img}:latest`, `${img}:sha-1a2b3c4`];
    const r = lauf(s, id, { [`\${{ steps.${sig}.outputs.digest }}`]: FROM_PUSH }, { META: JSON.stringify({ tags }) });
    assert.equal(r.code, 0, r.log);
    const call = callsIn(s).find(z => z.startsWith('docker buildx imagetools create'));
    assert.equal(call, `docker buildx imagetools create ${tags.map(x => `-t ${x}`).join(' ')} ${img}@${FROM_PUSH}`);
  }
});

test('a moved tag aborts', t => {
  const s = sandbox(t, true, { inspection: REASSIGNED });
  const r = lauf(
    s,
    'tags',
    { '${{ steps.signatur.outputs.digest }}': FROM_PUSH },
    { META: JSON.stringify({ tags: [`${IMAGE}:latest`] }) },
  );
  assert.equal(r.code, 1, `a moved tag aborts\n${r.log}`);
  assert.match(r.log, /zeigt auf sha256:b+ statt auf/);
});

// Every job that reads the Docker Hub credentials runs in the protected environment; the check in the
// build job refers to its secrets. Counter-checks (measured 13.11.2026, each individually): `environment:
// docker-hub` deleted in the job build → red „build liest DOCKERHUB_* ohne Umgebung docker-hub“; the
// message back to „Secrets and variables -> Actions“ → red „… nennt die Environment-Secrets“.
test('Docker Hub credentials only in jobs with the docker-hub environment', () => {
  const jobs = YML.slice(YML.indexOf('\njobs:\n'));
  const blockList = jobs.split(/^ {2}(?=[\w-]+:\s*$)/m).slice(1);
  const withSecret = blockList.filter(b => /secrets\.DOCKERHUB_/.test(b));
  assert.ok(withSecret.length >= 2, `too few jobs with DOCKERHUB_* found (${withSecret.length})`);
  for (const b of withSecret) {
    const name = b.split(':')[0];
    assert.match(
      b,
      /^ {4}environment: docker-hub\s*$/m,
      `${name} reads DOCKERHUB_* without the docker-hub environment`,
    );
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
  assert.equal(pruefe('n', 't').status, 0, 'with both secrets it continues');
  const ohne = pruefe('', '');
  assert.equal(ohne.status, 1, 'without secrets the step aborts');
  assert.match(ohne.stdout, /Environments -> docker-hub/, 'the message names the environment secrets');
});
