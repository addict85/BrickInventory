/** Anmeldedaten prüfen: Passwort, Kontozustand, zweiter Faktor, Bremse. */
import * as passwortRegel from '../infra/passwortRegel';
import bcrypt from 'bcryptjs';
import { passwortPasst, BcryptUeberlast } from './bcryptSchranke';
import {
  checkLoginAllowed,
  bekannteAnmeldung,
  gibAnmeldeplatzFrei,
  recordLoginFailure,
  recordLoginSuccess,
  meldeAnmeldeereignis,
  meldeAnmeldung,
  faktorCodeGesperrt,
  faktorCodeFalsch,
  MAX_ATTEMPTS,
  type Anmeldeereignis,
  type Anmeldeweg,
} from './loginLimiter';
import { kontoGedrosselt } from './zielDrossel';
import * as zf from './zweiterFaktor';
import * as passkeys from './passkeys';
import type { FehlerArt, FehlerCode } from '../infra/fehlerTexte';
import { hinweisNebenher } from './kontoHinweis';
import { kontoBereich } from './prozess';
import { hashToken } from './geraeteToken';
import { isValidLoginIdentifier } from './namensRegeln';

const TAG_MS = 86_400_000;

export interface KontoZustand {
  is_active: boolean;
  email_verified: boolean;
  email?: string | null;
  is_admin: boolean;
  registrierung_offen?: boolean;
  [k: string]: unknown;
}

/** Leer zählt wie „nicht da": Der Hash eines leeren Strings ist ein gültiger
 * SHA-256-Wert. */
export async function verifiziereEmailToken(
  token: string | null | undefined,
): Promise<{ ok: boolean; grund?: string; userId?: number }> {
  if (token === undefined || token === null || String(token).trim() === '') {
    return { ok: false, grund: 'fehlt' };
  }
  const neu = await kontoBereich().konten.uebernimmEmailNeu(hashToken(String(token)));
  if (!neu) return { ok: false, grund: 'ungueltig' };
  return neu.ok ? { ok: true, userId: neu.id } : { ok: false, grund: 'vergeben', userId: neu.id };
}

export const BCRYPT_ROUNDS = 12;

/** Eine Konstante, damit alle Routen, die ein Passwort setzen, dieselbe Länge prüfen. */
export const PASSWORT_MIN_ZEICHEN = passwortRegel.PASSWORT_MIN_ZEICHEN;
export const passwortZuKurz = passwortRegel.passwortZuKurz;

/** Nach erfolgreicher Passwortprüfung. Die Absage kommt als CODE, weil die
 * Route weiss, welche Sprache der Anfragende sieht.
 * @returns null = Login erlaubt */
export function assertLoginAllowed(
  user: KontoZustand,
): { art: FehlerArt; code: FehlerCode; unverified?: boolean } | null {
  if (!user.is_active) return { art: 'verboten', code: 'konto_deaktiviert' };
  if (user.registrierung_offen === true && !user.is_admin)
    return { art: 'verboten', code: 'email_nicht_bestaetigt', unverified: true };
  return null;
}

/** Für unbekannte Namen: bcrypt.compare() braucht dann dieselbe Zeit wie bei
 * einem echten Konto, mit denselben Runden erzeugt. */
const DUMMY_HASH = bcrypt.hashSync('nonexistent-account-placeholder', BCRYPT_ROUNDS);

/** Fachlich, nicht HTTP: Den Status wählt die HTTP-Seite (src/http/fehlerArt.ts). */
export interface AnmeldeAbsage {
  art: FehlerArt;
  code: FehlerCode;
  vars?: Record<string, string | number>;
  /** Der Client blendet dann „E-Mail erneut senden" ein. */
  unverified?: boolean;
  /** Passwort stimmt, es fehlt (oder scheiterte) der Code des zweiten Faktors. */
  zweiterFaktor?: boolean;
  /** Statt des Codes geht auch eine Passkey-Antwort. */
  passkey?: boolean;
}

export type AnmeldeErgebnis = { ok: true; user: Record<string, unknown> } | { ok: false; absage: AnmeldeAbsage };

export interface Herkunft {
  ip?: string | null;
}

function absage(
  art: FehlerArt,
  code: FehlerCode,
  vars?: Record<string, string | number>,
  unverified?: boolean,
  zweiterFaktor?: boolean,
): AnmeldeErgebnis {
  return {
    ok: false,
    absage: {
      art,
      code,
      ...(vars ? { vars } : {}),
      ...(unverified ? { unverified: true } : {}),
      ...(zweiterFaktor ? { zweiterFaktor: true } : {}),
    },
  };
}

/** Die einzige Stelle, an der Anmeldedaten geprüft werden: Zwei Fassungen für
 * Webapp und App waren schon einmal auseinandergelaufen.
 * @param username Benutzername ODER E-Mail-Adresse. */
