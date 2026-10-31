/**
 * Passkeys (WebAuthn) mit @simplewebauthn/server: registrieren, anmelden ohne
 * Passwort und als zweiter Faktor anstelle des TOTP-Codes. Tabellen in
 * Migration 0081.
 */
import crypto from 'crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON, WebAuthnCredential } from '@simplewebauthn/server';
import { decodeClientDataJSON } from '@simplewebauthn/server/helpers';
import * as repo from './repository/passkeys';
import { basisUrl } from '../infra/basisUrl';
import { fehlertext } from '../infra/httpError';

/** Eine abgewiesene Antwort ist kein Serverfehler, aber ein Eintrag wert. */
function abgewiesen(e: unknown): null {
  console.warn('[passkey] Antwort abgewiesen:', fehlertext(e));
  return null;
}

/** Die Antwort des Browsers in der Form, die die Prüfung erwartet — oder null. */
function alsAntwort<T extends RegistrationResponseJSON | AuthenticationResponseJSON>(roh: unknown): T | null {
  const a = roh as { id?: unknown; response?: { clientDataJSON?: unknown } } | null;
  return a && typeof a.id === 'string' && typeof a.response?.clientDataJSON === 'string' ? roh as T : null;
}

type Transporte = NonNullable<WebAuthnCredential['transports']>;
/** Die gespeicherte Liste als Feld, das ganz fehlt, wenn nichts gespeichert ist. */
const transporte = (s: string | null): { transports?: Transporte } =>
  s ? { transports: s.split(',') as Transporte } : {};

export type PasskeyZweck = 'registrieren' | 'anmelden' | 'zweiter_faktor';

/** Wie lange eine Challenge gilt; der Browser-Dialog läuft höchstens so lange. */
const CHALLENGE_MS = 5 * 60 * 1000;

/**
 * RP-ID und Origin aus APP_BASE_URL. Ein Browser lässt WebAuthn nur für einen
 * Domänennamen zu, nicht für eine IP-Adresse; ohne Namen gibt es keine Passkeys.
 */
export function vertrauenspartei(): { rpID: string; origin: string; rpName: string } | null {
  const basis = basisUrl();
  if (!basis) return null;
  const u = new URL(basis);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.startsWith('[')) return null;
  return { rpID: u.hostname, origin: u.origin, rpName: 'BrickInventory' };
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function merkeChallenge(challenge: string, zweck: PasskeyZweck, uid: number | null): Promise<void> {
  return repo.speichereChallenge(hash(challenge), zweck, uid, new Date(Date.now() + CHALLENGE_MS));
}

/**
 * Die Challenge aus der Antwort einlösen — genau einmal. Eine wiederholte
 * Antwort findet ihre Zeile nicht mehr und wird abgewiesen.
 */
async function loeseChallengeEin(clientDataJSON: unknown, zweck: PasskeyZweck, uid: number | null): Promise<string | null> {
  if (typeof clientDataJSON !== 'string') return null;
  let challenge: string;
  try { challenge = decodeClientDataJSON(clientDataJSON).challenge; } catch (e) { return abgewiesen(e); }
  return await repo.verbraucheChallenge(hash(challenge), zweck, uid) ? challenge : null;
}

/** Eine feste, nicht sprechende Kennung je Konto für den Authenticator. */
const nutzerKennung = (uid: number) => new Uint8Array(crypto.createHash('sha256').update(`bim:${uid}`).digest().subarray(0, 16));

export async function registrierungsOptionen(uid: number, name: string) {
  const rp = vertrauenspartei();
  if (!rp) return null;
  const vorhanden = await repo.kennungenDesKontos(uid);
  const optionen = await generateRegistrationOptions({
    rpName: rp.rpName, rpID: rp.rpID, userName: name, userID: nutzerKennung(uid),
    attestationType: 'none',
    // Auffindbar, damit dieselben Passkeys auch ohne Benutzernamen anmelden.
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    excludeCredentials: vorhanden.map(v => ({ id: v.credential_id, ...transporte(v.transports) })),
  });
  await merkeChallenge(optionen.challenge, 'registrieren', uid);
  return optionen;
}

/** @returns die neue Zeile, oder null, wenn Antwort, Challenge oder Herkunft nicht passen. */
export async function registrierungPruefen(uid: number, roh: unknown, name: string): Promise<{ id: number; name: string } | null> {
  const rp = vertrauenspartei();
  const antwort = alsAntwort<RegistrationResponseJSON>(roh);
  if (!rp || !antwort) return null;
  const challenge = await loeseChallengeEin(antwort.response.clientDataJSON, 'registrieren', uid);
  if (!challenge) return null;
  const v = await verifyRegistrationResponse({
    response: antwort, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID,
    requireUserVerification: false,
  }).catch(abgewiesen);
  if (!v?.verified) return null;
  const c = v.registrationInfo.credential;
  return repo.legeAn(uid, c.id, Buffer.from(c.publicKey), c.counter, (c.transports ?? []).join(',') || null, name);
}

export async function anmeldeOptionen(zweck: 'anmelden' | 'zweiter_faktor') {
  const rp = vertrauenspartei();
  if (!rp) return null;
  // Leere allowCredentials: Der Browser bietet die auffindbaren Passkeys an,
  // ohne dass der Server vorher sagt, welches Konto welche hat.
  const optionen = await generateAuthenticationOptions({
    rpID: rp.rpID, userVerification: zweck === 'anmelden' ? 'required' : 'preferred',
  });
  await merkeChallenge(optionen.challenge, zweck, null);
  return optionen;
}

/**
 * Eine Anmeldeantwort prüfen. Ohne Passwort verlangt sie User Verification
 * (PIN, Biometrie) — sonst wäre der Passkey allein ein einziger Faktor.
 * @param uid beim zweiten Faktor das Konto, dessen Passwort schon stimmte.
 * @returns das Konto, oder null.
 */
export async function anmeldungPruefen(roh: unknown, zweck: 'anmelden' | 'zweiter_faktor', uid: number | null = null): Promise<number | null> {
  const rp = vertrauenspartei();
  const antwort = alsAntwort<AuthenticationResponseJSON>(roh);
  if (!rp || !antwort) return null;
  const challenge = await loeseChallengeEin(antwort.response.clientDataJSON, zweck, null);
  if (!challenge) return null;
  const k = await repo.schluessel(antwort.id, uid);
  if (!k) return null;
  const v = await verifyAuthenticationResponse({
    response: antwort, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID,
    credential: { id: antwort.id, publicKey: new Uint8Array(k.public_key), counter: Number(k.sign_count),
                  ...transporte(k.transports) },
    requireUserVerification: zweck === 'anmelden',
  }).catch(abgewiesen);
  if (!v?.verified) return null;
  return await repo.zaehlerWeiter(k.id, v.authenticationInfo.newCounter, k.sign_count) ? k.user_id : null;
}

export const passkeysDesKontos = repo.desKontos;
export const hatPasskeys = repo.hatWelche;
/** @returns ob es den Passkey in diesem Konto gab */
export const loeschePasskey = repo.loeschePasskeyZeile;
