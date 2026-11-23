/** Android key attestation of the device key: the chain proves that the
 * key was created in the TEE or StrongBox, signs only after device unlock and
 * belongs to our app. Without it a stolen token could register a software key
 * and pass the step guard without unlock. */
import { X509Certificate, type KeyObject } from 'node:crypto';
import { TheError, expect, children, readWhole, type Tlv, UNIVERSAL, theNumber } from './der';

/** 1.3.6.1.4.1.11129.2.1.17 as DER content. */
const OID_ATTESTATION = Buffer.from('2b06010401d679020111', 'hex');
const AT_MOST_LINKS = 8;

/** Tags of the AuthorizationList (KeyMint, hardware/interfaces/security/keymint). */
const TAG = {
  purpose: 1,
  algorithm: 2,
  curve: 10,
  withoutLogin: 503,
  loginKind: 504,
  loginDeadline: 505,
  onlyUnlocked: 509,
  origin: 702,
  rootOfTrust: 704,
  patchLevel: 706,
  appId: 709,
} as const;
const PURPOSE_SIGN = 2;
const ALGORITHM_EC = 3;
const CURVE_P256 = 1;
const ORIGIN_CREATED = 0;
/** PASSWORD | FINGERPRINT: the device lock or strong biometrics. */
const LOGIN_KINDS = 0b11;
const BOOT_VERIFIED = 0;

export type Confidence = 'software' | 'tee' | 'strongbox';
const SECURITY: readonly Confidence[] = ['software', 'tee', 'strongbox'];

export interface Description {
  version: number;
  confidence: Confidence;
  keymintSecurity: Confidence;
  challenge: Buffer;
  software: Map<number, Tlv>;
  hardware: Map<number, Tlv>;
}

function list(t: Tlv): Map<number, Tlv> {
  const m = new Map<number, Tlv>();
  for (const k of children(expect(t, UNIVERSAL.SEQUENCE))) {
    if (k.tagClass !== 2 || !k.constructed) throw new TheError('AuthorizationList: Eintrag ohne Kontext-Tag');
    if (m.has(k.number)) throw new TheError(`AuthorizationList: Tag ${k.number} doppelt`);
    const inner = children(k);
    if (inner.length !== 1) throw new TheError('AuthorizationList: Eintrag ohne genau einen Wert');
    m.set(k.number, inner[0] as Tlv);
  }
  return m;
}

function confidence(t: Tlv | undefined): Confidence {
  const s = SECURITY[theNumber(expect(t, UNIVERSAL.ENUMERATED))];
  if (!s) throw new TheError('KeyDescription: unbekannte Sicherheitsstufe');
  return s;
}

/** The KeyDescription from the extension's content (without the enclosing OCTET STRING). */
export function readDescription(encoded: Buffer): Description {
  const f = children(expect(readWhole(encoded), UNIVERSAL.SEQUENCE));
  if (f.length < 8) throw new TheError('KeyDescription: zu wenige Felder');
  return {
    version: theNumber(expect(f[0], UNIVERSAL.INTEGER)),
    confidence: confidence(f[1]),
    keymintSecurity: confidence(f[3]),
    challenge: expect(f[4], UNIVERSAL.OCTET_STRING).content,
    software: list(f[6] as Tlv),
    hardware: list(f[7] as Tlv),
  };
}

/** The content of the attestation extension, null without it. */
export function attestationExtension(certificateThe: Buffer): Buffer | null {
  const [tbs] = children(expect(readWhole(certificateThe), UNIVERSAL.SEQUENCE));
  const ext = children(expect(tbs, UNIVERSAL.SEQUENCE)).find(k => k.tagClass === 2 && k.number === 3);
  if (!ext) return null;
  let hits: Buffer | null = null;
  for (const e of children(expect(children(ext)[0], UNIVERSAL.SEQUENCE))) {
    const parts = children(expect(e, UNIVERSAL.SEQUENCE));
    if (!expect(parts[0], UNIVERSAL.OID).content.equals(OID_ATTESTATION)) continue;
    if (hits) throw new TheError('Attestation-Erweiterung doppelt');
    hits = expect(parts[parts.length - 1], UNIVERSAL.OCTET_STRING).content;
  }
  return hits;
}

/** Package names and SHA-256 of the signing certificates (hex, upper case) from attestationApplicationId. */
export function readAppId(t: Tlv): { packages: string[]; digests: string[] } {
  const [packages, digests] = children(
    expect(readWhole(expect(t, UNIVERSAL.OCTET_STRING).content), UNIVERSAL.SEQUENCE),
  );
  return {
    packages: children(expect(packages, UNIVERSAL.SET)).map(p =>
      expect(children(expect(p, UNIVERSAL.SEQUENCE))[0], UNIVERSAL.OCTET_STRING).content.toString('utf8'),
    ),
    digests: children(expect(digests, UNIVERSAL.SET)).map(d =>
      expect(d, UNIVERSAL.OCTET_STRING).content.toString('hex').toUpperCase(),
    ),
  };
}

export interface Expectation {
  roots: readonly X509Certificate[];
  pkg: string;
  /** SHA-256 of the signing certificates, hex upper case; empty accepts no app. */
  digests: readonly string[];
  /** Serial numbers from Google's revocation list (seriennummer()); mandatory so that no caller forgets them. */
  revoked: ReadonlySet<string>;
  patchAtLeast?: number | null;
  now: Date;
}

/** That is how Google's list writes them: hex lower case, without leading zeros. */
export function serialNumber(c: X509Certificate): string {
  return c.serialNumber.toLowerCase().replace(/^0+(?=.)/, '');
}

