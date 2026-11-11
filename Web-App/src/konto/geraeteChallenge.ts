/** Der Schrittschutz der App, am Server gebunden: Nur ein Keystore-Schlüssel,
 * der erst nach Gerätesperre oder starker Biometrie signiert, öffnet die
 * heiklen Schritte eines App-Tokens. Das belegt seine Attestation; ohne sie
 * hinterlegte ein erbeuteter Token einen Schlüssel ohne Sperre. */
import { createPublicKey, randomBytes, verify, X509Certificate, type KeyObject } from 'node:crypto';
import * as repo from './repository/geraeteSchluessel';
import type { Familie } from './repository/geraeteSchluessel';
import type { AKTIONEN } from '../vertrag/geraet';
import { konfig } from '../infra/konfig';
import { GOOGLE_WURZELN } from './attestation/googleWurzeln';
import { pruefeKette } from './attestation/schluesselAttestation';

export type { Familie };

export type Schrittaktion = (typeof AKTIONEN)[number];

/** Nur gleich nach dem Anmelden: Wer später mit einem erbeuteten Token käme,
 * könnte sonst seinen eigenen Schlüssel hinterlegen. */
export const SCHLUESSEL_FRIST_S = 10 * 60;
export const CHALLENGE_FRIST_S = 2 * 60;
const CHALLENGES_OFFEN = 5;
const NONCES_OFFEN = 3;
/** Die Verwaltung bleibt in der App offen, bis sie in den Hintergrund geht;
 * das Fenster gleitet darum mit, endet aber spätestens nach HOECHSTENS_S. */
export const FREIGABE_LEERLAUF_S = 5 * 60;
export const FREIGABE_HOECHSTENS_S = 30 * 60;

/** Was die App signiert. Die Aktion steht darin, damit eine Challenge nie für eine andere taugt. */
export const nachricht = (aktion: Schrittaktion, challenge: string) =>
  `BrickInventory-Schritt/1\n${aktion}\n${challenge}`;

export function familieAus(
  apiUser: { user_id: number; created_at?: string | Date | undefined } | undefined,
): Familie | null {
  const seit = apiUser?.created_at;
  if (!apiUser || seit === undefined || seit === null) return null;
  const d = new Date(seit);
  return Number.isNaN(d.getTime()) ? null : { uid: apiUser.user_id, seit: d.toISOString() };
}

/** Nur EC P-256 als SPKI (Base64), so wie PublicKey.getEncoded() des Keystores ihn liefert. */
export function leseSchluessel(b64: string): KeyObject | null {
  try {
    const k = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ec' && k.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? k : null;
  } catch {
    return null;
  }
}

/** Was die App als Attestation-Challenge einsetzt; gilt bis zum Ende von SCHLUESSEL_FRIST_S.
 * Eine Familie aus der QR-Kopplung bekommt nur die Nonce ihrer Abholung. */
export async function neueNonce(f: Familie, ausQr = false): Promise<string | null> {
  if (!ausQr) {
    const qr = await repo.qrNonceDer(f);
    if (qr) return qr.nonce;
  }
  const nonce = randomBytes(32).toString('base64url');
  const ok = await repo.legeNonceAn(f, nonce, { fristS: SCHLUESSEL_FRIST_S, offen: NONCES_OFFEN, ausQr });
  return ok ? nonce : null;
}

/** Je PEM einmal gelesen; der Schlüssel '' steht für die Google-Wurzeln. */
const wurzelCache = new Map<string, X509Certificate[]>();
function wurzeln(): X509Certificate[] {
  const pem = konfig().attestationWurzeln ?? '';
  let liste = wurzelCache.get(pem);
  if (!liste) {
    const teile = pem
      ? (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [])
      : GOOGLE_WURZELN;
    liste = teile.map(p => new X509Certificate(p));
    wurzelCache.set(pem, liste);
  }
  return liste;
}

export type Registrierung = 'neu' | 'gleich' | 'anderer' | 'frist_vorbei' | 'ungueltig' | { abgewiesen: string };

/** Die Kette muss die Prüfung bestehen und eine noch offene Nonce dieser Familie tragen. */
export async function hinterlegeSchluessel(f: Familie, kette: readonly string[]): Promise<Registrierung> {
  const k = konfig();
  const p = pruefeKette(kette, { wurzeln: wurzeln(), paket: k.androidPaket, digests: k.androidZertifikate });
  if (!p.ok) return { abgewiesen: p.grund };
  const kanonisch = (p.oeffentlich.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  if (!leseSchluessel(kanonisch)) return 'ungueltig';
  const da = await repo.eintragDer(f);
  if (da?.attestiert) return da.oeffentlich === kanonisch ? 'gleich' : 'anderer';
  if (!(await repo.nimmNonce(f, p.challenge.toString('base64url')))) return { abgewiesen: 'challenge' };
  if (await repo.legeSchluesselAn(f, kanonisch, SCHLUESSEL_FRIST_S)) return 'neu';
  return (await repo.eintragDer(f))?.oeffentlich === kanonisch ? 'gleich' : 'frist_vorbei';
}

export type Challenge = { challenge: string; nachricht: string; gueltig_bis: Date } | 'kein_schluessel';

export async function neueChallenge(f: Familie, aktion: Schrittaktion): Promise<Challenge> {
  if (!(await repo.schluesselDer(f, konfig().geraeteschluesselAltBis))) return 'kein_schluessel';
  const challenge = randomBytes(32).toString('base64url');
  const bis = await repo.legeChallengeAn(f, challenge, aktion, CHALLENGE_FRIST_S, CHALLENGES_OFFEN);
  return { challenge, nachricht: nachricht(aktion, challenge), gueltig_bis: bis };
}

/** Die Challenge ist danach verbraucht, auch bei falscher Signatur: Raten kostet je Versuch eine neue. */
export async function loeseEin(
  f: Familie,
  challenge: string,
  signaturB64: string,
): Promise<{ aktion: Schrittaktion; bis: Date } | null> {
  const aktion = (await repo.nimmChallenge(f, challenge)) as Schrittaktion | null;
  if (!aktion) return null;
  const k = leseSchluessel((await repo.schluesselDer(f, konfig().geraeteschluesselAltBis)) ?? '');
  let passt = false;
  try {
    passt =
      !!k &&
      verify(
        'sha256',
        Buffer.from(nachricht(aktion, challenge), 'utf8'),
        { key: k, dsaEncoding: 'der' },
        Buffer.from(signaturB64, 'base64'),
      );
  } catch {
    passt = false;
  }
  if (!passt) return null;
  return { aktion, bis: await repo.oeffneFreigabe(f, aktion, FREIGABE_LEERLAUF_S, FREIGABE_HOECHSTENS_S) };
}

export type Pruefung = 'frei' | 'kein_schluessel' | 'freigabe_noetig';

export async function pruefeFreigabe(f: Familie, aktion: Schrittaktion): Promise<Pruefung> {
  if (await repo.nutzeFreigabe(f, aktion, FREIGABE_LEERLAUF_S)) return 'frei';
  return (await repo.schluesselDer(f, konfig().geraeteschluesselAltBis)) ? 'freigabe_noetig' : 'kein_schluessel';
}
