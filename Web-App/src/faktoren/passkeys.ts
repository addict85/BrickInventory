/** Registrieren, anmelden ohne Passwort und als zweiter Faktor anstelle des
 * TOTP-Codes. */
import crypto from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { decodeClientDataJSON } from '@simplewebauthn/server/helpers';
import { basisUrl } from '../infra/basisUrl';
import { fehlertext } from '../infra/fehler';
import { fachfehler } from '../infra/fehlerTexte';
import { suchwert } from '../infra/geheimnis';
import type { FaktorenKontext } from './kontext';
import { androidHerkuenfte } from './androidApp';

function abgewiesen(e: unknown): null {
  console.warn('[passkey] Antwort abgewiesen:', fehlertext(e));
  return null;
}

function alsAntwort<T extends RegistrationResponseJSON | AuthenticationResponseJSON>(roh: unknown): T | null {
  const a = roh as { id?: unknown; response?: { clientDataJSON?: unknown } } | null;
  return a && typeof a.id === 'string' && typeof a.response?.clientDataJSON === 'string' ? (roh as T) : null;
}

type Transporte = NonNullable<WebAuthnCredential['transports']>;
const transporte = (s: string | null): { transports?: Transporte } =>
  s ? { transports: s.split(',') as Transporte } : {};

export type PasskeyZweck = 'registrieren' | 'anmelden' | 'zweiter_faktor';

/** Der Browser-Dialog läuft höchstens so lange. */
const CHALLENGE_MS = 5 * 60 * 1000;

/** Ein Browser lässt WebAuthn nur für einen Domänennamen zu, nicht für eine
 * IP-Adresse; ohne Namen gibt es keine Passkeys. */
export function vertrauenspartei(): { rpID: string; origin: string; rpName: string } | null {
  const basis = basisUrl();
  if (!basis) return null;
  const u = new URL(basis);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.startsWith('[')) return null;
  return { rpID: u.hostname, origin: u.origin, rpName: 'BrickInventory' };
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Offene Challenges je Zweck; nur das Registrieren (angemeldet) legt sie ab. Darüber 503
 * statt einer Tabelle, die ohne Grenze wächst. */
export const OFFENE_CHALLENGES_HOECHSTENS = 5000;

const ZWECKE: readonly PasskeyZweck[] = ['registrieren', 'anmelden', 'zweiter_faktor'];
const signatur = (inhalt: Buffer) => Buffer.from(suchwert('passkey-challenge', inhalt.toString('base64url')), 'hex');

/** Die öffentlichen Anmeldeoptionen legen nichts ab: Frist, Zweck und Zufall tragen ihre eigene
 * Signatur. Sonst füllten viele Adressen eine gemeinsame Tabelle und sperrten alle aus. */
function signierteChallenge(zweck: PasskeyZweck, bisMs: number): Uint8Array<ArrayBuffer> {
  const inhalt = Buffer.alloc(23);
  inhalt.writeUIntBE(Math.ceil(bisMs / 1000), 0, 6);
  inhalt[6] = ZWECKE.indexOf(zweck);
  crypto.randomBytes(16).copy(inhalt, 7);
  return new Uint8Array(Buffer.concat([inhalt, signatur(inhalt)]));
}

/** @returns die Frist in ms, wenn Signatur, Zweck und Frist stimmen */
function signierteFrist(challenge: string, zweck: PasskeyZweck, jetzt: number): number | null {
  const b = Buffer.from(challenge, 'base64url');
  if (b.length !== 55) return null;
  const inhalt = b.subarray(0, 23);
  if (!crypto.timingSafeEqual(b.subarray(23), signatur(inhalt))) return null;
  const bis = inhalt.readUIntBE(0, 6) * 1000;
  return inhalt[6] === ZWECKE.indexOf(zweck) && bis > jetzt && bis <= jetzt + CHALLENGE_MS + 1000 ? bis : null;
}

async function merkeChallenge(
  k: FaktorenKontext,
  challenge: string,
  zweck: PasskeyZweck,
  uid: number | null,
): Promise<void> {
  if (
    !(await k.passkeys.speichereChallenge(
      hash(challenge),
      zweck,
      uid,
      new Date(k.uhr.jetzt() + CHALLENGE_MS),
      OFFENE_CHALLENGES_HOECHSTENS,
    ))
  )
    fachfehler('nicht_verfuegbar', 'server_ausgelastet');
}

/** Genau einmal: Eine wiederholte Antwort findet ihre Zeile nicht mehr. */
async function loeseChallengeEin(
  k: FaktorenKontext,
  clientDataJSON: unknown,
  zweck: PasskeyZweck,
  uid: number | null,
): Promise<string | null> {
  if (typeof clientDataJSON !== 'string') return null;
  let challenge: string;
  try {
    challenge = decodeClientDataJSON(clientDataJSON).challenge;
  } catch (e) {
    return abgewiesen(e);
  }
  return (await k.passkeys.verbraucheChallenge(hash(challenge), zweck, uid)) ? challenge : null;
}

