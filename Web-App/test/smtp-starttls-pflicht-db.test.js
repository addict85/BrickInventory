/**
 * Ohne Port 465 verlangt der Mailer STARTTLS: Bietet der Mailserver es nicht
 * an, bricht der Versand vor AUTH ab, statt Passwort und Rücksetzlink im
 * Klartext zu senden. Geprüft gegen einen SMTP-Server im Test, der jede Zeile
 * mitschreibt — einmal ohne STARTTLS, einmal mit (selbst signiert, PEM).
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  `requireTLS: !secure` entfernt → rot: „ohne STARTTLS …" (AUTH PLAIN mit
 *      Passwort und die Mail stehen im Klartext-Mitschnitt)
 *   B  `minVersion: 'TLSv1.2'` entfernt → rot: „TLS 1.1 wird abgelehnt …"
 *      (Zustellung über TLSv1.1, wenn der Prozess ältere Fassungen zulässt)
 *   C  in getTransporter() `mailserverAdresse(ip)` durch `true` ersetzt → rot:
 *      „ein Name, der auf eine gesperrte Adresse auflöst …“ (11.11.2026)
 *   D  in getTransporter() wieder `host` statt der geprüften Adresse an
 *      nodemailer → rot: „… verbunden wird mit der geprüften Adresse“
 *      (nodemailer löste selbst auf und erreichte 127.0.0.2 statt 127.0.0.1)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL, openssl im Pfad.
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

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const { testServer } = require('./helpers/server');
const db = _req('db/database.js');
const mailer = _req('src/mail/mailer.js');
const bcrypt = require(path.join(__dirname, '..', 'node_modules', 'bcryptjs'));

/** Klartext-SMTP; mit `tlsOpt` bietet er STARTTLS an. Jede Zeile landet mit ihrer Schicht im Mitschnitt. */
function smtpServer(tlsOpt) {
  const mitschnitt = [], post = [];
  const srv = net.createServer((roh) => {
    roh.on('error', () => {});
    roh.write('220 test ESMTP\r\n');
    const bediene = (s, schicht) => {
      let puffer = '', daten = null;
      s.on('data', (b) => {
        puffer += b.toString('latin1');
        for (let i = puffer.indexOf('\r\n'); i >= 0; i = puffer.indexOf('\r\n')) {
          const zeile = puffer.slice(0, i); puffer = puffer.slice(i + 2);
          mitschnitt.push({ schicht, zeile });
          if (daten !== null) {
            if (zeile === '.') { post.push(daten); daten = null; s.write('250 angenommen\r\n'); } else daten += zeile + '\n';
            continue;
          }
          const befehl = zeile.slice(0, 8).toUpperCase();
          if (befehl.startsWith('EHLO')) s.write(`250-test\r\n${tlsOpt && schicht === 'klar' ? '250-STARTTLS\r\n' : ''}250 AUTH PLAIN\r\n`);
          else if (befehl === 'STARTTLS') {
            if (!tlsOpt) { s.write('502 nicht angeboten\r\n'); continue; }
            s.removeAllListeners('data');
            s.write('220 los\r\n', () => {
              const sicher = new tls.TLSSocket(s, { isServer: true, ...tlsOpt });
              sicher.on('error', () => {});
              bediene(sicher, 'tls');
            });
            return;
          } else if (befehl.startsWith('AUTH')) s.write('235 ok\r\n');
          else if (befehl.startsWith('DATA')) { daten = ''; s.write('354 weiter\r\n'); }
          else if (befehl.startsWith('QUIT')) s.end('221 bye\r\n');
          else s.write('250 ok\r\n');
        }
      });
    };
    bediene(roh, 'klar');
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, mitschnitt, post, port: srv.address().port })));
}

