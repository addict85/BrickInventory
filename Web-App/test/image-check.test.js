/**
 * scripts/check-image.sh takes over app and Caddy image only after a passed
 * signature check and only as a digest; compose.yaml does not start without them.
 * The real script runs in a sandbox, `cosign` and `docker` are substitutes.
 *
 * Counter-checks (measured 05.11.2026, each alone):
 *   A  in the script `cosign verify … || true` (error ignored) → red: “a
 *      failed check changes nothing”
 *   B  `--certificate-identity` to another workflow → red: “checked
 *      against docker-publish.yml on main”
 *   C  instead of the count only the first digest (`head -n1`) → red: “two different digests …”
 *   D  in compose.yaml for jobs again `addict85/brickinventory:latest` →
 *      red: “without BRICK_IMAGE compose does not start”
 *   E  (11.11.2026) the Caddy image not checked (`caddy=$CADDY_REPO:$tag`) → red:
 *      “… the digest lands in .env” (only one cosign call) and “if the
 *      check of the Caddy image fails …”
 *   F  (11.11.2026) for caddy again `brickinventory-caddy:2.11.8` with
 *      `pull_policy: build` → red: “without BRICK_IMAGE and CADDY_IMAGE …”
 *   G  (13.11.2026) the call of setup-secrets.sh deleted → red:
 *      “an update creates the new secret of the system role …”
 *   H  (15.11.2026) in the script only db_system_password checked → red:
 *      “… also that of the web system role …”
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const D1 = 'sha256:' + '1'.repeat(64),
  D2 = 'sha256:' + '2'.repeat(64);

/** cosignResponse: lines on stdout; cosignCode: end of the substitute; caddy…: the same for the Caddy image. */
function lauf(
  t,
  {
    env = 'BRICK_HOST=nas.lan\nBRICK_TAG=sha-1a2b3c4\nBRICK_IMAGE=alt\n',
    cosignResponse = '',
    cosignCode = 0,
    caddyResponse = signatur(D2),
    caddyCode = 0,
    geheim = null,
  } = {},
) {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'image-pruefen-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  const bin = path.join(ort, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(ort, '.env'), env, { mode: 0o600 });
  if (geheim) {
    fs.mkdirSync(path.join(ort, 'geheimnisse'), { mode: 0o700 });
    for (const [n, w] of Object.entries(geheim)) fs.writeFileSync(path.join(ort, 'geheimnisse', n), w);
  }
  fs.writeFileSync(
    path.join(bin, 'cosign'),
    `#!/bin/sh\necho "$*" >> "${ort}/cosign.args"
case "$2" in
  addict85/brickinventory-caddy:*) cat <<'X'\n${caddyResponse}\nX\n    exit ${caddyCode} ;;
esac
cat <<'X'\n${cosignResponse}\nX\nexit ${cosignCode}\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\necho "docker $*" >> "${ort}/docker.log"\n`, { mode: 0o755 });
  const r = spawnSync('sh', [path.join(ROOT, 'scripts', 'check-image.sh')], {
    cwd: ort,
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin` },
  });
  const lies = n => (fs.existsSync(path.join(ort, n)) ? fs.readFileSync(path.join(ort, n), 'utf8') : '');
  return {
    code: r.status,
    log: r.stdout + r.stderr,
    env: lies('.env'),
    cosign: lies('cosign.args'),
    docker: lies('docker.log'),
    rechte: fs.statSync(path.join(ort, '.env')).mode & 0o777,
    geheim: n => lies(path.join('geheimnisse', n)),
    hatSecrets: fs.existsSync(path.join(ort, 'geheimnisse')),
  };
}
function signatur(d) {
  return JSON.stringify([{ critical: { image: { 'docker-manifest-digest': d } } }]);
}

test('checking happens against docker-publish.yml on main, the digest ends up in .env', t => {
  const r = lauf(t, { cosignResponse: signatur(D1) });
  assert.equal(r.code, 0, r.log);
  const check = repo =>
    `verify ${repo}:sha-1a2b3c4 --certificate-identity ` +
    'https://github.com/addict85/BrickInventory/.github/workflows/docker-publish.yml@refs/heads/main ' +
    '--certificate-oidc-issuer https://token.actions.githubusercontent.com';
  assert.deepEqual(r.cosign.trim().split('\n'), [
    check('addict85/brickinventory'),
    check('addict85/brickinventory-caddy'),
  ]);
  assert.equal(
    r.env,
    `BRICK_HOST=nas.lan\nBRICK_TAG=sha-1a2b3c4\nBRICK_IMAGE=addict85/brickinventory@${D1}\n` +
      `CADDY_IMAGE=addict85/brickinventory-caddy@${D2}\n`,
  );
  assert.equal(r.rechte, 0o600, '.env behält ihre Rechte');
  assert.match(r.docker, /^docker compose pull schluessel daten-rechte migration app jobs caddy-rechte caddy$/m);
});

test('if the check of the Caddy image fails, BRICK_IMAGE does not change either', t => {
  const vorher = 'BRICK_HOST=nas.lan\nBRICK_IMAGE=alt\nCADDY_IMAGE=altcaddy\n';
  const r = lauf(t, { env: vorher, cosignResponse: signatur(D1), caddyCode: 1 });
  assert.equal(r.code, 1);
  assert.match(r.log, /Signaturprüfung für addict85\/brickinventory-caddy:latest fehlgeschlagen — nichts geändert/);
  assert.equal(r.env, vorher);
  assert.equal(r.docker, '', 'kein pull');
});

test('a failed check changes nothing', t => {
  const vorher = 'BRICK_HOST=nas.lan\nBRICK_IMAGE=alt\n';
  const r = lauf(t, { env: vorher, cosignResponse: signatur(D1), cosignCode: 1 });
  assert.equal(r.code, 1);
  assert.match(r.log, /Signaturprüfung für addict85\/brickinventory:latest fehlgeschlagen — nichts geändert/);
  assert.equal(r.env, vorher);
  assert.equal(r.docker, '', 'kein pull');
});

test('two different digests or none: abort', t => {
  for (const antwort of [`${signatur(D1)}\n${signatur(D2)}`, '[]']) {
    const r = lauf(t, { cosignResponse: antwort });
    assert.equal(r.code, 1, r.log);
    assert.match(r.log, /genau ein geprüfter Digest/);
    assert.match(r.env, /^BRICK_IMAGE=alt$/m);
  }
});

test('without cosign: abort with a hint', t => {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'image-pruefen-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  // Only the tools up to the query, so that an installed cosign does not count.
  const bin = path.join(ort, 'bin');
  fs.mkdirSync(bin);
  for (const w of ['sed', 'tail'])
    fs.symlinkSync(spawnSync('sh', ['-c', `command -v ${w}`], { encoding: 'utf8' }).stdout.trim(), path.join(bin, w));
  const r = spawnSync('/bin/sh', [path.join(ROOT, 'scripts', 'check-image.sh')], {
    cwd: ort,
    encoding: 'utf8',
    env: { PATH: bin },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cosign fehlt/);
});

test('without BRICK_IMAGE and CADDY_IMAGE compose does not start, with digest every service pulls them', t => {
  const call = env =>
    spawnSync('docker', ['compose', '-f', path.join(ROOT, 'compose.yaml'), 'config', '--format', 'json'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        BRICK_HOST: 'nas.lan',
        VORGELAGERTER_PROXY: 'keiner',
        ...env,
      },
    });
  const probe = call({ BRICK_IMAGE: 'x', CADDY_IMAGE: 'y' });
  if (probe.error || (probe.status !== 0 && !/_IMAGE/.test(probe.stderr))) {
    if (process.env.CI) assert.fail(`docker compose im CI-Lauf: ${probe.error?.message || probe.stderr}`);
    t.skip('no docker compose');
    return;
  }
  const ohne = call({ CADDY_IMAGE: 'y' });
  assert.notEqual(ohne.status, 0);
  assert.match(ohne.stderr, /BRICK_IMAGE fehlt in \.env - einmal sh scripts\/check-image\.sh ausfuehren/);
  const withoutCaddy = call({ BRICK_IMAGE: 'x' });
  assert.notEqual(withoutCaddy.status, 0);
  assert.match(withoutCaddy.stderr, /CADDY_IMAGE fehlt in \.env - einmal sh scripts\/check-image\.sh ausfuehren/);
  const mit = JSON.parse(
    call({ BRICK_IMAGE: `addict85/brickinventory@${D1}`, CADDY_IMAGE: `addict85/brickinventory-caddy@${D2}` }).stdout,
  );
  // Only what is signed is pulled; self-built only with `--build` and an own name.
  const ziehen = Object.entries(mit.services).filter(([, d]) => !/^postgres:/.test(d.image));
  assert.deepEqual(
    ziehen.map(([n, d]) => `${n} ${d.image} ${d.pull_policy}`).sort(),
    [
      ...['app', 'daten-rechte', 'jobs', 'migration', 'schluessel'].map(
        n => `${n} addict85/brickinventory@${D1} missing`,
      ),
      ...['caddy', 'caddy-rechte'].map(n => `${n} addict85/brickinventory-caddy@${D2} missing`),
    ].sort(),
  );
});

test('an update creates the new secret of the system role, the others stay', t => {
  const alt = {
    db_password: 'su',
    db_app_password: 'app',
    db_migration_password: 'mig',
    session_secret: 's'.repeat(48),
  };
  const r = lauf(t, { cosignResponse: signatur(D1), geheim: alt });
  assert.equal(r.code, 0, r.log);
  assert.match(r.geheim('db_system_password'), /^[0-9a-f]{48}$/);
  for (const [n, w] of Object.entries(alt)) assert.equal(r.geheim(n), w, `${n} verändert`);
  const ohne = lauf(t, { cosignResponse: signatur(D1) });
  assert.equal(ohne.code, 0, ohne.log);
  assert.equal(ohne.hatSecrets, false, 'ohne ./geheimnisse legt das Update keine an');
});

test('… also that of the web system role, if only it is missing', t => {
  const alt = {
    db_password: 'su',
    db_app_password: 'app',
    db_migration_password: 'mig',
    db_system_password: 'sys',
    session_secret: 's'.repeat(48),
  };
  const r = lauf(t, { cosignResponse: signatur(D1), geheim: alt });
  assert.equal(r.code, 0, r.log);
  assert.match(r.geheim('db_system_web_password'), /^[0-9a-f]{48}$/);
  for (const [n, w] of Object.entries(alt)) assert.equal(r.geheim(n), w, `${n} verändert`);
});
