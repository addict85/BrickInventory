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
 *   C  the package check `packages[0] !== e.paket` deleted → red: “a foreign package …”
 *   D  in checkLinks() `!c.verify(...)` deleted → red: “a slipped-in leaf …”
 *   E  in checkDescription() the check for noAuthRequired deleted → red:
 *      “a key without lock …”
 *   F  a digit changed in FINGERPRINTS → red: “the Google roots …”
 *   G  in liesTlv() the length check `p + laenge > b.length` deleted → red:
 *      “truncated bytes …”
 *
 * Counter-checks for revocation list, RootOfTrust and patch level (measured 14.11.2026):
 *   H  in checkChain() the line with `e.widerrufen.has(…)` deleted → red:
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
const der = _req('src/devices/attestation/der.js');
const G = _req('src/devices/attestation/googleRoots.js');
const W = _req('src/devices/attestation/revocationList.js');
const T = require('./helpers/attestation');
const fs = require('node:fs');
const path = require('node:path');

const NONCE = Buffer.from('nonce-des-servers-32-bytes-lang!');
const expectation = (o = {}) => ({
  roots: [new X509Certificate(T.WURZEL.pem)],
  paket: T.PAKET,
  digests: [T.DIGEST_HEX],
  widerrufen: new Set(),
  now: new Date(),
  ...o,
});
const pruefe = (k, e = expectation()) => A.checkChain(k.chain, e);
const reason = (k, e) => {
  const p = pruefe(k, e);
  return p.ok ? 'angenommen' : p.reason;
};

test("a chain like the keystore's goes through, with challenge and key of the leaf", () => {
  const k = T.chain({ challenge: NONCE });
  const p = pruefe(k);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.challenge, NONCE);
  assert.equal(p.confidence, 'tee');
  assert.equal(p.public_key.export({ format: 'der', type: 'spki' }).toString('base64'), k.public_key);
  assert.equal(pruefe(T.chain({ challenge: NONCE, confidence: 2 })).confidence, 'strongbox');
});

test('a software key is rejected', () => {
  assert.equal(reason(T.chain({ challenge: NONCE, confidence: 0 })), 'nur_software');
});

test('a foreign root is rejected, even with an otherwise valid chain', () => {
  const fremd = T.newRoot('Fremde Wurzel');
  assert.equal(reason(T.chain({ challenge: NONCE, wurzel: fremd })), 'fremde_wurzel');
  // The Google roots do not accept the test chain either.
  const google = expectation({ roots: G.GOOGLE_ROOTS.map(p => new X509Certificate(p)) });
  assert.equal(reason(T.chain({ challenge: NONCE }), google), 'fremde_wurzel');
});

test('a foreign package or a foreign signature is rejected', () => {
  assert.equal(reason(T.chain({ challenge: NONCE, paket: 'com.boese.app' })), 'fremdes_paket');
  assert.equal(reason(T.chain({ challenge: NONCE, digest: Buffer.alloc(32, 7) })), 'fremde_signatur');
  assert.equal(
    reason(T.chain({ challenge: NONCE }), expectation({ digests: [] })),
    'fremde_signatur',
    'Ohne konfigurierten Fingerabdruck nimmt der Server keine App an',
  );
});

test('a key without lock, with a timeout or imported is rejected', () => {
  assert.equal(reason(T.chain({ challenge: NONCE, withoutLock: true })), 'ohne_sperre');
  assert.equal(reason(T.chain({ challenge: NONCE, alsoWithoutLogin: true })), 'ohne_sperre');
  assert.equal(reason(T.chain({ challenge: NONCE, frist: 300 })), 'sperre_mit_frist');
  assert.equal(reason(T.chain({ challenge: NONCE, herkunft: 2 })), 'importiert');
  assert.equal(reason(T.chain({ challenge: NONCE, kurve: 2 })), 'kein_ec_p256');
});

test('a slipped-in leaf (signed by a stranger) and a chain without extension are rejected', () => {
  const echt = T.chain({ challenge: NONCE });
  const fremd = T.chain({ challenge: NONCE });
  // Leaf from one chain, intermediate from another: same names, wrong signature.
  assert.equal(reason({ chain: [fremd.chain[0], echt.chain[1], echt.chain[2]] }), 'glied_0_signatur');
  assert.equal(reason(T.chain({ challenge: NONCE, withoutExtension: true })), 'ohne_attestation');
  assert.equal(reason({ chain: [] }), 'kette_laenge');
  assert.equal(reason({ chain: ['AAAA'] }), 'kette_unlesbar');
});

test('the KeyDescription reads challenge, level and app identifier', () => {
  const b = A.readDescription(T.beschreibung({ challenge: NONCE, confidence: 2 }));
  assert.deepEqual([b.version, b.confidence, b.challenge.toString()], [300, 'strongbox', NONCE.toString()]);
  const app = A.readAppId(b.software.get(709));
  assert.deepEqual(app, { packages: [T.PAKET], digests: [T.DIGEST_HEX] });
});

