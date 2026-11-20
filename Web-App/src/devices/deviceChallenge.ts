/** Der Schrittschutz der App, am Server gebunden: Nur ein Keystore-Schlüssel,
 * der erst nach Gerätesperre oder starker Biometrie signiert, öffnet die
 * heiklen Schritte eines App-Tokens. Das belegt seine Attestation; ohne sie
 * hinterlegte ein erbeuteter Token einen Schlüssel ohne Sperre. */
import { createPublicKey, randomBytes, verify, X509Certificate, type KeyObject } from 'node:crypto';
import type { Familie } from './repository/deviceKeys';
import type { ACTIONS } from '../vertrag/geraet';
import { GOOGLE_ROOTS } from './attestation/googleRoots';
import { checkChain } from './attestation/keyAttestation';
import { applicableList, REVOCATION_STATE } from './attestation/revocationList';
import type { DevicesContext } from './context';
import { prozessweit } from '../infra/prozessweit';
import { fachfehler } from '../infra/fehlerTexte';

export type { Familie };

export type Schrittaktion = (typeof ACTIONS)[number];

/** Nur gleich nach dem Anmelden: Wer später mit einem erbeuteten Token käme,
 * könnte sonst seinen eigenen Schlüssel hinterlegen. */
export const KEY_DEADLINE_S = 10 * 60;
export const CHALLENGE_FRIST_S = 2 * 60;
const CHALLENGES_OPEN = 5;
const NONCES_OPEN = 3;
/** Die Verwaltung bleibt in der App offen, bis sie in den Hintergrund geht;
 * das Fenster gleitet darum mit, endet aber spätestens nach HOECHSTENS_S. */
export const RELEASE_IDLE_S = 5 * 60;
export const RELEASE_AT_MOST_S = 30 * 60;

/** Was die App signiert. Die Aktion steht darin, damit eine Challenge nie für eine andere taugt. */
export const nachricht = (aktion: Schrittaktion, challenge: string) =>
  `BrickInventory-Schritt/1\n${aktion}\n${challenge}`;

export function familyFrom(
  apiUser: { user_id: number; created_at?: string | Date | undefined } | undefined,
): Familie | null {
  const seit = apiUser?.created_at;
  if (!apiUser || seit === undefined || seit === null) return null;
  const d = new Date(seit);
  return Number.isNaN(d.getTime()) ? null : { uid: apiUser.user_id, seit: d.toISOString() };
}

/** Nur EC P-256 als SPKI (Base64), so wie PublicKey.getEncoded() des Keystores ihn liefert. */
export function readKey(b64: string): KeyObject | null {
  try {
    const k = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ec' && k.asymmetricKeyDetails?.namedCurve === 'prime256v1' ? k : null;
  } catch {
    return null;
  }
}

/** Was die App als Attestation-Challenge einsetzt; gilt bis zum Ende von KEY_DEADLINE_S.
 * Eine Familie aus der QR-Kopplung bekommt nur die Nonce ihrer Abholung. */
export async function newNonce(k: DevicesContext, f: Familie, fromQr = false): Promise<string | null> {
  if (!fromQr) {
    const qr = await k.geraeteSchluessel.qrNonceThe(f);
    if (qr) return qr.nonce;
  }
  const nonce = randomBytes(32).toString('base64url');
  const ok = await k.geraeteSchluessel.putNonceAn(f, nonce, {
    fristS: KEY_DEADLINE_S,
    offen: NONCES_OPEN,
    fromQr,
  });
  return ok ? nonce : null;
}

/** Nach der QR-Abholung: Die Nonce gilt nur der Familie des neuen Tokens; ohne Familie keine. */
export async function nonceForQrToken(k: DevicesContext, tokenHash: string): Promise<string | null> {
  const f = await k.geraeteSchluessel.familyOfTokens(tokenHash);
  return f ? newNonce(k, f, true) : null;
}

/** Je PEM einmal gelesen; der Schlüssel '' steht für die Google-Wurzeln. */
function roots(pem: string): X509Certificate[] {
  const wurzelCache = prozessweit('attestationWurzeln', () => new Map<string, X509Certificate[]>());
  let liste = wurzelCache.get(pem);
  if (!liste) {
    const teile = pem
      ? (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [])
      : GOOGLE_ROOTS;
    liste = teile.map(p => new X509Certificate(p));
    wurzelCache.set(pem, liste);
  }
  return liste;
}

export type Registrierung = 'neu' | 'gleich';

