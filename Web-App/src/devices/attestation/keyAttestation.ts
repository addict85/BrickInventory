/** Android key attestation of the device key: the chain proves that the
 * key was created in the TEE or StrongBox, signs only after device unlock and
 * belongs to our app. Without it a stolen token could register a software key
 * and pass the step guard without unlock. */
import { X509Certificate, type KeyObject } from 'node:crypto';
import { TheError, expect, kinder, readWhole, type Tlv, UNIVERSAL, theNumber } from './der';

/** 1.3.6.1.4.1.11129.2.1.17 as DER content. */
const OID_ATTESTATION = Buffer.from('2b06010401d679020111', 'hex');
const AT_MOST_LINKS = 8;

/** Tags of the AuthorizationList (KeyMint, hardware/interfaces/security/keymint). */
const TAG = {
  zweck: 1,
  algorithm: 2,
  kurve: 10,
  withoutLogin: 503,
  loginKind: 504,
  loginDeadline: 505,
  onlyUnlocked: 509,
  herkunft: 702,
  rootOfTrust: 704,
  patchstand: 706,
  appId: 709,
} as const;
const PURPOSE_SIGN = 2;
const ALGORITHM_EC = 3;
const CURVE_P256 = 1;
const ORIGIN_CREATED = 0;
/** PASSWORD | FINGERPRINT: the device lock or strong biometrics. */
const LOGIN_KINDS = 0b11;
const BOOT_VERIFIED = 0;

export type Sicherheit = 'software' | 'tee' | 'strongbox';
const SICHERHEIT: readonly Sicherheit[] = ['software', 'tee', 'strongbox'];

export interface Beschreibung {
  version: number;
  sicherheit: Sicherheit;
  keymintSecurity: Sicherheit;
  challenge: Buffer;
  software: Map<number, Tlv>;
  hardware: Map<number, Tlv>;
}

function liste(t: Tlv): Map<number, Tlv> {
  const m = new Map<number, Tlv>();
  for (const k of kinder(expect(t, UNIVERSAL.SEQUENCE))) {
    if (k.klasse !== 2 || !k.zusammengesetzt) throw new TheError('AuthorizationList: Eintrag ohne Kontext-Tag');
    if (m.has(k.nummer)) throw new TheError(`AuthorizationList: Tag ${k.nummer} doppelt`);
    const innen = kinder(k);
    if (innen.length !== 1) throw new TheError('AuthorizationList: Eintrag ohne genau einen Wert');
    m.set(k.nummer, innen[0] as Tlv);
  }
  return m;
}

function sicherheit(t: Tlv | undefined): Sicherheit {
  const s = SICHERHEIT[theNumber(expect(t, UNIVERSAL.ENUMERATED))];
  if (!s) throw new TheError('KeyDescription: unbekannte Sicherheitsstufe');
  return s;
}

/** The KeyDescription from the extension's content (without the enclosing OCTET STRING). */
export function readDescription(der: Buffer): Beschreibung {
  const f = kinder(expect(readWhole(der), UNIVERSAL.SEQUENCE));
  if (f.length < 8) throw new TheError('KeyDescription: zu wenige Felder');
  return {
    version: theNumber(expect(f[0], UNIVERSAL.INTEGER)),
    sicherheit: sicherheit(f[1]),
    keymintSecurity: sicherheit(f[3]),
    challenge: expect(f[4], UNIVERSAL.OCTET_STRING).inhalt,
    software: liste(f[6] as Tlv),
    hardware: liste(f[7] as Tlv),
  };
}

/** The content of the attestation extension, null without it. */
export function attestationExtension(certificateThe: Buffer): Buffer | null {
  const [tbs] = kinder(expect(readWhole(certificateThe), UNIVERSAL.SEQUENCE));
  const ext = kinder(expect(tbs, UNIVERSAL.SEQUENCE)).find(k => k.klasse === 2 && k.nummer === 3);
  if (!ext) return null;
  let treffer: Buffer | null = null;
  for (const e of kinder(expect(kinder(ext)[0], UNIVERSAL.SEQUENCE))) {
    const teile = kinder(expect(e, UNIVERSAL.SEQUENCE));
    if (!expect(teile[0], UNIVERSAL.OID).inhalt.equals(OID_ATTESTATION)) continue;
    if (treffer) throw new TheError('Attestation-Erweiterung doppelt');
    treffer = expect(teile[teile.length - 1], UNIVERSAL.OCTET_STRING).inhalt;
  }
  return treffer;
}

/** Package names and SHA-256 of the signing certificates (hex, upper case) from attestationApplicationId. */
export function readAppId(t: Tlv): { packages: string[]; digests: string[] } {
  const [packages, digests] = kinder(expect(readWhole(expect(t, UNIVERSAL.OCTET_STRING).inhalt), UNIVERSAL.SEQUENCE));
  return {
    packages: kinder(expect(packages, UNIVERSAL.SET)).map(p =>
      expect(kinder(expect(p, UNIVERSAL.SEQUENCE))[0], UNIVERSAL.OCTET_STRING).inhalt.toString('utf8'),
    ),
    digests: kinder(expect(digests, UNIVERSAL.SET)).map(d =>
      expect(d, UNIVERSAL.OCTET_STRING).inhalt.toString('hex').toUpperCase(),
    ),
  };
}

export interface Erwartung {
  roots: readonly X509Certificate[];
  paket: string;
  /** SHA-256 of the signing certificates, hex upper case; empty accepts no app. */
  digests: readonly string[];
  /** Serial numbers from Google's revocation list (seriennummer()); mandatory so that no caller forgets them. */
  widerrufen: ReadonlySet<string>;
  patchAtLeast?: number | null;
  jetzt: Date;
}

