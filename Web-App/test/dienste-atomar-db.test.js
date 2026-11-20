/**
 * Mehrstufige Schreibvorgänge der Dienste sind atomar: Konto und Protokoll,
 * Gutscheinzeile und PDF, Lesen und Schreiben beim Ändern eines Gutscheins.
 *
 * Gegenproben (13.11.2026 gemessen, je einzeln, dist neu gebaut):
 *   A  putAccountAn (src/konto/konten.ts) ohne db.transaction, der Rumpf direkt →
 *      rot: „scheitert der Protokolleintrag, gibt es kein Konto“
 *   B  aktivSetzen (src/konto/verwalterAktionen.ts) ohne withAccessEnd → rot:
 *      „… bleibt das Konto aktiv“
 *   C  createVoucherWithPdf (src/vouchers/service.ts) ohne das Löschen im
 *      catch → rot: „… keine verwaiste Datei“
 *   D  createVoucherWithPdf ohne db.transaction → rot: „… keine Gutscheinzeile“
 *   E  changeVoucher liest mit voucher() statt lockedVoucher() → rot:
 *      „zwei gleichzeitige Änderungen“ (der Betrag des ersten ging verloren)
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
require('./helpers/systemrahmen');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';

const quellen = require('./helpers/sources');
const _req = quellen.buildAndRequire();
const { accessOrSkip } = require('./helpers/db');

/** Vor dem Laden der Dienste: Sie halten das Modulobjekt, das sie beim Laden bekommen. */
const replace = (rel, zusatz) => {
  const pfad = require.resolve(path.join(quellen.DIST, rel));
  _req(rel);
  require.cache[pfad].exports = Object.assign({}, require.cache[pfad].exports, zusatz);
};
const stoerung = { protokoll: false, rememberPdf: false, writePdf: false };
const kaputt = was => {
  throw new Error(`Störung: ${was}`);
};
const realLog = _req('src/konto/repository/protokoll.js');
replace('src/konto/repository/protokoll.js', {
  protokolliere: (...a) => (stoerung.protokoll ? kaputt('protokoll') : realLog.protokolliere(...a)),
});
const realFiles = _req('src/vouchers/voucherFiles.js');
replace('src/vouchers/voucherFiles.js', {
  writeVoucherPdf: (...a) => (stoerung.writePdf ? kaputt('pdf') : realFiles.writeVoucherPdf(...a)),
});

/** Zwei Leser: Der erste wartet nach dem Lesen, bis der zweite zu lesen begonnen
 * hat. Ohne Zeilensperre lesen dann beide denselben alten Stand. */
let limit = null;
const echtRepo = _req('src/vouchers/repository/vouchers.js');
const withLimit =
  name =>
  async (...a) => {
    const s = limit;
    const ich = s ? ++s.n : 0;
    if (ich === 2) s.secondDa();
    const z = await echtRepo[name](...a);
    if (ich === 1) await s.zweiter;
    return z;
  };
replace('src/vouchers/repository/vouchers.js', {
  voucher: withLimit('voucher'),
  lockedVoucher: withLimit('lockedVoucher'),
  rememberVoucherPdf: (...a) => (stoerung.rememberPdf ? kaputt('pdf merken') : echtRepo.rememberVoucherPdf(...a)),
});

