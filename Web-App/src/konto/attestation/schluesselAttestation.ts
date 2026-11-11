/** Android Key Attestation des Geräteschlüssels: Die Kette beweist, dass der
 * Schlüssel im TEE oder StrongBox entstand, nur nach Gerätesperre signiert und
 * unserer App gehört. Ohne sie könnte ein erbeuteter Token einen Software-Schlüssel
 * hinterlegen und den Schrittschutz ohne Sperre lösen. */
import { X509Certificate, type KeyObject } from 'node:crypto';
import { DerFehler, erwarte, kinder, liesGanz, type Tlv, UNIVERSAL, derZahl } from './der';

/** 1.3.6.1.4.1.11129.2.1.17 als DER-Inhalt. */
const OID_ATTESTATION = Buffer.from('2b06010401d679020111', 'hex');
const HOECHSTENS_GLIEDER = 8;

/** Tags der AuthorizationList (KeyMint, hardware/interfaces/security/keymint). */
const TAG = {
  zweck: 1,
  algorithmus: 2,
  kurve: 10,
  ohneAnmeldung: 503,
  anmeldeArt: 504,
  anmeldeFrist: 505,
  nurEntsperrt: 509,
  herkunft: 702,
  appKennung: 709,
} as const;
const ZWECK_SIGNIEREN = 2;
const ALGORITHMUS_EC = 3;
const KURVE_P256 = 1;
const HERKUNFT_ERZEUGT = 0;
/** PASSWORD | FINGERPRINT: die Gerätesperre oder starke Biometrie. */
const ANMELDE_ARTEN = 0b11;

export type Sicherheit = 'software' | 'tee' | 'strongbox';
const SICHERHEIT: readonly Sicherheit[] = ['software', 'tee', 'strongbox'];

export interface Beschreibung {
  version: number;
  sicherheit: Sicherheit;
  keymintSicherheit: Sicherheit;
  challenge: Buffer;
  software: Map<number, Tlv>;
  hardware: Map<number, Tlv>;
}

function liste(t: Tlv): Map<number, Tlv> {
  const m = new Map<number, Tlv>();
  for (const k of kinder(erwarte(t, UNIVERSAL.SEQUENCE))) {
    if (k.klasse !== 2 || !k.zusammengesetzt) throw new DerFehler('AuthorizationList: Eintrag ohne Kontext-Tag');
    if (m.has(k.nummer)) throw new DerFehler(`AuthorizationList: Tag ${k.nummer} doppelt`);
    const innen = kinder(k);
    if (innen.length !== 1) throw new DerFehler('AuthorizationList: Eintrag ohne genau einen Wert');
    m.set(k.nummer, innen[0] as Tlv);
  }
  return m;
}

function sicherheit(t: Tlv | undefined): Sicherheit {
  const s = SICHERHEIT[derZahl(erwarte(t, UNIVERSAL.ENUMERATED))];
  if (!s) throw new DerFehler('KeyDescription: unbekannte Sicherheitsstufe');
  return s;
}

/** Die KeyDescription aus dem Inhalt der Erweiterung (ohne das umhüllende OCTET STRING). */
export function leseBeschreibung(der: Buffer): Beschreibung {
  const f = kinder(erwarte(liesGanz(der), UNIVERSAL.SEQUENCE));
  if (f.length < 8) throw new DerFehler('KeyDescription: zu wenige Felder');
  return {
    version: derZahl(erwarte(f[0], UNIVERSAL.INTEGER)),
    sicherheit: sicherheit(f[1]),
    keymintSicherheit: sicherheit(f[3]),
    challenge: erwarte(f[4], UNIVERSAL.OCTET_STRING).inhalt,
    software: liste(f[6] as Tlv),
    hardware: liste(f[7] as Tlv),
  };
}

/** Der Inhalt der Attestation-Erweiterung, null ohne sie. */
export function attestationErweiterung(zertifikatDer: Buffer): Buffer | null {
  const [tbs] = kinder(erwarte(liesGanz(zertifikatDer), UNIVERSAL.SEQUENCE));
  const ext = kinder(erwarte(tbs, UNIVERSAL.SEQUENCE)).find(k => k.klasse === 2 && k.nummer === 3);
  if (!ext) return null;
  let treffer: Buffer | null = null;
  for (const e of kinder(erwarte(kinder(ext)[0], UNIVERSAL.SEQUENCE))) {
    const teile = kinder(erwarte(e, UNIVERSAL.SEQUENCE));
    if (!erwarte(teile[0], UNIVERSAL.OID).inhalt.equals(OID_ATTESTATION)) continue;
    if (treffer) throw new DerFehler('Attestation-Erweiterung doppelt');
    treffer = erwarte(teile[teile.length - 1], UNIVERSAL.OCTET_STRING).inhalt;
  }
  return treffer;
}

