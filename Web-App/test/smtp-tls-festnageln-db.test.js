/**
 * Der Mailer prüft das Zertifikat des Mailservers immer. Ein selbst signiertes
 * Zertifikat wird über das eingetragene PEM vertraut, ein Fingerabdruck nagelt
 * genau ein Zertifikat fest; die alte Ausnahme smtp_insecure_tls wirkt nicht
 * mehr. Geprüft gegen einen SMTP-Server im Test (TLS, selbst signiert).
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  mailer.ts auf Stand e21f747 (smtp_insecure_tls schaltet ab) → rot: alle
 *      Fälle, zuerst „ohne PEM …" (mit der Altlast ungeprüft zugestellt)
 *   B  pruefeGegenstelle() liefert immer undefined → rot: „ein falscher
 *      Fingerabdruck bricht ab" und „ohne Fingerabdruck gilt der Hostname …"
 *   C  `ca` nicht an nodemailer übergeben → rot: „mit PEM wird zugestellt …",
 *      „ohne Fingerabdruck …" und „das Formular …"
 *   D  globalerWertGueltig() ohne GLOBALE_REGELN → rot: „das Formular …"
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL, openssl im Pfad.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { execFileSync } = require('node:child_process');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATA_KEY = Buffer.alloc(32, 9).toString('base64');

const _req = require('./helpers/sources').buildAndRequire();
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const mailer = _req('src/mail/mailer.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

/** Selbst signiert, mit dem angegebenen subjectAltName. */
function zertifikat(dir, name, san) {
  const key = path.join(dir, `${name}.key`), crt = path.join(dir, `${name}.crt`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-keyout', key, '-out', crt, '-days', '2', '-subj', `/CN=${name}`, '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  const pem = fs.readFileSync(crt, 'utf8');
  return { key: fs.readFileSync(key), pem, fp: new crypto.X509Certificate(pem).fingerprint256 };
}

/** Gerade genug SMTP für nodemailer: EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT. */
function smtpServer(z) {
  const post = [];
  const srv = tls.createServer({ key: z.key, cert: z.pem }, (s) => {
    let puffer = '', daten = null;
    s.on('error', () => {});
    s.write('220 test ESMTP\r\n');
    s.on('data', (b) => {
      puffer += b.toString('latin1');
      for (let i; (i = puffer.indexOf('\r\n')) >= 0;) {
        const zeile = puffer.slice(0, i); puffer = puffer.slice(i + 2);
        if (daten !== null) {
          if (zeile === '.') { post.push(daten); daten = null; s.write('250 angenommen\r\n'); } else daten += zeile + '\n';
          continue;
        }
        const befehl = zeile.slice(0, 4).toUpperCase();
        if (befehl === 'EHLO') s.write('250-test\r\n250 AUTH PLAIN\r\n');
        else if (befehl === 'AUTH') s.write('235 ok\r\n');
        else if (befehl === 'DATA') { daten = ''; s.write('354 weiter\r\n'); }
        else if (befehl === 'QUIT') s.end('221 bye\r\n');
        else s.write('250 ok\r\n');
      }
    });
  });
  srv.on('tlsClientError', () => {});
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, post, port: srv.address().port })));
}

