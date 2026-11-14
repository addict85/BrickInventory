/**
 * Die eigene Wurzel-CA (scripts/ca-einrichten.sh) gilt nur für BRICK_HOST,
 * ihr Schlüssel bleibt nicht liegen, und Caddy signiert mit der Zwischenstelle
 * nur, wenn ./caddy/ca eingerichtet ist; ohne startet Caddy nur mit
 * BRICK_TLS=acme oder ausdrücklich mit CA_OHNE_NAMENSBESCHRAENKUNG=ja. …
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
 *   F  (03.11.2026, kein stiller Rückfall) im Startskript den Zweig `else …
 *      exit 1` durch den Rückfall auf Caddys CA ersetzt → rot: „ohne eigene CA
 *      und ohne Schalter startet Caddy nicht“
 *   G  im Caddyfile `issuer {$BRICK_TLS_AUSSTELLER}` durch
 *      `issuer {$BRICK_TLS_AUSSTELLER:internal}` ersetzt → rot: „ohne
 *      Aussteller ist das Caddyfile ungültig“ (nur mit Caddy)
 *   I  in ca-einrichten.sh die Zeile „SHA-256 des Zertifikats …“ gestrichen →
 *      rot: „eine Wurzel für einen Namen …“
 *   J  bei acme `rm -f /ca-wurzel/root.crt` gestrichen → rot: „öffentlicher
 *      Name mit acme …“ (die alte Wurzel bleibt für /ca.crt)
 *   H  die Fingerabdruck-Zeile im Startskript gestrichen → rot: „… nennt den
 *      Fingerabdruck der Wurzel“
 *   K  (14.11.2026, lokal mit Caddy 2.11.8) `reuse_private_keys` im Caddyfile
 *      gestrichen → rot: „Caddy behält beim Erneuern den Schlüssel“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');

/** Ein Port, den gerade niemand belegt; aus der Prozessnummer abgeleitet traf es im parallelen CI-Lauf belegte. */
const freierPort = () =>
  new Promise(r => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port;
      s.close(() => r(p));
    });
  });

const ROOT = path.join(__dirname, '..');
const SKRIPT = path.join(ROOT, 'scripts', 'ca-einrichten.sh');
const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
const ossl = (...args) => spawnSync('openssl', args, { encoding: 'utf8' });

function einrichten(ordner, host, mehr = {}) {
  return spawnSync('sh', [SKRIPT, host], {
    encoding: 'utf8',
    cwd: path.dirname(ordner),
    env: { PATH: process.env.PATH, CA_ORDNER: ordner, ...mehr },
  });
}

