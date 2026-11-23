/**
 * Without port 465 the mailer demands STARTTLS: if the mail server does not offer it,
 * sending aborts before AUTH instead of sending password and reset link in
 * plain text. Checked against an SMTP server in the test that records every line
 * — once without STARTTLS, once with it (self-signed, PEM).
 *
 * Counter-checks (measured 01.11.2026):
 *   A  `requireTLS: !secure` removed → red: “without STARTTLS …” (AUTH PLAIN with
 *      password and the mail stand in the plaintext recording)
 *   B  `minVersion: 'TLSv1.2'` removed → red: “TLS 1.1 is rejected …”
 *      (delivery via TLSv1.1 if the process allows older versions)
 *   C  in getTransporter() `mailServerAddress(ip)` replaced by `true` → red:
 *      “a name that resolves to a blocked address …” (11.11.2026)
 *   D  in getTransporter() again `host` instead of the checked address to
 *      nodemailer → red: “… the connection goes to the checked address”
 *      (nodemailer resolved itself and reached 127.0.0.2 instead of 127.0.0.1)
 *
 * Prerequisite: test DB via TEST_DATABASE_URL, openssl in the path.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATA_KEY = Buffer.alloc(32, 11).toString('base64');

const { buildAndRequire, testData } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const { testServer, portOf } = require('./helpers/server');
const { adminWithFactor } = require('./helpers/admin');
const db = testData();
const mailer = _req('src/mail/mailer.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

/** Plaintext SMTP; with `tlsOpt` it offers STARTTLS. Every line lands in the recording with its layer. */
function smtpServer(tlsOpt) {
  const recording = [],
    post = [];
  const srv = net.createServer(raw => {
    raw.on('error', () => {});
    raw.write('220 test ESMTP\r\n');
    const operate = (s, layer) => {
      let buffer = '',
        data = null;
      s.on('data', b => {
        buffer += b.toString('latin1');
        for (let i = buffer.indexOf('\r\n'); i >= 0; i = buffer.indexOf('\r\n')) {
          const row = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          recording.push({ layer, row });
          if (data !== null) {
            if (row === '.') {
              post.push(data);
              data = null;
              s.write('250 angenommen\r\n');
            } else data += row + '\n';
            continue;
          }
          const command = row.slice(0, 8).toUpperCase();
          if (command.startsWith('EHLO'))
            s.write(`250-test\r\n${tlsOpt && layer === 'klar' ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`);
          else if (command === 'STARTTLS') {
            if (!tlsOpt) {
              s.write('502 nicht angeboten\r\n');
              continue;
            }
            s.removeAllListeners('data');
            s.write('220 los\r\n', () => {
              const sicher = new tls.TLSSocket(s, { isServer: true, ...tlsOpt });
              sicher.on('error', () => {});
              operate(sicher, 'tls');
            });
            return;
          } else if (command.startsWith('AUTH')) s.write('235 ok\r\n');
          else if (command.startsWith('DATA')) {
            data = '';
            s.write('354 weiter\r\n');
          } else if (command.startsWith('QUIT')) s.end('221 bye\r\n');
          else s.write('250 ok\r\n');
        }
      });
    };
    operate(raw, 'klar');
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, recording, post, port: portOf(srv) })));
}