export async function pruefeAnmeldedaten(
  herkunft: Herkunft,
  username: string | null | undefined,
  password: string | null | undefined,
  code?: string | number | null | undefined,
  passkeyAntwort?: unknown,
): Promise<AnmeldeErgebnis> {
  if (!username || !password) return absage('ungueltig', 'benutzername_passwort');
  if (!isValidLoginIdentifier(username)) return absage('ungueltig', 'name_oder_email_eingeben');

  const ip = herkunft.ip || '?';
  const name = String(username);
  const gesperrt = await checkLoginAllowed(ip, name);
  if (gesperrt) {
    meldeAnmeldeereignis('anmeldung_gesperrt', {
      ip,
      konto: (await kontoBereich().zugaenge.kontoZurAnmeldung(name))?.id ?? null,
    });
    return absage('zu_viele', gesperrt.code, gesperrt.vars);
  }

  const user = await kontoBereich().zugaenge.kontoZurAnmeldung(name);
  // Auch ohne Treffer, gegen DUMMY_HASH: gleiche Zeit für unbekannte Namen. Wer sich von
  // hier zuletzt angemeldet hat, wartet unter Last vorne: Eine Flut fremder Adressen sperrt ihn nicht aus.
  const vorrang = await bekannteAnmeldung(ip, name);
  let passtDasPasswort: boolean;
  try {
    passtDasPasswort = await passwortPasst(password, user?.password_hash || DUMMY_HASH, vorrang);
  } catch (e) {
    if (!(e instanceof BcryptUeberlast)) throw e;
    await gibAnmeldeplatzFrei(ip, name);
    return absage('nicht_verfuegbar', 'server_ausgelastet');
  }
  // Gesperrt oder unbestätigt wie falsches Passwort: Eine eigene Absage verriete, dass es stimmte.
  if (!user || !passtDasPasswort || assertLoginAllowed(user)) {
    await fehlversuch('anmeldung_fehlgeschlagen', ip, name, user?.id);
    return absage('nicht_angemeldet', 'anmeldedaten_ungueltig');
  }

  let zugang: Anmeldeweg = 'passwort';
  if (await zf.istAktiv(user.id)) {
    // Ein Passkey ersetzt den Code — gebunden an DIESES Konto, dessen Passwort stimmte.
    const mitPasskey = passkeyAntwort !== undefined && passkeyAntwort !== null;
    zugang = mitPasskey ? 'passwort+passkey' : 'passwort+code';
    const hatPasskey = await passkeys.hatPasskeys(user.id);
    const ergaenzt = (e: AnmeldeErgebnis) => {
      if (!e.ok && hatPasskey) e.absage.passkey = true;
      return e;
    };
    if (!mitPasskey && !String(code ?? '').trim()) {
      // Das Passwort stimmte; nur der Code fehlt noch — kein Fehlversuch.
      await gibAnmeldeplatzFrei(ip, name);
      return ergaenzt(absage('nicht_angemeldet', 'zweiter_faktor_noetig', undefined, false, true));
    }
    const nurNotweg = !mitPasskey && (await faktorCodeGesperrt(user.id));
    const gilt = mitPasskey
      ? (await passkeys.anmeldungPruefen(passkeyAntwort, 'zweiter_faktor', user.id)) === user.id
      : await zf.pruefeCode(user.id, code, !nurNotweg);
    if (!gilt) {
      await fehlversuch('zweiter_faktor_falsch', ip, name, user.id);
      // Sofort, nicht erst mit der Kontosperre: Wer hier rät, kennt das Passwort.
      const erreicht = !mitPasskey && (await faktorCodeFalsch(user.id));
      if (erreicht) hinweisNebenher(user.id, 'zweiter_faktor_gesperrt');
      const grund = nurNotweg || erreicht ? 'zweiter_faktor_gesperrt' : 'zweiter_faktor_falsch';
      return ergaenzt(absage('nicht_angemeldet', grund, undefined, false, true));
    }
  }
  await recordLoginSuccess(ip, name);
  meldeAnmeldung({ ip, konto: Number(user.id), zugang });
  return { ok: true, user };
}

/** Beim Erreichen der Kontosperre erfährt es der Inhaber, höchstens einmal am Tag:
 * Nur er weiss, ob er sich vertippt hat. */
async function fehlversuch(ereignis: Anmeldeereignis, ip: string, name: string, konto?: number): Promise<void> {
  meldeAnmeldeereignis(ereignis, { ip, konto: konto ?? null });
  if ((await recordLoginFailure(ip, name)) !== MAX_ATTEMPTS || konto === undefined) return;
  if (!(await kontoGedrosselt('sperr-hinweis', konto, 1, TAG_MS))) hinweisNebenher(konto, 'anmeldung_gebremst');
}