/** Ein Blatt, das die Zwischenstelle (oder `stelle`) für `san` ausstellt; dann die Prüfung gegen die Wurzel. */
function blattGilt(ordner, san, stelle = { crt: `${ordner}/zwischen.crt`, key: `${ordner}/zwischen.key` }) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'blatt-'));
  try {
    ossl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', `${d}/b.key`);
    ossl('req', '-new', '-key', `${d}/b.key`, '-subj', '/CN=blatt', '-out', `${d}/b.csr`);
    fs.writeFileSync(`${d}/san.cnf`, `subjectAltName=${san}\n`);
    const x = ossl(
      'x509',
      '-req',
      '-in',
      `${d}/b.csr`,
      '-CA',
      stelle.crt,
      '-CAkey',
      stelle.key,
      '-CAcreateserial',
      '-CAserial',
      `${d}/serial`,
      '-days',
      '1',
      '-extfile',
      `${d}/san.cnf`,
      '-out',
      `${d}/b.crt`,
    );
    assert.equal(x.status, 0, x.stderr);
    const v = ossl('verify', '-CAfile', `${ordner}/root.crt`, '-untrusted', stelle.crt, `${d}/b.crt`);
    return v.status === 0;
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

const oeffentlich = pem => crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');

/** Das Skript hinter `command: [sh, -c, |]` von Caddy, wie Compose es übergibt ($$ → $). */
function caddySkript() {
  const z = compose.split('\n');
  const start = z.findIndex(l => /^ {2}caddy:\s*$/.test(l));
  const i = z.findIndex((l, j) => j > start && /^\s+- \|\s*$/.test(l));
  const rumpf = [];
  for (const l of z.slice(i + 1)) {
    if (!/^ {8}/.test(l)) break;
    rumpf.push(l.slice(8));
  }
  return rumpf.join('\n').replace(/\$\$/g, '$');
}

test('openssl ist da', () => assert.equal(ossl('version').status, 0, 'ohne openssl lässt sich die CA nicht prüfen'));

test('eine Wurzel für einen Namen: nur dieser Name, keine IP-Adressen', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eigene-ca-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ordner = path.join(tmp, 'ca');
  const r = einrichten(ordner, 'nas.example.lan');
  assert.equal(r.status, 0, r.stderr);
  // Derselbe Wert, den das Gerät beim Installieren und Caddy im Protokoll zeigt.
  const fp = new crypto.X509Certificate(fs.readFileSync(path.join(ordner, 'root.crt'))).fingerprint256;
  assert.match(r.stdout, new RegExp(`SHA-256 des Zertifikats zum Abgleich auf jedem Gerät: ${fp}$`, 'm'));
  assert.deepEqual(fs.readdirSync(ordner).sort(), ['root.crt', 'zwischen-kette.crt', 'zwischen.crt', 'zwischen.key']);
  assert.equal(
    fs.statSync(path.join(ordner, 'zwischen.key')).mode & 0o077,
    0,
    'der Schlüssel der Zwischenstelle ist für andere lesbar',
  );

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
    const kette = fs
      .readFileSync(path.join(ordner, 'zwischen-kette.crt'), 'utf8')
      .match(/-----BEGIN CERTIFICATE-----[^-]+-----END CERTIFICATE-----/g);
    assert.deepEqual(
      kette.map(oeffentlich),
      [oeffentlich(fs.readFileSync(path.join(ordner, 'zwischen.crt'))), wurzel],
      'die Kette ist Zwischenstelle, dann Wurzel',
    );
  });

  await t.test('eine vorhandene CA bleibt ohne NEU=1, der Wurzelschlüssel nur auf Wunsch', () => {
    const vorher = fs.readFileSync(path.join(ordner, 'root.crt'), 'utf8');
    const nochmal = einrichten(ordner, 'nas.example.lan');
    assert.notEqual(nochmal.status, 0);
    assert.equal(fs.readFileSync(path.join(ordner, 'root.crt'), 'utf8'), vorher);
    const ablage = path.join(tmp, 'wurzel.key');
    const neu = einrichten(ordner, 'nas.example.lan', { NEU: '1', WURZEL_SCHLUESSEL: ablage });
    assert.equal(neu.status, 0, neu.stderr);
    assert.equal(
      oeffentlich(crypto.createPrivateKey(fs.readFileSync(ablage))),
      oeffentlich(fs.readFileSync(path.join(ordner, 'root.crt'))),
    );
  });

  await t.test('auch ein gestohlener Wurzelschlüssel stellt nichts Fremdes aus', () => {
    // Eine eigene Zwischenstelle ohne Einschränkung, signiert mit dem Schlüssel der Wurzel.
    const ablage = path.join(tmp, 'wurzel.key'),
      boese = { crt: path.join(tmp, 'boese.crt'), key: path.join(tmp, 'boese.key') };
    ossl('genpkey', '-algorithm', 'EC', '-pkeyopt', 'ec_paramgen_curve:P-256', '-out', boese.key);
    ossl('req', '-new', '-key', boese.key, '-subj', '/CN=boese', '-out', `${boese.crt}.csr`);
    fs.writeFileSync(`${boese.crt}.cnf`, 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign\n');
    const x = ossl(
      'x509',
      '-req',
      '-in',
      `${boese.crt}.csr`,
      '-CA',
      path.join(ordner, 'root.crt'),
      '-CAkey',
      ablage,
      '-CAcreateserial',
      '-CAserial',
      `${boese.crt}.srl`,
      '-days',
      '1',
      '-extfile',
      `${boese.crt}.cnf`,
      '-out',
      boese.crt,
    );
    assert.equal(x.status, 0, x.stderr);
    assert.equal(blattGilt(ordner, 'DNS:nas.example.lan', boese), true, 'Vorbedingung: die Kette selbst ist gültig');
    assert.equal(blattGilt(ordner, 'DNS:www.bank.example', boese), false, 'die Wurzel lässt einen fremden Namen zu');
    assert.equal(blattGilt(ordner, 'IP:1.2.3.4', boese), false, 'die Wurzel lässt eine IP-Adresse zu');
  });
});