test('SMTP über TLS nur mit geprüftem Zertifikat', { concurrency: 1, timeout: 120_000 }, async (t) => {
  try { await db.initSchema(); }
  catch (e) {
    if (process.env.REQUIRE_DB === '1')
      throw new Error(`REQUIRE_DB=1, aber die Test-DB ist nicht erreichbar: ${e.message}`);
    t.skip('Test-DB nicht erreichbar'); return;
  }
  const c = await db.pool.connect();
  try { await _req('db/migrate.js').runMigrations(c); } finally { c.release(); }

  const SCHLUESSEL = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure', 'smtp_from',
    'smtp_tls_ca', 'smtp_tls_fingerprint', 'smtp_insecure_tls'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  const CHEF = `smtp_tls_${process.pid}`, PASS = 'Smtp-Tls-Pruefung-1';
  await db.run('DELETE FROM users WHERE username = $1', [CHEF]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified)
    VALUES ($1, $2, true, true, true) RETURNING id`, [CHEF, bcrypt.hashSync(PASS, 4)])).id;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-tls-'));
  const richtig = zertifikat(dir, 'localhost', 'IP:127.0.0.1,DNS:localhost');
  const fremd = zertifikat(dir, 'mail.intern', 'DNS:mail.intern');
  const a = await smtpServer(richtig), b = await smtpServer(fremd);
  t.after(async () => {
    a.srv.close(); b.srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const setze = async (werte) => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    const alle = { smtp_host: '127.0.0.1', smtp_user: 'u', smtp_pass: 'p', smtp_secure: '1', smtp_from: 'test@example.org', ...werte };
    for (const [k, v] of Object.entries(alle)) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [k, String(v)]);
    await _req('src/einstellungen/settings.js').verschluesseleGlobaleAltwerte();
  };
  let nr = 0;
  const sende = async (server) => {
    const betreff = `Probe ${++nr}`, vorherZahl = server.post.length;
    const r = await mailer.sendMail({ to: 'ziel@example.org', subject: betreff, text: 'Hallo' });
    const zugestellt = server.post.length > vorherZahl && server.post.at(-1).includes(betreff);
    return { zugestellt, error: r.error ?? null };
  };

  await t.test('ohne PEM wird nichts zugestellt, auch nicht mit der Altlast', async () => {
    await setze({ smtp_port: a.port, smtp_insecure_tls: '1' });
    const r = await sende(a);
    assert.equal(r.zugestellt, false);
    assert.match(r.error, /Zertifikat \(PEM\) oder seinen SHA-256-Fingerabdruck/);
    assert.equal(await mailer.meldeSmtpAltlast(), true);
    assert.equal((await mailer.testSmtp()).code, 'smtp_zertifikat');
  });

  await t.test('mit PEM wird zugestellt, mit richtigem Fingerabdruck auch', async () => {
    await setze({ smtp_port: a.port, smtp_tls_ca: richtig.pem });
    assert.deepEqual(await sende(a), { zugestellt: true, error: null });
    await setze({ smtp_port: a.port, smtp_tls_ca: richtig.pem, smtp_tls_fingerprint: richtig.fp.replace(/:/g, '').toLowerCase() });
    assert.deepEqual(await sende(a), { zugestellt: true, error: null });
  });

  await t.test('ein falscher Fingerabdruck bricht ab', async () => {
    await setze({ smtp_port: a.port, smtp_tls_ca: richtig.pem, smtp_tls_fingerprint: fremd.fp });
    const r = await sende(a);
    assert.equal(r.zugestellt, false);
    assert.match(r.error, /Fingerabdruck/);
  });

  await t.test('ohne Fingerabdruck gilt der Hostname, mit ihm genau das Zertifikat', async () => {
    await setze({ smtp_port: b.port, smtp_tls_ca: fremd.pem });
    assert.equal((await sende(b)).zugestellt, false);
    await setze({ smtp_port: b.port, smtp_tls_ca: fremd.pem, smtp_tls_fingerprint: fremd.fp });
    assert.deepEqual(await sende(b), { zugestellt: true, error: null });
  });

  await t.test('das Formular nimmt nur lesbare Werte und räumt die Altlast ab', async () => {
    await setze({ smtp_port: a.port, smtp_insecure_tls: '1' });
    const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, routen: { '/api/v1': 'routes/api_v1/settings.js' }, t });
    const speichere = (body) => fetch(`${base}/api/v1/settings`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_password: PASS, ...body }) }).then(async r => ({ status: r.status, body: await r.json() }));
    assert.equal((await speichere({ smtp_tls_fingerprint: 'AB:CD' })).status, 400);
    assert.equal((await speichere({ smtp_tls_ca: 'kein Zertifikat' })).status, 400);
    const r = await speichere({ smtp_tls_fingerprint: richtig.fp, smtp_tls_ca: richtig.pem });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const gespeichert = Object.fromEntries((await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL])).map(z => [z.key, z.value]));
    assert.equal(gespeichert.smtp_tls_fingerprint, richtig.fp);
    assert.equal(gespeichert.smtp_insecure_tls, undefined);
    assert.equal(await mailer.meldeSmtpAltlast(), false);
    assert.deepEqual(await sende(a), { zugestellt: true, error: null });
  });
});
