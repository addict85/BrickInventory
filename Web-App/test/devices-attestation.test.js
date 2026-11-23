/**
 * The check of Android Key Attestation (src/devices/attestation) on
 * self-generated chains with an own root (helpers/attestation.js): a
 * chain like the keystore's passes, every deviation that would reveal a key
 * without hardware, without lock or of a foreign app does not.
 *
 * Counter-checks (measured 11.11.2026):
 *   A  in checkDescription() the check for 'software' deleted → red:
 *      “a software key …”
 *   B  in checkLinks() `if (!anker) return 'fremde_wurzel'` deleted → red:
 *      “a foreign root …” (TypeError → kette_unlesbar instead of fremde_wurzel)
 *   C  the package check `packages[0] !== e.pkg` deleted → red: “a foreign package …”
 *   D  in checkLinks() `!c.verify(...)` deleted → red: “a slipped-in leaf …”
 *   E  in checkDescription() the check for noAuthRequired deleted → red:
 *      “a key without lock …”
 *   F  a digit changed in FINGERPRINTS → red: “the Google roots …”
 *   G  in readTlv() the length check `p + laenge > b.length` deleted → red:
 *      “truncated bytes …”
 *
 * Counter-checks for revocation list, RootOfTrust and patch level (measured 14.11.2026):
 *   H  in checkChain() the line with `e.revoked.has(…)` deleted → red:
 *      “a chain with a revoked serial number …”
 *   I  in seriennummer() `.replace(/^0+(?=.)/, '')` deleted → red: “… also with
 *      a leading zero …”
 *   J  in checkBoot() the check for BOOT_VERIFIED deleted → red:
 *      “a device with unverified boot …”
 *   K  in checkBoot() `if (!gesperrt[0]) return 'bootloader_offen'` deleted →
 *      red: “an open bootloader …”
 *   L  in checkDescription() the patch level line deleted → red: “a
 *      patch level below the minimum …”
 *   M  in readRevocationList() the check of the key (hex) deleted → red:
 *      “a list in another shape …”
 *   N  in applicableList() the age limit deleted → red: “a too old list …”
 *
 * Counter-checks for the issuers (measured 15.11.2026):
 *   O  in checkLinks() `|| attestationExtension(roh[i])` deleted → red: “an
 *      attested key as issuer …” (the case with CA bit)
 *   P  in checkLinks() `!c.ca ||` deleted → red: “an issuer without CA bit or
 *      without keyCertSign …” (ca of node:crypto also checks keyUsage)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { X509Certificate, generateKeyPairSync } = require('node:crypto');
const _req = require('./helpers/sources').buildAndRequire();
const A = _req('src/devices/attestation/keyAttestation.js');
const asn1 = _req('src/devices/attestation/der.js');
const G = _req('src/devices/attestation/googleRoots.js');
const W = _req('src/devices/attestation/revocationList.js');
const T = require('./helpers/attestation');
const fs = require('node:fs');
const path = require('node:path');

const NONCE = Buffer.from('nonce-des-servers-32-bytes-lang!');
const expectation = (o = {}) => ({
  roots: [new X509Certificate(T.ROOT_CERT.pem)],
  pkg: T.PACKAGE,
  digests: [T.DIGEST_HEX],
  revoked: new Set(),
  now: new Date(),
  ...o,
});
const check = (k, e = expectation()) => A.checkChain(k.chain, e);
const reason = (k, e) => {
  const p = check(k, e);
  return p.ok ? 'angenommen' : p.reason;
};

test("a chain like the keystore's goes through, with challenge and key of the leaf", () => {
  const k = T.chain({ challenge: NONCE });
  const p = check(k);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.challenge, NONCE);
  assert.equal(p.confidence, 'tee');
  assert.equal(p.public_key.export({ format: 'der', type: 'spki' }).toString('base64'), k.public_key);
  assert.equal(check(T.chain({ challenge: NONCE, confidence: 2 })).confidence, 'strongbox');
});

test('a software key is rejected', () => {
  assert.equal(reason(T.chain({ challenge: NONCE, confidence: 0 })), 'nur_software');
});

test('a foreign root is rejected, even with an otherwise valid chain', () => {
  const fremd = T.newRoot('Fremde Wurzel');
  assert.equal(reason(T.chain({ challenge: NONCE, root: fremd })), 'fremde_wurzel');
  // The Google roots do not accept the test chain either.
  const google = expectation({ roots: G.GOOGLE_ROOTS.map(p => new X509Certificate(p)) });
  assert.equal(reason(T.chain({ challenge: NONCE }), google), 'fremde_wurzel');
});

test('a foreign package or a foreign signature is rejected', () => {
  assert.equal(reason(T.chain({ challenge: NONCE, pkg: 'com.boese.app' })), 'fremdes_paket');
  assert.equal(reason(T.chain({ challenge: NONCE, digest: Buffer.alloc(32, 7) })), 'fremde_signatur');
  assert.equal(
    reason(T.chain({ challenge: NONCE }), expectation({ digests: [] })),
    'fremde_signatur',
    'Without a configured fingerprint the server accepts no app',
  );
});

test('a key without lock, with a timeout or imported is rejected', () => {
  assert.equal(reason(T.chain({ challenge: NONCE, withoutLock: true })), 'ohne_sperre');
  assert.equal(reason(T.chain({ challenge: NONCE, alsoWithoutLogin: true })), 'ohne_sperre');
  assert.equal(reason(T.chain({ challenge: NONCE, deadline: 300 })), 'sperre_mit_frist');
  assert.equal(reason(T.chain({ challenge: NONCE, provenance: 2 })), 'importiert');
  assert.equal(reason(T.chain({ challenge: NONCE, curve: 2 })), 'kein_ec_p256');
});

test('a slipped-in leaf (signed by a stranger) and a chain without extension are rejected', () => {
  const original = T.chain({ challenge: NONCE });
  const fremd = T.chain({ challenge: NONCE });
  // Leaf from one chain, intermediate from another: same names, wrong signature.
  assert.equal(reason({ chain: [fremd.chain[0], original.chain[1], original.chain[2]] }), 'glied_0_signatur');
  assert.equal(reason(T.chain({ challenge: NONCE, withoutExtension: true })), 'ohne_attestation');
  assert.equal(reason({ chain: [] }), 'kette_laenge');
  assert.equal(reason({ chain: ['AAAA'] }), 'kette_unlesbar');
});

test('the KeyDescription reads challenge, level and app identifier', () => {
  const b = A.readDescription(T.description({ challenge: NONCE, confidence: 2 }));
  assert.deepEqual([b.version, b.confidence, b.challenge.toString()], [300, 'strongbox', NONCE.toString()]);
  const app = A.readAppId(b.software.get(709));
  assert.deepEqual(app, { packages: [T.PACKAGE], digests: [T.DIGEST_HEX] });
});

test('truncated bytes and indefinite lengths throw instead of guessing', () => {
  const whole = T.description({ challenge: NONCE });
  for (const broken of [
    whole.subarray(0, whole.length - 3),
    Buffer.from([0x30, 0x80, 0x00, 0x00]),
    Buffer.from([0x30, 0x84, 1, 0, 0, 0]),
  ])
    assert.throws(() => A.readDescription(broken), asn1.TheError);
  assert.throws(() => asn1.readWhole(Buffer.from([0x05, 0x00, 0x00])), /hinter dem Element/);
  assert.throws(() => asn1.readTlv(Buffer.from([0x04, 0x05, 1, 2])), /über das Ende/);
  assert.equal(asn1.readTlv(Buffer.from([0xbf, 0x85, 0x45, 0x02, 0x05, 0x00])).tlv.number, 709);
});

test('the Google roots match their fingerprints', () => {
  assert.ok(G.GOOGLE_ROOTS.length >= 2);
  assert.deepEqual(
    G.GOOGLE_ROOTS.map(p => new X509Certificate(p).fingerprint256),
    [...G.FINGERPRINTS],
  );
  for (const p of G.GOOGLE_ROOTS) assert.equal(new X509Certificate(p).ca, true);
});

const series = b64 => A.serialNumber(new X509Certificate(Buffer.from(b64, 'base64')));

test('a chain with a revoked serial number is rejected, regardless of the link', () => {
  const k = T.chain({ challenge: NONCE });
  assert.equal(reason(k), 'angenommen');
  for (const link of k.chain) assert.equal(reason(k, expectation({ revoked: new Set([series(link)]) })), 'widerrufen');
  assert.equal(reason(k, expectation({ revoked: new Set(['abc', '1']) })), 'angenommen');
});

test("the serial number stands as in Google's list: hex lower case, without the leading zero", () => {
  const c = { serialNumber: '00A1B2' };
  assert.equal(A.serialNumber(c), 'a1b2');
  assert.equal(A.serialNumber({ serialNumber: '00' }), '0');
  const list = W.readRevocationList(JSON.stringify({ entries: { '00A1B2': { status: 'REVOKED' } } }));
  assert.deepEqual(list, ['a1b2']);
});

test('a device with unverified boot, unlocked bootloader or without RootOfTrust is rejected', () => {
  assert.equal(reason(T.chain({ challenge: NONCE, bootState: 2 })), 'boot_unverifiziert');
  assert.equal(reason(T.chain({ challenge: NONCE, bootState: 1 })), 'boot_unverifiziert', 'SelfSigned');
  assert.equal(reason(T.chain({ challenge: NONCE, bootState: 3 })), 'boot_unverifiziert', 'Failed');
  assert.equal(reason(T.chain({ challenge: NONCE, openBootloader: true })), 'bootloader_offen');
  assert.equal(reason(T.chain({ challenge: NONCE, withoutRootOfTrust: true })), 'ohne_root_of_trust');
});

test('a patch level below the minimum is rejected, without a minimum every one is accepted', () => {
  const k = T.chain({ challenge: NONCE, patch: 202608 });
  assert.equal(reason(k), 'angenommen');
  assert.equal(reason(k, expectation({ patchAtLeast: 202608 })), 'angenommen');
  assert.equal(reason(k, expectation({ patchAtLeast: 202609 })), 'patchstand_alt');
});

test("Google's list is read; a list in a different shape throws instead of half applying", () => {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'attestation-status-excerpt.json'));
  const numbers = W.readRevocationList(raw);
  assert.equal(numbers.length, 5);
  assert.ok(numbers.includes('c35747a084470c3135aeefe2b8d40cd6'));
  assert.ok(numbers.includes('17471682139930361099'), 'SOFTWARE_FLAW counts too');
  for (const broken of [
    '',
    '[]',
    '{"entries": []}',
    '{"eintraege": {}}',
    '{"entries": {"xyz": {"status": "REVOKED"}}}',
    '{"entries": {"ab": {}}}',
  ])
    assert.throws(() => W.readRevocationList(broken), broken);
});

test('a stored list that is too old, missing or damaged does not apply', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const value = days =>
    JSON.stringify({ state: new Date(now.getTime() - days * 86_400_000).toISOString(), nummern: ['ab'] });
  assert.deepEqual([...W.applicableList(value(6.9), 7, now)], ['ab']);
  assert.equal(W.applicableList(value(7.1), 7, now), null);
  assert.equal(W.applicableList(value(-1), 7, now), null, 'from the future');
  assert.equal(W.applicableList(null, 7, now), null);
  assert.equal(W.applicableList('{kaputt', 7, now), null);
  assert.equal(W.applicableList(JSON.stringify({ state: now.toISOString() }), 7, now), null);
});

/** Root → intermediate → middle link → leaf; the leaf carries an invented
 * KeyDescription (StrongBox), the middle link is optionally itself an attested key.
 * @param {{ attested?: boolean, ca?: boolean, keyUsage?: Buffer }} [o] keyUsage: content of the BIT STRING */
