/**
 * The otpauth link of the second factor names the BrickInventory logo, so that
 * authenticator apps that read `image` show it. Without a base URL there is
 * no address under which the app could fetch the image; then it is missing.
 * The logo itself lies publicly under public/assets.
 *
 * Counter-check (07.11.2026): the image part deleted in otpauthAddress() →
 * red: “with a base URL the logo is in the link”.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const _req = require('./helpers/sources').buildAndRequire();

test('otpauth link with logo', async t => {
  // The base URL is passed in (k.konfig.appBaseUrl), not taken from the environment.
  const { otpauthAddress } = _req('src/factors/secondFactor.js');

  await t.test('with a base URL the logo is in the link', () => {
    const url = new URL(otpauthAddress('JBSWY3DPEHPK3PXP', 'marco', 'https://lego.example.org'));
    assert.equal(url.searchParams.get('image'), 'https://lego.example.org/assets/logo-256.png');
    assert.equal(url.searchParams.get('issuer'), 'BrickInventory');
  });

  await t.test('without a base URL no image', () => {
    const url = new URL(otpauthAddress('JBSWY3DPEHPK3PXP', 'marco', null));
    assert.equal(url.searchParams.get('image'), null);
  });

  await t.test('the logo lies as a PNG under public/assets', () => {
    const png = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'logo-256.png'));
    assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  });
});
