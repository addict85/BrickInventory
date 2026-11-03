/**
 * Die eigene Wurzel-CA (scripts/ca-einrichten.sh) gilt nur für BRICK_HOST,
 * ihr Schlüssel bleibt nicht liegen, und Caddy signiert mit der Zwischenstelle
 * nur, wenn ./caddy/ca eingerichtet ist; ohne bleibt alles wie bisher.
 * Geprüft mit openssl an echten Zertifikaten, das Startskript aus compose.yaml
 * läuft wirklich (sh, Pfade umgebogen). Ist ein Caddy da (CADDY_BIN oder
 * `caddy` im Pfad), startet er mit dem echten Caddyfile, und ein TLS-Client
 * prüft Kette und Wurzel; ohne Caddy wird nur dieser Teil übersprungen.
 *
 * Gegenproben (03.11.2026 gemessen, je einzeln):
 *   A  nameConstraints aus [wurzel] in ca-einrichten.sh gestrichen → rot:
 *      „auch ein gestohlener Wurzelschlüssel stellt nichts Fremdes aus“
 *   B  `excluded;IP:…` beim Namen gestrichen → rot: „ein Blatt für eine
 *      fremde Adresse scheitert an der Wurzel“ (das Blatt für 1.2.3.4 gilt)
 *   C  den Schlüssel der Wurzel nach $ORDNER kopiert → rot: „eine Wurzel für
 *      einen Namen …“ (root.key liegt neben den vier Dateien für Caddy)
 *   D  im Startskript die Abfrage auf /ca-eigen/zwischen.key gestrichen (immer
 *      Caddys CA) → rot: „mit eigener CA …“
 *   E  in zwischen-kette.crt die Wurzel weggelassen → rot: „kein Schlüssel der
 *      Wurzel …“ (Kette) und „Caddy liefert die Wurzel mit aus“ (lokal mit
 *      Caddy 2.11.0 aus `go install`; ohne Caddy nur die erste)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SKRIPT = path.join(ROOT, 'scripts', 'ca-einrichten.sh');
const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
const ossl = (...args) => spawnSync('openssl', args, { encoding: 'utf8' });

function einrichten(ordner, host, mehr = {}) {
  return spawnSync('sh', [SKRIPT, host], { encoding: 'utf8', cwd: path.dirname(ordner),
    env: { PATH: process.env.PATH, CA_ORDNER: ordner, ...mehr } });
}

/** Ein Blatt, das die Zwischenstelle (oder `stelle`) für `san` ausstellt; dann die Prüfung gegen die Wurzel. */
function blattGilt(ordner, san, stelle = { crt: `${ordner}/zwischen.crt`, key: `${ordner}/zwischen.key` }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blatt-'));
  try {
    ossl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', `${d}/b.key`);
    ossl('req', '-new', '-key', `${d}/b.key`, '-subj', '/CN=blatt', '-out', `${d}/b.csr`);
    fs.writeFileSync(`${d}/san.cnf`, `subjectAltName=${san}\n`);
    const x = ossl('x509', '-req', '-in', `${d}/b.csr`, '-CA', stelle.crt, '-CAkey', stelle.key,
      '-CAcreateserial', '-CAserial', `${d}/serial`, '-days', '1', '-extfile', `${d}/san.cnf`, '-out', `${d}/b.crt`);
    assert.equal(x.status, 0, x.stderr);
    const v = ossl('verify', '-CAfile', `${ordner}/root.crt`, '-untrusted', stelle.crt, `${d}/b.crt`);
    return v.status === 0;
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
}

const oeffentlich = (pem) => crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');

/** Das Skript hinter `command: [sh, -c, |]` von Caddy, wie Compose es übergibt ($$ → $). */
function caddySkript() {
  const z = compose.split('\n');
  const start = z.findIndex(l => /^ {2}caddy:\s*$/.test(l));
  const i = z.findIndex((l, j) => j > start && /^\s+- \|\s*$/.test(l));
  const rumpf = [];
  for (const l of z.slice(i + 1)) { if (!/^ {8}/.test(l)) break; rumpf.push(l.slice(8)); }
  return rumpf.join('\n').replace(/\$\$/g, '$');
}

test('openssl ist da', () => assert.equal(ossl('version').status, 0, 'ohne openssl lässt sich die CA nicht prüfen'));

test('eine Wurzel für einen Namen: nur dieser Name, keine IP-Adressen', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eigene-ca-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ordner = path.join(tmp, 'ca');
  const r = einrichten(ordner, 'nas.example.lan');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(ordner).sort(), ['root.crt', 'zwischen-kette.crt', 'zwischen.crt', 'zwischen.key']);
  assert.equal(fs.statSync(path.join(ordner, 'zwischen.key')).mode & 0o077, 0, 'der Schlüssel der Zwischenstelle ist für andere lesbar');

  await t.test('ein Blatt für eine fremde Adresse scheitert an der Wurzel', () => {
    assert.equal(blattGilt(ordner, 'DNS:nas.example.lan'), true, 'der eigene Name');
    assert.equal(blattGilt(ordner, 'DNS:www.bank.example'), false, 'ein fremder Name');
    assert.equal(blattGilt(ordner, 'IP:1.2.3.4'), false, 'eine IP-Adresse');
  });

  await t.test('kein Schlüssel der Wurzel im Ordner für Caddy', () => {
    const wurzel = oeffentlich(fs.readFileSync(path.join(ordner, 'root.crt')));
    for (const f of fs.readdirSync(ordner)) {
      const inhalt = fs.readFileSync(path.join(ordner, f), 'utf8');
      if (!/PRIVATE KEY/.test(inhalt)) continue;
      assert.equal(f, 'zwischen.key');
      assert.notEqual(oeffentlich(crypto.createPrivateKey(inhalt)), wurzel, `${f} ist der Schlüssel der Wurzel`);
    }
    const kette = fs.readFileSync(path.join(ordner, 'zwischen-kette.crt'), 'utf8').match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g);
    assert.deepEqual(kette.map(oeffentlich), [oeffentlich(fs.readFileSync(path.join(ordner, 'zwischen.crt'))), wurzel],
      'die Kette ist Zwischenstelle, dann Wurzel');
  });

  await t.test('eine vorhandene CA bleibt ohne NEU=1, der Wurzelschlüssel nur auf Wunsch', () => {
    const vorher = fs.readFileSync(path.join(ordner, 'root.crt'), 'utf8');
    const nochmal = einrichten(ordner, 'nas.example.lan');
    assert.notEqual(nochmal.status, 0);
    assert.equal(fs.readFileSync(path.join(ordner, 'root.crt'), 'utf8'), vorher);
    const ablage = path.join(tmp, 'wurzel.key');
    const neu = einrichten(ordner, 'nas.example.lan', { NEU: '1', WURZEL_SCHLUESSEL: ablage });
    assert.equal(neu.status, 0, neu.stderr);
    assert.equal(oeffentlich(crypto.createPrivateKey(fs.readFileSync(ablage))), oeffentlich(fs.readFileSync(path.join(ordner, 'root.crt'))));
  });

  await t.test('auch ein gestohlener Wurzelschlüssel stellt nichts Fremdes aus', () => {
    // Eine eigene Zwischenstelle ohne Einschränkung, signiert mit dem Schlüssel der Wurzel.
    const ablage = path.join(tmp, 'wurzel.key'), boese = { crt: path.join(tmp, 'boese.crt'), key: path.join(tmp, 'boese.key') };
    ossl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', boese.key);
    ossl('req', '-new', '-key', boese.key, '-subj', '/CN=boese', '-out', `${boese.crt}.csr`);
    fs.writeFileSync(`${boese.crt}.cnf`, 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n');
    const x = ossl('x509', '-req', '-in', `${boese.crt}.csr`, '-CA', path.join(ordner, 'root.crt'), '-CAkey', ablage,
      '-CAcreateserial', '-CAserial', `${boese.crt}.srl`, '-days', '1', '-extfile', `${boese.crt}.cnf`, '-out', boese.crt);
    assert.equal(x.status, 0, x.stderr);
    assert.equal(blattGilt(ordner, 'DNS:nas.example.lan', boese), true, 'Vorbedingung: die Kette selbst ist gültig');
    assert.equal(blattGilt(ordner, 'DNS:www.bank.example', boese), false, 'die Wurzel lässt einen fremden Namen zu');
    assert.equal(blattGilt(ordner, 'IP:1.2.3.4', boese), false, 'die Wurzel lässt eine IP-Adresse zu');
  });
});