/** Locked bootloader with Google's or the manufacturer's key: otherwise
 * a KeyMint could be slipped in that confirms any lock. */
function checkBoot(t: Tlv | undefined): string | null {
  if (!t) return 'ohne_root_of_trust';
  const f = children(expect(t, UNIVERSAL.SEQUENCE));
  const locked = expect(f[1], UNIVERSAL.BOOLEAN).content;
  if (locked.length !== 1) throw new TheError('RootOfTrust: deviceLocked kein BOOLEAN');
  if (!locked[0]) return 'bootloader_offen';
  if (theNumber(expect(f[2], UNIVERSAL.ENUMERATED)) !== BOOT_VERIFIED) return 'boot_unverifiziert';
  return null;
}

export type Check =
  | { ok: true; public_key: KeyObject; challenge: Buffer; confidence: Confidence }
  | { ok: false; reason: string };

const spki = (c: X509Certificate) => c.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;

function checkLinks(z: X509Certificate[], raw: Buffer[], e: Expectation): string | null {
  const { now } = e;
  for (let i = 0; i < z.length; i++) {
    const c = z[i] as X509Certificate;
    // Issuers only with the CA bit (ca also checks keyCertSign) and without KeyDescription: otherwise
    // an ordinary keystore key would sign a leaf with an invented description.
    if (i > 0 && (!c.ca || attestationExtension(raw[i] as Buffer))) return `glied_${i}_kein_aussteller`;
    // The leaf carries the validity the keystore inserts (often 1970–2048), not a real one.
    if (i > 0 && (new Date(c.validFrom) > now || new Date(c.validTo) < now)) return `glied_${i}_abgelaufen`;
    const issuer = z[i + 1];
    if (issuer && (c.issuer !== issuer.subject || !c.verify(issuer.publicKey))) return `glied_${i}_signatur`;
  }
  const last = z[z.length - 1] as X509Certificate;
  const anchor =
    e.roots.find(w => spki(w).equals(spki(last))) ??
    e.roots.find(w => last.issuer === w.subject && last.verify(w.publicKey));
  if (!anchor) return 'fremde_wurzel';
  if (new Date(anchor.validFrom) > now || new Date(anchor.validTo) < now) return 'wurzel_abgelaufen';
  return null;
}

/** The key itself: EC P-256, for signing, created in the device and not imported. */
function checkKey(hw: Description['hardware'], z: (tag: number) => number | null): string | null {
  if (z(TAG.algorithm) !== ALGORITHM_EC || z(TAG.curve) !== CURVE_P256) return 'kein_ec_p256';
  const purposes = hw.get(TAG.purpose);
  if (!purposes || !children(expect(purposes, UNIVERSAL.SET)).some(t => theNumber(t) === PURPOSE_SIGN))
    return 'kein_signieren';
  if (z(TAG.origin) !== ORIGIN_CREATED) return 'importiert';
  return null;
}

/** The app that holds the key: exactly our package, signed with one of our certificates. */
function checkApp(b: Description, e: Expectation): string | null {
  const app = b.software.get(TAG.appId) ?? b.hardware.get(TAG.appId);
  if (!app) return 'ohne_app';
  const { packages, digests } = readAppId(app);
  if (packages.length !== 1 || packages[0] !== e.pkg) return 'fremdes_paket';
  if (!digests.length || !digests.some(d => e.digests.includes(d))) return 'fremde_signatur';
  return null;
}

function checkDescription(b: Description, e: Expectation): string | null {
  if (b.confidence === 'software' || b.keymintSecurity === 'software') return 'nur_software';
  const hw = b.hardware;
  const z = (tag: number) => {
    const t = hw.get(tag);
    return t ? theNumber(t) : null;
  };
  const key = checkKey(hw, z);
  if (key) return key;
  const boot = checkBoot(hw.get(TAG.rootOfTrust));
  if (boot) return boot;
  if (e.patchAtLeast && (z(TAG.patchLevel) ?? 0) < e.patchAtLeast) return 'patchstand_alt';
  // The app requires unlock on every use (timeout 0, see GeraeteSchluessel.kt).
  if (hw.has(TAG.withoutLogin) || !((z(TAG.loginKind) ?? 0) & LOGIN_KINDS)) return 'ohne_sperre';
  if ((z(TAG.loginDeadline) ?? 0) !== 0) return 'sperre_mit_frist';
  return checkApp(b, e);
}

/** The whole check without the nonce: the caller compares that with its database. */
export function checkChain(chainB64: readonly string[], e: Expectation): Check {
  if (!chainB64.length || chainB64.length > AT_MOST_LINKS) return { ok: false, reason: 'kette_laenge' };
  try {
    const raw = chainB64.map(s => Buffer.from(s, 'base64'));
    const z = raw.map(d => new X509Certificate(d));
    const error = checkLinks(z, raw, e);
    if (error) return { ok: false, reason: error };
    if (z.some(c => e.revoked.has(serialNumber(c)))) return { ok: false, reason: 'widerrufen' };
    const ext = attestationExtension(raw[0] as Buffer);
    if (!ext) return { ok: false, reason: 'ohne_attestation' };
    const b = readDescription(ext);
    const reason = checkDescription(b, e);
    if (reason) return { ok: false, reason };
    return {
      ok: true,
      public_key: (z[0] as X509Certificate).publicKey,
      challenge: b.challenge,
      confidence: b.confidence,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof TheError ? 'der_fehler' : 'kette_unlesbar' };
  }
}
