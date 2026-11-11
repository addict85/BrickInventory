/**
 * Härtung der Dienste in compose.yaml, gelesen als Struktur je Dienst:
 * Rechte, beschreibbare Orte, Netze, Geheimnisse und der Startbefehl von Caddy.
 *
 * Gegenproben stehen bei den einzelnen Prüfungen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/**
 * Minimaler YAML-Leser für genau diese Datei.
 *
 * Bewusst kein Paket dafür: js-yaml wäre eine neue Abhängigkeit für eine
 * einzige Prüfung. Gebraucht wird nur, was unter `services:` an
 * Diensten steht und welche Werte deren Schlüssel tragen.
 */
function leseDienst(yaml, name) {
  const zeilen = yaml.split('\n');
  const start = zeilen.findIndex(l => new RegExp(`^  ${name}:\\s*$`).test(l));
  if (start < 0) return null;
  const block = [];
  for (let i = start + 1; i < zeilen.length; i++) {
    const l = zeilen[i];
    if (/^\s*$/.test(l) || /^\s*#/.test(l)) continue;
    if (/^ {2}\S/.test(l) || /^\S/.test(l)) break; // nächster Dienst / nächster Abschnitt
    block.push(l);
  }
  return block.join('\n');
}

const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

// ── Härtung aller Dienste ─────────────────────────────────────────────────
//
// Docker ist hier nicht verfügbar; was der App-Entrypoint mit genau diesen
// Rechten tut, ist am 29.10.2026 mit setpriv nachgespielt worden (siehe
// Commit). Diese Prüfung hält fest, dass Liste und Entrypoint zusammenpassen.
//
// Gegenproben (am 29.10.2026 gemessen):
//   A  cap_drop beim Dienst app entfernt → rot: „app: cap_drop: [ALL] fehlt“
//   B  im Entrypoint ein Ziel /app/cache beim mkdir ergänzt → rot: „Der
//      Entrypoint schreibt ausserhalb der beschreibbaren Orte“
const liste = (block, schluessel) =>
  (block.match(new RegExp(`^\\s*${schluessel}:\\s*\\[([^\\]]*)\\]`, 'm'))?.[1] ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

test('kein Dienst gewinnt Rechte, jeder hat nur die nötigen Capabilities', () => {
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
    const block = leseDienst(compose, dienst);
    assert.match(block, /^\s*-\s*no-new-privileges:true\s*$/m, `${dienst}: no-new-privileges fehlt`);
    assert.deepEqual(liste(block, 'cap_drop'), ['ALL'], `${dienst}: cap_drop: [ALL] fehlt`);
    assert.deepEqual(liste(block, 'cap_add').sort(), caps, `${dienst}: unerwartete Capabilities`);
  }
});

test('die App schreibt nur in ./data und /tmp — daten-rechte auch', () => {
  const block = leseDienst(compose, 'app');
  assert.match(block, /^\s*read_only:\s*true\s*$/m, 'app: read_only fehlt');
  assert.match(block, /^\s*tmpfs:\s*\n\s*-\s*\/tmp:rw,noexec,nosuid,nodev,size=\d+m\s*$/m, 'app: /tmp als tmpfs fehlt');
  assert.match(block, /^\s*-\s*\.\/data:\/app\/data\s*$/m, 'app: ./data ist nicht nach /app/data eingehängt');

  const ep = fs
    .readFileSync(path.join(ROOT, 'daten-rechte.sh'), 'utf8')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  // Was der Entrypoint anlegt oder beschreibt: die mkdir-Ziele und die Marke.
  const mkdir = ep.slice(ep.indexOf('mkdir -p'), ep.indexOf('\n\n', ep.indexOf('mkdir -p')));
  const ziele = [...mkdir.matchAll(/\/\S+/g)].map(m => m[0]);
  ziele.push(ep.match(/^MARKE=(\S+)/m)?.[1]);
  assert.ok(ziele.length >= 5 && ziele.every(Boolean), `Ziele nicht gefunden: ${ziele}`);
  assert.deepEqual(
    ziele.filter(z => !z.startsWith('/app/data')),
    [],
    'daten-rechte schreibt ausserhalb der beschreibbaren Orte',
  );

  // Einmal ganz ausgeführt, /app/data im Sandkasten; id, su-exec und chown sind Ersatz.
  // Gegenprobe (11.11.2026 gemessen): `/app/data/images/sets \` aus der mkdir-Liste
  // gestrichen → rot „daten-rechte legt nicht an, was der Server braucht“.
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

// Gegenproben (11.11.2026 gemessen, je einzeln): bei jobs `user: brickinv`
// gestrichen → rot „jobs läuft als root“; bei daten-rechte `- ./schluessel:/app/schluessel`
// ergänzt → rot „daten-rechte sieht mehr als ./data“; `network_mode: none` dort
// gestrichen → rot „daten-rechte braucht kein Netz“; bei app die Abhängigkeit
// auf daten-rechte gestrichen → rot „app wartet nicht auf daten-rechte“.
test('root richtet ./data nur im Dienst daten-rechte ein, app und jobs laufen als brickinv', t => {
  // Wie Docker die Datei liest (Interpolation, Kurzschreibweisen), nicht per Regex.
  const r = require('node:child_process').spawnSync(
    'docker',
    ['compose', '-f', path.join(ROOT, 'compose.yaml'), 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        BRICK_HOST: 'nas.lan',
        BRICK_IMAGE: 'brickinventory:probe',
        CADDY_IMAGE: 'brickinventory-caddy:probe',
      },
    },
  );
  if (r.error || r.status !== 0) {
    if (process.env.CI) assert.fail(`docker compose config im CI-Lauf: ${r.error?.message || r.stderr}`);
    t.skip('kein docker compose');
    return;
  }
  const { services: d } = JSON.parse(r.stdout);
  const rechte = d['daten-rechte'];
  assert.ok(rechte, 'Dienst daten-rechte fehlt');
  assert.equal(rechte.user, 'root');
  assert.equal(rechte.network_mode, 'none', 'daten-rechte braucht kein Netz');
  assert.equal(rechte.read_only, true);
  assert.deepEqual(rechte.entrypoint, ['sh', '/app/daten-rechte.sh']);
  // Nur ./data: Ein Symlink des Dienstes darf root zu nichts anderem führen.
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

// Gegenproben (01.11.2026 gemessen): DATA_KEY_FILE bei jobs gestrichen → rot
// „jobs: DATA_KEY_FILE fehlt“; Pfad auf /app/data/.datenschluessel → rot „… ./data“.
test('der Datenschlüssel liegt für app und jobs ausserhalb von ./data', () => {
  for (const dienst of ['app', 'jobs']) {
    const block = leseDienst(compose, dienst);
    const datei = block.match(/^\s*DATA_KEY_FILE:\s*(\S+)\s*$/m)?.[1];
    assert.ok(datei, `${dienst}: DATA_KEY_FILE fehlt`);
    const ordner = [...block.matchAll(/^\s*-\s*(\.\/[^:\s]+):(\/[^:\s]+)(:ro)?\s*$/gm)].find(m =>
      datei.startsWith(m[2] + '/'),
    );
    assert.ok(ordner, `${dienst}: ${datei} liegt in keinem eingehängten Ordner`);
    assert.notEqual(ordner[1], './data', `${dienst}: der Schlüssel liegt wieder in ./data`);
  }
});

// Gegenproben (am 30.10.2026 gemessen): Vorgabe wieder `${TRUST_PROXY:-docker}` →
// rot „TRUST_PROXY vertraut genau Caddy …“; `ipam` am Netz entfernt → rot „… festes
// Subnetz“;
// `sign_with_root` aus dem Caddyfile entfernt → rot „Caddy: …“; Port 3000 der
// App wieder veröffentlicht → rot „die App ist nur über Caddy erreichbar“.
// (11.11.2026) in UPGRADE.md Abschnitt 53 `N=172.28.0.0/16` → rot „die LAN-Sperre
// in UPGRADE.md nennt ein anderes Netz“.
test('TRUST_PROXY vertraut genau Caddy, das Netz hat ein festes Subnetz', () => {
  const app = leseDienst(compose, 'app');
  const caddy = leseDienst(compose, 'caddy');
  const adresse = caddy.match(/ipv4_address:\s*(\S+)/)?.[1];
  assert.equal(adresse, '172.28.73.10', 'Caddy hat keine feste Adresse');
  assert.match(
    app,
    /^\s*TRUST_PROXY:\s*\$\{TRUST_PROXY:-172\.28\.73\.10\}\s*$/m,
    'TRUST_PROXY nennt ohne Angabe nicht genau Caddy',
  );
  const { proxyVertrauen } = require('./helpers/sources').buildAndRequire()('src/infra/proxyVertrauen.js');
  assert.deepEqual(proxyVertrauen(adresse), ['172.28.73.10'], 'geglaubt wird genau Caddy, kein ganzes Netz');
  const netz = compose.slice(compose.indexOf('\nnetworks:'));
  assert.match(netz, /subnet:\s*172\.28\.73\.0\/24/, 'brickinventory-net hat kein festes Subnetz');
  // Die DOCKER-USER-Regel in UPGRADE.md (Abschnitt 53) nennt genau dieses Netz.
  const upgrade = fs.readFileSync(path.join(ROOT, 'UPGRADE.md'), 'utf8');
  const regel = upgrade.slice(upgrade.indexOf('## 53.'));
  assert.match(regel, /^N=172\.28\.73\.0\/24 /m, 'die LAN-Sperre in UPGRADE.md nennt ein anderes Netz');
  assert.match(regel, /iptables -I DOCKER-USER -s "\$N" -j BRICK-LAN/);
});

test('die App ist nur über Caddy erreichbar', () => {
  const app = leseDienst(compose, 'app')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  assert.doesNotMatch(app, /^\s*ports:/m, 'die App veröffentlicht einen Port am Proxy vorbei');
  const caddy = leseDienst(compose, 'caddy');
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

// Gegenproben (09.11.2026 gemessen, je einzeln): bei caddy `user:` gestrichen →
// rot „Caddy läuft als root“; `sysctls` gestrichen → rot „… Ports unter 1024“;
// in caddy-rechte 1000:1000 statt 10443:10443 → rot „… andere Kennung“;
// `- ./caddy/config:/config` aus caddy-rechte gestrichen → rot „… nicht übergeben“;
// die Abhängigkeit auf caddy-rechte gestrichen → rot „Caddy wartet nicht …“.
test('Caddy läuft ohne root, caddy-rechte übergibt ihm seine Ordner', () => {
  const caddy = leseDienst(compose, 'caddy');
  const rechte = leseDienst(compose, 'caddy-rechte');
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
  const uebergeben = chown.flatMap(m => m[2].trim().split(/\s+/));
  // Jeder Ordner, den Caddy einhängt (ausser dem Caddyfile), ist dort eingehängt und gehört danach ihm.
  const einh = block => [...block.matchAll(/^\s*-\s*([^\s:]+):(\/[^:\s]+)(:ro)?\s*$/gm)].map(m => `${m[1]}:${m[2]}`);
  const ordner = einh(caddy).filter(e => !e.endsWith(':/etc/caddy/Caddyfile'));
  assert.ok(ordner.length >= 4, `Caddys Ordner nicht gefunden: ${ordner}`);
  const fehlt = ordner.filter(e => !einh(rechte).includes(e) || !uebergeben.some(u => e.endsWith(':' + u)));
  assert.deepEqual(fehlt, [], 'diese Orte hat caddy-rechte nicht übergeben');
});

test('Caddy: Aussteller aus dem Startskript, eigene Anfragekennung, /ca.crt im Klartext', () => {
  const datei = fs
    .readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .split('\n')
    .filter(z => !/^\s*#/.test(z))
    .join('\n');
  // Ohne Vorgabe: Fehlt BRICK_TLS_AUSSTELLER, ist das Caddyfile ungültig (ca-eigene-wurzel prüft das mit Caddy).
  assert.match(
    datei,
    /issuer \{\$BRICK_TLS_AUSSTELLER\} \{\s*\{\$BRICK_TLS_OPTIONEN\}\s*\}/,
    'der Aussteller hat eine Vorgabe',
  );
  assert.match(datei, /reverse_proxy app:3000 \{[^}]*header_up X-Request-Id \{http\.request\.uuid\}/);
  assert.match(
    datei,
    /http:\/\/ \{[\s\S]*@wurzel \{\s*method GET HEAD\s*path \/ca\.crt\s*\}\s*handle @wurzel[\s\S]*redir /,
    'Port 80 liefert nur GET/HEAD /ca.crt und leitet sonst um',
  );
  assert.match(datei, /default_sni \{\$BRICK_HOST\}/);
});

test('kein Dienst hat ein Ersatz-Datenbankpasswort', () => {
  assert.doesNotMatch(compose, /\$\{DB_PASSWORD:-/, 'ein Dienst fällt auf ein Beispielpasswort zurück');
  assert.doesNotMatch(compose, /DB_APP_PASSWORD:-/, 'ein Dienst fällt auf ein Beispielpasswort zurück');
});

// Gegenproben (02.11.2026 gemessen): bei jobs die Abhängigkeit wieder auf
// postgres → rot „jobs wartet nicht auf db-rolle“; im Dienst db-rolle ein anderer
// Digest → rot „db-rolle nimmt ein anderes Postgres-Image“. (03.11.2026) bei jobs
// db_password unter secrets ergänzt → rot „jobs kennt das Passwort des
// Superusers“; bei app PGPASSWORD_FILE auf /run/secrets/db_password → rot
// „app: PGPASSWORD_FILE nicht aus db_app_password“. (11.11.2026) bei jobs die
// Abhängigkeit auf migration gestrichen → rot „jobs wartet nicht auf migration“;
// migration zusätzlich in brickinventory-net → rot „migration braucht nur das
// interne Netz …“; schluessel bekommt db_migration_password → rot „ein
// Laufzeitdienst kennt das Passwort der Migrationsrolle“.
const geheimnisse = block =>
  (block.match(/^\s*secrets:\s*\[([^\]]*)\]/m)?.[1] ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .sort();
test('nur postgres und db-rolle kennen den Superuser, nur migration die Migrationsrolle, App und Jobs die Laufzeitrolle', () => {
  const dienste = ['postgres', 'db-rolle', 'app', 'jobs'];
  const mitSuperuser = dienste.filter(d => geheimnisse(leseDienst(compose, d)).includes('db_password'));
  assert.deepEqual(mitSuperuser, ['postgres', 'db-rolle']);
  assert.deepEqual(geheimnisse(leseDienst(compose, 'app')), ['db_app_password', 'session_secret']);
  assert.deepEqual(
    geheimnisse(leseDienst(compose, 'jobs')),
    ['db_app_password'],
    'jobs kennt das Passwort des Superusers',
  );
  for (const d of ['app', 'jobs']) {
    const block = leseDienst(compose, d);
    assert.match(block, /^\s*PGUSER:\s*brickinventory_app\s*$/m, `${d} verbindet sich nicht als App-Rolle`);
    assert.match(
      block,
      /^\s*PGPASSWORD_FILE:\s*\/run\/secrets\/db_app_password\s*$/m,
      `${d}: PGPASSWORD_FILE nicht aus db_app_password`,
    );
  }
  assert.match(
    leseDienst(compose, 'db-rolle'),
    /^\s*PGWEB_DB_PASSWORD_FILE:\s*\/run\/secrets\/pgweb_db_password\s*$/m,
    'db-rolle setzt das Passwort der Leserolle nicht',
  );
  for (const d of ['app', 'jobs'])
    assert.match(
      leseDienst(compose, d),
      /depends_on:\s*\n\s*db-rolle:\s*\n\s*condition: service_completed_successfully/,
      `${d} wartet nicht auf db-rolle`,
    );
  const image = d => leseDienst(compose, d).match(/^\s*image:\s*(\S+)\s*$/m)?.[1];
  assert.equal(image('db-rolle'), image('postgres'), 'db-rolle nimmt ein anderes Postgres-Image');

  // Die Migrationsrolle (Eigentümerin) kennt nur der Dienst migration; app und jobs starten erst nach ihm.
  const mitMigration = Object.keys({
    postgres: 1,
    'db-rolle': 1,
    migration: 1,
    app: 1,
    jobs: 1,
    schluessel: 1,
    'daten-rechte': 1,
  }).filter(d => geheimnisse(leseDienst(compose, d)).includes('db_migration_password'));
  assert.deepEqual(
    mitMigration,
    ['postgres', 'db-rolle', 'migration'],
    'ein Laufzeitdienst kennt das Passwort der Migrationsrolle',
  );
  const mig = leseDienst(compose, 'migration');
  assert.deepEqual(geheimnisse(mig), ['db_migration_password']);
  assert.match(mig, /^\s*PGUSER:\s*brickinventory_migration\s*$/m);
  assert.match(mig, /^\s*PGPASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m);
  assert.match(mig, /^\s*entrypoint: \["node", "dist\/startup\/migrieren\.js"\]\s*$/m);
  assert.equal(image('migration'), image('app'), 'migration nimmt ein anderes Image als app');
  const netze = mig
    .split(/\n\s*networks:\s*\n/)[1]
    ?.split('\n')
    .filter(z => /^\s+-\s/.test(z))
    .map(z => z.trim().slice(2));
  assert.deepEqual(netze, ['db-net'], 'migration braucht nur das interne Netz der Datenbank');
  for (const d of ['app', 'jobs'])
    assert.match(
      leseDienst(compose, d),
      /depends_on:[\s\S]*?\n\s+migration:\s*\n\s*condition: service_completed_successfully/,
      `${d} wartet nicht auf migration`,
    );
  assert.match(
    leseDienst(compose, 'db-rolle'),
    /^\s*DB_MIGRATION_PASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m,
  );
  assert.match(
    leseDienst(compose, 'postgres'),
    /^\s*DB_MIGRATION_PASSWORD_FILE:\s*\/run\/secrets\/db_migration_password\s*$/m,
    'eine neue Datenbank bekommt die Migrationsrolle nicht beim Anlegen',
  );
  const rolle = leseDienst(compose, 'db-rolle');
  assert.match(rolle, /^\s*entrypoint: \["sh", "\/rolle\/app-rolle\.sh"\]\s*$/m);
  assert.match(rolle, /^\s*-\s*\.\/postgres\/app-rolle\.sh:\/rolle\/app-rolle\.sh:ro\s*$/m);
  assert.match(
    leseDienst(compose, 'postgres'),
    /^\s*-\s*\.\/postgres\/app-rolle\.sh:\/docker-entrypoint-initdb\.d\/10-app-rolle\.sh:ro\s*$/m,
    'eine neue Datenbank bekommt die Rolle nicht beim Anlegen',
  );
  assert.ok(
    fs.statSync(path.join(ROOT, 'postgres', 'app-rolle.sh')).mode & 0o111,
    'docker-entrypoint-initdb.d führt das Skript nur aus, wenn es ausführbar ist',
  );
});