/** That is how Google's list writes them: hex lower case, without leading zeros. */
export function seriennummer(c: X509Certificate): string {
  return c.serialNumber.toLowerCase().replace(/^0+(?=.)/, '');
}

/** Locked bootloader with Google's or the manufacturer's key: otherwise
 * a KeyMint could be slipped in that confirms any lock. */
function checkBoot(t: Tlv | undefined): string | null {
  if (!t) return 'ohne_root_of_trust';
  const f = kinder(expect(t, UNIVERSAL.SEQUENCE));
  const gesperrt = expect(f[1], UNIVERSAL.BOOLEAN).inhalt;
  if (gesperrt.length !== 1) throw new TheError('RootOfTrust: deviceLocked kein BOOLEAN');
  if (!gesperrt[0]) return 'bootloader_offen';
  if (theNumber(expect(f[2], UNIVERSAL.ENUMERATED)) !== BOOT_VERIFIED) return 'boot_unverifiziert';
  return null;
}

export type Pruefung =
  | { ok: true; oeffentlich: KeyObject; challenge: Buffer; sicherheit: Sicherheit }
  | { ok: false; grund: string };

const spki = (c: X509Certificate) => c.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;

function checkLinks(z: X509Certificate[], roh: Buffer[], e: Erwartung): string | null {
  const { jetzt } = e;
  for (let i = 0; i < z.length; i++) {
    const c = z[i] as X509Certificate;
    // Issuers only with the CA bit (ca also checks keyCertSign) and without KeyDescription: otherwise
    // an ordinary keystore key would sign a leaf with an invented description.
    if (i > 0 && (!c.ca || attestationExtension(roh[i] as Buffer))) return `glied_${i}_kein_aussteller`;
    // The leaf carries the validity the keystore inserts (often 1970–2048), not a real one.
    if (i > 0 && (new Date(c.validFrom) > jetzt || new Date(c.validTo) < jetzt)) return `glied_${i}_abgelaufen`;
    const aussteller = z[i + 1];
    if (aussteller && (c.issuer !== aussteller.subject || !c.verify(aussteller.publicKey)))
      return `glied_${i}_signatur`;
  }
  const letztes = z[z.length - 1] as X509Certificate;
  const anker =
    e.roots.find(w => spki(w).equals(spki(letztes))) ??
    e.roots.find(w => letztes.issuer === w.subject && letztes.verify(w.publicKey));
  if (!anker) return 'fremde_wurzel';
  if (new Date(anker.validFrom) > jetzt || new Date(anker.validTo) < jetzt) return 'wurzel_abgelaufen';
  return null;
}

function checkDescription(b: Beschreibung, e: Erwartung): string | null {
  if (b.sicherheit === 'software' || b.keymintSecurity === 'software') return 'nur_software';
  const hw = b.hardware;
  const z = (tag: number) => {
    const t = hw.get(tag);
    return t ? theNumber(t) : null;
  };
  if (z(TAG.algorithm) !== ALGORITHM_EC || z(TAG.kurve) !== CURVE_P256) return 'kein_ec_p256';
  const purposes = hw.get(TAG.zweck);
  if (!purposes || !kinder(expect(purposes, UNIVERSAL.SET)).some(t => theNumber(t) === PURPOSE_SIGN))
    return 'kein_signieren';
  if (z(TAG.herkunft) !== ORIGIN_CREATED) return 'importiert';
  const boot = checkBoot(hw.get(TAG.rootOfTrust));
  if (boot) return boot;
  if (e.patchAtLeast && (z(TAG.patchstand) ?? 0) < e.patchAtLeast) return 'patchstand_alt';
  // The app requires unlock on every use (timeout 0, see GeraeteSchluessel.kt).
  if (hw.has(TAG.withoutLogin) || !((z(TAG.loginKind) ?? 0) & LOGIN_KINDS)) return 'ohne_sperre';
  if ((z(TAG.loginDeadline) ?? 0) !== 0) return 'sperre_mit_frist';
  const app = b.software.get(TAG.appId) ?? hw.get(TAG.appId);
  if (!app) return 'ohne_app';
  const { packages, digests } = readAppId(app);
  if (packages.length !== 1 || packages[0] !== e.paket) return 'fremdes_paket';
  if (!digests.length || !digests.some(d => e.digests.includes(d))) return 'fremde_signatur';
  return null;
}

/** The whole check without the nonce: the caller compares that with its database. */
export function checkChain(chainB64: readonly string[], e: Erwartung): Pruefung {
  if (!chainB64.length || chainB64.length > AT_MOST_LINKS) return { ok: false, grund: 'kette_laenge' };
  try {
    const roh = chainB64.map(s => Buffer.from(s, 'base64'));
    const z = roh.map(d => new X509Certificate(d));
    const fehler = checkLinks(z, roh, e);
    if (fehler) return { ok: false, grund: fehler };
    if (z.some(c => e.widerrufen.has(seriennummer(c)))) return { ok: false, grund: 'widerrufen' };
    const ext = attestationExtension(roh[0] as Buffer);
    if (!ext) return { ok: false, grund: 'ohne_attestation' };
    const b = readDescription(ext);
    const grund = checkDescription(b, e);
    if (grund) return { ok: false, grund };
    return {
      ok: true,
      oeffentlich: (z[0] as X509Certificate).publicKey,
      challenge: b.challenge,
      sicherheit: b.sicherheit,
    };
  } catch (err) {
    return { ok: false, grund: err instanceof TheError ? 'der_fehler' : 'kette_unlesbar' };
  }
}
