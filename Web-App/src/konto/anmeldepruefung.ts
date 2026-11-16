/** Anmeldedaten prüfen: Passwort, Kontozustand, zweiter Faktor, Bremse. */
import * as passwortRegel from '../infra/passwortRegel';
import { BcryptUeberlast } from './bcryptSchranke';
import { brauchtNeuenHash, hashePasswort, hashePasswortSofort, passwortPasst } from './passwortHash';
import {
  anmeldungErlaubt,
  bekannteAnmeldung,
  gibAnmeldeplatzFrei,
  anmeldungGescheitert,
  anmeldungGelungen,
  meldeAnmeldeereignis,
  meldeAnmeldung,
  faktorCodeGesperrt,
  faktorCodeFalsch,
  tagesgrenzeErreicht,
  MAX_ATTEMPTS,
  type Anmeldeereignis,
  type Anmeldeweg,
} from './loginLimiter';
import { kontoGedrosselt } from './zielDrossel';
import { doppeltAls, fachfehler, type FehlerArt, type FehlerCode } from '../infra/fehlerTexte';
import { hinweisNebenher } from './kontoHinweis';
import { tokenAbdruck } from './geraeteToken';
import { zugangsTransaktion } from './zugangsende';
import { anmeldenameGueltig } from './namensRegeln';
import type { KontoKontext } from './kontext';
import { imSystemkontext } from '../infra/kontoKontext';

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
  k: KontoKontext,
  token: string | null | undefined,
): Promise<{ userId: number }> {
  const leer = token === undefined || token === null || String(token).trim() === '';
  const hash = tokenAbdruck(String(token));
  const id = leer ? undefined : await k.konten.kontoZuEmailToken(hash);
  if (id === undefined) fachfehler('ungueltig', 'bestaetigungslink_ungueltig');
  const ok = await zugangsTransaktion(k, t => t.konten.uebernimmEmailNeu(id, hash)).catch(doppeltAls(false));
  if (!ok) {
    await k.konten.verwirfEmailNeu(id, hash);
    fachfehler('ungueltig', 'email_vergeben');
  }
  return { userId: id };
}

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

/** Für unbekannte Namen: Die Prüfung braucht dann dieselbe Zeit wie bei einem
 * Konto mit aktuellem Hash. */
