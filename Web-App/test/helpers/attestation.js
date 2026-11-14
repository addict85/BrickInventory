/**
 * Android-Attestierungsketten für Tests: eine eigene Wurzel, eine Zwischenstufe
 * und ein Blatt mit der KeyDescription (OID 1.3.6.1.4.1.11129.2.1.17), so wie
 * KeyMint sie ausstellt. Der Server nimmt die Wurzel über ATTESTATION_WURZELN an.
 * Jede Abweichung, die ein Test braucht, geht über die Optionen von kette().
 */
const { createHash, generateKeyPairSync, sign } = require('node:crypto');

const tlv = (tag, inhalt) => {
  const n = inhalt.length;
  const laenge =
    n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from(tag), laenge, inhalt]);
};
const seq = (...t) => tlv([0x30], Buffer.concat(t));
const set = (...t) => tlv([0x31], Buffer.concat(t));
const ganz = n => {
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  let b = Buffer.from(h, 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv([0x02], b);
};
const aufz = n => tlv([0x0a], ganz(n).subarray(2));
const oktette = b => tlv([0x04], Buffer.from(b));
const nichts = () => Buffer.from([0x05, 0x00]);
const wahr = b => tlv([0x01], Buffer.from([b ? 0xff : 0x00]));
const oid = s => {
  const z = s.split('.').map(Number);
  const teile = [40 * z[0] + z[1]];
  for (const x of z.slice(2)) {
    const b = [x & 0x7f];
    for (let r = x >> 7; r; r >>= 7) b.unshift((r & 0x7f) | 0x80);
    teile.push(...b);
  }
  return tlv([0x06], Buffer.from(teile));
};
/** [n] EXPLICIT, auch mit Tag-Nummern über 30 (KeyMint nutzt bis 7xx). */
const kontext = (n, innen) => {
  if (n < 31) return tlv([0xa0 | n], innen);
  const b = [n & 0x7f];
  for (let r = n >> 7; r; r >>= 7) b.unshift((r & 0x7f) | 0x80);
  return tlv([0xbf, ...b], innen);
};
const name = cn => seq(set(seq(oid('2.5.4.3'), tlv([0x0c], Buffer.from(cn)))));
const zeit = d => tlv([0x17], Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

/**
 * @param {{ subjekt: string, aussteller: string, oeffentlich: import('node:crypto').KeyObject,
 *   signierer: import('node:crypto').KeyObject, ca?: boolean, erweiterungen?: Buffer[], von?: Date, bis?: Date }} z
 */
function zertifikat({ subjekt, aussteller, oeffentlich, signierer, ca = false, erweiterungen = [], von, bis }) {
  const ext = [...erweiterungen];
  if (ca)
    ext.push(seq(oid('2.5.29.19'), tlv([0x01], Buffer.from([0xff])), oktette(seq(tlv([0x01], Buffer.from([0xff]))))));
  const tbs = seq(
    kontext(0, ganz(2)),
    ganz(Math.floor(Math.random() * 2 ** 40) + 1),
    ECDSA_SHA256,
    name(aussteller),
    seq(zeit(von ?? new Date(Date.now() - 86_400_000)), zeit(bis ?? new Date(Date.now() + 365 * 86_400_000))),
    name(subjekt),
    oeffentlich.export({ format: 'der', type: 'spki' }),
    ...(ext.length ? [kontext(3, seq(...ext))] : []),
  );
  const sig = sign('sha256', tbs, { key: signierer, dsaEncoding: 'der' });
  return seq(tbs, ECDSA_SHA256, tlv([0x03], Buffer.concat([Buffer.from([0]), sig])));
}

const pem = der =>
  `-----BEGIN CERTIFICATE-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n-----END CERTIFICATE-----\n`;

function neueWurzel(cn = 'Test-Attestierungswurzel') {
  const k = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = zertifikat({ subjekt: cn, aussteller: cn, oeffentlich: k.publicKey, signierer: k.privateKey, ca: true });
  return { ...k, cn, der, pem: pem(der) };
}

const WURZEL = neueWurzel();
const PAKET = 'ch.brickinventoryapp';
/** Der SHA-256 des Signaturzertifikats der Test-App. */
const DIGEST = createHash('sha256').update('brickinventory-test-signatur').digest();
const DIGEST_HEX = DIGEST.toString('hex').toUpperCase();

/**
 * Eine geladene Widerrufsliste in laufzustand, wie sie der Auftrag `widerrufsliste`
 * ablegt; ohne sie nimmt der Server keinen Schlüssel an.
 * @param {{ run: (sql: string, p: unknown[]) => Promise<unknown> }} db
 * @param {string[]} [nummern] @param {Date} [stand]
 */
function widerrufslisteAblegen(db, nummern = [], stand = new Date()) {
  return db.run(
    `INSERT INTO laufzustand (schluessel, wert) VALUES ('attestation_widerruf', $1)
     ON CONFLICT (schluessel) DO UPDATE SET wert = EXCLUDED.wert`,
    [JSON.stringify({ stand: stand.toISOString(), nummern })],
  );
}

/** Die Umgebung, mit der ein Server die Testketten annimmt. */
const UMGEBUNG = {
  ATTESTATION_WURZELN: WURZEL.pem,
  PASSKEY_ANDROID_ZERTIFIKATE: DIGEST_HEX,
  PASSKEY_ANDROID_PAKET: PAKET,
};

/**
 * @typedef {{ challenge: Buffer, wurzel?: ReturnType<typeof neueWurzel>, sicherheit?: number,
 *   paket?: string, digest?: Buffer, ohneSperre?: boolean, auchOhneAnmeldung?: boolean,
 *   ohneErweiterung?: boolean, frist?: number, herkunft?: number, kurve?: number, algorithmus?: number,
 *   bootloaderOffen?: boolean, bootZustand?: number, ohneRootOfTrust?: boolean, patch?: number }} Abweichung
 * ohneSperre: noAuthRequired statt userAuthType; auchOhneAnmeldung: beide, wie es ein
 * manipuliertes KeyMint melden könnte; sicherheit: 0 Software, 1 TEE, 2 StrongBox;
 * bootZustand: 0 Verified, 1 SelfSigned, 2 Unverified, 3 Failed; patch: osPatchLevel JJJJMM.
 */

/** @param {Abweichung} o */
function beschreibung(o) {
  const hw = [
    kontext(1, set(ganz(2))),
    kontext(2, ganz(o.algorithmus ?? 3)),
    kontext(3, ganz(256)),
    kontext(10, ganz(o.kurve ?? 1)),
    ...(o.ohneSperre || o.auchOhneAnmeldung ? [kontext(503, nichts())] : []),
    ...(o.ohneSperre ? [] : [kontext(504, ganz(3))]),
    ...(o.frist ? [kontext(505, ganz(o.frist))] : []),
    kontext(702, ganz(o.herkunft ?? 0)),
    ...(o.ohneRootOfTrust
      ? []
      : [
          kontext(
            704,
            seq(
              oktette(Buffer.alloc(32, 9)),
              wahr(!o.bootloaderOffen),
              aufz(o.bootZustand ?? 0),
              oktette(Buffer.alloc(32, 3)),
            ),
          ),
        ]),
    kontext(706, ganz(o.patch ?? 202610)),
  ];
  const app = seq(set(seq(oktette(Buffer.from(o.paket ?? PAKET)), ganz(1))), set(oktette(o.digest ?? DIGEST)));
  const sw = [kontext(709, oktette(app))];
  return seq(
    ganz(300),
    aufz(o.sicherheit ?? 1),
    ganz(300),
    aufz(o.sicherheit ?? 1),
    oktette(o.challenge),
    oktette(Buffer.alloc(0)),
    seq(...sw),
    seq(...hw),
  );
}

/**
 * Eine Kette wie getCertificateChain() des Keystores, Base64, Blatt zuerst.
 * @param {Abweichung} o  challenge: die Nonce des Servers als Bytes
 */
function kette(o) {
  const w = o.wurzel ?? WURZEL;
  const zwischen = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const blatt = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const zDer = zertifikat({
    subjekt: 'Test-Zwischenstufe',
    aussteller: w.cn,
    oeffentlich: zwischen.publicKey,
    signierer: w.privateKey,
    ca: true,
  });
  const ext = o.ohneErweiterung ? [] : [seq(oid('1.3.6.1.4.1.11129.2.1.17'), oktette(beschreibung(o)))];
  const bDer = zertifikat({
    subjekt: 'Android Keystore Key',
    aussteller: 'Test-Zwischenstufe',
    oeffentlich: blatt.publicKey,
    signierer: zwischen.privateKey,
    erweiterungen: ext,
    von: new Date(0),
    bis: new Date('2048-01-01T00:00:00Z'),
  });
  return {
    kette: [bDer, zDer, w.der].map(d => d.toString('base64')),
    privateKey: blatt.privateKey,
    oeffentlich: blatt.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

module.exports = {
  WURZEL,
  PAKET,
  DIGEST,
  DIGEST_HEX,
  UMGEBUNG,
  neueWurzel,
  kette,
  beschreibung,
  widerrufslisteAblegen,
};
