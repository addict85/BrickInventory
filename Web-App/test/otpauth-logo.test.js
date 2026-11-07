/**
 * Der otpauth-Link des zweiten Faktors nennt das BrickInventory-Logo, damit
 * Authenticator-Apps, die `image` lesen, es zeigen. Ohne Basis-URL gibt es
 * keine Adresse, unter der die App das Bild holen könnte; dann fehlt es.
 * Das Logo selbst liegt öffentlich unter public/assets.
 *
 * Gegenprobe (07.11.2026): in otpauthAdresse() den image-Teil gestrichen →
 * rot: „mit Basis-URL steht das Logo im Link“.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();

test('otpauth-Link mit Logo', async t => {
  const vorher = process.env.APP_BASE_URL;
  t.after(() => {
    if (vorher === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = vorher;
  });
  const { otpauthAdresse } = _req('src/konto/zweiterFaktor.js');

  await t.test('mit Basis-URL steht das Logo im Link', () => {
    process.env.APP_BASE_URL = 'https://lego.example.org/';
    const url = new URL(otpauthAdresse('JBSWY3DPEHPK3PXP', 'marco'));
    assert.equal(url.searchParams.get('image'), 'https://lego.example.org/assets/logo-256.png');
    assert.equal(url.searchParams.get('issuer'), 'BrickInventory');
  });

  await t.test('ohne Basis-URL kein image', () => {
    delete process.env.APP_BASE_URL;
    const url = new URL(otpauthAdresse('JBSWY3DPEHPK3PXP', 'marco'));
    assert.equal(url.searchParams.get('image'), null);
  });

  await t.test('das Logo liegt als PNG unter public/assets', () => {
    const png = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'logo-256.png'));
    assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  });
});