const DUMMY_HASH = hashePasswortSofort('nonexistent-account-placeholder');

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
  k: KontoKontext,
  herkunft: Herkunft,
  username: string | null | undefined,
  password: string | null | undefined,
  code?: string | number | null | undefined,
  passkeyAntwort?: unknown,
): Promise<AnmeldeErgebnis> {
  if (!username || !password) return absage('ungueltig', 'benutzername_passwort');
  if (!anmeldenameGueltig(username)) return absage('ungueltig', 'name_oder_email_eingeben');

  const ip = herkunft.ip || '?';
  const name = String(username);
  const gesperrt = await anmeldungErlaubt(k, ip, name);
  if (gesperrt) {
    meldeAnmeldeereignis('anmeldung_gesperrt', {
      ip,
      konto: (await k.zugaenge.kontoZurAnmeldung(name))?.id ?? null,
    });
    return absage('zu_viele', gesperrt.code, gesperrt.vars);
  }

  const user = await k.zugaenge.kontoZurAnmeldung(name);
  const mitFaktor = (passkeyAntwort !== undefined && passkeyAntwort !== null) || !!String(code ?? '').trim();
  if (await nurNochMitFaktor(k, ip, name, user?.id, mitFaktor))
    return absage('zu_viele', 'konto_tagesgrenze', undefined, false, true);
  // Auch ohne Treffer, gegen DUMMY_HASH: gleiche Zeit für unbekannte Namen. Wer sich von
  // hier zuletzt angemeldet hat, wartet unter Last vorne: Eine Flut fremder Adressen sperrt ihn nicht aus.
  const vorrang = await bekannteAnmeldung(k, ip, name);
  let passtDasPasswort: boolean;
  try {
    passtDasPasswort = await passwortPasst(password, user?.password_hash || DUMMY_HASH, vorrang);
  } catch (e) {
    if (!(e instanceof BcryptUeberlast)) throw e;
    await gibAnmeldeplatzFrei(k, ip, name);
    return absage('nicht_verfuegbar', 'server_ausgelastet');
  }
  // Gesperrt oder unbestätigt wie falsches Passwort: Eine eigene Absage verriete, dass es stimmte.
  if (!user || !passtDasPasswort || assertLoginAllowed(user)) {
    await fehlversuch(k, 'anmeldung_fehlgeschlagen', ip, name, user?.id);
    return absage('nicht_angemeldet', 'anmeldedaten_ungueltig');
  }

  let zugang: Anmeldeweg = 'passwort';
  if (await k.faktoren.istAktiv(user.id)) {
    // Ein Passkey ersetzt den Code — gebunden an DIESES Konto, dessen Passwort stimmte.
    const mitPasskey = passkeyAntwort !== undefined && passkeyAntwort !== null;
    zugang = mitPasskey ? 'passwort+passkey' : 'passwort+code';
    const hatPasskey = await k.faktoren.hatPasskeys(user.id);
    const ergaenzt = (e: AnmeldeErgebnis) => {
      if (!e.ok && hatPasskey) e.absage.passkey = true;
      return e;
    };
    if (!mitPasskey && !String(code ?? '').trim()) {
      // Das Passwort stimmte; nur der Code fehlt noch — kein Fehlversuch.
      await gibAnmeldeplatzFrei(k, ip, name);
      return ergaenzt(absage('nicht_angemeldet', 'zweiter_faktor_noetig', undefined, false, true));
    }
    const nurNotweg = !mitPasskey && (await faktorCodeGesperrt(k, user.id));
    const gilt = mitPasskey
      ? (await k.faktoren.anmeldungPruefen(passkeyAntwort, 'zweiter_faktor', user.id)) === user.id
      : await k.faktoren.pruefeCode(user.id, code, !nurNotweg);
    if (!gilt) {
      await fehlversuch(k, 'zweiter_faktor_falsch', ip, name, user.id);
      // Sofort, nicht erst mit der Kontosperre: Wer hier rät, kennt das Passwort.
      const erreicht = !mitPasskey && (await faktorCodeFalsch(k, user.id));
      if (erreicht) hinweisNebenher(k, user.id, 'zweiter_faktor_gesperrt');
      const grund = nurNotweg || erreicht ? 'zweiter_faktor_gesperrt' : 'zweiter_faktor_falsch';
      return ergaenzt(absage('nicht_angemeldet', grund, undefined, false, true));
    }
    if (gilt === 'wiederherstellung_alt') {
      // Vor der Anmeldung trägt die Anfrage noch kein Konto für den Zeilenschutz.
      const bis = (await imSystemkontext('anmeldung: alte Codes', () => k.faktoren.stand(user.id))).alte_codes_bis;
      if (bis) hinweisNebenher(k, user.id, 'alte_codes_ablauf', undefined, { bis });
    }
  }
  // Erst jetzt, nach Passwort und zweitem Faktor: Den Klartext gibt es nur bei einer Anmeldung.
  if (brauchtNeuenHash(user.password_hash))
    await k.zugaenge.ersetzePasswortHash(user.id, user.password_hash, await hashePasswort(password));
  await anmeldungGelungen(k, ip, name);
  meldeAnmeldung({ ip, konto: Number(user.id), zugang });
  return { ok: true, user };
}

/** Über der Tagesgrenze nur mit Code oder Passkey und aktivem Faktor. Vor der Passwortprüfung
 * und ohne deren Ergebnis entschieden: Eine eigene Absage danach verriete das Passwort. */
async function nurNochMitFaktor(
  k: KontoKontext,
  ip: string,
  name: string,
  konto: number | undefined,
  mitFaktor: boolean,
): Promise<boolean> {
  if (!(await tagesgrenzeErreicht(k, ip, name))) return false;
  if (mitFaktor && konto !== undefined && (await k.faktoren.istAktiv(konto))) return false;
  await gibAnmeldeplatzFrei(k, ip, name);
  meldeAnmeldeereignis('anmeldung_tagesgrenze', { ip, konto: konto ?? null });
  return true;
}

/** Beim Erreichen der Kontosperre erfährt es der Inhaber, höchstens einmal am Tag:
 * Nur er weiss, ob er sich vertippt hat. */
async function fehlversuch(
  k: KontoKontext,
  ereignis: Anmeldeereignis,
  ip: string,
  name: string,
  konto?: number,
): Promise<void> {
  meldeAnmeldeereignis(ereignis, { ip, konto: konto ?? null });
  const { n, tagesgrenze } = await anmeldungGescheitert(k, ip, name);
  if (konto === undefined) return;
  if (tagesgrenze) hinweisNebenher(k, konto, 'anmeldung_tagesgrenze');
  else if (n === MAX_ATTEMPTS && !(await kontoGedrosselt(k, 'sperr-hinweis', konto, 1, TAG_MS)))
    hinweisNebenher(k, konto, 'anmeldung_gebremst');
}
