/**
 * The Android app as a party of the passkeys: /.well-known/assetlinks.json and the
 * origin `android:apk-key-hash:…` come from PASSKEY_ANDROID_CERTIFICATES.
 * Whether the server accepts the response of an app is checked by passkeys-db.test.js.
 *
 * Counter-checks (measured on 31.10.2026):
 *   A  in assetlinks() the colons left out (`hex` instead of `AB:CD:…`) →
 *      red: “the document names package and fingerprint …”
 *   B  in androidOrigins() base64 instead of base64url → red: “the origin is …”
 *   C  in androidZertifikate() the form check removed → red: “a wrong
 *      fingerprint … is a startup error …”
 *   D  the router in routes/wellKnown.ts without the path `.well-known` → red: “without
 *      an entry there is no document” and “the document names …”
 */
const test = require('node:test');
const { environment } = require('./helpers/sources');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildAndRequire } = require('./helpers/sources');
const { testServer } = require('./helpers/server');

const _req = buildAndRequire();
const { loadConfig, ConfigError } = _req('src/infra/config.js');
const { androidOrigins: origins } = _req('src/factors/androidApp.js');
const androidOrigins = () => origins(_req('src/infra/config.js').config());

/** A hash whose base64 contains a „+“ and a „/“: base64url must replace them. */
const HASH = Buffer.from('fbff' + '00'.repeat(28) + 'fbff', 'hex');
const WITH_COLON = HASH.toString('hex').toUpperCase().match(/../g).join(':');

function withEnvironment(t, values) {
  const vorher = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  environment(values);
  t.after(() => {
    for (const [k, v] of Object.entries(vorher)) {
      if (v === undefined) environment({ [k]: undefined });
      else environment({ [k]: v });
    }
  });
}

test('without an entry there is no document and no app origin', async t => {
  withEnvironment(t, { PASSKEY_ANDROID_CERTIFICATES: '' });
  const { base } = testServer(_req, { t });
  const r = await fetch(`${base}/.well-known/assetlinks.json`);
  assert.equal(r.status, 404);
  assert.match(await r.text(), /PASSKEY_ANDROID_CERTIFICATES/);
  assert.deepEqual(androidOrigins(), []);
});

test('the document names package and fingerprint, only for the credentials', async t => {
  withEnvironment(t, {
    PASSKEY_ANDROID_CERTIFICATES: HASH.toString('hex'),
    PASSKEY_ANDROID_PACKAGE: 'ch.brickinventoryapp.debug',
  });
  const { base } = testServer(_req, { t });
  const r = await fetch(`${base}/.well-known/assetlinks.json`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await r.json(), [
    {
      relation: ['delegate_permission/common.get_login_creds'],
      target: {
        namespace: 'android_app',
        package_name: 'ch.brickinventoryapp.debug',
        sha256_cert_fingerprints: [WITH_COLON],
      },
    },
  ]);
});

test('the origin is base64url of the hash, regardless of the notation it is entered in', t => {
  withEnvironment(t, { PASSKEY_ANDROID_CERTIFICATES: `${WITH_COLON.toLowerCase()}, ${HASH.toString('hex')}` });
  const erwartet =
    'android:apk-key-hash:' + HASH.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.match(HASH.toString('base64'), /[+/]/, 'The probe does not cover the replacement');
  assert.deepEqual(androidOrigins(), [erwartet], 'entered twice counts once');
});

test('a wrong fingerprint or package name is a startup error with a name', () => {
  const error = env => {
    try {
      loadConfig(env);
      return [];
    } catch (e) {
      assert.ok(e instanceof ConfigError);
      return e.error;
    }
  };
  assert.match(error({ PASSKEY_ANDROID_CERTIFICATES: 'AB:CD' }).join(), /PASSKEY_ANDROID_CERTIFICATES: AB:CD/);
  assert.match(
    error({ PASSKEY_ANDROID_CERTIFICATES: crypto.randomBytes(32).toString('hex') + 'x' }).join(),
    /kein SHA-256/,
  );
  assert.match(error({ PASSKEY_ANDROID_PACKAGE: 'kein paket' }).join(), /PASSKEY_ANDROID_PACKAGE/);
  assert.deepEqual(error({ PASSKEY_ANDROID_CERTIFICATES: crypto.randomBytes(32).toString('hex') }), []);
});
