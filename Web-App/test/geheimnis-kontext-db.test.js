/**
 * Geheimnisse sind an ihren Ort gebunden (v2: AES-GCM mit Spalte, Konto und
 * Zeile als zusätzlich authentifizierten Daten): Ein Geheimtext, in ein
 * anderes Konto, eine andere Zeile oder Spalte kopiert, lässt sich dort nicht
 * lesen. Klartext und v1 nimmt das Lesen nicht mehr an; der Start schlüsselt
 * v1 und Klartext vorher um — Datenbank und Gutschein-PDFs.
 *
 * Gegenproben (01.11.2026 gemessen):
 *   A  setAAD() in versiegle() und oeffne() gestrichen → rot: „vertauscht …"
 *      (die PIN ist im fremden Konto lesbar)
 *   B  entschluessele() gibt Klartext ohne Präfix wieder zurück → rot:
 *      „Klartext und v1 …"
 *   C  bereiteDatenbankVor() ohne verschluesseleAltbestand() → rot:
 *      „ein v1-Altbestand …" (TOTP und SMTP-Passwort bleiben v1)
 *   D  verschluesseleGutscheinAltbestand() liest BIENC1 nicht mehr (nur
 *      Klartext) → rot: „ein v1-Altbestand …" (PDF bleibt BIENC1)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
process.env.DATA_KEY = crypto.randomBytes(32).toString('base64');
const SANDKASTEN = fs.mkdtempSync(path.join(os.tmpdir(), 'geheimnis-kontext-'));
fs.mkdirSync(path.join(SANDKASTEN, 'data'), { recursive: true });
fs.writeFileSync(path.join(SANDKASTEN, 'package.json'), '{"name":"sandkasten"}');
process.env.APP_ROOT = SANDKASTEN;

const _req = require('./helpers/sources').buildAndRequire();
const { dbOderSkip } = require('./helpers/db');
const db = _req('db/database.js');
const g = _req('src/infra/geheimnis.js');
const gr = _req('src/gutscheine/repository/gutscheine.js');
const dateien = _req('src/gutscheine/gutscheinDateien.js');
const zf = _req('src/konto/zweiterFaktor.js');
const settings = _req('src/einstellungen/settings.js');
const idem = _req('src/idempotenz/dienst.js');

/** Das Format vor dem Kontext: AES-GCM mit dem Rohschlüssel, ohne AAD. */
function roh1(daten) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', Buffer.from(process.env.DATA_KEY, 'base64'), iv);
  const d = Buffer.concat([c.update(daten), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), d]);
}
const alsV1 = (klar) => 'v1:' + roh1(Buffer.from(klar, 'utf8')).toString('base64');
const PDF = Buffer.from('%PDF-1.4\nGutschein 5045076374450099999 PIN 4711\n%%EOF\n');

