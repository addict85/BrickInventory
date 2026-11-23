/**
 * Android attestation chains for tests: an own root, an intermediate
 * and a leaf with the KeyDescription (OID 1.3.6.1.4.1.11129.2.1.17), as
 * KeyMint issues them. The server accepts the root via ATTESTATION_ROOTS.
 * Every deviation a test needs goes via the options of kette().
 */
const { createHash, generateKeyPairSync, sign } = require('node:crypto');

const tlv = (tag, content) => {
  const n = content.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from(tag), len, content]);
};
const seq = (...t) => tlv([0x30], Buffer.concat(t));
const set = (...t) => tlv([0x31], Buffer.concat(t));
const whole = n => {
  let h = n.toString(16);
  if (h.length % 2) h = '0' + h;
  let b = Buffer.from(h, 'hex');
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv([0x02], b);
};
const recording = n => tlv([0x0a], whole(n).subarray(2));
const octets = b => tlv([0x04], Buffer.from(b));
const nichts = () => Buffer.from([0x05, 0x00]);
const truthy = b => tlv([0x01], Buffer.from([b ? 0xff : 0x00]));
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
const context = (n, inner) => {
  if (n < 31) return tlv([0xa0 | n], inner);
  const b = [n & 0x7f];
  for (let r = n >> 7; r; r >>= 7) b.unshift((r & 0x7f) | 0x80);
  return tlv([0xbf, ...b], inner);
};
const name = cn => seq(set(seq(oid('2.5.4.3'), tlv([0x0c], Buffer.from(cn)))));
const time = d => tlv([0x17], Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));

/**
 * @param {{ subject: string, issuer: string, public_key: import('node:crypto').KeyObject,
 *   signer: import('node:crypto').KeyObject, ca?: boolean, extensions?: Buffer[], von?: Date, until?: Date }} z
 */
function certificate({ subject, issuer, public_key, signer, ca = false, extensions = [], von: from, until }) {
  const ext = [...extensions];
  if (ca)
    ext.push(seq(oid('2.5.29.19'), tlv([0x01], Buffer.from([0xff])), octets(seq(tlv([0x01], Buffer.from([0xff]))))));
  const tbs = seq(
    context(0, whole(2)),
    whole(Math.floor(Math.random() * 2 ** 40) + 1),
    ECDSA_SHA256,
    name(issuer),
    seq(time(from ?? new Date(Date.now() - 86_400_000)), time(until ?? new Date(Date.now() + 365 * 86_400_000))),
    name(subject),
    public_key.export({ format: 'der', type: 'spki' }),
    ...(ext.length ? [context(3, seq(...ext))] : []),
  );
  const sig = sign('sha256', tbs, { key: signer, dsaEncoding: 'der' });
  return seq(tbs, ECDSA_SHA256, tlv([0x03], Buffer.concat([Buffer.from([0]), sig])));
}

const pem = certBytes =>
  `-----BEGIN CERTIFICATE-----\n${certBytes
    .toString('base64')
    .match(/.{1,64}/g)
    .join('\n')}\n-----END CERTIFICATE-----\n`;

function newRoot(cn = 'Test-Attestierungswurzel') {
  const k = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const certBytes = certificate({ subject: cn, issuer: cn, public_key: k.publicKey, signer: k.privateKey, ca: true });
  return { ...k, cn, certBytes, pem: pem(certBytes) };
}

const ROOT_CERT = newRoot();
const PACKAGE = 'ch.brickinventoryapp';
/** The SHA-256 of the test app's signing certificate. */
const DIGEST = createHash('sha256').update('brickinventory-test-signatur').digest();
const DIGEST_HEX = DIGEST.toString('hex').toUpperCase();

/**
 * A loaded revocation list in run_state, as the job `revocation_list`
 * stores it; without it the server accepts no key.
 * @param {{ run: (sql: string, p: unknown[]) => Promise<unknown> }} db
 * @param {string[]} [numbers] @param {Date} [state]
 */
function storeRevocationList(db, numbers = [], state = new Date()) {
  return db.run(
    `INSERT INTO run_state (key, value) VALUES ('attestation_widerruf', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ state: state.toISOString(), nummern: numbers })],
  );
}

/** The environment with which a server accepts the test chains. */
const ENVIRONMENT = {
  ATTESTATION_ROOTS: ROOT_CERT.pem,
  PASSKEY_ANDROID_CERTIFICATES: DIGEST_HEX,
  PASSKEY_ANDROID_PACKAGE: PACKAGE,
};

/**
 * @typedef {{ challenge: Buffer, root?: ReturnType<typeof newRoot>, confidence?: number,
 *   pkg?: string, digest?: Buffer, withoutLock?: boolean, alsoWithoutLogin?: boolean,
 *   withoutExtension?: boolean, deadline?: number, provenance?: number, curve?: number, algorithm?: number,
 *   openBootloader?: boolean, bootState?: number, withoutRootOfTrust?: boolean, patch?: number }} Abweichung
 * withoutLock: noAuthRequired instead of userAuthType; alsoWithoutLogin: both, as a
 * manipulated KeyMint could report; sicherheit: 0 software, 1 TEE, 2 StrongBox;
 * bootState: 0 Verified, 1 SelfSigned, 2 Unverified, 3 Failed; patch: osPatchLevel YYYYMM.
 */

/** @param {Abweichung} o */
function description(o) {
  const hw = [
    context(1, set(whole(2))),
    context(2, whole(o.algorithm ?? 3)),
    context(3, whole(256)),
    context(10, whole(o.curve ?? 1)),
    ...(o.withoutLock || o.alsoWithoutLogin ? [context(503, nichts())] : []),
    ...(o.withoutLock ? [] : [context(504, whole(3))]),
    ...(o.deadline ? [context(505, whole(o.deadline))] : []),
    context(702, whole(o.provenance ?? 0)),
    ...(o.withoutRootOfTrust
      ? []
      : [
          context(
            704,
            seq(
              octets(Buffer.alloc(32, 9)),
              truthy(!o.openBootloader),
              recording(o.bootState ?? 0),
              octets(Buffer.alloc(32, 3)),
            ),
          ),
        ]),
    context(706, whole(o.patch ?? 202610)),
  ];
  const app = seq(set(seq(octets(Buffer.from(o.pkg ?? PACKAGE)), whole(1))), set(octets(o.digest ?? DIGEST)));
  const sw = [context(709, octets(app))];
  return seq(
    whole(300),
    recording(o.confidence ?? 1),
    whole(300),
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
  const w = o.root ?? ROOT_CERT;
  const between = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const blatt = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const zThe = certificate({
    subject: 'Test-Zwischenstufe',
    issuer: w.cn,
    public_key: between.publicKey,
    signer: w.privateKey,
    ca: true,
  });
  const ext = o.withoutExtension ? [] : [seq(oid('1.3.6.1.4.1.11129.2.1.17'), octets(description(o)))];
  const bThe = certificate({
    subject: 'Android Keystore Key',
    issuer: 'Test-Zwischenstufe',
    public_key: blatt.publicKey,
    signer: between.privateKey,
    extensions: ext,
    von: new Date(0),
    until: new Date('2048-01-01T00:00:00Z'),
  });
  return {
    chain: [bThe, zThe, w.certBytes].map(d => d.toString('base64')),
    privateKey: blatt.privateKey,
    public_key: blatt.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

module.exports = {
  certificate,
  seq,
  oid,
  octets,
  tlv,
  ROOT_CERT,
  PACKAGE,
  DIGEST,
  DIGEST_HEX,
  ENVIRONMENT,
  newRoot,
  chain,
  description,
  storeRevocationList,
};