/** Nicht sprechend: Der Authenticator soll keine Konto-ID speichern. */
const nutzerKennung = (uid: number) =>
  new Uint8Array(crypto.createHash('sha256').update(`bim:${uid}`).digest().subarray(0, 16));

export async function registrierungsOptionen(k: FaktorenKontext, uid: number, name: string) {
  const rp = vertrauenspartei();
  if (!rp) return null;
  const vorhanden = await k.passkeys.kennungenDesKontos(uid);
  const optionen = await generateRegistrationOptions({
    rpName: rp.rpName,
    rpID: rp.rpID,
    userName: name,
    userID: nutzerKennung(uid),
    attestationType: 'none',
    // Auffindbar, damit dieselben Passkeys auch ohne Benutzernamen anmelden.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    excludeCredentials: vorhanden.map(v => ({ id: v.credential_id, ...transporte(v.transports) })),
  });
  await merkeChallenge(k, optionen.challenge, 'registrieren', uid);
  return optionen;
}

export async function registrierungPruefen(
  k: FaktorenKontext,
  uid: number,
  roh: unknown,
  name: string,
): Promise<{ id: number; name: string } | null> {
  const rp = vertrauenspartei();
  const antwort = alsAntwort<RegistrationResponseJSON>(roh);
  if (!rp || !antwort) return null;
  const challenge = await loeseChallengeEin(k, antwort.response.clientDataJSON, 'registrieren', uid);
  if (!challenge) return null;
  const v = await verifyRegistrationResponse({
    response: antwort,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: false,
  }).catch(abgewiesen);
  if (!v?.verified) return null;
  const c = v.registrationInfo.credential;
  return k.passkeys.legeAn(
    uid,
    c.id,
    Buffer.from(c.publicKey),
    c.counter,
    (c.transports ?? []).join(',') || null,
    name,
  );
}

export async function anmeldeOptionen(k: FaktorenKontext, zweck: 'anmelden' | 'zweiter_faktor') {
  const rp = vertrauenspartei();
  if (!rp) return null;
  // Leere allowCredentials: Der Browser bietet die auffindbaren Passkeys an,
  // ohne dass der Server verrät, welches Konto welche hat.
  return generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: zweck === 'anmelden' ? 'required' : 'preferred',
    challenge: signierteChallenge(zweck, k.uhr.jetzt() + CHALLENGE_MS),
  });
}

/** Ohne Passwort verlangt sie User Verification (PIN, Biometrie) — sonst wäre
 * der Passkey allein ein einziger Faktor.
 * @param uid beim zweiten Faktor das Konto, dessen Passwort schon stimmte. */
export async function anmeldungPruefen(
  kx: FaktorenKontext,
  roh: unknown,
  zweck: 'anmelden' | 'zweiter_faktor',
  uid: number | null = null,
): Promise<number | null> {
  const rp = vertrauenspartei();
  const antwort = alsAntwort<AuthenticationResponseJSON>(roh);
  if (!rp || !antwort) return null;
  let challenge: string;
  try {
    challenge = decodeClientDataJSON(antwort.response.clientDataJSON).challenge;
  } catch (e) {
    return abgewiesen(e);
  }
  const bis = signierteFrist(challenge, zweck, kx.uhr.jetzt());
  if (bis === null) return null;
  const k = await kx.passkeys.schluessel(antwort.id, uid);
  if (!k) return null;
  const v = await verifyAuthenticationResponse({
    // Registriert wird nur im Browser; anmelden darf auch die eingetragene App.
    response: antwort,
    expectedChallenge: challenge,
    expectedOrigin: [rp.origin, ...androidHerkuenfte(kx.konfig)],
    expectedRPID: rp.rpID,
    credential: {
      id: antwort.id,
      publicKey: new Uint8Array(k.public_key),
      counter: Number(k.sign_count),
      ...transporte(k.transports),
    },
    requireUserVerification: zweck === 'anmelden',
  }).catch(abgewiesen);
  if (!v?.verified) return null;
  // Erst nach gültiger Signatur vermerkt: Eine Wiederholung derselben Antwort findet ihn.
  if (!(await kx.passkeys.vermerkeVerbraucht(hash(challenge), zweck, new Date(bis)))) return null;
  return (await kx.passkeys.zaehlerWeiter(k.id, v.authenticationInfo.newCounter, k.sign_count)) ? k.user_id : null;
}

export const passkeysDesKontos = (k: FaktorenKontext, uid: number) => k.passkeys.desKontos(uid);
export const hatPasskeys = (k: FaktorenKontext, uid: number) => k.passkeys.hatWelche(uid);
export const loeschePasskey = (k: FaktorenKontext, uid: number, id: number) => k.passkeys.loeschePasskeyZeile(uid, id);
/** Beim Zurücksetzen oder auf Wunsch beim Passwortwechsel: Ein Eindringling behielte sonst seinen Passkey. */
export const passkeysWiderrufen = (k: FaktorenKontext, uid: number) => k.passkeys.loescheAlleDesKontos(uid);