test('SMTP ohne Port 465 nur mit STARTTLS', { concurrency: 1, timeout: 120_000 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;

  const SCHLUESSEL = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure', 'smtp_from', 'smtp_tls_ca', 'smtp_tls_fingerprint'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  const CHEF = `starttls_${process.pid}`, PASS = 'Starttls-Pruefung-1';
  await db.run('DELETE FROM users WHERE username = $1', [CHEF]);
  const uid = (await db.get(`INSERT INTO users (username, password_hash, is_admin, is_active, email_verified, email)
    VALUES ($1, $2, true, true, true, 'chef@example.org') RETURNING id`, [CHEF, bcrypt.hashSync(PASS, 4)])).id;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smtp-starttls-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  const zert = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem'), 'utf8') };
  const ohne = await smtpServer(null), mit = await smtpServer(zert);
  const alt = await smtpServer({ ...zert, minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' });
  t.after(async () => {
    for (const s of [ohne, mit, alt]) s.srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE id = $1', [uid]);
    await db.pool.end().catch(() => {});
  });

  const setze = async (werte) => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    const alle = { smtp_host: '127.0.0.1', smtp_user: 'postfach', smtp_pass: 'Geheim-Smtp-9', smtp_secure: '0', smtp_from: 'test@example.org', ...werte };
    for (const [k, v] of Object.entries(alle)) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [k, String(v)]);
    await _req('src/einstellungen/settings.js').verschluesseleGlobaleAltwerte();
  };
  const LINK = 'https://brick.example/reset?token=abcdef0123';

  await t.test('ohne STARTTLS bricht der Versand vor AUTH ab', async () => {
    await setze({ smtp_port: ohne.port });
    const r = await mailer.sendMail({ to: 'ziel@example.org', subject: 'Rücksetzen', text: LINK });
    assert.equal(r.success, false);
    assert.match(r.error, /kein STARTTLS/);
    const zeilen = ohne.mitschnitt.map(z => z.zeile);
    assert.ok(zeilen.some(z => /^EHLO/i.test(z)), 'Der Mailer hat den Server gar nicht erreicht');
    assert.deepEqual(zeilen.filter(z => /^(AUTH|MAIL FROM|DATA)/i.test(z) || z.includes('token=')), []);
    assert.equal(ohne.post.length, 0);
  });

  await t.test('der Mail-Test in den Einstellungen nimmt denselben Weg', async () => {
    await setze({ smtp_port: ohne.port });
    const vorherZeilen = ohne.mitschnitt.length;
    assert.equal((await mailer.testSmtp()).code, 'smtp_fehler');
    const { base } = testServer(_req, { sitzung: { userId: uid, isAdmin: true }, routen: { '/api/v1': 'routes/api_v1/settings.js' }, t });
    const r = await fetch(`${base}/api/v1/settings/smtp-test`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /kein STARTTLS/);
    assert.deepEqual(ohne.mitschnitt.slice(vorherZeilen).filter(z => /^AUTH/i.test(z.zeile)), []);
  });

  await t.test('mit STARTTLS geht AUTH erst über die verschlüsselte Verbindung', async () => {
    await setze({ smtp_port: mit.port, smtp_tls_ca: zert.cert });
    const r = await mailer.sendMail({ to: 'ziel@example.org', subject: 'Rücksetzen', text: LINK });
    assert.equal(r.success, true, r.error);
    assert.equal(mit.post.length, 1);
    assert.deepEqual(mit.mitschnitt.filter(z => z.schicht === 'klar').map(z => z.zeile.split(' ')[0].toUpperCase()), ['EHLO', 'STARTTLS']);
    assert.ok(mit.mitschnitt.some(z => z.schicht === 'tls' && /^AUTH PLAIN/i.test(z.zeile)));
  });

  await t.test('TLS 1.1 wird abgelehnt, auch wenn der Prozess es zuliesse', async () => {
    const vorherMin = tls.DEFAULT_MIN_VERSION, vorherChiffren = tls.DEFAULT_CIPHERS;
    tls.DEFAULT_MIN_VERSION = 'TLSv1'; tls.DEFAULT_CIPHERS = 'DEFAULT@SECLEVEL=0';
    try {
      await setze({ smtp_port: alt.port, smtp_tls_ca: zert.cert });
      const r = await mailer.sendMail({ to: 'ziel@example.org', subject: 'Alt', text: LINK });
      assert.equal(r.success, false);
      assert.equal(alt.post.length, 0);
      assert.deepEqual(alt.mitschnitt.filter(z => /^AUTH/i.test(z.zeile)), []);
    } finally { tls.DEFAULT_MIN_VERSION = vorherMin; tls.DEFAULT_CIPHERS = vorherChiffren; }
  });

  /** Das DNS des Tests: `mail.attrappe.test` löst auf `ziel` auf, alles andere wie gewohnt. */
  const mitDns = async (ziel, arbeit) => {
    const dns = require('node:dns');
    const echt = dns.lookup;
    const gefragt = [];
    /** @type {any} */ (dns).lookup = (host, opt, rueckruf) => {
      if (host !== 'mail.attrappe.test') return echt(host, opt, rueckruf);
      gefragt.push(host);
      const a = { address: ziel, family: 4 };
      setImmediate(() => (opt?.all ? rueckruf(null, [a]) : rueckruf(null, a.address, 4)));
    };
    try { await arbeit(); } finally { dns.lookup = echt; }
    return gefragt;
  };

  await t.test('ein Name, der auf eine gesperrte Adresse auflöst, wird nicht verbunden', async () => {
    await setze({ smtp_port: ohne.port, smtp_host: 'mail.attrappe.test' });
    const vorherZeilen = ohne.mitschnitt.length;
    let r;
    const gefragt = await mitDns('169.254.169.254', async () => { r = await mailer.testSmtp(); });
    assert.deepEqual(gefragt, ['mail.attrappe.test']);
    assert.equal(r.code, 'smtp_fehler');
    assert.match(r.vars.grund, /keine erlaubte Adresse/);
    assert.equal(ohne.mitschnitt.length, vorherZeilen, 'kein Verbindungsversuch');
  });

  await t.test('ein Name, der auf eine erlaubte Adresse auflöst: verbunden wird mit der geprüften Adresse', async () => {
    await setze({ smtp_port: ohne.port, smtp_host: 'mail.attrappe.test' });
    const vorherZeilen = ohne.mitschnitt.length;
    // Nur der erste Aufruf bekommt 127.0.0.1; ein zweites Nachschlagen landete auf 127.0.0.2.
    const dns = require('node:dns');
    const echt = dns.lookup;
    let n = 0;
    /** @type {any} */ (dns).lookup = (host, opt, rueckruf) => {
      if (host !== 'mail.attrappe.test') return echt(host, opt, rueckruf);
      const a = { address: n++ === 0 ? '127.0.0.1' : '127.0.0.2', family: 4 };
      setImmediate(() => (opt?.all ? rueckruf(null, [a]) : rueckruf(null, a.address, 4)));
    };
    let r;
    try { r = await mailer.testSmtp(); } finally { dns.lookup = echt; }
    assert.match(r.vars.grund, /kein STARTTLS/, JSON.stringify(r));
    assert.ok(ohne.mitschnitt.slice(vorherZeilen).some(z => /^EHLO/i.test(z.zeile)));
  });
});