test('truncated bytes and indefinite lengths throw instead of guessing', () => {
  const ganz = T.beschreibung({ challenge: NONCE });
  for (const kaputt of [
    ganz.subarray(0, ganz.length - 3),
    Buffer.from([0x30, 0x80, 0x00, 0x00]),
    Buffer.from([0x30, 0x84, 1, 0, 0, 0]),
  ])
    assert.throws(() => A.readDescription(kaputt), der.TheError);
  assert.throws(() => der.readWhole(Buffer.from([0x05, 0x00, 0x00])), /hinter dem Element/);
  assert.throws(() => der.liesTlv(Buffer.from([0x04, 0x05, 1, 2])), /über das Ende/);
  assert.equal(der.liesTlv(Buffer.from([0xbf, 0x85, 0x45, 0x02, 0x05, 0x00])).tlv.number, 709);
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
  for (const link of k.chain)
    assert.equal(reason(k, expectation({ widerrufen: new Set([series(link)]) })), 'widerrufen');
  assert.equal(reason(k, expectation({ widerrufen: new Set(['abc', '1']) })), 'angenommen');
});

test("the serial number stands as in Google's list: hex lower case, without the leading zero", () => {
  const c = { serialNumber: '00A1B2' };
  assert.equal(A.serialNumber(c), 'a1b2');
  assert.equal(A.serialNumber({ serialNumber: '00' }), '0');
  const liste = W.readRevocationList(JSON.stringify({ entries: { '00A1B2': { status: 'REVOKED' } } }));
  assert.deepEqual(liste, ['a1b2']);
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
  const roh = fs.readFileSync(path.join(__dirname, 'fixtures', 'attestation-status-excerpt.json'));
  const nummern = W.readRevocationList(roh);
  assert.equal(nummern.length, 5);
  assert.ok(nummern.includes('c35747a084470c3135aeefe2b8d40cd6'));
  assert.ok(nummern.includes('17471682139930361099'), 'auch SOFTWARE_FLAW zählt');
  for (const kaputt of [
    '',
    '[]',
    '{"entries": []}',
    '{"eintraege": {}}',
    '{"entries": {"xyz": {"status": "REVOKED"}}}',
    '{"entries": {"ab": {}}}',
  ])
    assert.throws(() => W.readRevocationList(kaputt), kaputt);
});

test('a stored list that is too old, missing or damaged does not apply', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  const wert = tage =>
    JSON.stringify({ state: new Date(now.getTime() - tage * 86_400_000).toISOString(), nummern: ['ab'] });
  assert.deepEqual([...W.applicableList(wert(6.9), 7, now)], ['ab']);
  assert.equal(W.applicableList(wert(7.1), 7, now), null);
  assert.equal(W.applicableList(wert(-1), 7, now), null, 'aus der Zukunft');
  assert.equal(W.applicableList(null, 7, now), null);
  assert.equal(W.applicableList('{kaputt', 7, now), null);
  assert.equal(W.applicableList(JSON.stringify({ state: now.toISOString() }), 7, now), null);
});

/** Root → intermediate → middle link → leaf; the leaf carries an invented
 * KeyDescription (StrongBox), the middle link is optionally itself an attested key.
 * @param {{ attestiert?: boolean, ca?: boolean, keyUsage?: Buffer }} [o] keyUsage: content of the BIT STRING */
function chainWithMiddleLink({ attestiert = false, ca = false, keyUsage } = {}) {
  const neu = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const [zw, mittel, blatt] = [neu(), neu(), neu()];
  const att = confidence =>
    T.seq(T.oid('1.3.6.1.4.1.11129.2.1.17'), T.oktette(T.beschreibung({ challenge: NONCE, confidence })));
  const zThe = T.zertifikat({
    subject: 'Test-Zwischenstufe',
    aussteller: T.WURZEL.cn,
    public_key: zw.publicKey,
    signierer: T.WURZEL.privateKey,
    ca: true,
  });
  const mThe = T.zertifikat({
    subject: 'Android Keystore Key',
    aussteller: 'Test-Zwischenstufe',
    public_key: mittel.publicKey,
    signierer: zw.privateKey,
    ca,
    extensions: [
      ...(attestiert ? [att(0)] : []),
      ...(keyUsage ? [T.seq(T.oid('2.5.29.15'), T.oktette(T.tlv([0x03], keyUsage)))] : []),
    ],
  });
  const bThe = T.zertifikat({
    subject: 'Gefälschter Schlüssel',
    aussteller: 'Android Keystore Key',
    public_key: blatt.publicKey,
    signierer: mittel.privateKey,
    extensions: [att(2)],
  });
  return { chain: [bThe, mThe, zThe, T.WURZEL.der].map(d => d.toString('base64')) };
}

test('an attested key as the issuer of a leaf is rejected, even with the CA bit', () => {
  assert.equal(reason(chainWithMiddleLink({ attestiert: true })), 'glied_1_kein_aussteller');
  assert.equal(reason(chainWithMiddleLink({ attestiert: true, ca: true })), 'glied_1_kein_aussteller');
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
