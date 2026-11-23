/**
 * A downloaded instruction only lands in the shared cache (and goes
 * from there to all accounts) if it starts with `%PDF-`. Measured on
 * loadSetInstructions: the sources and the network are replaced, database
 * and disk are real.
 *
 * Counter-checks (measured on 08.11.2026, each alone):
 *   A  in loadSetInstructions() `PDF_START` no longer passed → red:
 *      “a file without %PDF- is not stored” (file lies there, path stands
 *      in the table)
 *   B  in downloadFile() the block `if (anfang && …)` removed → the same red
 *
 * Prerequisite: test DB via TEST_DATABASE_URL.
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
const ROOT_CERT = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-anleitung-'));
process.env.APP_ROOT = ROOT_CERT;
test.after(() => fs.rmSync(ROOT_CERT, { recursive: true, force: true }));

const S = require('./helpers/sources');
const _req = S.buildAndRequire();
const { dataOrSkip } = require('./helpers/db');

// The source names two addresses; what lies there is determined by the test.
const URLS = ['https://cdn.rebrickable.com/media/echt.pdf', 'https://cdn.rebrickable.com/media/seite.pdf'];
S.testSources(null, {
  scrapeInstructions: async () => URLS.map((url, i) => ({ url, description: `Anleitung ${i}` })),
});
const { loadSetInstructions } = _req('src/catalog/instructions.js');

const CONTENT = {
  [URLS[0]]: Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(3000, 7)]),
  [URLS[1]]: Buffer.concat([Buffer.from('<html>Bitte anmelden</html>'), Buffer.alloc(3000, 32)]),
};

test('instructions only with a PDF start', async t => {
  const db = await dataOrSkip(t, _req);
  if (!db) return;
  const sn = '99981-1';
  await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]);
  t.after(async () => {
    await db.run('DELETE FROM shared_instructions WHERE set_number = $1', [sn]).catch(() => {});
    await db.pool.end().catch(() => {});
  });
  const original = https.get;
  const fang = (/** @type {any} */ url, /** @type {any} */ _opt, /** @type {any} */ cb) => {
    /** @type {any} */ const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    /** @type {any} */ const res = new PassThrough();
    res.statusCode = 200;
    res.headers = {};
    setImmediate(() => {
      cb(res);
      res.end(CONTENT[String(url)]);
    });
    return req;
  };
  https.get = /** @type {any} */ (fang);
  t.after(() => {
    https.get = original;
  });

  await loadSetInstructions(sn, true);

  const lines = await db.all('SELECT url, local_path FROM shared_instructions WHERE set_number = $1 ORDER BY url', [
    sn,
  ]);
  const localPath = u => lines.find(z => z.url === u)?.local_path;
  const onDisk = rel => fs.existsSync(path.join(ROOT_CERT, rel));

  await t.test('a real PDF is stored and registered', () => {
    assert.ok(localPath(URLS[0]), 'the path is in the table');
    assert.ok(onDisk(localPath(URLS[0])), 'the file is on disk');
  });

  await t.test('a file without %PDF- is not stored', () => {
    assert.equal(localPath(URLS[1]), null, 'no path in the table without a file');
    assert.deepEqual(fs.readdirSync(path.join(ROOT_CERT, 'data', 'instructions')).sort(), [
      path.basename(localPath(URLS[0])),
    ]);
  });
});
