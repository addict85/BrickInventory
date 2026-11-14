/**
 * Eine heruntergeladene Anleitung landet nur im gemeinsamen Cache (und geht
 * von dort an alle Konten), wenn sie mit `%PDF-` beginnt. Gemessen an
 * downloadSetInstructions: Die Quellen und das Netz sind ersetzt, Datenbank
 * und Platte sind echt.
 *
 * Gegenproben (am 08.11.2026 gemessen, je einzeln):
 *   A  in downloadSetInstructions() `PDF_ANFANG` nicht mehr übergeben → rot:
 *      „eine Datei ohne %PDF- wird nicht abgelegt“ (Datei liegt, Pfad steht
 *      in der Tabelle)
 *   B  in downloadFile() den Block `if (anfang && …)` entfernt → dasselbe rot
 *
 * Voraussetzung: Test-DB via TEST_DATABASE_URL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://tester:test@localhost/cattest';
const WURZEL = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-anleitung-'));
process.env.APP_ROOT = WURZEL;
test.after(() => fs.rmSync(WURZEL, { recursive: true, force: true }));

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { datenOderSkip } = require('./helpers/db');

// Die Quelle nennt zwei Adressen; was dort liegt, bestimmt der Test.
const URLS = ['https://cdn.rebrickable.com/media/echt.pdf', 'https://cdn.rebrickable.com/media/seite.pdf'];
S.testQuellen(null, {
  scrapeInstructions: async () => URLS.map((url, i) => ({ url, description: `Anleitung ${i}` })),
});
const { downloadSetInstructions } = _req('src/katalog/instructions.js');

const INHALT = {
  [URLS[0]]: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(3000, 7)]),
  [URLS[1]]: Buffer.concat([Buffer.from('<html>Bitte anmelden</html>'), Buffer.alloc(3000, 32)]),
};

test('Anleitungen nur mit PDF-Anfang', async t => {
  const db = await datenOderSkip(t, _req);
  if (!db) return;
  const sn = '99981-1';
  await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]);
  t.after(async () => {
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const echt = https.get;
  const fang = (/** @type {any} */ url, /** @type {any} */ _opt, /** @type {any} */ cb) => {
    /** @type {any} */ const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    /** @type {any} */ const res = new PassThrough();
    res.statusCode = 200;
    res.headers = {};
    setImmediate(() => {
      cb(res);
      res.end(INHALT[String(url)]);
    });
    return req;
  };
  https.get = /** @type {any} */ (fang);
  t.after(() => {
    https.get = echt;
  });

  await downloadSetInstructions(sn, true);

  const zeilen = await db.all('SELECT url, local_path FROM shared_instructions WHERE set_number = $1 ORDER BY url', [
    sn,
  ]);
  const pfad = u => zeilen.find(z => z.url === u)?.local_path;
  const aufPlatte = rel => fs.existsSync(path.join(WURZEL, rel));

  await t.test('ein echtes PDF wird abgelegt und eingetragen', () => {
    assert.ok(pfad(URLS[0]), 'der Pfad steht in der Tabelle');
    assert.ok(aufPlatte(pfad(URLS[0])), 'die Datei liegt auf der Platte');
  });

  await t.test('eine Datei ohne %PDF- wird nicht abgelegt', () => {
    assert.equal(pfad(URLS[1]), null, 'ohne Datei kein Pfad in der Tabelle');
    assert.deepEqual(fs.readdirSync(path.join(WURZEL, 'data', 'instructions')).sort(), [path.basename(pfad(URLS[0]))]);
  });
});
