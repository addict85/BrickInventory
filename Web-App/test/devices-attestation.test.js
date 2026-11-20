/**
 * Die Prüfung der Android Key Attestation (src/devices/attestation) an
 * selbst erzeugten Ketten mit eigener Wurzel (helpers/attestation.js): Eine
 * Kette wie die des Keystores geht durch, jede Abweichung, die einen Schlüssel
 * ohne Hardware, ohne Sperre oder einer fremden App verriete, nicht.
 *
 * Gegenproben (11.11.2026 gemessen):
 *   A  in checkDescription() die Prüfung auf 'software' gestrichen → rot:
 *      „ein Software-Schlüssel …“
 *   B  in checkLinks() `if (!anker) return 'fremde_wurzel'` gestrichen → rot:
 *      „eine fremde Wurzel …“ (TypeError → kette_unlesbar statt fremde_wurzel)
 *   C  die Paketprüfung `packages[0] !== e.paket` gestrichen → rot: „ein fremdes Paket …“
 *   D  in checkLinks() `!c.verify(...)` gestrichen → rot: „ein untergeschobenes Blatt …“
 *   E  in checkDescription() die Prüfung auf noAuthRequired gestrichen → rot:
 *      „ein Schlüssel ohne Sperre …“
 *   F  in FINGERPRINTS eine Ziffer geändert → rot: „die Google-Wurzeln …“
 *   G  in liesTlv() die Längenprüfung `p + laenge > b.length` gestrichen → rot:
 *      „abgeschnittene Bytes …“
 *
 * Gegenproben zu Widerrufsliste, RootOfTrust und Patchstand (14.11.2026 gemessen):
 *   H  in checkChain() die Zeile mit `e.widerrufen.has(…)` gestrichen → rot:
 *      „eine Kette mit widerrufener Seriennummer …“
 *   I  in seriennummer() `.replace(/^0+(?=.)/, '')` gestrichen → rot: „… auch mit
 *      führender Null …“
 *   J  in checkBoot() die Prüfung auf BOOT_VERIFIED gestrichen → rot:
 *      „ein Gerät mit unverifiziertem Boot …“
 *   K  in checkBoot() `if (!gesperrt[0]) return 'bootloader_offen'` gestrichen →
 *      rot: „ein offener Bootloader …“
 *   L  in checkDescription() die Patchstand-Zeile gestrichen → rot: „ein
 *      Patchstand unter der Mindeststufe …“
 *   M  in readRevocationList() die Prüfung des Schlüssels (Hex) gestrichen → rot:
 *      „eine Liste in anderer Form …“
 *   N  in applicableList() die Altersgrenze gestrichen → rot: „eine zu alte Liste …“
 *
 * Gegenproben zu den Ausstellern (15.11.2026 gemessen):
 *   O  in checkLinks() `|| attestationExtension(roh[i])` gestrichen → rot: „ein
 *      attestierter Schlüssel als Aussteller …“ (der Fall mit CA-Bit)
 *   P  in checkLinks() `!c.ca ||` gestrichen → rot: „ein Aussteller ohne CA-Bit oder
 *      ohne keyCertSign …“ (ca von node:crypto prüft keyUsage mit)
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
  jetzt: new Date(),
  ...o,
});
const pruefe = (k, e = expectation()) => A.checkChain(k.kette, e);
const grund = (k, e) => {
  const p = pruefe(k, e);
  return p.ok ? 'angenommen' : p.grund;
};

test('eine Kette wie die des Keystores geht durch, mit Challenge und Schlüssel des Blatts', () => {
  const k = T.kette({ challenge: NONCE });
  const p = pruefe(k);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.challenge, NONCE);
  assert.equal(p.sicherheit, 'tee');
  assert.equal(p.oeffentlich.export({ format: 'der', type: 'spki' }).toString('base64'), k.oeffentlich);
  assert.equal(pruefe(T.kette({ challenge: NONCE, sicherheit: 2 })).sicherheit, 'strongbox');
});

test('ein Software-Schlüssel wird abgewiesen', () => {
  assert.equal(grund(T.kette({ challenge: NONCE, sicherheit: 0 })), 'nur_software');
});

test('eine fremde Wurzel wird abgewiesen, auch mit sonst gültiger Kette', () => {
  const fremd = T.newRoot('Fremde Wurzel');
  assert.equal(grund(T.kette({ challenge: NONCE, wurzel: fremd })), 'fremde_wurzel');
  // Die Google-Wurzeln nehmen die Testkette ebenso wenig an.
  const google = expectation({ roots: G.GOOGLE_ROOTS.map(p => new X509Certificate(p)) });
  assert.equal(grund(T.kette({ challenge: NONCE }), google), 'fremde_wurzel');
});

test('ein fremdes Paket oder eine fremde Signatur wird abgewiesen', () => {
  assert.equal(grund(T.kette({ challenge: NONCE, paket: 'com.boese.app' })), 'fremdes_paket');
  assert.equal(grund(T.kette({ challenge: NONCE, digest: Buffer.alloc(32, 7) })), 'fremde_signatur');
  assert.equal(
    grund(T.kette({ challenge: NONCE }), expectation({ digests: [] })),
    'fremde_signatur',
    'Ohne konfigurierten Fingerabdruck nimmt der Server keine App an',
  );
});

test('ein Schlüssel ohne Sperre, mit Frist oder importiert wird abgewiesen', () => {
  assert.equal(grund(T.kette({ challenge: NONCE, withoutLock: true })), 'ohne_sperre');
  assert.equal(grund(T.kette({ challenge: NONCE, alsoWithoutLogin: true })), 'ohne_sperre');
  assert.equal(grund(T.kette({ challenge: NONCE, frist: 300 })), 'sperre_mit_frist');
  assert.equal(grund(T.kette({ challenge: NONCE, herkunft: 2 })), 'importiert');
  assert.equal(grund(T.kette({ challenge: NONCE, kurve: 2 })), 'kein_ec_p256');
});

test('ein untergeschobenes Blatt (fremd signiert) und eine Kette ohne Erweiterung werden abgewiesen', () => {
  const echt = T.kette({ challenge: NONCE });
  const fremd = T.kette({ challenge: NONCE });
  // Blatt aus einer Kette, Zwischenstufe aus einer anderen: gleiche Namen, falsche Signatur.
  assert.equal(grund({ kette: [fremd.kette[0], echt.kette[1], echt.kette[2]] }), 'glied_0_signatur');
  assert.equal(grund(T.kette({ challenge: NONCE, withoutExtension: true })), 'ohne_attestation');
  assert.equal(grund({ kette: [] }), 'kette_laenge');
  assert.equal(grund({ kette: ['AAAA'] }), 'kette_unlesbar');
});

test('die KeyDescription liest Challenge, Stufe und App-Kennung', () => {
  const b = A.readDescription(T.beschreibung({ challenge: NONCE, sicherheit: 2 }));
  assert.deepEqual([b.version, b.sicherheit, b.challenge.toString()], [300, 'strongbox', NONCE.toString()]);
  const app = A.readAppId(b.software.get(709));
  assert.deepEqual(app, { packages: [T.PAKET], digests: [T.DIGEST_HEX] });
});

test('abgeschnittene Bytes und unbestimmte Längen werfen statt zu raten', () => {
  const ganz = T.beschreibung({ challenge: NONCE });
  for (const kaputt of [
    ganz.subarray(0, ganz.length - 3),
    Buffer.from([0x30, 0x80, 0x00, 0x00]),
    Buffer.from([0x30, 0x84, 1, 0, 0, 0]),
  ])
    assert.throws(() => A.readDescription(kaputt), der.TheError);
  assert.throws(() => der.readWhole(Buffer.from([0x05, 0x00, 0x00])), /hinter dem Element/);
  assert.throws(() => der.liesTlv(Buffer.from([0x04, 0x05, 1, 2])), /über das Ende/);
  assert.equal(der.liesTlv(Buffer.from([0xbf, 0x85, 0x45, 0x02, 0x05, 0x00])).tlv.nummer, 709);
});

test('die Google-Wurzeln stimmen mit ihren Fingerabdrücken überein', () => {
  assert.ok(G.GOOGLE_ROOTS.length >= 2);
  assert.deepEqual(
    G.GOOGLE_ROOTS.map(p => new X509Certificate(p).fingerprint256),
    [...G.FINGERPRINTS],
  );
  for (const p of G.GOOGLE_ROOTS) assert.equal(new X509Certificate(p).ca, true);
});

const series = b64 => A.seriennummer(new X509Certificate(Buffer.from(b64, 'base64')));

test('eine Kette mit widerrufener Seriennummer wird abgewiesen, gleich an welchem Glied', () => {
  const k = T.kette({ challenge: NONCE });
  assert.equal(grund(k), 'angenommen');
  for (const link of k.kette)
    assert.equal(grund(k, expectation({ widerrufen: new Set([series(link)]) })), 'widerrufen');
  assert.equal(grund(k, expectation({ widerrufen: new Set(['abc', '1']) })), 'angenommen');
});

test('die Seriennummer steht wie in Googles Liste: Hex klein, auch mit führender Null ohne sie', () => {
  const c = { serialNumber: '00A1B2' };
  assert.equal(A.seriennummer(c), 'a1b2');
  assert.equal(A.seriennummer({ serialNumber: '00' }), '0');
  const liste = W.readRevocationList(JSON.stringify({ entries: { '00A1B2': { status: 'REVOKED' } } }));
  assert.deepEqual(liste, ['a1b2']);
});

test('ein Gerät mit unverifiziertem Boot, offenem Bootloader oder ohne RootOfTrust wird abgewiesen', () => {
  assert.equal(grund(T.kette({ challenge: NONCE, bootState: 2 })), 'boot_unverifiziert');
  assert.equal(grund(T.kette({ challenge: NONCE, bootState: 1 })), 'boot_unverifiziert', 'SelfSigned');
  assert.equal(grund(T.kette({ challenge: NONCE, bootState: 3 })), 'boot_unverifiziert', 'Failed');
  assert.equal(grund(T.kette({ challenge: NONCE, openBootloader: true })), 'bootloader_offen');
  assert.equal(grund(T.kette({ challenge: NONCE, withoutRootOfTrust: true })), 'ohne_root_of_trust');
});

test('ein Patchstand unter der Mindeststufe wird abgewiesen, ohne Mindeststufe jeder', () => {
  const k = T.kette({ challenge: NONCE, patch: 202608 });
  assert.equal(grund(k), 'angenommen');
  assert.equal(grund(k, expectation({ patchAtLeast: 202608 })), 'angenommen');
  assert.equal(grund(k, expectation({ patchAtLeast: 202609 })), 'patchstand_alt');
});

test('Googles Liste wird gelesen; eine Liste in anderer Form wirft, statt halb zu gelten', () => {
  const roh = fs.readFileSync(path.join(__dirname, 'fixtures', 'attestation-status-auszug.json'));
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

test('eine zu alte, fehlende oder beschädigte gespeicherte Liste gilt nicht', () => {
  const jetzt = new Date('2026-11-14T12:00:00Z');
  const wert = tage =>
    JSON.stringify({ stand: new Date(jetzt.getTime() - tage * 86_400_000).toISOString(), nummern: ['ab'] });
  assert.deepEqual([...W.applicableList(wert(6.9), 7, jetzt)], ['ab']);
  assert.equal(W.applicableList(wert(7.1), 7, jetzt), null);
  assert.equal(W.applicableList(wert(-1), 7, jetzt), null, 'aus der Zukunft');
  assert.equal(W.applicableList(null, 7, jetzt), null);
  assert.equal(W.applicableList('{kaputt', 7, jetzt), null);
  assert.equal(W.applicableList(JSON.stringify({ stand: jetzt.toISOString() }), 7, jetzt), null);
});

/** Wurzel → Zwischenstufe → Mittelglied → Blatt; das Blatt trägt eine erfundene
 * KeyDescription (StrongBox), das Mittelglied ist wahlweise selbst ein attestierter Schlüssel.
 * @param {{ attestiert?: boolean, ca?: boolean, keyUsage?: Buffer }} [o] keyUsage: Inhalt des BIT STRING */
