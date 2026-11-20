/**
 * Geheimnisse sind an ihren Ort gebunden (v2: AES-GCM mit Spalte, Konto und
 * Zeile als zusätzlich authentifizierten Daten): Ein Geheimtext, in ein
 * anderes Konto, eine andere Zeile oder Spalte kopiert, lässt sich dort nicht
 * lesen. Klartext und v1 nimmt das Lesen nicht mehr an; der Start schlüsselt
 * v1 und Klartext vorher um — Datenbank und Gutschein-PDFs.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  setAad() in versiegle() und oeffne() gestrichen → rot: „vertauscht …"
 *      (die PIN ist im fremden Konto lesbar)
 *   B  entschluessele() gibt Klartext ohne Präfix wieder zurück → rot:
 *      „Klartext und v1 …"
 *   C  prepareDatabaseBefore() ohne verschluesseleAltbestand() → rot:
 *      „ein v1-Altbestand …" (TOTP und SMTP-Passwort bleiben v1)
 *   D  encryptLegacyVoucherFiles() liest BIENC1 nicht mehr (nur
 *      Klartext) → rot: „ein v1-Altbestand …" (PDF bleibt BIENC1)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/system-frame');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATA_KEY = crypto.randomBytes(32).toString('base64');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-kontext-'));
fs.mkdirSync(path.join(SANDBOX, 'data'), { recursive: true });
fs.writeFileSync(path.join(SANDBOX, 'package.json'), '{"name":"sandkasten"}');
process.env.APP_ROOT = SANDBOX;

const { buildAndRequire, testData, testAccess } = require('./helpers/sources');
const _req = buildAndRequire();
const { dataOrSkip } = require('./helpers/db');
const db = testData();
const g = _req('src/infra/secret.js');
const gr = {
  ..._req('src/vouchers/repository/vouchers.js'),
  ...require('./helpers/sources').testArea('vouchers').vouchers,
};
const dateien = _req('src/vouchers/voucherFiles.js');
const zf = _req('src/factors/secondFactor.js');
const settings = _req('src/settings/settings.js');
const idem = _req('src/idempotency/service.js');

/** Das Format vor dem Kontext: AES-GCM mit dem Rohschlüssel, ohne AAD. */
function roh1(daten) {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.DATA_KEY, 'base64'), iv);
  const d = Buffer.concat([c.update(daten), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), d]);
}
const alsV1 = klar => 'v1:' + roh1(Buffer.from(klar, 'utf8')).toString('base64');
const PDF = Buffer.from('%PDF-1.4\nGutschein 5045076374450099999 PIN 4711\n%%EOF\n');