/** Der Grund gehört ins Protokoll: Die App kann ihn nicht beheben, der Betreiber (Fingerabdruck) schon. */
function attestationRejected(f: Familie, grund: string): never {
  console.warn(`[geraet] Attestation von Konto ${f.uid} abgewiesen: ${grund}`);
  fachfehler('ungueltig', 'geraeteschluessel_attestation');
}

/** Die Kette muss die Prüfung bestehen und eine noch offene Nonce dieser Familie tragen. */
export async function depositKey(kx: DevicesContext, f: Familie, kette: readonly string[]): Promise<Registrierung> {
  const k = kx.konfig;
  const widerrufen = applicableList(
    await kx.auftraege.liesZustand(REVOCATION_STATE),
    k.attestationRevocationDays,
    kx.uhr.datum(),
  );
  if (!widerrufen) attestationRejected(f, 'widerrufsliste_fehlt');
  const p = checkChain(kette, {
    roots: roots(k.attestationWurzeln ?? ''),
    paket: k.androidPaket,
    digests: k.androidZertifikate,
    widerrufen,
    patchAtLeast: k.attestationPatchAtLeast,
    jetzt: kx.uhr.datum(),
  });
  if (!p.ok) attestationRejected(f, p.grund);
  const canonical = (p.oeffentlich.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64');
  if (!readKey(canonical)) fachfehler('ungueltig', 'geraeteschluessel_ungueltig');
  const da = await kx.geraeteSchluessel.entryThe(f);
  if (da?.attested) {
    if (da.public_key !== canonical) fachfehler('konflikt', 'geraeteschluessel_vorhanden');
    return 'gleich';
  }
  if (!(await kx.geraeteSchluessel.takeNonce(f, p.challenge.toString('base64url'))))
    attestationRejected(f, 'challenge');
  if (await kx.geraeteSchluessel.putKeyAn(f, canonical, KEY_DEADLINE_S)) return 'neu';
  if ((await kx.geraeteSchluessel.entryThe(f))?.public_key !== canonical)
    fachfehler('verboten', 'geraeteschluessel_frist');
  return 'gleich';
}

export type Challenge = { challenge: string; nachricht: string; gueltig_bis: Date };

export async function newChallenge(k: DevicesContext, f: Familie, aktion: Schrittaktion): Promise<Challenge> {
  if (!(await k.geraeteSchluessel.keyThe(f, k.konfig.geraeteschluesselAltBis)))
    fachfehler('verboten', 'geraeteschluessel_fehlt');
  const challenge = randomBytes(32).toString('base64url');
  const bis = await k.geraeteSchluessel.putChallengeAn(f, challenge, aktion, CHALLENGE_FRIST_S, CHALLENGES_OPEN);
  return { challenge, nachricht: nachricht(aktion, challenge), gueltig_bis: bis };
}

/** Die Challenge ist danach verbraucht, auch bei falscher Signatur: Raten kostet je Versuch eine neue. */
export async function resolveOne(
  kx: DevicesContext,
  f: Familie,
  challenge: string,
  signatureB64: string,
): Promise<{ aktion: Schrittaktion; bis: Date } | null> {
  const aktion = (await kx.geraeteSchluessel.takeChallenge(f, challenge)) as Schrittaktion | null;
  if (!aktion) return null;
  const k = readKey((await kx.geraeteSchluessel.keyThe(f, kx.konfig.geraeteschluesselAltBis)) ?? '');
  let passt = false;
  try {
    passt =
      !!k &&
      verify(
        'sha256',
        Buffer.from(nachricht(aktion, challenge), 'utf8'),
        { key: k, dsaEncoding: 'der' },
        Buffer.from(signatureB64, 'base64'),
      );
  } catch {
    passt = false;
  }
  if (!passt) return null;
  return {
    aktion,
    bis: await kx.geraeteSchluessel.openRelease(f, aktion, RELEASE_IDLE_S, RELEASE_AT_MOST_S),
  };
}

export type Pruefung = 'frei' | 'kein_schluessel' | 'freigabe_noetig';

export async function pruefeFreigabe(k: DevicesContext, f: Familie, aktion: Schrittaktion): Promise<Pruefung> {
  if (await k.geraeteSchluessel.useRelease(f, aktion, RELEASE_IDLE_S)) return 'frei';
  return (await k.geraeteSchluessel.keyThe(f, k.konfig.geraeteschluesselAltBis))
    ? 'freigabe_noetig'
    : 'kein_schluessel';
}