test('Geheimnisse mit Kontext', { concurrency: 1, timeout: 120_000 }, async (t) => {
  if (!await dbOderSkip(t, _req)) return;
  const namen = [`kontext_a_${process.pid}`, `kontext_b_${process.pid}`];
  await db.run('DELETE FROM users WHERE username = ANY($1)', [namen]);
  const ids = [];
  for (const n of namen) ids.push((await db.get(`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, [n])).id);
  const SCHLUESSEL = ['smtp_pass', 'brickset_api_key'];
  const vorher = await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
  t.after(async () => {
    await db.run('DELETE FROM global_settings WHERE key = ANY($1)', [SCHLUESSEL]);
    for (const z of vorher) await db.run('INSERT INTO global_settings (key, value) VALUES ($1, $2)', [z.key, z.value]);
    await db.run('DELETE FROM users WHERE id = ANY($1)', [ids]);
    fs.rmSync(SANDKASTEN, { recursive: true, force: true });
    await db.pool.end().catch(() => {});
  });
  const [a, b] = ids;
  const stumm = async (f) => { const w = console.warn; console.warn = () => {}; try { return await f(); } finally { console.warn = w; } };
  const pinVon = async (uid, id) => (await gr.gutschein(uid, id)).pin;

  await t.test('vertauscht zwischen Konten, Zeilen und Spalten ist nichts mehr lesbar', async () => {
    const ga = await gr.gutscheinAnlegen(a, { number: '5045076374450011111', pin: '1111', amount: 10, currency: 'CHF' });
    const ga2 = await gr.gutscheinAnlegen(a, { number: '5045076374450022222', pin: '2222', amount: 10, currency: 'CHF' });
    const gb = await gr.gutscheinAnlegen(b, { number: '5045076374450033333', pin: '3333', amount: 10, currency: 'CHF' });
    assert.deepEqual([await pinVon(a, ga.id), await pinVon(b, gb.id)], ['1111', '3333'], 'Vorbedingung: lesbar am eigenen Ort');
    const zeile = async (id) => db.get('SELECT number, pin FROM vouchers WHERE id = $1', [id]);
    // PIN von Konto a nach Konto b, Nummer innerhalb von a von einer Zeile zur anderen.
    await db.run('UPDATE vouchers SET pin = $1 WHERE id = $2', [(await zeile(ga.id)).pin, gb.id]);
    await db.run('UPDATE vouchers SET number = $1 WHERE id = $2', [(await zeile(ga.id)).number, ga2.id]);
    assert.equal(await stumm(() => pinVon(b, gb.id)), null, 'PIN in fremdem Konto lesbar');
    assert.equal(await stumm(async () => (await gr.gutschein(a, ga2.id)).number), '', 'Nummer in anderer Zeile lesbar');

    // TOTP-Geheimnis von a nach b.
    const geheimA = await zf.beginneEinrichtung(a);
    await zf.beginneEinrichtung(b);
    const codeA = zf.hotp(zf.ausBase32(geheimA), zf.zeitschritt());
    await db.run('UPDATE zweiter_faktor SET geheimnis = (SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1) WHERE user_id = $2', [a, b]);
    assert.equal(await stumm(() => zf.bestaetigeEinrichtung(b, codeA)), null, 'fremdes TOTP-Geheimnis lesbar');
    assert.ok(await zf.bestaetigeEinrichtung(a, codeA), 'Vorbedingung: am eigenen Ort gilt der Code');

    // SMTP-Passwort in die Zeile eines API-Schlüssels.
    await settings.setGlobalSetting('smtp_pass', 'Smtp-Geheim-1');
    await db.run(`INSERT INTO global_settings (key, value) SELECT 'brickset_api_key', value FROM global_settings WHERE key = 'smtp_pass'
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    assert.equal(await settings.getGlobalSetting('smtp_pass'), 'Smtp-Geheim-1');
    assert.equal(await stumm(() => settings.getGlobalSetting('brickset_api_key')), null, 'Wert in anderer Spalte lesbar');

    // Gespeicherte Antwort eines Idempotency-Keys in den Eintrag eines anderen Kontos.
    for (const uid of ids) assert.equal((await idem.beginne(uid, 'k-1', 'abdruck')).art, 'neu');
    await idem.beende(a, 'k-1', 200, '{"geheim":"a"}');
    await idem.beende(b, 'k-1', 200, '{"geheim":"b"}');
    assert.deepEqual(await idem.beginne(a, 'k-1', 'abdruck'), { art: 'wiederholung', status: 200, antwort: '{"geheim":"a"}' });
    await db.run(`UPDATE idempotenz SET antwort = (SELECT antwort FROM idempotenz WHERE user_id = $1 AND schluessel = 'k-1')
                  WHERE user_id = $2 AND schluessel = 'k-1'`, [a, b]);
    assert.equal((await stumm(() => idem.beginne(b, 'k-1', 'abdruck'))).art, 'nicht_wiederholbar');

    // Gutschein-PDF von a in den Ordner von b.
    const da = path.join(dateien.VOUCHER_DIR, String(a), `${ga.id}.pdf`), db_ = path.join(dateien.VOUCHER_DIR, String(b), `${gb.id}.pdf`);
    await dateien.schreibeGutscheinPdf(da, PDF);
    assert.ok((await dateien.liesGutscheinPdf(da)).equals(PDF), 'Vorbedingung: am eigenen Ort lesbar');
    fs.mkdirSync(path.dirname(db_), { recursive: true });
    fs.copyFileSync(da, db_);
    assert.equal(await stumm(() => dateien.liesGutscheinPdf(db_)), null, 'PDF an fremdem Ort lesbar');
  });

  await t.test('Klartext und v1 werden beim Lesen abgewiesen', async () => {
    const k = g.kontext('probe', 1);
    assert.equal(await stumm(() => g.entschluessele('klartext', k)), null);
    assert.equal(await stumm(() => g.entschluessele(alsV1('alt'), k)), null);
    assert.equal(g.altwertLesen(alsV1('alt'), k), 'alt', 'nur das Umschlüsseln liest v1');
    await db.run("UPDATE global_settings SET value = 'eingeschleust' WHERE key = 'smtp_pass'");
    assert.equal(await stumm(() => settings.getGlobalSetting('smtp_pass')), null);
    const pdf = path.join(dateien.VOUCHER_DIR, String(a), 'klartext.pdf');
    fs.mkdirSync(path.dirname(pdf), { recursive: true });
    fs.writeFileSync(pdf, PDF);
    assert.equal(await stumm(() => dateien.liesGutscheinPdf(pdf)), null);
    fs.rmSync(pdf);
  });

  await t.test('ein v1-Altbestand wird beim Start umgeschlüsselt', async () => {
    await db.run('DELETE FROM vouchers WHERE user_id = ANY($1)', [ids]);
    await db.run('DELETE FROM zweiter_faktor WHERE user_id = ANY($1)', [ids]);
    fs.rmSync(dateien.VOUCHER_DIR, { recursive: true, force: true });
    // Nummer und PIN v1, wie vor dem Kontext; der CHECK der Tabelle verlangt jetzt v2.
    await db.run('ALTER TABLE vouchers DROP CONSTRAINT vouchers_nummer_verschluesselt');
    const nr = '5045076374450044444';
    const id = (await db.get(`INSERT INTO vouchers (user_id, number, nummer_suche, pin, amount, currency)
      VALUES ($1, $2, $3, $4, 5, 'CHF') RETURNING id`, [a, alsV1(nr), gr.nummerSuche(a, nr), alsV1('4444')])).id;
    await db.run(`ALTER TABLE vouchers ADD CONSTRAINT vouchers_nummer_verschluesselt
      CHECK (number LIKE 'v2:%' AND nummer_suche IS NOT NULL) NOT VALID`);
    await db.run("UPDATE global_settings SET value = $1 WHERE key = 'smtp_pass'", [alsV1('Smtp-Alt-2')]);
    const totp = zf.base32(crypto.randomBytes(20));
    await db.run('INSERT INTO zweiter_faktor (user_id, geheimnis, aktiv) VALUES ($1, $2, true)', [b, alsV1(totp)]);
    const abdruck = idem.fingerabdruck('PUT', '/api/v1/x', { alt: true });
    await db.run(`INSERT INTO idempotenz (user_id, schluessel, anfrage, status, antwort) VALUES ($1, 'alt-1', $2, 200, $3)`,
      [a, abdruck, alsV1('{"alt":true}')]);
    const pdf = path.join(dateien.VOUCHER_DIR, String(a), `${id}.pdf`);
    fs.mkdirSync(path.dirname(pdf), { recursive: true });
    fs.writeFileSync(pdf, Buffer.concat([Buffer.from('BIENC1\n'), roh1(PDF)]));

    await _req('startup/datenbank.js').bereiteDatenbankVor();

    const v = await db.get('SELECT number, pin FROM vouchers WHERE id = $1', [id]);
    assert.ok(v.number.startsWith('v2:') && v.pin.startsWith('v2:'), JSON.stringify(v));
    assert.deepEqual([(await gr.gutschein(a, id)).number, await pinVon(a, id)], [nr, '4444']);
    assert.match((await db.get("SELECT value FROM global_settings WHERE key = 'smtp_pass'")).value, /^v2:/);
    assert.equal(await settings.getGlobalSetting('smtp_pass'), 'Smtp-Alt-2');
    assert.match((await db.get('SELECT geheimnis FROM zweiter_faktor WHERE user_id = $1', [b])).geheimnis, /^v2:/);
    assert.equal(await zf.pruefeCode(b, zf.hotp(zf.ausBase32(totp), zf.zeitschritt())), 'totp');
    assert.deepEqual(await idem.beginne(a, 'alt-1', abdruck), { art: 'wiederholung', status: 200, antwort: '{"alt":true}' });
    assert.equal(fs.readFileSync(pdf).subarray(0, 7).toString('latin1'), 'BIENC2\n');
    assert.ok((await dateien.liesGutscheinPdf(pdf)).equals(PDF));
  });
});
