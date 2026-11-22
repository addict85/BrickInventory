/**
 * AES-GCM only opens with the full 16-byte tag (src/infra/secret.ts): a ciphertext with
 * a shortened tag or a value that is too short is unreadable, a regular one stays readable.
 *
 * Counter-checks (measured 16.11.2026):
 *   A  `authTagLength` and the minimum length deleted in oeffne() → red: “a 4-byte tag …”
 *      (the empty plain text was accepted, value and file)
 *   B  only the minimum length deleted (authTagLength stays) → green: Node then rejects the
 *      short tag itself; the minimum length is the second line, only A turns red
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATA_KEY = crypto.randomBytes(32).toString('base64');
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const g = _req('src/infra/secret.js');

/** The same subkey as v2Key(): the test forges what an attacker would try. */
const v2 = Buffer.from(
  crypto.hkdfSync(
    'sha256',
    Buffer.from(process.env.DATA_KEY, 'base64'),
    Buffer.alloc(0),
    'brickinventory/geheimnis/v2',
    32,
  ),
);
function withRecentlyTag(klar, k, laenge) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', v2, iv, { authTagLength: laenge });
  c.setAAD(Buffer.from(k, 'utf8'));
  const inhalt = Buffer.concat([c.update(Buffer.from(klar, 'utf8')), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), inhalt]);
}

test('a 4-byte tag is not accepted, a full one is', () => {
  const k = g.context('test', 1);
  const kurz = withRecentlyTag('', k, 4);
  assert.equal(g.decrypt(`v2:${kurz.toString('base64')}`, k), null);
  assert.equal(g.decryptBuffer(Buffer.concat([Buffer.from('BIENC2\n'), kurz]), k), null);
  assert.equal(g.decrypt(g.encrypt('geheim', k), k), 'geheim');
  assert.equal(g.decrypt(`v2:${Buffer.alloc(20).toString('base64')}`, k), null, 'too short');
});