test('eine Wurzel für eine IP-Adresse: nur diese Adresse', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eigene-ca-ip-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ordner = path.join(tmp, 'ca');
  const r = einrichten(ordner, '192.168.7.20');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(blattGilt(ordner, 'IP:192.168.7.20'), true);
  assert.equal(blattGilt(ordner, 'IP:192.168.7.21'), false);
  assert.equal(blattGilt(ordner, 'DNS:www.bank.example'), false);
});

test('das Startskript wählt die eigene CA nur, wenn sie eingerichtet ist', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-start-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const lauf = async (mitCa) => {
    const ort = fs.mkdtempSync(path.join(tmp, 'lauf-'));
    const daten = path.join(ort, 'data/caddy/pki/authorities/local'), eigen = path.join(ort, 'ca-eigen'), vol = path.join(ort, 'vol');
    for (const d of [daten, eigen, vol]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(daten, 'root.crt'), 'caddys wurzel\n');
    if (mitCa) { fs.writeFileSync(path.join(eigen, 'root.crt'), 'eigene wurzel\n'); fs.writeFileSync(path.join(eigen, 'zwischen.key'), 'k\n'); }
    const skript = caddySkript().replaceAll('/data/', `${ort}/data/`).replaceAll('/ca-wurzel', vol)
      .replaceAll('/ca-eigen/zwischen.key ]', `${eigen}/zwischen.key ]`).replaceAll('q=/ca-eigen/', `q=${eigen}/`)
      .replace(/exec caddy run .*/, `env > ${ort}/umgebung; exec sleep 60`);
    const p = spawn('sh', ['-c', skript], { detached: true, stdio: 'ignore' });
    for (let i = 0; i < 50 && !(fs.existsSync(`${vol}/root.crt`) && fs.existsSync(`${ort}/umgebung`)); i++) await new Promise(r => setTimeout(r, 100));
    try { process.kill(-p.pid, 'SIGKILL'); } catch { /* schon beendet */ }
    const umgebung = fs.readFileSync(`${ort}/umgebung`, 'utf8');
    return { wurzel: fs.readFileSync(`${vol}/root.crt`, 'utf8'), signieren: umgebung.match(/^BRICK_CA_SIGNIEREN=(.*)$/m)?.[1],
      eigen: umgebung.includes('BRICK_CA_EIGEN=') ? umgebung.slice(umgebung.indexOf('BRICK_CA_EIGEN=')).split('\n').slice(0, 7).join('\n') : null };
  };
  await t.test('ohne eigene CA wie bisher', async () => {
    assert.deepEqual(await lauf(false), { wurzel: 'caddys wurzel\n', signieren: undefined, eigen: null });
  });
  await t.test('mit eigener CA: Zwischenstelle signiert, die App bekommt die eigene Wurzel', async () => {
    assert.deepEqual(await lauf(true), { wurzel: 'eigene wurzel\n', signieren: 'ca local',
      eigen: 'BRICK_CA_EIGEN=root {\ncert /ca-eigen/root.crt\n}\nintermediate {\ncert /ca-eigen/zwischen-kette.crt\nkey /ca-eigen/zwischen.key\n}' });
  });
});