function chainWithMiddleLink({ attested = false, ca = false, keyUsage } = {}) {
  const fresh = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const [zw, mean, blatt] = [fresh(), fresh(), fresh()];
  const att = confidence =>
    T.seq(T.oid('1.3.6.1.4.1.11129.2.1.17'), T.octets(T.description({ challenge: NONCE, confidence })));
  const zThe = T.certificate({
    subject: 'Test-Zwischenstufe',
    issuer: T.ROOT_CERT.cn,
    public_key: zw.publicKey,
    signer: T.ROOT_CERT.privateKey,
    ca: true,
  });
  const mThe = T.certificate({
    subject: 'Android Keystore Key',
    issuer: 'Test-Zwischenstufe',
    public_key: mean.publicKey,
    signer: zw.privateKey,
    ca,
    extensions: [
      ...(attested ? [att(0)] : []),
      ...(keyUsage ? [T.seq(T.oid('2.5.29.15'), T.octets(T.tlv([0x03], keyUsage)))] : []),
    ],
  });
  const bThe = T.certificate({
    subject: 'Gefälschter Schlüssel',
    issuer: 'Android Keystore Key',
    public_key: blatt.publicKey,
    signer: mean.privateKey,
    extensions: [att(2)],
  });
  return { chain: [bThe, mThe, zThe, T.ROOT_CERT.certBytes].map(d => d.toString('base64')) };
}

test('an attested key as the issuer of a leaf is rejected, even with the CA bit', () => {
  assert.equal(reason(chainWithMiddleLink({ attested: true })), 'glied_1_kein_aussteller');
  assert.equal(reason(chainWithMiddleLink({ attested: true, ca: true })), 'glied_1_kein_aussteller');
});

test('an issuer without CA bit or without keyCertSign is rejected, accepted with both', () => {
  assert.equal(reason(chainWithMiddleLink()), 'glied_1_kein_aussteller');
  // keyUsage only digitalSignature: 7 unused bits, bit 0 set.
  assert.equal(
    reason(chainWithMiddleLink({ ca: true, keyUsage: Buffer.from([0x07, 0x80]) })),
    'glied_1_kein_aussteller',
  );
  // keyCertSign (bit 5): the control that the check does not reject every chain.
  assert.equal(reason(chainWithMiddleLink({ ca: true, keyUsage: Buffer.from([0x02, 0x04]) })), 'angenommen');
  assert.equal(reason(chainWithMiddleLink({ ca: true })), 'angenommen');
});