test('Geheimnisse mit Kontext', { concurrency: 1, timeout: 120_000 }, async t => {
  if (!(await dataOrSkip(t, _req))) return;
  const namen = [`kontext_a_${process.pid}`, `kontext_b_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen)
    ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id);
  const SCHLUESSEL = ['smtp_pass', 'brickset_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]);
    fs.rmSync(SANDBOX, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });
  const [a, b] = ids;
  const stumm = async f => {
    const w = console.warn;
    console.warn = () => {};
    try {
      return await f();
    } finally {
      console.warn = w;
    }
  };
  const pinOf = async (uid, id) => (await gr.voucher(uid, id)).pin;

  await t.test('vertauscht zwischen Konten, Zeilen und Spalten ist nichts mehr lesbar', async () => {
    const ga = await gr.createVoucher(a, {
      number: '5045076374450011111',
      pin: '1111',
      amount: 10,
      currency: 'CHF',
    });
    const ga2 = await gr.createVoucher(a, {
      number: '5045076374450022222',
      pin: '2222',
      amount: 10,
      currency: 'CHF',
    });
    const gb = await gr.createVoucher(b, {
      number: '5045076374450033333',
      pin: '3333',
      amount: 10,
      currency: 'CHF',
    });
    assert.deepEqual(
      [await pinOf(a, ga.id), await pinOf(b, gb.id)],
      ['1111', '3333'],
      'Vorbedingung: lesbar am eigenen Ort',
    );
    const zeile = async id => db.get('SELECT number, pin FROM vouchers WHERE id = $1', [id]);
    // PIN von Konto a nach Konto b, Nummer innerhalb von a von einer Zeile zur anderen.
    await db.run('UPDATE vouchers SET pin = $1 WHERE id = $2', [(await zeile(ga.id)).pin, gb.id]);
    await db.run('UPDATE vouchers SET number = $1 WHERE id = $2', [(await zeile(ga.id)).number, ga2.id]);
    assert.equal(await stumm(() => pinOf(b, gb.id)), null, 'PIN in fremdem Konto lesbar');
    assert.equal(await stumm(async () => (await gr.voucher(a, ga2.id)).number), '', 'Nummer in anderer Zeile lesbar');

    // TOTP-Geheimnis von a nach b.
    const secretA = await zf.beginSetup(a);
    await zf.beginSetup(b);
    const codeA = zf.hotp(zf.fromBase32(secretA), zf.timeStep());
    await db.run(
      'UPDATE second_factor SET secret = (SELECT secret FROM second_factor WHERE user_id = $1) WHERE user_id = $2',
      [a, b],
    );
    assert.equal(await stumm(() => zf.confirmSetup(b, codeA)), null, 'fremdes TOTP-Geheimnis lesbar');
    assert.ok(await zf.confirmSetup(a, codeA), 'Vorbedingung: am eigenen Ort gilt der Code');

    // SMTP-Passwort in die Zeile eines API-Schlüssels.
    await settings.setGlobalSetting('smtp_pass', 'Smtp-Geheim-1');
    await db.run(`INSERT INTO global_settings (key, value) SELECT 'brickset_api_key', value FROM global_settings WHERE key = 'smtp_pass'
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    assert.equal(await settings.getGlobalSetting('smtp_pass'), 'Smtp-Geheim-1');
    assert.equal(
      await stumm(() => settings.getGlobalSetting('brickset_api_key')),
      null,
      'Wert in anderer Spalte lesbar',
    );

    // Gespeicherte Antwort eines Idempotency-Keys in den Eintrag eines anderen Kontos.
    for (const uid of ids) assert.equal((await idem.begin(uid, 'k-1', 'abdruck')).kind, 'new');
    await idem.end(a, 'k-1', 200, '{"geheim":"a"}');
    await idem.end(b, 'k-1', 200, '{"geheim":"b"}');
    assert.deepEqual(await idem.begin(a, 'k-1', 'abdruck'), {
      kind: 'replay',
      status: 200,
      response: '{"geheim":"a"}',
    });
    await db.run(
      `UPDATE idempotency SET response = (SELECT response FROM idempotency WHERE user_id = $1 AND key = 'k-1')
                  WHERE user_id = $2 AND key = 'k-1'`,
      [a, b],
    );
    assert.equal((await stumm(() => idem.begin(b, 'k-1', 'abdruck'))).kind, 'not_replayable');

    // Gutschein-PDF von a in den Ordner von b.
    const da = path.join(dateien.VOUCHER_DIR, String(a), `${ga.id}.pdf`),
      db_ = path.join(dateien.VOUCHER_DIR, String(b), `${gb.id}.pdf`);
    await dateien.writeVoucherPdf(da, PDF);
    assert.ok((await dateien.readVoucherPdf(da)).equals(PDF), 'Vorbedingung: am eigenen Ort lesbar');
    fs.mkdirSync(path.dirname(db_), { recursive: true });
    fs.copyFileSync(da, db_);
    assert.equal(await stumm(() => dateien.readVoucherPdf(db_)), null, 'PDF an fremdem Ort lesbar');
  });

  await t.test('Klartext und v1 werden beim Lesen abgewiesen', async () => {
    const k = g.kontext('probe', 1);
    assert.equal(await stumm(() => g.decrypt('klartext', k)), null);
    assert.equal(await stumm(() => g.decrypt(alsV1('alt'), k)), null);
    assert.equal(g.readOldValue(alsV1('alt'), k), 'alt', 'nur das Umschlüsseln liest v1');
    await db.run("UPDATE global_settings SET value = 'eingeschleust' WHERE key = 'smtp_pass'");
    assert.equal(await stumm(() => settings.getGlobalSetting('smtp_pass')), null);
    const pdf = path.join(dateien.VOUCHER_DIR, String(a), 'klartext.pdf');
    fs.mkdirSync(path.dirname(pdf), { recursive: true });
    fs.writeFileSync(pdf, PDF);
    assert.equal(await stumm(() => dateien.readVoucherPdf(pdf)), null);
    fs.rmSync(pdf);
  });

  await t.test('ein v1-Altbestand wird beim Start umgeschlüsselt', async () => {
    await db.run('DELETE FROM vouchers WHERE user_id = ANY($1)', [ids]);
    await db.run('DELETE FROM second_factor WHERE user_id = ANY($1)', [ids]);
    fs.rmSync(dateien.VOUCHER_DIR, { recursive: true, force: true });
    // Nummer und PIN v1, wie vor dem Kontext; der CHECK der Tabelle verlangt jetzt v2.
    await db.run('ALTER TABLE vouchers DROP CONSTRAINT vouchers_nummer_verschluesselt');
    const nr = '5045076374450044444';
    const id = (
      await db.get(
        `INSERT INTO vouchers (user_id, number, number_search, pin, amount, currency)
      VALUES ($1, $2, $3, $4, 5, 'CHF') RETURNING id`,
        [a, alsV1(nr), gr.numberSearch(a, nr), alsV1('4444')],
      )
    ).id;
    await db.run(`ALTER TABLE vouchers ADD CONSTRAINT vouchers_nummer_verschluesselt
      CHECK (number LIKE 'v2:%' AND number_search IS NOT NULL) NOT VALID`);
    await db.run("UPDATE global_settings SET value = $1 WHERE key = 'smtp_pass'", [alsV1('Smtp-Alt-2')]);
    const totp = zf.base32(crypto.randomBytes(20));
    await db.run('INSERT INTO second_factor (user_id, secret, active) VALUES ($1, $2, true)', [b, alsV1(totp)]);
    const abdruck = idem.fingerprint('PUT', '/api/v1/x', { alt: true });
    await db.run(
      `INSERT INTO idempotency (user_id, key, request, status, response) VALUES ($1, 'alt-1', $2, 200, $3)`,
      [a, abdruck, alsV1('{"alt":true}')],
    );
    const pdf = path.join(dateien.VOUCHER_DIR, String(a), `${id}.pdf`);
    fs.mkdirSync(path.dirname(pdf), { recursive: true });
    fs.writeFileSync(pdf, Buffer.concat([Buffer.from('BIENC1\n'), roh1(PDF)]));

    // Ein Altbestand trägt die Marke der Umschlüsselung noch nicht (die Testvorlage schon).
    await require('./helpers/sources').testArea('jobQueue').laufzustand.deleteState('altbestand_v2');
    await _req('startup/database.js').prepareDatabaseBefore(testAccess(), require('./helpers/sources').testServices());

    const v = await db.get('SELECT number, pin FROM vouchers WHERE id = $1', [id]);
    assert.ok(v.number.startsWith('v2:') && v.pin.startsWith('v2:'), JSON.stringify(v));
    assert.deepEqual([(await gr.voucher(a, id)).number, await pinOf(a, id)], [nr, '4444']);
    assert.match((await db.get("SELECT value FROM global_settings WHERE key = 'smtp_pass'")).value, /^v2:/);
    assert.equal(await settings.getGlobalSetting('smtp_pass'), 'Smtp-Alt-2');
    assert.match((await db.get('SELECT secret FROM second_factor WHERE user_id = $1', [b])).secret, /^v2:/);
    assert.equal(await zf.checkCode(b, zf.hotp(zf.fromBase32(totp), zf.timeStep())), 'totp');
    assert.deepEqual(await idem.begin(a, 'alt-1', abdruck), {
      kind: 'replay',
      status: 200,
      response: '{"alt":true}',
    });
    assert.equal(fs.readFileSync(pdf).subarray(0, 7).toString('latin1'), 'BIENC2\n');
    assert.ok((await dateien.readVoucherPdf(pdf)).equals(PDF));
  });
});
