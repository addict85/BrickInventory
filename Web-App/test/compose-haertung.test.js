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
  const zeilen = yaml.split('\n');
  const start = zeilen.findIndex(l => new RegExp(`^  ${name}:\\s*$`).test(l));
  if (start < 0) return null;
  const block = [];
  for (let i = start + 1; i < zeilen.length; i++) {
    const l = zeilen[i];
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
const liste = (block, schluessel) =>
  (block.match(new RegExp(`^\\s*${schluessel}:\\s*\\[([^\\]]*)\\]`, 'm'))?.[1] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

test('no service gains privileges, each has only the necessary capabilities', () => {
  const erwartet = {
    postgres: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
    app: [],
    jobs: [],
    'daten-rechte': ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID'],
    migration: [],
    'db-rolle': [],
    caddy: [],
    'caddy-rechte': ['CHOWN', 'DAC_OVERRIDE'],
  };
  for (const [dienst, caps] of Object.entries(erwartet)) {
    const block = readService(compose, dienst);
    assert.match(block, /^\s*-\s*no-new-privileges:true\s*$/m, `${dienst}: no-new-privileges fehlt`);
    assert.deepEqual(liste(block, 'cap_drop'), ['ALL'], `${dienst}: cap_drop: [ALL] fehlt`);
    assert.deepEqual(liste(block, 'cap_add').sort(), caps, `${dienst}: unerwartete Capabilities`);
  }
});

test('the app only writes to ./data and /tmp — daten-rechte too', () => {
  const block = readService(compose, 'app');
  assert.match(block, /^\s*read_only:\s*true\s*$/m, 'app: read_only fehlt');
  assert.match(block, /^\s*tmpfs:\s*\n\s*-\s*\/tmp:rw,noexec,nosuid,nodev,size=\d+m\s*$/m, 'app: /tmp als tmpfs fehlt');
  assert.match(block, /^\s*-\s*\.\/data:\/app\/data\s*$/m, 'app: ./data ist nicht nach /app/data eingehängt');

  const ep = fs
    .readFileSync(path.join(ROOT, 'daten-rechte.sh'), 'utf8')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  // What the entrypoint creates or writes: the mkdir targets and the marker.
  const mkdir = ep.slice(ep.indexOf('mkdir -p'), ep.indexOf('\n\n', ep.indexOf('mkdir -p')));
  const ziele = [...mkdir.matchAll(/\/\S+/g)].map(m => m[0]);
  ziele.push(ep.match(/^MARKE=(\S+)/m)?.[1]);
  assert.ok(ziele.length >= 5 && ziele.every(Boolean), `Ziele nicht gefunden: ${ziele}`);
  assert.deepEqual(
    ziele.filter(z => !z.startsWith('/app/data')),
    [],
    'daten-rechte schreibt ausserhalb der beschreibbaren Orte',
  );

  // Executed fully once, /app/data in the sandbox; id, su-exec and chown are substitutes.
  // Counter-check (measured 11.11.2026): `/app/data/images/sets \` deleted from the mkdir list
  // → red “daten-rechte does not create what the server needs”.
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'daten-rechte-'));
  try {
    const daten = path.join(ort, 'data'),
      bin = path.join(ort, 'bin');
    fs.mkdirSync(daten);
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'id'), '#!/bin/sh\necho 4242\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'su-exec'), '#!/bin/sh\nshift\nexec "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'chown'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const r = require('node:child_process').spawnSync('sh', ['-c', ep.replaceAll('/app/data', daten)], {
      encoding: 'utf8',
      env: { PATH: `${bin}:/usr/bin:/bin`, BRICKINV_CHOWN: 'always' },
    });
    assert.equal(r.status, 0, r.stderr);
    const angelegt = fs.readdirSync(daten, { recursive: true }).sort();
    assert.deepEqual(
      angelegt,
      ['.eigentuemer', 'images', 'images/minifigs', 'images/parts', 'images/sets', 'instructions', 'uploads'],
      'daten-rechte legt nicht an, was der Server braucht',
    );
    assert.equal(fs.readFileSync(path.join(daten, '.eigentuemer'), 'utf8'), '4242');
  } finally {
    fs.rmSync(ort, { recursive: true, force: true });
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
    if (process.env.CI) assert.fail(`docker compose config im CI-Lauf: ${r.error?.message || r.stderr}`);
    t.skip('no docker compose');
    return;
  }
  const { services: d } = JSON.parse(r.stdout);
  const rechte = d['daten-rechte'];
  assert.ok(rechte, 'Dienst daten-rechte fehlt');
  assert.equal(rechte.user, 'root');
  assert.equal(rechte.network_mode, 'none', 'daten-rechte braucht kein Netz');
  assert.equal(rechte.read_only, true);
  assert.deepEqual(rechte.entrypoint, ['sh', '/app/daten-rechte.sh']);
  // Only ./data: a symlink of the service must lead root to nothing else.
  assert.deepEqual(
    (rechte.volumes || []).map(v => `${path.relative(ROOT, v.source)}:${v.target}`),
    ['data:/app/data'],
    'daten-rechte sieht mehr als ./data',
  );
  assert.equal(rechte.secrets, undefined, 'daten-rechte sieht mehr als ./data');
  assert.equal(rechte.image, d.app.image, 'daten-rechte.sh kommt aus dem App-Image');
  for (const n of ['app', 'jobs']) {
    assert.equal(d[n].user, 'brickinv', `${n} läuft als root`);
    assert.equal(
      d[n].depends_on?.['daten-rechte']?.condition,
      'service_completed_successfully',
      `${n} wartet nicht auf daten-rechte`,
    );
  }
});