test('eine Wurzel für eine IP-Adresse: nur diese Adresse', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eigene-ca-ip-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ordner = path.join(tmp, 'ca');
  const r = einrichten(ordner, '192.168.7.20');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(blattGilt(ordner, 'IP:192.168.7.20'), true);
  assert.equal(blattGilt(ordner, 'IP:192.168.7.21'), false);
  assert.equal(blattGilt(ordner, 'DNS:www.bank.example'), false);
});

test('das Startskript wählt eigene CA, acme oder ausdrücklich Caddys CA — sonst startet Caddy nicht', async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-start-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const caddysWurzel = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'ca-wurzel-1.crt'), 'utf8');
  const lauf = async (mitCa, env = {}) => {
    const ort = fs.mkdtempSync(path.join(tmp, 'lauf-'));
    const daten = path.join(ort, 'data/caddy/pki/authorities/local'),
      eigen = path.join(ort, 'ca-eigen'),
      vol = path.join(ort, 'vol');
    for (const d of [daten, eigen, vol]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(daten, 'root.crt'), caddysWurzel);
    if (mitCa) {
      fs.writeFileSync(path.join(eigen, 'root.crt'), 'eigene wurzel\n');
      fs.writeFileSync(path.join(eigen, 'zwischen.key'), 'k\n');
    }
    // Wie nach einem Wechsel auf acme: Die Wurzel von früher liegt noch im Volume.
    if (env.BRICK_TLS === 'acme') fs.writeFileSync(path.join(vol, 'root.crt'), 'alte wurzel\n');
    const skript = caddySkript()
      .replaceAll('/data/', `${ort}/data/`)
      .replaceAll('/ca-wurzel', vol)
      .replaceAll('/ca-eigen/zwischen.key ]', `${eigen}/zwischen.key ]`)
      .replaceAll('q=/ca-eigen/', `q=${eigen}/`)
      .replace(/exec caddy run .*/, `env > ${ort}/umgebung; exec sleep 60`);
    const aus = fs.openSync(path.join(ort, 'aus'), 'w'),
      fehl = fs.openSync(path.join(ort, 'fehl'), 'w');
    const p = spawn('sh', ['-c', skript], {
      detached: true,
      stdio: ['ignore', aus, fehl],
      env: {
        PATH: process.env.PATH,
        BRICK_TLS: 'intern',
        CA_OHNE_NAMENSBESCHRAENKUNG: 'nein',
        VORGELAGERTER_PROXY: 'keiner',
        ...env,
      },
    });
    let beendet = null;
    p.on('exit', c => {
      beendet = c;
    });
    const fertig = () =>
      beendet !== null ||
      (fs.existsSync(`${ort}/umgebung`) &&
        (!mitCa && env.BRICK_TLS === 'acme' ? true : fs.existsSync(`${vol}/root.crt`)) &&
        /Fingerabdruck|^$/.test(fs.readFileSync(path.join(ort, 'aus'), 'utf8') || ''));
    for (let i = 0; i < 80 && !fertig(); i++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 200));
    try {
      process.kill(-p.pid, 'SIGKILL');
    } catch {
      /* schon beendet */
    }
    fs.closeSync(aus);
    fs.closeSync(fehl);
    const umgebung = fs.existsSync(`${ort}/umgebung`) ? fs.readFileSync(`${ort}/umgebung`, 'utf8') : null;
    const wert = n => umgebung?.match(new RegExp(`^${n}=(.*)$`, 'm'))?.[1];
    return {
      beendet,
      umgebung,
      stdout: fs.readFileSync(path.join(ort, 'aus'), 'utf8'),
      stderr: fs.readFileSync(path.join(ort, 'fehl'), 'utf8'),
      wurzel: fs.existsSync(`${vol}/root.crt`) ? fs.readFileSync(`${vol}/root.crt`, 'utf8') : null,
      aussteller: wert('BRICK_TLS_AUSSTELLER'),
      optionen: wert('BRICK_TLS_OPTIONEN'),
      eigen: umgebung?.includes('BRICK_CA_EIGEN=')
        ? umgebung.slice(umgebung.indexOf('BRICK_CA_EIGEN=')).split('\n').slice(0, 7).join('\n')
        : null,
    };
  };
  await t.test('ohne eigene CA und ohne Schalter startet Caddy nicht', async () => {
    const r = await lauf(false);
    assert.notEqual(r.beendet, null, 'das Skript läuft weiter');
    assert.notEqual(r.beendet, 0);
    assert.equal(r.umgebung, null, 'Caddy wurde gestartet');
    assert.equal(r.wurzel, null, 'die App bekommt Caddys unbeschränkte Wurzel');
    assert.match(r.stderr, /scripts\/ca-einrichten\.sh/);
    assert.match(r.stderr, /BRICK_TLS=acme/);
    assert.match(r.stderr, /CA_OHNE_NAMENSBESCHRAENKUNG=ja/);
  });
  await t.test('Caddys CA nur mit CA_OHNE_NAMENSBESCHRAENKUNG=ja, mit Warnung', async () => {
    const r = await lauf(false, { CA_OHNE_NAMENSBESCHRAENKUNG: 'ja' });
    assert.equal(r.beendet, null, r.stderr);
    assert.deepEqual([r.wurzel, r.aussteller, r.optionen, r.eigen], [caddysWurzel, 'internal', 'sign_with_root', null]);
    assert.match(r.stderr, /WARNUNG: Caddys eigene CA ohne Namensbeschränkung/);
  });
  await t.test('das Protokoll nennt den Fingerabdruck der Wurzel', async () => {
    const r = await lauf(false, { CA_OHNE_NAMENSBESCHRAENKUNG: 'ja' });
    const fp = new crypto.X509Certificate(caddysWurzel).fingerprint256;
    assert.match(
      r.stdout,
      new RegExp(`SHA-256-Fingerabdruck zum Abgleich auf dem Gerät: ${fp}$`, 'm'),
      r.stdout + r.stderr,
    );
  });
  await t.test('mit eigener CA: Zwischenstelle signiert, die App bekommt die eigene Wurzel', async () => {
    const r = await lauf(true);
    assert.deepEqual(
      [r.wurzel, r.aussteller, r.optionen, r.eigen],
      [
        'eigene wurzel\n',
        'internal',
        'ca local',
        'BRICK_CA_EIGEN=root {\ncert /ca-eigen/root.crt\n}\nintermediate {\ncert /ca-eigen/zwischen-kette.crt\nkey /ca-eigen/zwischen.key\n}',
      ],
    );
    assert.doesNotMatch(r.stderr, /WARNUNG/);
  });
  await t.test('öffentlicher Name mit acme: keine eigene CA nötig, keine Wurzel für die App', async () => {
    const r = await lauf(false, { BRICK_TLS: 'acme', ACME_EMAIL: 'betrieb@example.org' });
    assert.equal(r.beendet, null, r.stderr);
    assert.deepEqual([r.wurzel, r.aussteller, r.optionen], [null, 'acme', 'email betrieb@example.org']);
    const ohneMail = await lauf(false, { BRICK_TLS: 'acme' });
    assert.deepEqual([ohneMail.aussteller, ohneMail.optionen], ['acme', '']);
    const boese = await lauf(false, { BRICK_TLS: 'acme', ACME_EMAIL: 'a@b.ch }\n}\nhttp:// {' });
    assert.notEqual(boese.beendet, null);
    assert.equal(boese.umgebung, null, 'eine Adresse mit Caddyfile-Zeichen ging durch');
  });
});

