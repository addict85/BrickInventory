/**
 * Die Android-App als Partei der Passkeys: /.well-known/assetlinks.json und die
 * Herkunft `android:apk-key-hash:…` kommen aus PASSKEY_ANDROID_ZERTIFIKATE.
 * Ob der Server die Antwort einer App annimmt, prüft passkeys-db.test.js.
 *
 * Gegenproben (am 31.10.2026 gemessen):
 *   A  in assetlinks() die Doppelpunkte weggelassen (`hex` statt `AB:CD:…`) →
 *      rot: „das Dokument nennt Paket und Fingerabdruck …“
 *   B  in androidHerkuenfte() base64 statt base64url → rot: „die Herkunft ist …“
 *   C  in androidZertifikate() die Formprüfung entfernt → rot: „ein falscher
 *      Fingerabdruck ist ein Startfehler …“
 *   D  den Router in routes/wellKnown.ts ohne Pfad `.well-known` → rot: „ohne
 *      Eintrag gibt es kein Dokument“ und „das Dokument nennt …“
 */
const test = require('node:test');
const { umgebung } = require('./helpers/sources');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { buildAndRequire } = require('./helpers/sources');
const { testServer } = require('./helpers/server');

const _req = buildAndRequire();
const { ladeKonfig, KonfigFehler } = _req('src/infra/konfig.js');
const { androidHerkuenfte } = _req('src/konto/androidApp.js');

/** Ein Hash, dessen base64 ein „+“ und ein „/“ enthält: base64url muss sie ersetzen. */
const HASH = Buffer.from('fbff' + '00'.repeat(28) + 'fbff', 'hex');
const MIT_DOPPELPUNKT = HASH.toString('hex').toUpperCase().match(/../g).join(':');

function mitUmgebung(t, werte) {
  const vorher = Object.fromEntries(Object.keys(werte).map(k => [k, process.env[k]]));
  umgebung(werte);
  t.after(() => {
    for (const [k, v] of Object.entries(vorher)) { if (v === undefined) umgebung({ [k]: undefined }); else umgebung({ [k]: v }); }
  });
}

test('ohne Eintrag gibt es kein Dokument und keine App-Herkunft', async (t) => {
  mitUmgebung(t, { PASSKEY_ANDROID_ZERTIFIKATE: '' });
  const { base } = testServer(_req, { routen: { '/': 'routes/wellKnown.js' }, t });
  const r = await fetch(`${base}/.well-known/assetlinks.json`);
  assert.equal(r.status, 404);
  assert.match(await r.text(), /PASSKEY_ANDROID_ZERTIFIKATE/);
  assert.deepEqual(androidHerkuenfte(), []);
});

test('das Dokument nennt Paket und Fingerabdruck, nur für die Anmeldedaten', async (t) => {
  mitUmgebung(t, { PASSKEY_ANDROID_ZERTIFIKATE: HASH.toString('hex'), PASSKEY_ANDROID_PAKET: 'ch.brickinventoryapp.debug' });
  const { base } = testServer(_req, { routen: { '/': 'routes/wellKnown.js' }, t });
  const r = await fetch(`${base}/.well-known/assetlinks.json`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await r.json(), [{
    relation: ['delegate_permission/common.get_login_creds'],
    target: { namespace: 'android_app', package_name: 'ch.brickinventoryapp.debug',
      sha256_cert_fingerprints: [MIT_DOPPELPUNKT] },
  }]);
});

test('die Herkunft ist base64url des Hashes, gleich in welcher Schreibweise er eingetragen ist', (t) => {
  mitUmgebung(t, { PASSKEY_ANDROID_ZERTIFIKATE: `${MIT_DOPPELPUNKT.toLowerCase()}, ${HASH.toString('hex')}` });
  const erwartet = 'android:apk-key-hash:' + HASH.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.match(HASH.toString('base64'), /[+/]/, 'Die Probe deckt die Ersetzung nicht ab');
  assert.deepEqual(androidHerkuenfte(), [erwartet], 'Doppelt eingetragen zählt einmal');
});

test('ein falscher Fingerabdruck oder Paketname ist ein Startfehler mit Namen', () => {
  const fehler = (env) => { try { ladeKonfig(env); return []; } catch (e) { assert.ok(e instanceof KonfigFehler); return e.fehler; } };
  assert.match(fehler({ PASSKEY_ANDROID_ZERTIFIKATE: 'AB:CD' }).join(), /PASSKEY_ANDROID_ZERTIFIKATE: AB:CD/);
  assert.match(fehler({ PASSKEY_ANDROID_ZERTIFIKATE: crypto.randomBytes(32).toString('hex') + 'x' }).join(), /kein SHA-256/);
  assert.match(fehler({ PASSKEY_ANDROID_PAKET: 'kein paket' }).join(), /PASSKEY_ANDROID_PAKET/);
  assert.deepEqual(fehler({ PASSKEY_ANDROID_ZERTIFIKATE: crypto.randomBytes(32).toString('hex') }), []);
});
