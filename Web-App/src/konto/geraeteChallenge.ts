/** Der Schrittschutz der App, am Server gebunden: Nur ein Keystore-Schlüssel,
 * der erst nach Gerätesperre oder starker Biometrie signiert, öffnet die
 * heiklen Schritte eines App-Tokens. Ein gerootetes Gerät mit Token allein
 * kommt ohne die Sperre nicht weiter. */
import { createPublicKey, randomBytes, verify, type KeyObject } from 'node:crypto';
import * as repo from './repository/geraeteSchluessel';
import type { Familie } from './repository/geraeteSchluessel';
import type { AKTIONEN } from '../vertrag/geraet';

export type { Familie };

export type Schrittaktion = (typeof AKTIONEN)[number];

/** Nur gleich nach dem Anmelden: Wer später mit einem erbeuteten Token käme,
 * könnte sonst seinen eigenen Schlüssel hinterlegen. */
export const SCHLUESSEL_FRIST_S = 10 * 60;
export const CHALLENGE_FRIST_S = 2 * 60;
const CHALLENGES_OFFEN = 5;
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

export type Registrierung = 'neu' | 'gleich' | 'anderer' | 'frist_vorbei' | 'ungueltig';

export async function hinterlegeSchluessel(f: Familie, oeffentlich: string): Promise<Registrierung> {
  const k = leseSchluessel(oeffentlich);
  if (!k) return 'ungueltig';
  const kanonisch = (k.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  const da = await repo.schluesselDer(f);
  if (da) return da === kanonisch ? 'gleich' : 'anderer';
  if (await repo.legeSchluesselAn(f, kanonisch, SCHLUESSEL_FRIST_S)) return 'neu';
  return (await repo.schluesselDer(f)) === kanonisch ? 'gleich' : 'frist_vorbei';
}

export type Challenge = { challenge: string; nachricht: string; gueltig_bis: Date } | 'kein_schluessel';

export async function neueChallenge(f: Familie, aktion: Schrittaktion): Promise<Challenge> {
  if (!(await repo.schluesselDer(f))) return 'kein_schluessel';
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
  const k = leseSchluessel((await repo.schluesselDer(f)) ?? '');
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
  return (await repo.schluesselDer(f)) ? 'freigabe_noetig' : 'kein_schluessel';
}
