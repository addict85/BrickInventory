/**
 * pgweb ist optional, nur lokal erreichbar und startet nicht von selbst mit.
 *
 * ── Warum es diesen Test gibt (Nachtrag 54) ─────────────────────────────────
 * Wer pgweb erreicht und sich anmeldet (PGWEB_PASSWORD), hat vollen Zugriff
 * auf die Datenbank — alle Konten, alle Sitzungen, alle Daten — und kann sie
 * ändern. Der Dienst ist damit die einzige Stelle im ganzen Aufbau, an der eine
 * einzige geänderte Zeile in compose.yaml die komplette Installation offenlegt:
 * Aus `127.0.0.1:8081:8081` wird beim Kopieren schnell `8081:8081`, und dann
 * hängt die Datenbank je nach Router am offenen Netz.
 *
 * Genau diese drei Eigenschaften hält der Test fest:
 *   1. Bindung an 127.0.0.1 — nur auf dem Server selbst erreichbar
 *   2. profiles: ["tools"] — `docker compose up -d` startet ihn NICHT mit
 *   3. kein Volume aus dem Projekt — pgweb braucht keinen Dateizugriff
 *
 * Der Test prüft die tatsächliche YAML-Struktur, nicht den Wortlaut: Eine
 * Prüfung auf Zeichenketten wäre hier zu leicht auszuhebeln (ein Kommentar mit
 * der richtigen Zeichenfolge genügte).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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
    if (/^  \S/.test(l) || /^\S/.test(l)) break;   // nächster Dienst / nächster Abschnitt
    block.push(l);
  }
  return block.join('\n');
}

const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');

test('pgweb ist im compose-File vorhanden', () => {
  assert.ok(leseDienst(compose, 'pgweb'), 'der Dienst pgweb fehlt');
});

test('pgweb hört NUR auf 127.0.0.1', () => {
  const block = leseDienst(compose, 'pgweb');
  const ports = [...block.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map(m => m[1])
    .filter(p => /:\d+$/.test(p) && p.includes(':'));
  assert.ok(ports.length > 0, 'pgweb veröffentlicht keinen Port — dann ist er nicht erreichbar');
  for (const p of ports) {
    assert.ok(p.startsWith('127.0.0.1:'),
      `Portangabe "${p}" bindet an ALLE Schnittstellen. pgweb gibt die ganze Datenbank heraus — ` +
      'damit stünde die ganze Datenbank offen. Zugriff von aussen gehört durch einen ' +
      'SSH-Tunnel, nicht durch eine offene Bindung');
  }
});

test('pgweb startet nicht bei `docker compose up`', () => {
  const block = leseDienst(compose, 'pgweb');
  assert.match(block, /profiles:\s*\[\s*"tools"\s*\]/,
    'ohne Profil liefe das Werkzeug dauerhaft mit — es soll nur auf Anforderung starten');
  // Gegenprobe im selben Test: Datenbank und App dürfen KEIN Profil haben,
  // sonst startet der normale Aufruf gar nichts mehr.
  for (const dienst of ['postgres', 'app']) {
    assert.doesNotMatch(leseDienst(compose, dienst), /profiles:/,
      `${dienst} darf kein Profil tragen — sonst startet "docker compose up -d" ihn nicht`);
  }
});

test('pgweb bekommt keinen Zugriff auf Projektdateien', () => {
  const block = leseDienst(compose, 'pgweb');
  assert.doesNotMatch(block, /^\s*volumes:/m,
    'pgweb braucht kein Volume — es spricht über das Netzwerk mit Postgres');
});

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
    .split(',').map(s => s.trim()).filter(Boolean);

test('kein Dienst gewinnt Rechte, jeder hat nur die nötigen Capabilities', () => {
  const erwartet = {
    postgres: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
    app:      ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID'],
    pgweb:    [],
    'db-rolle': [],
    caddy:    ['NET_BIND_SERVICE'],
  };
  for (const [dienst, caps] of Object.entries(erwartet)) {
    const block = leseDienst(compose, dienst);
    assert.match(block, /^\s*-\s*no-new-privileges:true\s*$/m, `${dienst}: no-new-privileges fehlt`);
    assert.deepEqual(liste(block, 'cap_drop'), ['ALL'], `${dienst}: cap_drop: [ALL] fehlt`);
    assert.deepEqual(liste(block, 'cap_add').sort(), caps, `${dienst}: unerwartete Capabilities`);
  }
});

test('die App schreibt nur in ./data und /tmp — der Entrypoint auch', () => {
  const block = leseDienst(compose, 'app');
  assert.match(block, /^\s*read_only:\s*true\s*$/m, 'app: read_only fehlt');
  assert.match(block, /^\s*tmpfs:\s*\n\s*-\s*\/tmp\s*$/m, 'app: /tmp als tmpfs fehlt');
  assert.match(block, /^\s*-\s*\.\/data:\/app\/data\s*$/m, 'app: ./data ist nicht nach /app/data eingehängt');

  const ep = fs.readFileSync(path.join(ROOT, 'docker-entrypoint.sh'), 'utf8')
    .split('\n').filter(z => !/^\s*#/.test(z)).join('\n');
  // Was der Entrypoint anlegt oder beschreibt: die mkdir-Ziele und die Marke.
  const mkdir = ep.slice(ep.indexOf('mkdir -p'), ep.indexOf('\n\n', ep.indexOf('mkdir -p')));
  const ziele = [...mkdir.matchAll(/\/\S+/g)].map(m => m[0]);
  ziele.push(ep.match(/^MARKE=(\S+)/m)?.[1]);
  assert.ok(ziele.length >= 5 && ziele.every(Boolean), `Ziele nicht gefunden: ${ziele}`);
  assert.deepEqual(ziele.filter(z => !z.startsWith('/app/data')), [],
    'Der Entrypoint schreibt ausserhalb der beschreibbaren Orte');
  assert.match(ep, /exec su-exec brickinv /, 'Der Wechsel zu brickinv (SETUID/SETGID) ist nicht mehr su-exec');
});

// Gegenproben (01.11.2026 gemessen): DATA_KEY_FILE bei jobs gestrichen → rot
// „jobs: DATA_KEY_FILE fehlt“; Pfad auf /app/data/.datenschluessel → rot „… ./data“.
test('der Datenschlüssel liegt für app und jobs ausserhalb von ./data', () => {
  for (const dienst of ['app', 'jobs']) {
    const block = leseDienst(compose, dienst);
    const datei = block.match(/^\s*DATA_KEY_FILE:\s*(\S+)\s*$/m)?.[1];
    assert.ok(datei, `${dienst}: DATA_KEY_FILE fehlt`);
    const ordner = [...block.matchAll(/^\s*-\s*(\.\/[^:\s]+):(\/[^:\s]+)(:ro)?\s*$/gm)].find(m => datei.startsWith(m[2] + '/'));
    assert.ok(ordner, `${dienst}: ${datei} liegt in keinem eingehängten Ordner`);
    assert.notEqual(ordner[1], './data', `${dienst}: der Schlüssel liegt wieder in ./data`);
  }
});

// Gegenproben (am 30.10.2026 gemessen): Vorgabe wieder `${TRUST_PROXY:-docker}` →
// rot „TRUST_PROXY vertraut genau Caddy …“; `ipam` am Netz entfernt → rot „… festes
// Subnetz“; pgweb wieder ohne Digest → rot „pgweb ist nicht per Digest …“;
// `sign_with_root` aus dem Caddyfile entfernt → rot „Caddy: …“; Port 3000 der
// App wieder veröffentlicht → rot „die App ist nur über Caddy erreichbar“.
test('TRUST_PROXY vertraut genau Caddy, das Netz hat ein festes Subnetz', () => {
  const app = leseDienst(compose, 'app');
  const caddy = leseDienst(compose, 'caddy');
  const adresse = caddy.match(/ipv4_address:\s*(\S+)/)?.[1];
  assert.equal(adresse, '172.28.73.10', 'Caddy hat keine feste Adresse');
  assert.match(app, /^\s*TRUST_PROXY:\s*\$\{TRUST_PROXY:-172\.28\.73\.10\}\s*$/m,
    'TRUST_PROXY nennt ohne Angabe nicht genau Caddy');
  const { proxyVertrauen } = require('./helpers/sources').buildAndRequire()('src/infra/proxyVertrauen.js');
  assert.deepEqual(proxyVertrauen(adresse), ['172.28.73.10'], 'geglaubt wird genau Caddy, kein ganzes Netz');
  const netz = compose.slice(compose.indexOf('\nnetworks:'));
  assert.match(netz, /subnet:\s*172\.28\.73\.0\/24/, 'brickinventory-net hat kein festes Subnetz');
});

test('die App ist nur über Caddy erreichbar', () => {
  const app = leseDienst(compose, 'app').split('\n').filter(z => !/^\s*#/.test(z)).join('\n');
  assert.doesNotMatch(app, /^\s*ports:/m, 'die App veröffentlicht einen Port am Proxy vorbei');
  const caddy = leseDienst(compose, 'caddy');
  assert.match(caddy, /:443:443"/);
  assert.match(caddy, /:80:80"/);
  assert.match(caddy, /^\s*image:\s*caddy:\S+@sha256:[0-9a-f]{64}\s*$/m, 'Caddy ist nicht per Digest festgelegt');
  assert.match(app, /^\s*-\s*ca-wurzel:\/caddy-ca:ro\s*$/m, 'das Wurzelzertifikat ist nicht nur lesend eingehängt');
});

test('Caddy: Aussteller aus dem Startskript, eigene Anfragekennung, /ca.crt im Klartext', () => {
  const datei = fs.readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .split('\n').filter(z => !/^\s*#/.test(z)).join('\n');
  // Ohne Vorgabe: Fehlt BRICK_TLS_AUSSTELLER, ist das Caddyfile ungültig (ca-eigene-wurzel prüft das mit Caddy).
  assert.match(datei, /issuer \{\$BRICK_TLS_AUSSTELLER\} \{\s*\{\$BRICK_TLS_OPTIONEN\}\s*\}/, 'der Aussteller hat eine Vorgabe');
  assert.match(datei, /reverse_proxy app:3000 \{[^}]*header_up X-Request-Id \{http\.request\.uuid\}/);
  assert.match(datei, /http:\/\/ \{[\s\S]*handle \/ca\.crt[\s\S]*redir /, 'Port 80 leitet nicht um');
  assert.match(datei, /default_sni \{\$BRICK_HOST\}/);
});

test('pgweb ist per Digest festgelegt, kein Dienst hat ein Ersatz-Datenbankpasswort', () => {
  assert.match(leseDienst(compose, 'pgweb'), /^\s*image:\s*\S+@sha256:[0-9a-f]{64}\s*$/m, 'pgweb ist nicht per Digest festgelegt');
  assert.doesNotMatch(compose, /\$\{DB_PASSWORD:-/, 'ein Dienst fällt auf ein Beispielpasswort zurück');
  assert.doesNotMatch(compose, /DB_APP_PASSWORD:-/, 'ein Dienst fällt auf ein Beispielpasswort zurück');
});

// Gegenproben (02.11.2026 gemessen): bei jobs die Abhängigkeit wieder auf
// postgres → rot „jobs wartet nicht auf db-rolle“; im Dienst db-rolle ein anderer
// Digest → rot „db-rolle nimmt ein anderes Postgres-Image“. (03.11.2026) bei jobs
// db_password unter secrets ergänzt → rot „jobs kennt das Passwort des
// Superusers“; bei app PGPASSWORD_FILE auf /run/secrets/db_password → rot
// „app: PGPASSWORD_FILE nicht aus db_app_password“.
const geheimnisse = (block) => (block.match(/^\s*secrets:\s*\[([^\]]*)\]/m)?.[1] ?? '')
  .split(',').map(x => x.trim()).filter(Boolean).sort();
test('nur postgres und db-rolle kennen den Superuser, App und Jobs die App-Rolle, pgweb die Leserolle', () => {
  const dienste = ['postgres', 'db-rolle', 'app', 'jobs', 'pgweb'];
  const mitSuperuser = dienste.filter(d => geheimnisse(leseDienst(compose, d)).includes('db_password'));
  assert.deepEqual(mitSuperuser, ['postgres', 'db-rolle']);
  assert.deepEqual(geheimnisse(leseDienst(compose, 'app')), ['db_app_password', 'session_secret']);
  assert.deepEqual(geheimnisse(leseDienst(compose, 'jobs')), ['db_app_password'], 'jobs kennt das Passwort des Superusers');
  assert.deepEqual(geheimnisse(leseDienst(compose, 'pgweb')), ['pgweb_db_password', 'pgweb_password'], 'pgweb kennt das Passwort der App-Rolle');
  for (const d of ['app', 'jobs']) {
    const block = leseDienst(compose, d);
    assert.match(block, /^\s*PGUSER:\s*brickinventory_app\s*$/m, `${d} verbindet sich nicht als App-Rolle`);
    assert.match(block, /^\s*PGPASSWORD_FILE:\s*\/run\/secrets\/db_app_password\s*$/m, `${d}: PGPASSWORD_FILE nicht aus db_app_password`);
  }
  assert.match(leseDienst(compose, 'db-rolle'), /^\s*PGWEB_DB_PASSWORD_FILE:\s*\/run\/secrets\/pgweb_db_password\s*$/m,
    'db-rolle setzt das Passwort der Leserolle nicht');
  for (const d of ['app', 'jobs', 'pgweb'])
    assert.match(leseDienst(compose, d), /depends_on:\s*\n\s*db-rolle:\s*\n\s*condition: service_completed_successfully/,
      `${d} wartet nicht auf db-rolle`);
  const image = d => leseDienst(compose, d).match(/^\s*image:\s*(\S+)\s*$/m)?.[1];
  assert.equal(image('db-rolle'), image('postgres'), 'db-rolle nimmt ein anderes Postgres-Image');
  const rolle = leseDienst(compose, 'db-rolle');
  assert.match(rolle, /^\s*entrypoint: \["sh", "\/rolle\/app-rolle\.sh"\]\s*$/m);
  assert.match(rolle, /^\s*-\s*\.\/postgres\/app-rolle\.sh:\/rolle\/app-rolle\.sh:ro\s*$/m);
  assert.match(leseDienst(compose, 'postgres'),
    /^\s*-\s*\.\/postgres\/app-rolle\.sh:\/docker-entrypoint-initdb\.d\/10-app-rolle\.sh:ro\s*$/m,
    'eine neue Datenbank bekommt die Rolle nicht beim Anlegen');
  assert.ok(fs.statSync(path.join(ROOT, 'postgres', 'app-rolle.sh')).mode & 0o111,
    'docker-entrypoint-initdb.d führt das Skript nur aus, wenn es ausführbar ist');
});

// Gegenproben (01.11.2026 gemessen, je einzeln): die Passwortprüfung im
// entrypoint gestrichen → rot „ohne PGWEB_PASSWORD startet pgweb nicht“;
// `--readonly` gestrichen → rot „… nur lesend“; (03.11.2026)
// `--lock-session` gestrichen → rot „… nur zur eigenen Datenbank“;
// (03.11.2026, Secrets) die Prüfung der Zeichen im Passwort der Leserolle
// gestrichen → rot „ein Passwort, das die Adresse sprengt, …“.
test('ohne Passwörter startet pgweb nicht, mit Passwort nur lesend und ohne Passwort in der Umgebung', (t) => {
  const block = leseDienst(compose, 'pgweb');
  assert.match(block, /^\s*PGWEB_AUTH_USER:\s*\$\{PGWEB_USER:-pgweb\}\s*$/m);
  assert.doesNotMatch(block, /PGWEB_AUTH_PASS:|PGWEB_DATABASE_URL:/, 'ein Passwort steht in der Umgebung des Dienstes');
  const z = block.split('\n');
  const i = z.findIndex(l => /^\s+- \|\s*$/.test(l));
  assert.ok(i > 0, 'entrypoint-Skript von pgweb nicht gefunden');
  const rumpf = [];
  for (const l of z.slice(i + 1)) { if (!/^ {8}/.test(l)) break; rumpf.push(l.slice(8)); }
  const ort = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pgweb-start-'));
  t.after(() => fs.rmSync(ort, { recursive: true, force: true }));
  // Wie Compose es übergibt ($$ → $); pgweb selbst durch ein Echo ersetzt, /run/secrets umgebogen.
  const skript = rumpf.join('\n').replace(/\$\$/g, '$').replaceAll('/run/secrets/', `${ort}/`);
  assert.match(skript, /exec \/usr\/bin\/pgweb /);
  const lauf = (pass, dbPass) => {
    for (const [n, w] of [['pgweb_password', pass], ['pgweb_db_password', dbPass]]) {
      fs.rmSync(path.join(ort, n), { force: true });
      if (w !== null) fs.writeFileSync(path.join(ort, n), w);
    }
    return spawnSync('sh', ['-c', skript.replace('exec /usr/bin/pgweb', 'echo "PGWEB $PGWEB_AUTH_PASS $PGWEB_DATABASE_URL"; echo PGWEB')],
      { encoding: 'utf8', env: { PATH: process.env.PATH, PGWEB_AUTH_USER: 'pgweb' } });
  };
  for (const [pass, db] of [[null, 'lesen'], ['', 'lesen'], ['geheim', ''], ['geheim', null]]) {
    const r = lauf(pass, db);
    assert.notEqual(r.status, 0, `ohne Passwörter startet pgweb nicht (${pass}/${db})`);
    assert.match(r.stderr, /geheimnisse-einrichten\.sh/);
    assert.doesNotMatch(r.stdout, /PGWEB/);
  }
  const boese = lauf('geheim', 'a@b/c');
  assert.notEqual(boese.status, 0, 'ein Passwort, das die Adresse sprengt, geht durch');
  const mit = lauf('geheim', 'abc123');
  assert.equal(mit.status, 0, mit.stderr);
  assert.match(mit.stdout, /^PGWEB geheim postgres:\/\/brickinventory_lesen:abc123@postgres:5432\/brickinventory\?sslmode=disable$/m);
  assert.match(mit.stdout, /^PGWEB .*--readonly/m, 'pgweb startet nur lesend');
  assert.match(mit.stdout, /^PGWEB .*--lock-session/m, 'pgweb verbindet nur zur eigenen Datenbank');
});

// Gegenproben (03.11.2026 gemessen, je einzeln): bei pgweb `read_only: true`
// gestrichen → rot „pgweb: read_only fehlt“; pgweb wieder in brickinventory-net
// → rot „pgweb hängt nur im eigenen Netz“; postgres ohne pgweb-net → rot
// „postgres fehlt im Netz von pgweb“.
test('pgweb läuft ohne root, nur lesend und in einem eigenen Netz nur mit postgres', () => {
  const block = leseDienst(compose, 'pgweb');
  assert.match(block, /^\s*user:\s*"1000:1000"\s*$/m, 'pgweb: kein fester Benutzer');
  assert.match(block, /^\s*read_only:\s*true\s*$/m, 'pgweb: read_only fehlt');
  assert.match(block, /^\s*tmpfs:\s*\n\s*-\s*\/tmp\s*$/m, 'pgweb: /tmp als tmpfs fehlt');
  const netze = (d) => {
    const z = leseDienst(compose, d).split('\n');
    const i = z.findIndex(l => /^\s{4}networks:\s*$/.test(l));
    const raus = [];
    for (const l of z.slice(i + 1)) { const m = l.match(/^\s{6}-\s*(\S+)\s*$/) || l.match(/^\s{6}(\S+):\s*$/); if (!m) break; raus.push(m[1]); }
    return raus.sort();
  };
  assert.deepEqual(netze('pgweb'), ['pgweb-net'], 'pgweb hängt nur im eigenen Netz');
  assert.ok(netze('postgres').includes('pgweb-net'), 'postgres fehlt im Netz von pgweb');
  for (const d of ['app', 'jobs', 'caddy', 'db-rolle']) assert.ok(!netze(d).includes('pgweb-net'), `${d} erreicht pgweb`);
});