const CADDY = process.env.CADDY_BIN || (spawnSync('caddy', ['version']).status === 0 ? 'caddy' : null);

test('Caddy liefert die Wurzel mit aus', { skip: !CADDY && 'kein Caddy (CADDY_BIN)' }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-echt-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ordner = path.join(tmp, 'ca');
  assert.equal(einrichten(ordner, 'nas.example.lan').status, 0);
  const port = 20000 + (process.pid % 20000);
  const datei = fs.readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .replace('https://{$BRICK_HOST} {', `https://{$BRICK_HOST}:${port} {`).replace('http:// {', `http://:${port + 1} {`);
  fs.writeFileSync(path.join(tmp, 'Caddyfile'), datei);
  const starte = (mitCa) => spawn(CADDY, ['run', '--config', path.join(tmp, 'Caddyfile'), '--adapter', 'caddyfile'], {
    stdio: 'ignore', env: { PATH: process.env.PATH, XDG_DATA_HOME: path.join(tmp, mitCa ? 'd1' : 'd2'), XDG_CONFIG_HOME: path.join(tmp, 'c'),
      BRICK_HOST: 'nas.example.lan', BRICK_BASE_URL: 'https://nas.example.lan',
      ...(mitCa ? { BRICK_CA_SIGNIEREN: 'ca local', BRICK_CA_EIGEN:
        `root {\ncert ${ordner}/root.crt\n}\nintermediate {\ncert ${ordner}/zwischen-kette.crt\nkey ${ordner}/zwischen.key\n}` } : {}) } });
  const kette = async (ca) => {
    for (let i = 0; i < 100; i++) {
      const r = await new Promise((fertig) => {
        const s = tls.connect({ host: '127.0.0.1', port, servername: 'nas.example.lan', ca, rejectUnauthorized: !!ca }, () => {
          const liste = []; for (let c = s.getPeerCertificate(true); c && !liste.includes(c.fingerprint256); c = c.issuerCertificate) liste.push(c.fingerprint256);
          s.end(); fertig({ ok: s.authorized, liste });
        });
        s.on('error', () => fertig(null));
      });
      if (r) return r;
      await new Promise(r => setTimeout(r, 100));
    }
    return null;
  };
  const p1 = starte(true);
  try {
    const wurzel = fs.readFileSync(path.join(ordner, 'root.crt'));
    const r = await kette(wurzel);
    assert.ok(r, 'Caddy antwortet nicht');
    assert.equal(r.ok, true, 'der Client traut der Kette mit der eigenen Wurzel nicht');
    // Ohne `ca` baut der Client nichts dazu: Das ist die Kette, die Caddy sendet und die App pinnt.
    const gesendet = await kette(null);
    assert.equal(gesendet.liste.length, 3, 'Blatt, Zwischenstelle, Wurzel');
    assert.equal(gesendet.liste[2], new crypto.X509Certificate(wurzel).fingerprint256, 'die Wurzel steht in der Kette');
  } finally { p1.kill('SIGKILL'); }
  await new Promise(r => setTimeout(r, 300));
  const p2 = starte(false);
  try {
    const r = await kette(null);
    assert.ok(r, 'Caddy ohne eigene CA antwortet nicht');
    assert.equal(r.liste.length, 2, 'ohne eigene CA wie bisher: Blatt und Caddys Wurzel');
  } finally { p2.kill('SIGKILL'); }
});