const CADDY = process.env.CADDY_BIN || (spawnSync('caddy', ['version']).status === 0 ? 'caddy' : null);
// REQUIRE_CADDY=1 (CI): ein fehlender Caddy ist ein Fehler, kein stilles Überspringen.
if (!CADDY && process.env.REQUIRE_CADDY === '1') throw new Error('REQUIRE_CADDY=1, aber kein Caddy (CADDY_BIN)');

test('Caddy liefert die Wurzel mit aus', { skip: !CADDY && 'kein Caddy (CADDY_BIN)' }, async t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'caddy-echt-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const ordner = path.join(tmp, 'ca');
  assert.equal(einrichten(ordner, 'nas.example.lan').status, 0);
  const port = await freierPort(),
    port80 = await freierPort();
  const datei = fs
    .readFileSync(path.join(ROOT, 'Caddyfile'), 'utf8')
    .replace('https://{$BRICK_HOST} {', `https://{$BRICK_HOST}:${port} {`)
    .replace('http:// {', `http://:${port80} {`);
  fs.writeFileSync(path.join(tmp, 'Caddyfile'), datei);
  let protokoll = '';
  const starte = mitCa => {
    const p = spawn(CADDY, ['run', '--config', path.join(tmp, 'Caddyfile'), '--adapter', 'caddyfile'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        PATH: process.env.PATH,
        XDG_DATA_HOME: path.join(tmp, mitCa ? 'd1' : 'd2'),
        XDG_CONFIG_HOME: path.join(tmp, 'c'),
        BRICK_HOST: 'nas.example.lan',
        BRICK_BASE_URL: 'https://nas.example.lan',
        ...(mitCa
          ? {
              BRICK_TLS_AUSSTELLER: 'internal',
              BRICK_TLS_OPTIONEN: 'ca local',
              BRICK_CA_EIGEN: `root {\ncert ${ordner}/root.crt\n}\nintermediate {\ncert ${ordner}/zwischen-kette.crt\nkey ${ordner}/zwischen.key\n}`,
            }
          : { BRICK_TLS_AUSSTELLER: 'internal', BRICK_TLS_OPTIONEN: 'sign_with_root' }),
      },
    });
    p.stderr.on('data', d => {
      protokoll = (protokoll + d).slice(-3000);
    });
    return p;
  };
  // Unter Last (vier Testdateien parallel) braucht der erste Start mit eigener CA länger als 10 s.
  const kette = async ca => {
    for (let i = 0; i < 300; i++) {
      const r = await new Promise(fertig => {
        const s = tls.connect(
          { host: '127.0.0.1', port, servername: 'nas.example.lan', ca, rejectUnauthorized: !!ca },
          () => {
            const liste = [];
            for (let c = s.getPeerCertificate(true); c && !liste.includes(c.fingerprint256); c = c.issuerCertificate)
              liste.push(c.fingerprint256);
            s.end();
            fertig({ ok: s.authorized, liste });
          },
        );
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
    assert.ok(r, `Caddy antwortet nicht:\n${protokoll}`);
    assert.equal(r.ok, true, 'der Client traut der Kette mit der eigenen Wurzel nicht');
    // Ohne `ca` baut der Client nichts dazu: Das ist die Kette, die Caddy sendet und die App pinnt.
    const gesendet = await kette(null);
    assert.equal(gesendet.liste.length, 3, 'Blatt, Zwischenstelle, Wurzel');
    assert.equal(gesendet.liste[2], new crypto.X509Certificate(wurzel).fingerprint256, 'die Wurzel steht in der Kette');
  } finally {
    p1.kill('SIGKILL');
  }
  await new Promise(r => setTimeout(r, 300));
  const p2 = starte(false);
  try {
    const r = await kette(null);
    assert.ok(r, `Caddy ohne eigene CA antwortet nicht:\n${protokoll}`);
    assert.equal(r.liste.length, 2, 'mit CA_OHNE_NAMENSBESCHRAENKUNG=ja: Blatt und Caddys Wurzel');
  } finally {
    p2.kill('SIGKILL');
  }
});

test('ohne Aussteller ist das Caddyfile ungültig', { skip: !CADDY && 'kein Caddy (CADDY_BIN)' }, () => {
  const adapt = env =>
    spawnSync(CADDY, ['adapt', '--config', path.join(ROOT, 'Caddyfile'), '--adapter', 'caddyfile'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, BRICK_HOST: 'nas.example.lan', BRICK_BASE_URL: 'https://nas.example.lan', ...env },
    });
  const ohne = adapt({});
  assert.notEqual(ohne.status, 0, 'ohne Aussteller fällt Caddy auf eine Vorgabe zurück');
  for (const [aussteller, optionen, erwartet] of [
    ['internal', 'sign_with_root', { module: 'internal', sign_with_root: true }],
    ['internal', 'ca local', { module: 'internal', ca: 'local' }],
    ['acme', 'email a@example.org', { module: 'acme', email: 'a@example.org' }],
  ]) {
    const r = adapt({ BRICK_TLS_AUSSTELLER: aussteller, BRICK_TLS_OPTIONEN: optionen });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout).apps.tls.automation.policies, [
      { subjects: ['nas.example.lan'], issuers: [erwartet], reuse_private_keys: true },
    ]);
  }
});

test('Caddy behält beim Erneuern den Schlüssel', { skip: !CADDY && 'kein Caddy (CADDY_BIN)' }, () => {
  for (const aussteller of ['internal', 'acme']) {
    const r = spawnSync(CADDY, ['adapt', '--config', path.join(ROOT, 'Caddyfile'), '--adapter', 'caddyfile'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, BRICK_HOST: 'nas.example.lan', BRICK_TLS_AUSSTELLER: aussteller },
    });
    assert.equal(r.status, 0, r.stderr);
    const [politik] = JSON.parse(r.stdout).apps.tls.automation.policies;
    assert.equal(politik.reuse_private_keys, true, `${aussteller}: ein neuer Schlüssel je Erneuerung`);
  }
});