test('Dienste schreiben ganz oder gar nicht', { concurrency: 1, timeout: 60_000 }, async t => {
  const db = await accessOrSkip(t, _req);
  if (!db) return;
  const NAME = `atomar-${process.pid}`;
  await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
  const neu = async (n, admin = false) =>
    (
      await db.get(`INSERT INTO users (username, password_hash, is_admin) VALUES ($1, 'x', $2) RETURNING id`, [
        n,
        admin,
      ])
    ).id;
  const chef = await neu(`${NAME}-chef`, true);
  const nutzer = await neu(`${NAME}-nutzer`);
  const K = require('./helpers/sources').testServices().konto;
  const G = _req('src/vouchers/service.js');
  const ordner = path.join(_req('src/vouchers/index.js').VOUCHER_DIR, String(nutzer));
  t.after(async () => {
    fs.rmSync(ordner, { recursive: true, force: true });
    await db.run('DELETE FROM users WHERE username LIKE $1', [`${NAME}%`]);
    await db.pool.end().catch(() => {});
  });
  const disrupt = async (was, work) => {
    stoerung[was] = true;
    try {
      await assert.rejects(work, /Störung/);
    } finally {
      stoerung[was] = false;
    }
  };

  await t.test('scheitert der Protokolleintrag, gibt es kein Konto', async () => {
    await disrupt('protokoll', () => K.putAccountAn(chef, `${NAME}-neu`, 'Ein-Langes-Passwort-2026', false));
    assert.equal(await db.get('SELECT id FROM users WHERE username = $1', [`${NAME}-neu`]), undefined);
    // Ohne Störung entstehen Konto und Eintrag zusammen.
    const id = await K.putAccountAn(chef, `${NAME}-neu`, 'Ein-Langes-Passwort-2026', false);
    const eintrag = await db.get('SELECT action FROM admin_log WHERE target_id = $1', [id]);
    assert.equal(eintrag?.action, 'konto_angelegt');
  });

  await t.test('scheitert der Protokolleintrag beim Sperren, bleibt das Konto aktiv', async () => {
    await disrupt('protokoll', () => K.verwalter.aktivSetzen(chef, nutzer, false));
    assert.equal((await db.get('SELECT is_active FROM users WHERE id = $1', [nutzer])).is_active, true);
  });

  const pdf = Buffer.from('%PDF-1.4\n% Test\n');
  const zeilen = async () => (await db.all('SELECT id FROM vouchers WHERE user_id = $1', [nutzer])).length;
  const dateien = () => (fs.existsSync(ordner) ? fs.readdirSync(ordner).filter(n => n.endsWith('.pdf')) : []);

  await t.test('scheitert das Merken des Pfads, bleibt keine Gutscheinzeile und keine verwaiste Datei', async () => {
    const w = { number: '6000111122223333', pin: '123', amount: 25, currency: 'EUR' };
    await disrupt('rememberPdf', () => G.createVoucherWithPdf(nutzer, w, pdf));
    assert.equal(await zeilen(), 0);
    assert.deepEqual(dateien(), []);
    await disrupt('writePdf', () => G.createVoucherWithPdf(nutzer, w, pdf));
    assert.equal(await zeilen(), 0);
    // Ohne Störung: Zeile und Datei, und die Zeile kennt die Datei.
    const z = await G.createVoucherWithPdf(nutzer, w, pdf);
    assert.equal(z.pdf_path, `${nutzer}/${z.id}.pdf`);
    assert.deepEqual(dateien(), [`${z.id}.pdf`]);
    assert.deepEqual(await G.voucherPdf(nutzer, z.id), pdf);
  });

  await t.test('zwei gleichzeitige Änderungen verlieren keine', async () => {
    const z = await G.createVoucher(nutzer, { number: '6000444455556666', pin: '111', amount: 10 });
    let secondDa;
    limit = { n: 0, zweiter: new Promise(r => (secondDa = r)) };
    limit.secondDa = secondDa;
    try {
      await Promise.all([
        G.changeVoucher(nutzer, z.id, { amount: 42 }),
        G.changeVoucher(nutzer, z.id, { pin: '999', number: G.masked(z).number }),
      ]);
    } finally {
      limit = null;
    }
    const jetzt = await G.voucherPlaintext(nutzer, z.id);
    assert.equal(Number(jetzt.amount), 42, 'der Betrag der ersten Änderung ging verloren');
    assert.equal(jetzt.pin, '999');
    assert.equal(jetzt.number, '6000444455556666');
  });
});