function chainWithMiddleLink({ attestiert = false, ca = false, keyUsage } = {}) {
  const neu = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const [zw, mittel, blatt] = [neu(), neu(), neu()];
  const att = sicherheit =>
    T.seq(T.oid('1.3.6.1.4.1.11129.2.1.17'), T.oktette(T.beschreibung({ challenge: NONCE, sicherheit })));
  const zThe = T.zertifikat({
    subject: 'Test-Zwischenstufe',
    aussteller: T.WURZEL.cn,
    oeffentlich: zw.publicKey,
    signierer: T.WURZEL.privateKey,
    ca: true,
  });
  const mThe = T.zertifikat({
    subject: 'Android Keystore Key',
    aussteller: 'Test-Zwischenstufe',
    oeffentlich: mittel.publicKey,
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
    oeffentlich: blatt.publicKey,
    signierer: mittel.privateKey,
    extensions: [att(2)],
  });
  return { kette: [bThe, mThe, zThe, T.WURZEL.der].map(d => d.toString('base64')) };
}

test('ein attestierter Schlüssel als Aussteller eines Blatts wird abgewiesen, auch mit CA-Bit', () => {
  assert.equal(grund(chainWithMiddleLink({ attestiert: true })), 'glied_1_kein_aussteller');
  assert.equal(grund(chainWithMiddleLink({ attestiert: true, ca: true })), 'glied_1_kein_aussteller');
});

test('ein Aussteller ohne CA-Bit oder ohne keyCertSign wird abgewiesen, mit beidem angenommen', () => {
  assert.equal(grund(chainWithMiddleLink()), 'glied_1_kein_aussteller');
  // keyUsage nur digitalSignature: 7 ungenutzte Bits, Bit 0 gesetzt.
  assert.equal(
    grund(chainWithMiddleLink({ ca: true, keyUsage: Buffer.from([0x07, 0x80]) })),
    'glied_1_kein_aussteller',
  );
  // keyCertSign (Bit 5): die Kontrolle, dass die Prüfung nicht jede Kette verwirft.
  assert.equal(grund(chainWithMiddleLink({ ca: true, keyUsage: Buffer.from([0x02, 0x04]) })), 'angenommen');
  assert.equal(grund(chainWithMiddleLink({ ca: true })), 'angenommen');
});