/** Paketnamen und SHA-256 der Signaturzertifikate (Hex, gross) aus attestationApplicationId. */
export function leseAppKennung(t: Tlv): { pakete: string[]; digests: string[] } {
  const [pakete, digests] = kinder(erwarte(liesGanz(erwarte(t, UNIVERSAL.OCTET_STRING).inhalt), UNIVERSAL.SEQUENCE));
  return {
    pakete: kinder(erwarte(pakete, UNIVERSAL.SET)).map(p =>
      erwarte(kinder(erwarte(p, UNIVERSAL.SEQUENCE))[0], UNIVERSAL.OCTET_STRING).inhalt.toString('utf8'),
    ),
    digests: kinder(erwarte(digests, UNIVERSAL.SET)).map(d =>
      erwarte(d, UNIVERSAL.OCTET_STRING).inhalt.toString('hex').toUpperCase(),
    ),
  };
}

export interface Erwartung {
  wurzeln: readonly X509Certificate[];
  paket: string;
  /** SHA-256 der Signaturzertifikate, Hex gross; leer nimmt keine App an. */
  digests: readonly string[];
  jetzt?: Date;
}

export type Pruefung =
  | { ok: true; oeffentlich: KeyObject; challenge: Buffer; sicherheit: Sicherheit }
  | { ok: false; grund: string };

const spki = (c: X509Certificate) => c.publicKey.export({ format: 'der', type: 'spki' }) as Buffer;

function pruefeGlieder(z: X509Certificate[], e: Erwartung): string | null {
  const jetzt = e.jetzt ?? new Date();
  for (let i = 0; i < z.length; i++) {
    const c = z[i] as X509Certificate;
    // Das Blatt trägt die Gültigkeit, die der Keystore einsetzt (oft 1970–2048), keine echte.
    if (i > 0 && (new Date(c.validFrom) > jetzt || new Date(c.validTo) < jetzt)) return `glied_${i}_abgelaufen`;
    const aussteller = z[i + 1];
    if (aussteller && (c.issuer !== aussteller.subject || !c.verify(aussteller.publicKey)))
      return `glied_${i}_signatur`;
  }
  const letztes = z[z.length - 1] as X509Certificate;
  const anker =
    e.wurzeln.find(w => spki(w).equals(spki(letztes))) ??
    e.wurzeln.find(w => letztes.issuer === w.subject && letztes.verify(w.publicKey));
  if (!anker) return 'fremde_wurzel';
  if (new Date(anker.validFrom) > jetzt || new Date(anker.validTo) < jetzt) return 'wurzel_abgelaufen';
  return null;
}

function pruefeBeschreibung(b: Beschreibung, e: Erwartung): string | null {
  if (b.sicherheit === 'software' || b.keymintSicherheit === 'software') return 'nur_software';
  const hw = b.hardware;
  const z = (tag: number) => {
    const t = hw.get(tag);
    return t ? derZahl(t) : null;
  };
  if (z(TAG.algorithmus) !== ALGORITHMUS_EC || z(TAG.kurve) !== KURVE_P256) return 'kein_ec_p256';
  const zwecke = hw.get(TAG.zweck);
  if (!zwecke || !kinder(erwarte(zwecke, UNIVERSAL.SET)).some(t => derZahl(t) === ZWECK_SIGNIEREN))
    return 'kein_signieren';
  if (z(TAG.herkunft) !== HERKUNFT_ERZEUGT) return 'importiert';
  // Die App verlangt die Sperre bei jeder Benutzung (Frist 0, siehe GeraeteSchluessel.kt).
  if (hw.has(TAG.ohneAnmeldung) || !((z(TAG.anmeldeArt) ?? 0) & ANMELDE_ARTEN)) return 'ohne_sperre';
  if ((z(TAG.anmeldeFrist) ?? 0) !== 0) return 'sperre_mit_frist';
  const app = b.software.get(TAG.appKennung) ?? hw.get(TAG.appKennung);
  if (!app) return 'ohne_app';
  const { pakete, digests } = leseAppKennung(app);
  if (pakete.length !== 1 || pakete[0] !== e.paket) return 'fremdes_paket';
  if (!digests.length || !digests.some(d => e.digests.includes(d))) return 'fremde_signatur';
  return null;
}

/** Die ganze Prüfung ohne die Nonce: Die vergleicht der Aufrufer mit seiner Datenbank. */
export function pruefeKette(ketteB64: readonly string[], e: Erwartung): Pruefung {
  if (!ketteB64.length || ketteB64.length > HOECHSTENS_GLIEDER) return { ok: false, grund: 'kette_laenge' };
  try {
    const roh = ketteB64.map(s => Buffer.from(s, 'base64'));
    const z = roh.map(d => new X509Certificate(d));
    const fehler = pruefeGlieder(z, e);
    if (fehler) return { ok: false, grund: fehler };
    const ext = attestationErweiterung(roh[0] as Buffer);
    if (!ext) return { ok: false, grund: 'ohne_attestation' };
    const b = leseBeschreibung(ext);
    const grund = pruefeBeschreibung(b, e);
    if (grund) return { ok: false, grund };
    return {
      ok: true,
      oeffentlich: (z[0] as X509Certificate).publicKey,
      challenge: b.challenge,
      sicherheit: b.sicherheit,
    };
  } catch (err) {
    return { ok: false, grund: err instanceof DerFehler ? 'der_fehler' : 'kette_unlesbar' };
  }
}