// Counter-checks (measured 01.11.2026): DATA_KEY_FILE deleted for jobs → red
// “jobs: DATA_KEY_FILE missing”; path to /app/data/.datenschluessel → red “… ./data”.
test('the data key lies outside of ./data for app and jobs', () => {
  for (const dienst of ['app', 'jobs']) {
    const block = readService(compose, dienst);
    const datei = block.match(/^\s*DATA_KEY_FILE:\s*(\S+)\s*$/m)?.[1];
    assert.ok(datei, `${dienst}: DATA_KEY_FILE fehlt`);
    const ordner = [...block.matchAll(/^\s*-\s*(\.\/[^:\s]+):(\/[^:\s]+)(:ro)?\s*$/gm)].find(m =>
      datei.startsWith(m[2] + '/'),
    );
    assert.ok(ordner, `${dienst}: ${datei} liegt in keinem eingehängten Ordner`);
    assert.notEqual(ordner[1], './data', `${dienst}: der Schlüssel liegt wieder in ./data`);
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
  const adresse = caddy.match(/ipv4_address:\s*(\S+)/)?.[1];
  assert.equal(adresse, '172.28.73.10', 'Caddy hat keine feste Adresse');
  assert.match(
    app,
    /^\s*TRUST_PROXY:\s*\$\{TRUST_PROXY:-172\.28\.73\.10\}\s*$/m,
    'TRUST_PROXY nennt ohne Angabe nicht genau Caddy',
  );
  const { proxyTrust } = require('./helpers/sources').buildAndRequire()('src/infra/proxyTrust.js');
  assert.deepEqual(proxyTrust(adresse), ['172.28.73.10'], 'geglaubt wird genau Caddy, kein ganzes Netz');
  const netz = compose.slice(compose.indexOf('\nnetworks:'));
  assert.match(netz, /subnet:\s*172\.28\.73\.0\/24/, 'brickinventory-net hat kein festes Subnetz');
  // The DOCKER-USER rule in UPGRADE.md (section 53) names exactly this network.
  const upgrade = fs.readFileSync(path.join(ROOT, 'UPGRADE.md'), 'utf8');
  const regel = upgrade.slice(upgrade.indexOf('## 53.'));
  assert.match(regel, /^N=172\.28\.73\.0\/24 /m, 'die LAN-Sperre in UPGRADE.md nennt ein anderes Netz');
  assert.match(regel, /iptables -I DOCKER-USER -s "\$N" -j BRICK-LAN/);
});

test('the app is only reachable via Caddy', () => {
  const app = readService(compose, 'app')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  assert.doesNotMatch(app, /^\s*ports:/m, 'die App veröffentlicht einen Port am Proxy vorbei');
  const caddy = readService(compose, 'caddy');
  assert.match(caddy, /:443:443"/);
  assert.match(caddy, /:80:80"/);
  assert.match(caddy, /^\s*dockerfile:\s*Dockerfile\.caddy\s*$/m, 'Caddy wird nicht aus Dockerfile.caddy gebaut');
  const basis = [...fs.readFileSync(path.join(ROOT, 'Dockerfile.caddy'), 'utf8').matchAll(/^FROM\s+(\S+)/gm)].map(
    m => m[1],
  );
  assert.ok(
    basis.length === 2 && basis.every(b => /^caddy:[\w.-]+@sha256:[0-9a-f]{64}$/.test(b)),
    `Caddy-Basis nicht per Digest: ${basis}`,
  );
  assert.match(app, /^\s*-\s*ca-wurzel:\/caddy-ca:ro\s*$/m, 'das Wurzelzertifikat ist nicht nur lesend eingehängt');
});

// Counter-checks (measured 09.11.2026, each alone): for caddy `user:` deleted →
// red “Caddy runs as root”; `sysctls` deleted → red “… ports below 1024”;
// in caddy-rechte 1000:1000 instead of 10443:10443 → red “… other identifier”;
// `- ./caddy/config:/config` deleted from caddy-rechte → red “… not handed over”;
// the dependency on caddy-rechte deleted → red “Caddy does not wait …”.
test('Caddy runs without root, caddy-rechte hands it its folders', () => {
  const caddy = readService(compose, 'caddy');
  const rechte = readService(compose, 'caddy-rechte');
  const kennung = caddy.match(/^\s*user:\s*"?(\d+):(\d+)"?\s*$/m);
  assert.ok(kennung && kennung[1] !== '0' && kennung[2] !== '0', 'Caddy läuft als root');
  assert.match(
    caddy,
    /^\s*sysctls:\s*\n\s*net\.ipv4\.ip_unprivileged_port_start:\s*0\s*$/m,
    'ohne root und ohne NET_BIND_SERVICE braucht Caddy die Ports unter 1024 freigegeben',
  );
  assert.match(
    caddy,
    /caddy-rechte:\s*\n\s*condition: service_completed_successfully/,
    'Caddy wartet nicht auf caddy-rechte',
  );

  assert.match(rechte, /^\s*network_mode:\s*none\s*$/m, 'caddy-rechte braucht kein Netz');
  assert.match(rechte, /^\s*read_only:\s*true\s*$/m);
  const ziel = `${kennung[1]}:${kennung[2]}`;
  const chown = [...rechte.matchAll(/chown (?:-R )?(\d+:\d+) ([^;\n]+)/g)];
  assert.ok(
    chown.length && chown.every(m => m[1] === ziel),
    `caddy-rechte übergibt an eine andere Kennung als ${ziel}`,
  );
  const passed = chown.flatMap(m => m[2].trim().split(/\s+/));
  // Every folder Caddy mounts (except the Caddyfile) is mounted there and belongs to it afterwards.
  const einh = block => [...block.matchAll(/^\s*-\s*([^\s:]+):(\/[^:\s]+)(:ro)?\s*$/gm)].map(m => `${m[1]}:${m[2]}`);
  const ordner = einh(caddy).filter(e => !e.endsWith(':/etc/caddy/Caddyfile'));
  assert.ok(ordner.length >= 4, `Caddys Ordner nicht gefunden: ${ordner}`);
  const fehlt = ordner.filter(e => !einh(rechte).includes(e) || !passed.some(u => e.endsWith(':' + u)));
  assert.deepEqual(fehlt, [], 'diese Orte hat caddy-rechte nicht übergeben');
});

test('Caddy: issuer from the start script, own request identifier, port 80 only redirects', () => {
  const datei = fs
    .readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  // Without default: if BRICK_TLS_AUSSTELLER is missing, the Caddyfile is invalid (ca-eigene-wurzel checks that with Caddy).
  assert.match(
    datei,
    /issuer \{\$BRICK_TLS_AUSSTELLER\} \{\s*\{\$BRICK_TLS_OPTIONEN\}\s*\}/,
    'der Aussteller hat eine Vorgabe',
  );
  assert.match(datei, /reverse_proxy app:3000 \{[^}]*header_up X-Request-Id \{http\.request\.uuid\}/);
  // /ca.crt also only over HTTPS (routes/certificate.ts says 403 over HTTP, tls-wurzel-db).
  assert.match(datei, /http:\/\/ \{\s*redir \{\$BRICK_BASE_URL\}\{uri\} 308\s*\}/, 'Port 80 leitet nicht nur um');
  assert.match(datei, /default_sni \{\$BRICK_HOST\}/);
});

test('no service has a substitute database password', () => {
  assert.doesNotMatch(compose, /\$\{DB_PASSWORD:-/, 'ein Dienst fällt auf ein Beispielpasswort zurück');
  assert.doesNotMatch(compose, /DB_APP_PASSWORD:-/, 'ein Dienst fällt auf ein Beispielpasswort zurück');
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
const geheimnisse = block =>
  (block.match(/^\s*secrets:\s*\[([^\]]*)\]/m)?.[1] ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .sort();
test('only postgres and db-rolle know the superuser, only migration the migration role, app and jobs the runtime role', () => {
  const dienste = ['postgres', 'db-rolle', 'app', 'jobs'];
  const withSuperuser = dienste.filter(d => geheimnisse(readService(compose, d)).includes('db_password'));
  assert.deepEqual(withSuperuser, ['postgres', 'db-rolle']);
  assert.deepEqual(
    geheimnisse(readService(compose, 'app')),
    ['db_app_password', 'db_system_web_password', 'session_secret'],
    'app kennt mehr als die Web-Systemrolle',
  );
  assert.deepEqual(
    geheimnisse(readService(compose, 'jobs')),
    ['db_app_password', 'db_system_password'],
    'jobs kennt das Passwort des Superusers',
  );
  for (const d of ['app', 'jobs']) {
    const block = readService(compose, d);
    assert.match(block, /^\s*PGUSER:\s*brickinventory_app\s*$/m, `${d} verbindet sich nicht als App-Rolle`);
    assert.match(
      block,
      /^\s*PGPASSWORD_FILE:\s*\/run\/secrets\/db_app_password\s*$/m,
      `${d}: PGPASSWORD_FILE nicht aus db_app_password`,
    );
    const rolle = d === 'app' ? 'system_web' : 'system';
    assert.match(
      block,
      new RegExp(`^\\s*PGSYSTEM_USER:\\s*brickinventory_${rolle}\\s*$`, 'm'),
      `${d} ohne Systemrolle`,
    );
    assert.match(block, new RegExp(`^\\s*PGSYSTEM_PASSWORD_FILE:\\s*/run/secrets/db_${rolle}_password\\s*$`, 'm'));
  }
  for (const d of ['postgres', 'db-rolle'])
    for (const rolle of ['system', 'system_web'])
      assert.match(
        readService(compose, d),
        new RegExp(`^\\s*DB_${rolle.toUpperCase()}_PASSWORD_FILE:\\s*/run/secrets/db_${rolle}_password\\s*$`, 'm'),
        `${d} legt die Rolle ${rolle} ohne Passwort an`,
      );
  assert.match(
    readService(compose, 'db-rolle'),
    /^\s*PGWEB_DB_PASSWORD_FILE:\s*\/run\/secrets\/pgweb_db_password\s*$/m,
    'db-rolle setzt das Passwort der Leserolle nicht',
  );
  for (const d of ['app', 'jobs'])
    assert.match(
      readService(compose, d),
      /depends_on:\s*\n\s*db-rolle:\s*\n\s*condition: service_completed_successfully/,
      `${d} wartet nicht auf db-rolle`,
    );
  const image = d => readService(compose, d).match(/^\s*image:\s*(\S+)\s*$/m)?.[1];
  assert.equal(image('db-rolle'), image('postgres'), 'db-rolle nimmt ein anderes Postgres-Image');

  // Only the migration service knows the migration role (owner); app and jobs only start after it.
  const withMigration = Object.keys({
    postgres: 1,
    'db-rolle': 1,
    migration: 1,
    app: 1,
    jobs: 1,
    schluessel: 1,
    'daten-rechte': 1,
  }).filter(d => geheimnisse(readService(compose, d)).includes('db_migration_password'));
  assert.deepEqual(
    withMigration,
    ['postgres', 'db-rolle', 'migration'],
    'ein Laufzeitdienst kennt das Passwort der Migrationsrolle',
  );
  const mig = readService(compose, 'migration');
  assert.deepEqual(geheimnisse(mig), ['db_migration_password']);
  assert.match(mig, /^\s*PGUSER:\s*brickinventory_migration\s*$/m);
  assert.match(mig, /^\s*PGPASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m);
  assert.match(mig, /^\s*entrypoint: \["node", "dist\/startup\/migrate\.js"\]\s*$/m);
  assert.equal(image('migration'), image('app'), 'migration nimmt ein anderes Image als app');
  const netze = mig
    .split(/\n\s*networks:\s*\n/)[1]
    ?.split('\n')
    .filter(z => /^\s+-\s/.test(z))
    .map(z => z.trim().slice(2));
  assert.deepEqual(netze, ['db-net'], 'migration braucht nur das interne Netz der Datenbank');
  for (const d of ['app', 'jobs'])
    assert.match(
      readService(compose, d),
      /depends_on:[\s\S]*?\n\s+migration:\s*\n\s*condition: service_completed_successfully/,
      `${d} wartet nicht auf migration`,
    );
  assert.match(
    readService(compose, 'db-rolle'),
    /^\s*DB_MIGRATION_PASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m,
  );
  assert.match(
    readService(compose, 'postgres'),
    /^\s*DB_MIGRATION_PASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m,
    'eine neue Datenbank bekommt die Migrationsrolle nicht beim Anlegen',
  );
  const rolle = readService(compose, 'db-rolle');
  assert.match(rolle, /^\s*entrypoint: \["sh", "\/rolle\/app-rolle\.sh"\]\s*$/m);
  assert.match(rolle, /^\s*-\s*\.\/postgres\/app-rolle\.sh:\/rolle\/app-rolle\.sh:ro\s*$/m);
  assert.match(
    readService(compose, 'postgres'),
    /^\s*-\s*\.\/postgres\/app-rolle\.sh:\/docker-entrypoint-initdb\.d\/10-app-rolle\.sh:ro\s*$/m,
    'eine neue Datenbank bekommt die Rolle nicht beim Anlegen',
  );
  assert.ok(
    fs.statSync(path.join(ROOT, 'postgres', 'app-rolle.sh')).mode & 0o111,
    'docker-entrypoint-initdb.d führt das Skript nur aus, wenn es ausführbar ist',
  );
});
