/**
 * Die Prüfung der Android Key Attestation (src/konto/attestation) an
 * selbst erzeugten Ketten mit eigener Wurzel (helpers/attestation.js): Eine
 * Kette wie die des Keystores geht durch, jede Abweichung, die einen Schlüssel
 * ohne Hardware, ohne Sperre oder einer fremden App verriete, nicht.
 *
 * Gegenproben (11.11.2026 gemessen):
 *   A  in pruefeBeschreibung() die Prüfung auf 'software' gestrichen → rot:
 *      „ein Software-Schlüssel …“
 *   B  in pruefeGlieder() `if (!anker) return 'fremde_wurzel'` gestrichen → rot:
 *      „eine fremde Wurzel …“ (TypeError → kette_unlesbar statt fremde_wurzel)
 *   C  die Paketprüfung `pakete[0] !== e.paket` gestrichen → rot: „ein fremdes Paket …“
 *   D  in pruefeGlieder() `!c.verify(...)` gestrichen → rot: „ein untergeschobenes Blatt …“
 *   E  in pruefeBeschreibung() die Prüfung auf noAuthRequired gestrichen → rot:
 *      „ein Schlüssel ohne Sperre …“
 *   F  in FINGERABDRUECKE eine Ziffer geändert → rot: „die Google-Wurzeln …“
 *   G  in liesTlv() die Längenprüfung `p + laenge > b.length` gestrichen → rot:
 *      „abgeschnittene Bytes …“
 *
 * Gegenproben zu Widerrufsliste, RootOfTrust und Patchstand (14.11.2026 gemessen):
 *   H  in pruefeKette() die Zeile mit `e.widerrufen.has(…)` gestrichen → rot:
 *      „eine Kette mit widerrufener Seriennummer …“
 *   I  in seriennummer() `.replace(/^0+(?=.)/, '')` gestrichen → rot: „… auch mit
 *      führender Null …“
 *   J  in pruefeBoot() die Prüfung auf BOOT_VERIFIZIERT gestrichen → rot:
 *      „ein Gerät mit unverifiziertem Boot …“
 *   K  in pruefeBoot() `if (!gesperrt[0]) return 'bootloader_offen'` gestrichen →
 *      rot: „ein offener Bootloader …“
 *   L  in pruefeBeschreibung() die Patchstand-Zeile gestrichen → rot: „ein
 *      Patchstand unter der Mindeststufe …“
 *   M  in leseWiderrufsliste() die Prüfung des Schlüssels (Hex) gestrichen → rot:
 *      „eine Liste in anderer Form …“
 *   N  in geltendeListe() die Altersgrenze gestrichen → rot: „eine zu alte Liste …“
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { X509Certificate } = require('node:crypto');
const _req = require('./helpers/sources').buildAndRequire();
const A = _req('src/konto/attestation/schluesselAttestation.js');
const der = _req('src/konto/attestation/der.js');
const G = _req('src/konto/attestation/googleWurzeln.js');
const W = _req('src/konto/attestation/widerrufsliste.js');
const T = require('./helpers/attestation');
const fs = require('node:fs');
const path = require('node:path');

const NONCE = Buffer.from('nonce-des-servers-32-bytes-lang!');
const erwartung = (o = {}) => ({
  wurzeln: [new X509Certificate(T.WURZEL.pem)],
  paket: T.PAKET,
  digests: [T.DIGEST_HEX],
  widerrufen: new Set(),
  ...o,
});
const pruefe = (k, e = erwartung()) => A.pruefeKette(k.kette, e);
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
  const fremd = T.neueWurzel('Fremde Wurzel');
  assert.equal(grund(T.kette({ challenge: NONCE, wurzel: fremd })), 'fremde_wurzel');
  // Die Google-Wurzeln nehmen die Testkette ebenso wenig an.
  const google = erwartung({ wurzeln: G.GOOGLE_WURZELN.map(p => new X509Certificate(p)) });
  assert.equal(grund(T.kette({ challenge: NONCE }), google), 'fremde_wurzel');
});

test('ein fremdes Paket oder eine fremde Signatur wird abgewiesen', () => {
  assert.equal(grund(T.kette({ challenge: NONCE, paket: 'com.boese.app' })), 'fremdes_paket');
  assert.equal(grund(T.kette({ challenge: NONCE, digest: Buffer.alloc(32, 7) })), 'fremde_signatur');
  assert.equal(
    grund(T.kette({ challenge: NONCE }), erwartung({ digests: [] })),
    'fremde_signatur',
    'Ohne konfigurierten Fingerabdruck nimmt der Server keine App an',
  );
});

test('ein Schlüssel ohne Sperre, mit Frist oder importiert wird abgewiesen', () => {
  assert.equal(grund(T.kette({ challenge: NONCE, ohneSperre: true })), 'ohne_sperre');
  assert.equal(grund(T.kette({ challenge: NONCE, auchOhneAnmeldung: true })), 'ohne_sperre');
  assert.equal(grund(T.kette({ challenge: NONCE, frist: 300 })), 'sperre_mit_frist');
  assert.equal(grund(T.kette({ challenge: NONCE, herkunft: 2 })), 'importiert');
  assert.equal(grund(T.kette({ challenge: NONCE, kurve: 2 })), 'kein_ec_p256');
});

test('ein untergeschobenes Blatt (fremd signiert) und eine Kette ohne Erweiterung werden abgewiesen', () => {
  const echt = T.kette({ challenge: NONCE });
  const fremd = T.kette({ challenge: NONCE });
  // Blatt aus einer Kette, Zwischenstufe aus einer anderen: gleiche Namen, falsche Signatur.
  assert.equal(grund({ kette: [fremd.kette[0], echt.kette[1], echt.kette[2]] }), 'glied_0_signatur');
  assert.equal(grund(T.kette({ challenge: NONCE, ohneErweiterung: true })), 'ohne_attestation');
  assert.equal(grund({ kette: [] }), 'kette_laenge');
  assert.equal(grund({ kette: ['AAAA'] }), 'kette_unlesbar');
});

test('die KeyDescription liest Challenge, Stufe und App-Kennung', () => {
  const b = A.leseBeschreibung(T.beschreibung({ challenge: NONCE, sicherheit: 2 }));
  assert.deepEqual([b.version, b.sicherheit, b.challenge.toString()], [300, 'strongbox', NONCE.toString()]);
  const app = A.leseAppKennung(b.software.get(709));
  assert.deepEqual(app, { pakete: [T.PAKET], digests: [T.DIGEST_HEX] });
});

test('abgeschnittene Bytes und unbestimmte Längen werfen statt zu raten', () => {
  const ganz = T.beschreibung({ challenge: NONCE });
  for (const kaputt of [
    ganz.subarray(0, ganz.length - 3),
    Buffer.from([0x30, 0x80, 0x00, 0x00]),
    Buffer.from([0x30, 0x84, 1, 0, 0, 0]),
  ])
    assert.throws(() => A.leseBeschreibung(kaputt), der.DerFehler);
  assert.throws(() => der.liesGanz(Buffer.from([0x05, 0x00, 0x00])), /hinter dem Element/);
  assert.throws(() => der.liesTlv(Buffer.from([0x04, 0x05, 1, 2])), /über das Ende/);
  assert.equal(der.liesTlv(Buffer.from([0xbf, 0x85, 0x45, 0x02, 0x05, 0x00])).tlv.nummer, 709);
});

test('die Google-Wurzeln stimmen mit ihren Fingerabdrücken überein', () => {
  assert.ok(G.GOOGLE_WURZELN.length >= 2);
  assert.deepEqual(
    G.GOOGLE_WURZELN.map(p => new X509Certificate(p).fingerprint256),
    [...G.FINGERABDRUECKE],
  );
  for (const p of G.GOOGLE_WURZELN) assert.equal(new X509Certificate(p).ca, true);
});

const serie = b64 => A.seriennummer(new X509Certificate(Buffer.from(b64, 'base64')));

test('eine Kette mit widerrufener Seriennummer wird abgewiesen, gleich an welchem Glied', () => {
  const k = T.kette({ challenge: NONCE });
  assert.equal(grund(k), 'angenommen');
  for (const glied of k.kette) assert.equal(grund(k, erwartung({ widerrufen: new Set([serie(glied)]) })), 'widerrufen');
  assert.equal(grund(k, erwartung({ widerrufen: new Set(['abc', '1']) })), 'angenommen');
});

test('die Seriennummer steht wie in Googles Liste: Hex klein, auch mit führender Null ohne sie', () => {
  const c = { serialNumber: '00A1B2' };
  assert.equal(A.seriennummer(c), 'a1b2');
  assert.equal(A.seriennummer({ serialNumber: '00' }), '0');
  const liste = W.leseWiderrufsliste(JSON.stringify({ entries: { '00A1B2': { status: 'REVOKED' } } }));
  assert.deepEqual(liste, ['a1b2']);
});

test('ein Gerät mit unverifiziertem Boot, offenem Bootloader oder ohne RootOfTrust wird abgewiesen', () => {
  assert.equal(grund(T.kette({ challenge: NONCE, bootZustand: 2 })), 'boot_unverifiziert');
  assert.equal(grund(T.kette({ challenge: NONCE, bootZustand: 1 })), 'boot_unverifiziert', 'SelfSigned');
  assert.equal(grund(T.kette({ challenge: NONCE, bootZustand: 3 })), 'boot_unverifiziert', 'Failed');
  assert.equal(grund(T.kette({ challenge: NONCE, bootloaderOffen: true })), 'bootloader_offen');
  assert.equal(grund(T.kette({ challenge: NONCE, ohneRootOfTrust: true })), 'ohne_root_of_trust');
});

test('ein Patchstand unter der Mindeststufe wird abgewiesen, ohne Mindeststufe jeder', () => {
  const k = T.kette({ challenge: NONCE, patch: 202608 });
  assert.equal(grund(k), 'angenommen');
  assert.equal(grund(k, erwartung({ patchMindestens: 202608 })), 'angenommen');
  assert.equal(grund(k, erwartung({ patchMindestens: 202609 })), 'patchstand_alt');
});

test('Googles Liste wird gelesen; eine Liste in anderer Form wirft, statt halb zu gelten', () => {
  const roh = fs.readFileSync(path.join(__dirname, 'fixtures', 'attestation-status-auszug.json'));
  const nummern = W.leseWiderrufsliste(roh);
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
    assert.throws(() => W.leseWiderrufsliste(kaputt), kaputt);
});

test('eine zu alte, fehlende oder beschädigte gespeicherte Liste gilt nicht', () => {
  const jetzt = new Date('2026-11-14T12:00:00Z');
  const wert = tage =>
    JSON.stringify({ stand: new Date(jetzt.getTime() - tage * 86_400_000).toISOString(), nummern: ['ab'] });
  assert.deepEqual([...W.geltendeListe(wert(6.9), 7, jetzt)], ['ab']);
  assert.equal(W.geltendeListe(wert(7.1), 7, jetzt), null);
  assert.equal(W.geltendeListe(wert(-1), 7, jetzt), null, 'aus der Zukunft');
  assert.equal(W.geltendeListe(null, 7, jetzt), null);
  assert.equal(W.geltendeListe('{kaputt', 7, jetzt), null);
  assert.equal(W.geltendeListe(JSON.stringify({ stand: jetzt.toISOString() }), 7, jetzt), null);
});
