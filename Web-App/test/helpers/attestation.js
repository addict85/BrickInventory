/**
 * Android attestation chains for tests: an own root, an intermediate
 * and a leaf with the KeyDescription (OID 1.3.6.1.4.1.11129.2.1.17), as
 * KeyMint issues them. The server accepts the root via ATTESTATION_ROOTS.
 * Every deviation a test needs goes via the options of kette().
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
const recording = n => tlv([0x0a], ganz(n).subarray(2));
const octets = b => tlv([0x04], Buffer.from(b));
const nichts = () => Buffer.from([0x05, 0x00]);
const wahr = b => tlv([0x01], Buffer.from([b ? 0xff : 0x00]));
const oid = s => {
  const z = s.split('.').map(Number);
  const parts = [40 * z[0] + z[1]];
  for (const x of z.slice(2)) {
    const b = [x & 0x7f];
    for (let r = x >> 7; r; r >>= 7) b.unshift((r & 0x7f) | 0x80);
    parts.push(...b);
  }
  return tlv([0x06], Buffer.from(parts));
};
/** [n] EXPLICIT, also with tag numbers above 30 (KeyMint uses up to 7xx). */
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
 * @param {{ subject: string, aussteller: string, public_key: import('node:crypto').KeyObject,
 *   signer: import('node:crypto').KeyObject, ca?: boolean, extensions?: Buffer[], von?: Date, bis?: Date }} z
 */
function zertifikat({ subject, aussteller, public_key, signer, ca = false, extensions = [], von, bis }) {
  const ext = [...extensions];
  if (ca)
    ext.push(seq(oid('2.5.29.19'), tlv([0x01], Buffer.from([0xff])), octets(seq(tlv([0x01], Buffer.from([0xff]))))));
  const tbs = seq(
    kontext(0, ganz(2)),
    ganz(Math.floor(Math.random() * 2 ** 40) + 1),
    ECDSA_SHA256,
    name(aussteller),
    seq(zeit(von ?? new Date(Date.now() - 86_400_000)), zeit(bis ?? new Date(Date.now() + 365 * 86_400_000))),
    name(subject),
    public_key.export({ format: 'der', type: 'spki' }),
    ...(ext.length ? [kontext(3, seq(...ext))] : []),
  );
  const sig = sign('sha256', tbs, { key: signer, dsaEncoding: 'der' });
  return seq(tbs, ECDSA_SHA256, tlv([0x03], Buffer.concat([Buffer.from([0]), sig])));
}

const pem = der =>
  `-----BEGIN CERTIFICATE-----\n${der
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n-----END CERTIFICATE-----\n`;

function newRoot(cn = 'Test-Attestierungswurzel') {
  const k = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const der = zertifikat({ subject: cn, aussteller: cn, public_key: k.publicKey, signer: k.privateKey, ca: true });
  return { ...k, cn, der, pem: pem(der) };
}

const WURZEL = newRoot();
const PAKET = 'ch.brickinventoryapp';
/** The SHA-256 of the test app's signing certificate. */
const DIGEST = createHash('sha256').update('brickinventory-test-signatur').digest();
const DIGEST_HEX = DIGEST.toString('hex').toUpperCase();

/**
 * A loaded revocation list in run_state, as the job `revocation_list`
 * stores it; without it the server accepts no key.
 * @param {{ run: (sql: string, p: unknown[]) => Promise<unknown> }} db
 * @param {string[]} [nummern] @param {Date} [state]
 */
function storeRevocationList(db, nummern = [], state = new Date()) {
  return db.run(
    `INSERT INTO run_state (key, value) VALUES ('attestation_widerruf', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ state: state.toISOString(), nummern })],
  );
}

/** The environment with which a server accepts the test chains. */
const UMGEBUNG = {
  ATTESTATION_ROOTS: WURZEL.pem,
  PASSKEY_ANDROID_CERTIFICATES: DIGEST_HEX,
  PASSKEY_ANDROID_PACKAGE: PAKET,
};

/**
 * @typedef {{ challenge: Buffer, wurzel?: ReturnType<typeof newRoot>, confidence?: number,
 *   paket?: string, digest?: Buffer, withoutLock?: boolean, alsoWithoutLogin?: boolean,
 *   withoutExtension?: boolean, frist?: number, herkunft?: number, kurve?: number, algorithm?: number,
 *   openBootloader?: boolean, bootState?: number, withoutRootOfTrust?: boolean, patch?: number }} Abweichung
 * withoutLock: noAuthRequired instead of userAuthType; alsoWithoutLogin: both, as a
 * manipulated KeyMint could report; sicherheit: 0 software, 1 TEE, 2 StrongBox;
 * bootState: 0 Verified, 1 SelfSigned, 2 Unverified, 3 Failed; patch: osPatchLevel YYYYMM.
 */

/** @param {Abweichung} o */
function beschreibung(o) {
  const hw = [
    kontext(1, set(ganz(2))),
    kontext(2, ganz(o.algorithm ?? 3)),
    kontext(3, ganz(256)),
    kontext(10, ganz(o.kurve ?? 1)),
    ...(o.withoutLock || o.alsoWithoutLogin ? [kontext(503, nichts())] : []),
    ...(o.withoutLock ? [] : [kontext(504, ganz(3))]),
    ...(o.frist ? [kontext(505, ganz(o.frist))] : []),
    kontext(702, ganz(o.herkunft ?? 0)),
    ...(o.withoutRootOfTrust
      ? []
      : [
          kontext(
            704,
            seq(
              octets(Buffer.alloc(32, 9)),
              wahr(!o.openBootloader),
              recording(o.bootState ?? 0),
              octets(Buffer.alloc(32, 3)),
            ),
          ),
        ]),
    kontext(706, ganz(o.patch ?? 202610)),
  ];
  const app = seq(set(seq(octets(Buffer.from(o.paket ?? PAKET)), ganz(1))), set(octets(o.digest ?? DIGEST)));
  const sw = [kontext(709, octets(app))];
  return seq(
    ganz(300),
    recording(o.confidence ?? 1),
    ganz(300),
    recording(o.confidence ?? 1),
    octets(o.challenge),
    octets(Buffer.alloc(0)),
    seq(...sw),
    seq(...hw),
  );
}

/**
 * A chain like the keystore's getCertificateChain(), Base64, leaf first.
 * @param {Abweichung} o  challenge: the server's nonce as bytes
 */
function chain(o) {
  const w = o.wurzel ?? WURZEL;
  const zwischen = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const blatt = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const zThe = zertifikat({
    subject: 'Test-Zwischenstufe',
    aussteller: w.cn,
    public_key: zwischen.publicKey,
    signer: w.privateKey,
    ca: true,
  });
  const ext = o.withoutExtension ? [] : [seq(oid('1.3.6.1.4.1.11129.2.1.17'), octets(beschreibung(o)))];
  const bThe = zertifikat({
    subject: 'Android Keystore Key',
    aussteller: 'Test-Zwischenstufe',
    public_key: blatt.publicKey,
    signer: zwischen.privateKey,
    extensions: ext,
    von: new Date(0),
    bis: new Date('2048-01-01T00:00:00Z'),
  });
  return {
    chain: [bThe, zThe, w.der].map(d => d.toString('base64')),
    privateKey: blatt.privateKey,
    public_key: blatt.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

module.exports = {
  zertifikat,
  seq,
  oid,
  octets,
  tlv,
  WURZEL,
  PAKET,
  DIGEST,
  DIGEST_HEX,
  UMGEBUNG,
  newRoot,
  chain,
  beschreibung,
  storeRevocationList,
};
