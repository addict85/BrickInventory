/**
 * scripts/image-pruefen.sh übernimmt App- und Caddy-Image nur nach bestandener
 * Signaturprüfung und nur als Digest; compose.yaml startet ohne diese nicht.
 * Das echte Skript läuft in einem Sandkasten, `cosign` und `docker` sind Ersatz.
 *
 * Gegenproben (05.11.2026 gemessen, je einzeln):
 *   A  im Skript `cosign verify … || true` (Fehler übergangen) → rot: „eine
 *      gescheiterte Prüfung ändert nichts“
 *   B  `--certificate-identity` auf einen anderen Workflow → rot: „geprüft
 *      wird gegen docker-publish.yml auf main“
 *   C  statt der Zählung nur der erste Digest (`head -n1`) → rot: „zwei verschiedene Digests …“
 *   D  in compose.yaml bei jobs wieder `addict85/brickinventory:latest` →
 *      rot: „ohne BRICK_IMAGE startet compose nicht“
 *   E  (11.11.2026) das Caddy-Image nicht geprüft (`caddy=$CADDY_REPO:$tag`) → rot:
 *      „… der Digest landet in .env“ (nur ein cosign-Aufruf) und „scheitert die
 *      Prüfung des Caddy-Images …“
 *   F  (11.11.2026) bei caddy wieder `brickinventory-caddy:2.11.8` mit
 *      `pull_policy: build` → rot: „ohne BRICK_IMAGE und CADDY_IMAGE …“
 *   G  (13.11.2026) den Aufruf von geheimnisse-einrichten.sh gestrichen → rot:
 *      „ein Update legt das neue Geheimnis der Systemrolle an …“
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

/** cosignAntwort: Zeilen auf stdout; cosignCode: Ende des Ersatzes; caddy…: dasselbe für das Caddy-Image. */
function lauf(
  t,
  {
    env = 'BRICK_HOST=nas.lan\nBRICK_TAG=sha-1a2b3c4\nBRICK_IMAGE=alt\n',
    cosignAntwort = '',
    cosignCode = 0,
    caddyAntwort = signatur(D2),
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
  addict85/brickinventory-caddy:*) cat <<'X'\n${caddyAntwort}\nX\n    exit ${caddyCode} ;;
esac
cat <<'X'\n${cosignAntwort}\nX\nexit ${cosignCode}\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\necho "docker $*" >> "${ort}/docker.log"\n`, { mode: 0o755 });
  const r = spawnSync('sh', [path.join(ROOT, 'scripts', 'image-pruefen.sh')], {
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
    hatGeheimnisse: fs.existsSync(path.join(ort, 'geheimnisse')),
  };
}
function signatur(d) {
  return JSON.stringify([{ critical: { image: { 'docker-manifest-digest': d } } }]);
}

test('geprüft wird gegen docker-publish.yml auf main, der Digest landet in .env', t => {
  const r = lauf(t, { cosignAntwort: signatur(D1) });
  assert.equal(r.code, 0, r.log);
  const pruefung = repo =>
    `verify ${repo}:sha-1a2b3c4 --certificate-identity ` +
    'https://github.com/addict85/BrickInventory/.github/workflows/docker-publish.yml@refs/heads/main ' +
    '--certificate-oidc-issuer https://token.actions.githubusercontent.com';
  assert.deepEqual(r.cosign.trim().split('\n'), [
    pruefung('addict85/brickinventory'),
    pruefung('addict85/brickinventory-caddy'),
  ]);
  assert.equal(
    r.env,
    `BRICK_HOST=nas.lan\nBRICK_TAG=sha-1a2b3c4\nBRICK_IMAGE=addict85/brickinventory@${D1}\n` +
      `CADDY_IMAGE=addict85/brickinventory-caddy@${D2}\n`,
  );
  assert.equal(r.rechte, 0o600, '.env behält ihre Rechte');
  assert.match(r.docker, /^docker compose pull schluessel daten-rechte migration app jobs caddy-rechte caddy$/m);
});

test('scheitert die Prüfung des Caddy-Images, ändert sich auch BRICK_IMAGE nicht', t => {
  const vorher = 'BRICK_HOST=nas.lan\nBRICK_IMAGE=alt\nCADDY_IMAGE=altcaddy\n';
  const r = lauf(t, { env: vorher, cosignAntwort: signatur(D1), caddyCode: 1 });
  assert.equal(r.code, 1);
  assert.match(r.log, /Signaturprüfung für addict85\/brickinventory-caddy:latest fehlgeschlagen — nichts geändert/);
  assert.equal(r.env, vorher);
  assert.equal(r.docker, '', 'kein pull');
});

test('eine gescheiterte Prüfung ändert nichts', t => {
  const vorher = 'BRICK_HOST=nas.lan\nBRICK_IMAGE=alt\n';
  const r = lauf(t, { env: vorher, cosignAntwort: signatur(D1), cosignCode: 1 });
  assert.equal(r.code, 1);
  assert.match(r.log, /Signaturprüfung für addict85\/brickinventory:latest fehlgeschlagen — nichts geändert/);
  assert.equal(r.env, vorher);
  assert.equal(r.docker, '', 'kein pull');
});

test('zwei verschiedene Digests oder keiner: Abbruch', t => {
  for (const antwort of [`${signatur(D1)}\n${signatur(D2)}`, '[]']) {
    const r = lauf(t, { cosignAntwort: antwort });
    assert.equal(r.code, 1, r.log);
    assert.match(r.log, /genau ein geprüfter Digest/);
    assert.match(r.env, /^BRICK_IMAGE=alt$/m);
  }
});

test('ohne cosign: Abbruch mit Hinweis', t => {
  const ort = fs.mkdtempSync(path.join(os.tmpdir(), 'image-pruefen-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  // Nur die Werkzeuge bis zur Abfrage, damit ein installiertes cosign nicht zählt.
  const bin = path.join(ort, 'bin');
  fs.mkdirSync(bin);
  for (const w of ['sed', 'tail'])
    fs.symlinkSync(spawnSync('sh', ['-c', `command -v ${w}`], { encoding: 'utf8' }).stdout.trim(), path.join(bin, w));
  const r = spawnSync('/bin/sh', [path.join(ROOT, 'scripts', 'image-pruefen.sh')], {
    cwd: ort,
    encoding: 'utf8',
    env: { PATH: bin },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /cosign fehlt/);
});

test('ohne BRICK_IMAGE und CADDY_IMAGE startet compose nicht, mit Digest zieht jeder Dienst sie', t => {
  const aufruf = env =>
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
  const probe = aufruf({ BRICK_IMAGE: 'x', CADDY_IMAGE: 'y' });
  if (probe.error || (probe.status !== 0 && !/_IMAGE/.test(probe.stderr))) {
    if (process.env.CI) assert.fail(`docker compose im CI-Lauf: ${probe.error?.message || probe.stderr}`);
    t.skip('kein docker compose');
    return;
  }
  const ohne = aufruf({ CADDY_IMAGE: 'y' });
  assert.notEqual(ohne.status, 0);
  assert.match(ohne.stderr, /BRICK_IMAGE fehlt in \.env - einmal sh scripts\/image-pruefen\.sh ausfuehren/);
  const ohneCaddy = aufruf({ BRICK_IMAGE: 'x' });
  assert.notEqual(ohneCaddy.status, 0);
  assert.match(ohneCaddy.stderr, /CADDY_IMAGE fehlt in \.env - einmal sh scripts\/image-pruefen\.sh ausfuehren/);
  const mit = JSON.parse(
    aufruf({ BRICK_IMAGE: `addict85/brickinventory@${D1}`, CADDY_IMAGE: `addict85/brickinventory-caddy@${D2}` }).stdout,
  );
  // Gezogen wird nur, was signiert ist; selbst gebaut nur mit `--build` und eigenem Namen.
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

test('ein Update legt das neue Geheimnis der Systemrolle an, die übrigen bleiben', t => {
  const alt = {
    db_password: 'su',
    db_app_password: 'app',
    db_migration_password: 'mig',
    session_secret: 's'.repeat(48),
  };
  const r = lauf(t, { cosignAntwort: signatur(D1), geheim: alt });
  assert.equal(r.code, 0, r.log);
  assert.match(r.geheim('db_system_password'), /^[0-9a-f]{48}$/);
  for (const [n, w] of Object.entries(alt)) assert.equal(r.geheim(n), w, `${n} verändert`);
  const ohne = lauf(t, { cosignAntwort: signatur(D1) });
  assert.equal(ohne.code, 0, ohne.log);
  assert.equal(ohne.hatGeheimnisse, false, 'ohne ./geheimnisse legt das Update keine an');
});