test('SMTP without port 465 only with STARTTLS', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;

  const KEY = [
    'smtp_host',
    'smtp_port',
    'smtp_user',
    'smtp_pass',
    'smtp_secure',
    'smtp_from',
    'smtp_tls_ca',
    'smtp_tls_fingerprint',
  ];
  const prior = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [KEY]);
  const CHEF = `starttls_${process.pid}`,
    PASS = 'Starttls-Pruefung-1';
  await db.run('DELETE FROM users WHERE username = $1', [CHEF]);
  const uid = (
    await db.get(
      `INSERT INTO users (username, password_hash, is_admin, is_active, email_verified, email)
    VALUES ($1, $2, true, true, true, 'chef@example.org') RETURNING id`,
      [CHEF, bcrypt.hashSync(PASS, 4)],
    )
  ).id;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-starttls-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-nodes',
      '-keyout',
      path.join(dir, 'k.pem'),
      '-out',
      path.join(dir, 'c.pem'),
      '-days',
      '2',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const cert = {
    key: fs.readFileSync(path.join(dir, 'k.pem')),
    cert: fs.readFileSync(path.join(dir, 'c.pem'), 'utf8'),
  };
  const without = await smtpServer(null),
    withIt = await smtpServer(cert);
  const alt = await smtpServer({ ...cert, minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' });
  t.after(async () => {
    for (const s of [without, withIt, alt]) s.srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [KEY]);
    for (const z of prior) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const put = async values => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [KEY]);
    const all = {
      smtp_host: '127.0.0.1',
      smtp_user: 'postfach',
      smtp_pass: 'Geheim-Smtp-9',
      smtp_secure: '0',
      smtp_from: 'test@example.org',
      ...values,
    };
    for (const [k, v] of Object.entries(all))
      await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [k, String(v)]);
    await _req('src/settings/settings.js').reencryptLegacyGlobalValues();
  };
  const LINK = 'https://brick.example/reset?token=abcdef0123';

  await t.test('without STARTTLS sending aborts before AUTH', async () => {
    await put({ smtp_port: without.port });
    const r = await mailer.sendMail({ to: 'ziel@example.org', subject: 'Rücksetzen', text: LINK });
    assert.equal(r.success, false);
    assert.match(r.error, /kein STARTTLS/);
    const lines = without.recording.map(z => z.row);
    assert.ok(
      lines.some(z => /^EHLO/i.test(z)),
      'The mailer did not reach the server at all',
    );
    assert.deepEqual(
      lines.filter(z => /^(AUTH|MAIL FROM|DATA)/i.test(z) || z.includes('token=')),
      [],
    );
    assert.equal(without.post.length, 0);
  });

  await t.test('the mail test in the settings takes the same path', async () => {
    await put({ smtp_port: without.port });
    const beforeRows = without.recording.length;
    assert.equal((await mailer.testSmtp()).code, 'smtp_error');
    await adminWithFactor(_req, uid);
    const { base } = testServer(_req, { session: { userId: uid, isAdmin: true }, t });
    const r = await fetch(`${base}/api/v2/settings/smtp-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /kein STARTTLS/);
    assert.deepEqual(
      without.recording.slice(beforeRows).filter(z => /^AUTH/i.test(z.row)),
      [],
    );
  });

  await t.test('with STARTTLS AUTH only goes over the encrypted connection', async () => {
    await put({ smtp_port: withIt.port, smtp_tls_ca: cert.cert });
    const r = await mailer.sendMail({ to: 'ziel@example.org', subject: 'Rücksetzen', text: LINK });
    assert.equal(r.success, true, r.error);
    assert.equal(withIt.post.length, 1);
    assert.deepEqual(
      withIt.recording.filter(z => z.layer === 'klar').map(z => z.row.split(' ')[0].toUpperCase()),
      ['EHLO', 'STARTTLS'],
    );
    assert.ok(withIt.recording.some(z => z.layer === 'tls' && /^AUTH PLAIN/i.test(z.row)));
  });

  await t.test('TLS 1.1 is rejected, even if the process would allow it', async () => {
    const beforeMin = tls.DEFAULT_MIN_VERSION,
      beforeCiphers = tls.DEFAULT_CIPHERS;
    tls.DEFAULT_MIN_VERSION = 'TLSv1';
    tls.DEFAULT_CIPHERS = 'DEFAULT@SECLEVEL=0';
    try {
      await put({ smtp_port: alt.port, smtp_tls_ca: cert.cert });
      const r = await mailer.sendMail({ to: 'ziel@example.org', subject: 'Alt', text: LINK });
      assert.equal(r.success, false);
      assert.equal(alt.post.length, 0);
      assert.deepEqual(
        alt.recording.filter(z => /^AUTH/i.test(z.row)),
        [],
      );
    } finally {
      tls.DEFAULT_MIN_VERSION = beforeMin;
      tls.DEFAULT_CIPHERS = beforeCiphers;
    }
  });

  /** The test's DNS: `mail.fake.test` resolves to `target`, everything else as usual. */
  const withDns = async (target, work) => {
    const dns = require('node:dns');
    const original = dns.lookup;
    const asked = [];
    /** @type {any} */ (dns).lookup = (host, opt, callback) => {
      if (host !== 'mail.fake.test') return original(host, opt, callback);
      asked.push(host);
      const a = { address: target, family: 4 };
      setImmediate(() => (opt?.all ? callback(null, [a]) : callback(null, a.address, 4)));
    };
    try {
      await work();
    } finally {
      dns.lookup = original;
    }
    return asked;
  };

  await t.test('a name that resolves to a blocked address is not connected', async () => {
    await put({ smtp_port: without.port, smtp_host: 'mail.fake.test' });
    const beforeRows = without.recording.length;
    let r;
    const asked = await withDns('169.254.169.254', async () => {
      r = await mailer.testSmtp();
    });
    assert.deepEqual(asked, ['mail.fake.test']);
    assert.equal(r.code, 'smtp_error');
    assert.match(r.vars.reason, /keine erlaubte Adresse/);
    assert.equal(without.recording.length, beforeRows, 'no connection attempt');
  });

  await t.test('a name that resolves to an allowed address: the connection goes to the checked address', async () => {
    await put({ smtp_port: without.port, smtp_host: 'mail.fake.test' });
    const beforeRows = without.recording.length;
    // Only the first call gets 127.0.0.1; a second lookup would land on 127.0.0.2.
    const dns = require('node:dns');
    const original = dns.lookup;
    let n = 0;
    /** @type {any} */ (dns).lookup = (host, opt, callback) => {
      if (host !== 'mail.fake.test') return original(host, opt, callback);
      const a = { address: n++ === 0 ? '127.0.0.1' : '127.0.0.2', family: 4 };
      setImmediate(() => (opt?.all ? callback(null, [a]) : callback(null, a.address, 4)));
    };
    let r;
    try {
      r = await mailer.testSmtp();
    } finally {
      dns.lookup = original;
    }
    assert.match(r.vars.reason, /kein STARTTLS/, JSON.stringify(r));
    assert.ok(without.recording.slice(beforeRows).some(z => /^EHLO/i.test(z.row)));
  });
});
