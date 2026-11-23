/**
 * Hardening of the services in compose.yaml, read as structure per service:
 * privileges, writable places, networks, secrets and Caddy's start command.
 *
 * Counter-checks are listed with the individual checks.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Minimal YAML reader for exactly this file.
 *
 * Deliberately no package for it: js-yaml would be a new dependency for a
 * single check. All that is needed is what services stand under `services:`
 * and which values their keys carry.
 */
function readService(yaml, name) {
  const lines = yaml.split('\n');
  const start = lines.findIndex(l => new RegExp(`^  ${name}:\\s*$`).test(l));
  if (start < 0) return null;
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*$/.test(l) || /^\s*#/.test(l)) continue;
    if (/^ {2}\S/.test(l) || /^\S/.test(l)) break; // next service / next section
    block.push(l);
  }
  return block.join('\n');
}

const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

// ── Hardening of all services ─────────────────────────────────────────────
//
// This check records that list and entrypoint match.
// Counter-checks (measured on 29.10.2026):
//   A  cap_drop removed from the service app → red: “app: cap_drop: [ALL] missing”
//   B  in the entrypoint a target /app/cache added to mkdir → red: “the
//      entrypoint writes outside the writable places”
const list = (block, key) =>
  (block.match(new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]`, 'm'))?.[1] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

test('no service gains privileges, each has only the necessary capabilities', () => {
  const expected = {
    postgres: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
    app: [],
    jobs: [],
    'daten-rechte': ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID'],
    migration: [],
    'db-rolle': [],
    caddy: [],
    'caddy-rechte': ['CHOWN', 'DAC_OVERRIDE'],
  };
  for (const [serviceFn, caps] of Object.entries(expected)) {
    const block = readService(compose, serviceFn);
    assert.match(block, /^\s*-\s*no-new-privileges:true\s*$/m, `${serviceFn}: no-new-privileges is missing`);
    assert.deepEqual(list(block, 'cap_drop'), ['ALL'], `${serviceFn}: cap_drop: [ALL] is missing`);
    assert.deepEqual(list(block, 'cap_add').sort(), caps, `${serviceFn}: unerwartete Capabilities`);
  }
});

test('the app only writes to ./data and /tmp — daten-rechte too', () => {
  const block = readService(compose, 'app');
  assert.match(block, /^\s*read_only:\s*true\s*$/m, 'app: read_only is missing');
  assert.match(
    block,
    /^\s*tmpfs:\s*\n\s*-\s*\/tmp:rw,noexec,nosuid,nodev,size=\d+m\s*$/m,
    'app: /tmp as tmpfs is missing',
  );
  assert.match(block, /^\s*-\s*\.\/data:\/app\/data\s*$/m, 'app: ./data is not mounted at /app/data');

  const ep = fs
    .readFileSync(path.join(ROOT, 'data-permissions.sh'), 'utf8')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  // What the entrypoint creates or writes: the mkdir targets and the marker.
  const mkdir = ep.slice(ep.indexOf('mkdir -p'), ep.indexOf('\n\n', ep.indexOf('mkdir -p')));
  const targets = [...mkdir.matchAll(/\/\S+/g)].map(m => m[0]);
  targets.push(ep.match(/^MARKE=(\S+)/m)?.[1]);
  assert.ok(targets.length >= 5 && targets.every(Boolean), `Targets not found: ${targets}`);
  assert.deepEqual(
    targets.filter(z => !z.startsWith('/app/data')),
    [],
    'daten-rechte writes outside the writable places',
  );

  // Executed fully once, /app/data in the sandbox; id, su-exec and chown are substitutes.
  // Counter-check (measured 11.11.2026): `/app/data/images/sets \` deleted from the mkdir list
  // → red “daten-rechte does not create what the server needs”.
  const location = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'daten-rechte-'));
  try {
    const data = path.join(location, 'data'),
      bin = path.join(location, 'bin');
    fs.mkdirSync(data);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\necho 4242\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'su-exec'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'chown'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const r = require('node:child_process').spawnSync('sh', ['-c', ep.replaceAll('/app/data', data)], {
      encoding: 'utf8',
      env: { PATH: `${bin}:/usr/bin:/bin`, BRICKINV_CHOWN: 'always' },
    });
    assert.equal(r.status, 0, r.stderr);
    const created = fs.readdirSync(data, { recursive: true }).sort();
    assert.deepEqual(
      created,
      ['.eigentuemer', 'images', 'images/minifigs', 'images/parts', 'images/sets', 'instructions', 'uploads'],
      'daten-rechte does not create what the server needs',
    );
    assert.equal(fs.readFileSync(path.join(data, '.eigentuemer'), 'utf8'), '4242');
  } finally {
    fs.rmSync(location, { recursive: true, force: true });
  }
});

// Counter-checks (measured 11.11.2026, each alone): for jobs `user: brickinv`
// deleted → red “jobs runs as root”; for daten-rechte `- ./schluessel:/app/schluessel`
// added → red “daten-rechte sees more than ./data”; `network_mode: none` there
// deleted → red “daten-rechte needs no network”; for app the dependency
// on daten-rechte deleted → red “app does not wait for daten-rechte”.
test('root sets up ./data only in the service daten-rechte, app and jobs run as brickinv', t => {
  // How Docker reads the file (interpolation, short notations), not via regex.
  const r = require('node:child_process').spawnSync(
    'docker',
    ['compose', '-f', path.join(ROOT, 'compose.yaml'), 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        BRICK_HOST: 'nas.lan',
        VORGELAGERTER_PROXY: 'keiner',
        BRICK_IMAGE: 'brickinventory:probe',
        CADDY_IMAGE: 'brickinventory-caddy:probe',
      },
    },
  );
  if (r.error || r.status !== 0) {
    if (process.env.CI) assert.fail(`docker compose config in the CI run: ${r.error?.message || r.stderr}`);
    t.skip('no docker compose');
    return;
  }
  const { services: d } = JSON.parse(r.stdout);
  const rights = d['daten-rechte'];
  assert.ok(rights, 'Service daten-rechte is missing');
  assert.equal(rights.user, 'root');
  assert.equal(rights.network_mode, 'none', 'daten-rechte needs no network');
  assert.equal(rights.read_only, true);
  assert.deepEqual(rights.entrypoint, ['sh', '/app/data-permissions.sh']);
  // Only ./data: a symlink of the service must lead root to nothing else.
  assert.deepEqual(
    (rights.volumes || []).map(v => `${path.relative(ROOT, v.source)}:${v.target}`),
    ['data:/app/data'],
    'daten-rechte sees more than ./data',
  );
  assert.equal(rights.secrets, undefined, 'daten-rechte sees more than ./data');
  assert.equal(rights.image, d.app.image, 'data-permissions.sh comes from the app image');
  for (const n of ['app', 'jobs']) {
    assert.equal(d[n].user, 'brickinv', `${n} runs as root`);
    assert.equal(
      d[n].depends_on?.['daten-rechte']?.condition,
      'service_completed_successfully',
      `${n} does not wait for daten-rechte`,
    );
  }
});

// Counter-checks (measured 01.11.2026): DATA_KEY_FILE deleted for jobs → red
// “jobs: DATA_KEY_FILE missing”; path to /app/data/.datenschluessel → red “… ./data”.
test('the data key lies outside of ./data for app and jobs', () => {
  for (const serviceFn of ['app', 'jobs']) {
    const block = readService(compose, serviceFn);
    const file = block.match(/^\s*DATA_KEY_FILE:\s*(\S+)\s*$/m)?.[1];
    assert.ok(file, `${serviceFn}: DATA_KEY_FILE is missing`);
    const dir = [...block.matchAll(/^\s*-\s*(\.\/[^:\s]+):(\/[^:\s]+)(:ro)?\s*$/gm)].find(m =>
      file.startsWith(m[2] + '/'),
    );
    assert.ok(dir, `${serviceFn}: ${file} is not in any mounted folder`);
    assert.notEqual(dir[1], './data', `${serviceFn}: the key is in ./data again`);
  }
});

// Counter-checks (measured on 30.10.2026): default back to `${TRUST_PROXY:-docker}` →
// red “TRUST_PROXY trusts exactly Caddy …”; `ipam` removed from the network → red “… fixed
// subnet”;
// `sign_with_root` removed from the Caddyfile → red “Caddy: …”; port 3000 of the
// app published again → red “the app is only reachable via Caddy”.
// (11.11.2026) in UPGRADE.md section 53 `N=172.28.0.0/16` → red “the LAN block
// in UPGRADE.md names another network”.
test('TRUST_PROXY trusts exactly Caddy, the network has a fixed subnet', () => {
  const app = readService(compose, 'app');
  const caddy = readService(compose, 'caddy');
  const address = caddy.match(/ipv4_address:\s*(\S+)/)?.[1];
  assert.equal(address, '172.28.73.10', 'Caddy has no fixed address');
  assert.match(
    app,
    /^\s*TRUST_PROXY:\s*\$\{TRUST_PROXY:-172\.28\.73\.10\}\s*$/m,
    'TRUST_PROXY does not name exactly Caddy by default',
  );
  const { proxyTrust } = require('./helpers/sources').buildAndRequire()('src/infra/proxyTrust.js');
  assert.deepEqual(proxyTrust(address), ['172.28.73.10'], 'exactly Caddy is trusted, not a whole network');
  const net = compose.slice(compose.indexOf('\nnetworks:'));
  assert.match(net, /subnet:\s*172\.28\.73\.0\/24/, 'brickinventory-net has no fixed subnet');
  // The DOCKER-USER rule in UPGRADE.md (section 53) names exactly this network.
  const upgrade = fs.readFileSync(path.join(ROOT, 'UPGRADE.md'), 'utf8');
  const rule = upgrade.slice(upgrade.indexOf('## 53.'));
  assert.match(rule, /^N=172\.28\.73\.0\/24 /m, 'the LAN block in UPGRADE.md names a different network');
  assert.match(rule, /iptables -I DOCKER-USER -s "\$N" -j BRICK-LAN/);
});

test('the app is only reachable via Caddy', () => {
  const app = readService(compose, 'app')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  assert.doesNotMatch(app, /^\s*ports:/m, 'the app publishes a port bypassing the proxy');
  const caddy = readService(compose, 'caddy');
  assert.match(caddy, /:443:443"/);
  assert.match(caddy, /:80:80"/);
  assert.match(caddy, /^\s*dockerfile:\s*Dockerfile\.caddy\s*$/m, 'Caddy is not built from Dockerfile.caddy');
  const basis = [...fs.readFileSync(path.join(ROOT, 'Dockerfile.caddy'), 'utf8').matchAll(/^FROM\s+(\S+)/gm)].map(
    m => m[1],
  );
  assert.ok(
    basis.length === 2 && basis.every(b => /^caddy:[\w.-]+@sha256:[0-9a-f]{64}$/.test(b)),
    `Caddy base not by digest: ${basis}`,
  );
  assert.match(app, /^\s*-\s*ca-wurzel:\/caddy-ca:ro\s*$/m, 'the root certificate is not mounted read-only');
});

// Counter-checks (measured 09.11.2026, each alone): for caddy `user:` deleted →
// red “Caddy runs as root”; `sysctls` deleted → red “… ports below 1024”;
// in caddy-rechte 1000:1000 instead of 10443:10443 → red “… other identifier”;
// `- ./caddy/config:/config` deleted from caddy-rechte → red “… not handed over”;
// the dependency on caddy-rechte deleted → red “Caddy does not wait …”.
test('Caddy runs without root, caddy-rechte hands it its folders', () => {
  const caddy = readService(compose, 'caddy');
  const rights = readService(compose, 'caddy-rechte');
  const tokenId = caddy.match(/^\s*user:\s*"?(\d+):(\d+)"?\s*$/m);
  assert.ok(tokenId && tokenId[1] !== '0' && tokenId[2] !== '0', 'Caddy runs as root');
  assert.match(
    caddy,
    /^\s*sysctls:\s*\n\s*net\.ipv4\.ip_unprivileged_port_start:\s*0\s*$/m,
    'without root and without NET_BIND_SERVICE Caddy needs the ports below 1024 unlocked',
  );
  assert.match(
    caddy,
    /caddy-rechte:\s*\n\s*condition: service_completed_successfully/,
    'Caddy does not wait for caddy-rechte',
  );

  assert.match(rights, /^\s*network_mode:\s*none\s*$/m, 'caddy-rechte needs no network');
  assert.match(rights, /^\s*read_only:\s*true\s*$/m);
  const target = `${tokenId[1]}:${tokenId[2]}`;
  const chown = [...rights.matchAll(/chown (?:-R )?(\d+:\d+) ([^;\n]+)/g)];
  assert.ok(
    chown.length && chown.every(m => m[1] === target),
    `caddy-rechte hands over to a different ID than ${target}`,
  );
  const passed = chown.flatMap(m => m[2].trim().split(/\s+/));
  // Every folder Caddy mounts (except the Caddyfile) is mounted there and belongs to it afterwards.
  const mount = block => [...block.matchAll(/^\s*-\s*([^\s:]+):(\/[^:\s]+)(:ro)?\s*$/gm)].map(m => `${m[1]}:${m[2]}`);
  const dir = mount(caddy).filter(e => !e.endsWith(':/etc/caddy/Caddyfile'));
  assert.ok(dir.length >= 4, `Caddy’s folder not found: ${dir}`);
  const missing = dir.filter(e => !mount(rights).includes(e) || !passed.some(u => e.endsWith(':' + u)));
  assert.deepEqual(missing, [], 'caddy-rechte did not hand over these places');
});

test('Caddy: issuer from the start script, own request identifier, port 80 only redirects', () => {
  const file = fs
    .readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  // Without default: if BRICK_TLS_AUSSTELLER is missing, the Caddyfile is invalid (ca-eigene-wurzel checks that with Caddy).
  assert.match(
    file,
    /issuer \{\$BRICK_TLS_AUSSTELLER\} \{\s*\{\$BRICK_TLS_OPTIONEN\}\s*\}/,
    'the issuer has a default',
  );
  assert.match(file, /reverse_proxy app:3000 \{[^}]*header_up X-Request-Id \{http\.request\.uuid\}/);
  // /ca.crt also only over HTTPS (routes/certificate.ts says 403 over HTTP, tls-wurzel-db).
  assert.match(file, /http:\/\/ \{\s*redir \{\$BRICK_BASE_URL\}\{uri\} 308\s*\}/, 'Port 80 does not only redirect');
  assert.match(file, /default_sni \{\$BRICK_HOST\}/);
});

test('no service has a substitute database password', () => {
  assert.doesNotMatch(compose, /\$\{DB_PASSWORD:-/, 'a service falls back to an example password');
  assert.doesNotMatch(compose, /DB_APP_PASSWORD:-/, 'a service falls back to an example password');
});

// Counter-checks (measured 02.11.2026): for jobs the dependency back on
// postgres → red “jobs does not wait for db-rolle”; in the service db-rolle another
// digest → red “db-rolle takes another Postgres image”. (03.11.2026) for jobs
// db_password added under secrets → red “jobs knows the password of the
// superuser”; for app PGPASSWORD_FILE to /run/secrets/db_password → red
// “app: PGPASSWORD_FILE not from db_app_password”. (11.11.2026) for jobs the
// dependency on migration deleted → red “jobs does not wait for migration”;
// migration additionally in brickinventory-net → red “migration only needs the
// internal network …”; schluessel gets db_migration_password → red “a
// runtime service knows the password of the migration role”. (15.11.2026) app again with
// db_system_password → red “app knows more than the web system role”; for db-rolle
// DB_SYSTEM_WEB_PASSWORD_FILE deleted → red “db-rolle creates the role system_web …”.
const secretsOf = block =>
  (block.match(/^\s*secrets:\s*\[([^\]]*)\]/m)?.[1] ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .sort();
test('only postgres and db-rolle know the superuser, only migration the migration role, app and jobs the runtime role', () => {
  const services = ['postgres', 'db-rolle', 'app', 'jobs'];
  const withSuperuser = services.filter(d => secretsOf(readService(compose, d)).includes('db_password'));
  assert.deepEqual(withSuperuser, ['postgres', 'db-rolle']);
  assert.deepEqual(
    secretsOf(readService(compose, 'app')),
    ['db_app_password', 'db_system_web_password', 'session_secret'],
    'app knows more than the web system role',
  );
  assert.deepEqual(
    secretsOf(readService(compose, 'jobs')),
    ['db_app_password', 'db_system_password'],
    'jobs knows the superuser password',
  );
  for (const d of ['app', 'jobs']) {
    const block = readService(compose, d);
    assert.match(block, /^\s*PGUSER:\s*brickinventory_app\s*$/m, `${d} does not connect as the app role`);
    assert.match(
      block,
      /^\s*PGPASSWORD_FILE:\s*\/run\/secrets\/db_app_password\s*$/m,
      `${d}: PGPASSWORD_FILE not from db_app_password`,
    );
    const role = d === 'app' ? 'system_web' : 'system';
    assert.match(
      block,
      new RegExp(`^\\s*PGSYSTEM_USER:\\s*brickinventory_${role}\\s*$`, 'm'),
      `${d} without a system role`,
    );
    assert.match(block, new RegExp(`^\\s*PGSYSTEM_PASSWORD_FILE:\\s*/run/secrets/db_${role}_password\\s*$`, 'm'));
  }
  for (const d of ['postgres', 'db-rolle'])
    for (const role of ['system', 'system_web'])
      assert.match(
        readService(compose, d),
        new RegExp(`^\\s*DB_${role.toUpperCase()}_PASSWORD_FILE:\\s*/run/secrets/db_${role}_password\\s*$`, 'm'),
        `${d} creates the role ${role} without a password`,
      );
  assert.match(
    readService(compose, 'db-rolle'),
    /^\s*PGWEB_DB_PASSWORD_FILE:\s*\/run\/secrets\/pgweb_db_password\s*$/m,
    'db-rolle does not set the password of the reader role',
  );
  for (const d of ['app', 'jobs'])
    assert.match(
      readService(compose, d),
      /depends_on:\s*\n\s*db-rolle:\s*\n\s*condition: service_completed_successfully/,
      `${d} does not wait for db-rolle`,
    );
  const image = d => readService(compose, d).match(/^\s*image:\s*(\S+)\s*$/m)?.[1];
  assert.equal(image('db-rolle'), image('postgres'), 'db-rolle uses a different Postgres image');

  // Only the migration service knows the migration role (owner); app and jobs only start after it.
  const withMigration = ['postgres', 'db-rolle', 'migration', 'app', 'jobs', 'schluessel', 'daten-rechte'].filter(d =>
    secretsOf(readService(compose, d)).includes('db_migration_password'),
  );
  assert.deepEqual(
    withMigration,
    ['postgres', 'db-rolle', 'migration'],
    'a runtime service knows the password of the migration role',
  );
  const mig = readService(compose, 'migration');
  assert.deepEqual(secretsOf(mig), ['db_migration_password']);
  assert.match(mig, /^\s*PGUSER:\s*brickinventory_migration\s*$/m);
  assert.match(mig, /^\s*PGPASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m);
  assert.match(mig, /^\s*entrypoint: \["node", "dist\/startup\/migrate\.js"\]\s*$/m);
  assert.equal(image('migration'), image('app'), 'migration uses a different image than app');
  const networkList = mig
    .split(/\n\s*networks:\s*\n/)[1]
    ?.split('\n')
    .filter(z => /^\s+-\s/.test(z))
    .map(z => z.trim().slice(2));
  assert.deepEqual(networkList, ['db-net'], 'migration only needs the internal network of the database');
  for (const d of ['app', 'jobs'])
    assert.match(
      readService(compose, d),
      /depends_on:[\s\S]*?\n\s+migration:\s*\n\s*condition: service_completed_successfully/,
      `${d} does not wait for migration`,
    );
  assert.match(
    readService(compose, 'db-rolle'),
    /^\s*DB_MIGRATION_PASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m,
  );
  assert.match(
    readService(compose, 'postgres'),
    /^\s*DB_MIGRATION_PASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m,
    'a new database does not get the migration role on creation',
  );
  const role = readService(compose, 'db-rolle');
  assert.match(role, /^\s*entrypoint: \["sh", "\/rolle\/app-role\.sh"\]\s*$/m);
  assert.match(role, /^\s*-\s*\.\/postgres\/app-role\.sh:\/rolle\/app-role\.sh:ro\s*$/m);
  assert.match(
    readService(compose, 'postgres'),
    /^\s*-\s*\.\/postgres\/app-role\.sh:\/docker-entrypoint-initdb\.d\/10-app-role\.sh:ro\s*$/m,
    'a new database does not get the role on creation',
  );
  assert.ok(
    fs.statSync(path.join(ROOT, 'postgres', 'app-role.sh')).mode & 0o111,
    'docker-entrypoint-initdb.d only runs the script if it is executable',
  );
});
