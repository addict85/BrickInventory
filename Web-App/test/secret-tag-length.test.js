/**
 * AES-GCM öffnet nur mit vollem 16-Byte-Tag (src/infra/secret.ts): Ein Geheimtext mit
 * gekürztem Tag oder zu kurzer Wert ist unlesbar, ein regulärer bleibt lesbar.
 *
 * Gegenproben (16.11.2026 gemessen):
 *   A  in oeffne() `authTagLength` und die Mindestlänge gestrichen → rot: „ein 4-Byte-Tag …“
 *      (der leere Klartext wurde angenommen, Wert und Datei)
 *   B  nur die Mindestlänge gestrichen (authTagLength bleibt) → grün: Node lehnt dann den
 *      kurzen Tag selbst ab; die Mindestlänge ist zweite Linie, rot wird nur A
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATA_KEY = crypto.randomBytes(32).toString('base64');
const { buildAndRequire } = require('./helpers/sources');
const _req = buildAndRequire();
const g = _req('src/infra/secret.js');

/** Derselbe Teilschlüssel wie v2Key(): Der Test fälscht, was ein Angreifer probieren würde. */
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
  const k = g.kontext('test', 1);
  const kurz = withRecentlyTag('', k, 4);
  assert.equal(g.decrypt(`v2:${kurz.toString('base64')}`, k), null);
  assert.equal(g.decryptBuffer(Buffer.concat([Buffer.from('BIENC2\n'), kurz]), k), null);
  assert.equal(g.decrypt(g.encrypt('geheim', k), k), 'geheim');
  assert.equal(g.decrypt(`v2:${Buffer.alloc(20).toString('base64')}`, k), null, 'zu kurz');
});
