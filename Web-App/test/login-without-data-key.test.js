/**
 * Without a data key the login brake aborts instead of storing name and address with
 * an unkeyed SHA-256 (which could be brute-forced for small value
 * ranges).
 *
 * Counter-check (measured 14.11.2026): in namedDigest() and adressDigest() again
 * `try { searchValue(…) } catch { createHash('sha256')… }` → red: „Missing expected
 * rejection“ (the brake kept counting without a key).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// A place where no key lies and none can be created.
const sperre = fs.mkdtempSync(path.join(os.tmpdir(), 'ohne-schluessel-'));
fs.writeFileSync(path.join(sperre, 'datei'), '');
delete process.env.DATA_KEY;
process.env.DATA_KEY_FILE = path.join(sperre, 'datei', 'unter', 'datenschluessel');

const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const limiter = _req('src/account/loginLimiter.js');

test('without a data key the login brake refuses instead of hashing unkeyed', async () => {
  await assert.rejects(
    limiter.loginAllowed('203.0.113.5', `ohne_schluessel_${process.pid}`),
    /unter[\\/]datenschluessel|ENOTDIR/,
  );
  fs.rmSync(sperre, { recursive: true, force: true });
});
