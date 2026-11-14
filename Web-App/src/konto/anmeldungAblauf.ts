/** Was nach einer gelungenen Prüfung geschieht: Token ausstellen, Profil ändern,
 * QR-Zugang anlegen. Die Routen in routes/auth.ts prüfen, rufen und antworten;
 * Sitzung und Keks bleiben dort, weil sie an der Anfrage hängen. */
import crypto from 'node:crypto';
import * as K from './konten';
import { tokenAnlegen, hashToken, laufzeitTage, UNBEGRENZT } from './geraeteToken';
import { APP_HOECHSTDAUER_TAGE, tokenAngaben, tokenLabel, tokenScope } from './tokenWunsch';
import { hinweisNebenher } from './kontoHinweis';
import { kontoGedrosselt } from './zielDrossel';
import * as zf from './zweiterFaktor';
import * as QR from './qrKopplung';
import { basisUrl, hinweisOhneBasisUrl, mailBasisUrl, ueberTls, unbegrenztNurMitTls } from '../infra/basisUrl';
import { tlsStand } from '../infra/tlsWurzel';
import { fachfehler } from '../infra/fehlerTexte';
import { passwortMangel } from '../infra/passwortRegel';
import { versuche, wertOder } from '../infra/ergebnis';
import { imSystemkontext } from '../infra/kontoKontext';
import type { Konto as KontoZeile } from './repository/konten';
import type { KontoKontext } from './kontext';

export type Angemeldet = { id: number | string; username: string; is_admin: boolean; must_change_password?: boolean };
/** Wie der Token heissen und gelten soll; beide Anmeldewege prüft der Vertrag. */
export type TokenWunsch = { label?: unknown; never_expires?: boolean | undefined; scope?: string | undefined };

/** Die Antwort nach Passwort oder Passkey. Ohne `mitToken` trägt die Sitzung
 * (httpOnly-Keks); ein Token wäre im Browser per Skript auslesbar. */
export async function anmeldeAntwort(
  k: KontoKontext,
  user: Angemeldet,
  wunsch: TokenWunsch,
  mitToken: boolean,
  ip: string | undefined,
) {
  const uid = Number(user.id);
  let token: string | null = null;
  if (mitToken) {
    const dauerhaft = wunsch.never_expires === true;
    // Ein Token, den die Datenbank nie sah, liefe im SSE-Kanal in ein 401.
    const neu = await versuche(
      'login:token',
      tokenAnlegen(
        k,
        uid,
        tokenLabel(wunsch.label, 'webapp-session'),
        dauerhaft,
        dauerhaft ? APP_HOECHSTDAUER_TAGE : null,
        { scope: tokenScope(wunsch.scope), ip },
      ),
    );
    token = wertOder(neu, null);
    if (!token) fachfehler('intern', 'token_nicht_ausgestellt');
    hinweisNebenher(k, uid, 'token_neu', tokenLabel(wunsch.label, 'webapp-session'));
  }
  // Verwalterrechte trägt die Sitzung und ein Token mit Scope `voll`, nicht `app`.
  const verwalter = user.is_admin && (!mitToken || tokenScope(wunsch.scope) === 'voll');
  return {
    ...(token ? { token, token_info: await tokenAngaben(k, token) } : {}),
    // Mit gleitender Frist ist nichts unbegrenzt.
    never_expires: false as const,
    user: {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      mustChangePassword: user.must_change_password,
      zweiterFaktorPflicht: verwalter && !(await zf.istAktiv(k, uid)),
    },
  };
}

/** Ein dauerhafter Gerätezugang; die Mail meldet ihn dem Inhaber. */
export async function geraeteTokenAusstellen(
  k: KontoKontext,
  uid: number,
  label: unknown,
  scope: unknown,
  ip: string | undefined,
) {
  const name = tokenLabel(label, 'Android App');
  const token = await tokenAnlegen(k, uid, name, true, null, { scope: tokenScope(scope), ip });
  hinweisNebenher(k, uid, 'token_neu', name);
  return { token, label: name, token_info: await tokenAngaben(k, token) };
}

/** Ohne Adresse verweigern statt raten: Eine falsche Adresse im QR-Code fiele
 * erst später in einem anderen Netz auf. */
export async function qrZugangErzeugen(k: KontoKontext, uid: number, gueltigkeit: unknown) {
  const basis = basisUrl();
  if (!basis) {
    hinweisOhneBasisUrl('auth:qr', 'der QR-Code zur Verknuepfung der App laesst sich nicht erzeugen.');
    fachfehler('nicht_verfuegbar', 'qr_ohne_basis_url');
  }
  const tage = laufzeitTage(gueltigkeit) ?? APP_HOECHSTDAUER_TAGE;
  if (tage === UNBEGRENZT) unbegrenztNurMitTls(basis);
  const { token, kopplung } = await QR.erzeuge(k, uid, tage);
  hinweisNebenher(k, uid, 'qr_zugang_neu');
  // `fp` nur mit TLS: Die App pinnt damit die Wurzel der internen CA.
  const ca = ueberTls(basis) ? await tlsStand() : null;
  return {
    token,
    kopplung,
    expires_in: QR.QR_TTL_MS / 1000,
    token_days: tage,
    url: basis,
    ...(ca ? { fp: ca.fp, zert_sha256: ca.zert_sha256 } : {}),
  };
}

type Konto = KontoZeile;
export interface ProfilEingabe {
  username?: string | undefined;
  email?: string | null | undefined;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
}

export function emailWirdGeaendert(user: Konto, email: string | null | undefined): email is string {
  return !!email && email.toLowerCase() !== String(user.email || '').toLowerCase();
}

/** Nach bestätigtem Passwort. Eine neue Adresse gilt erst nach dem Link; bis
 * dahin gilt die alte, und die neue belegt nichts. */
export async function profilAendern(
  k: KontoKontext,
  user: Konto,
  e: ProfilEingabe,
): Promise<{ emailChanged: boolean; emailSent?: boolean }> {
  const nameNeu = !!e.username && e.username.toLowerCase() !== String(user.username || '').toLowerCase();
  const emailNeu = emailWirdGeaendert(user, e.email);
  if (nameNeu || emailNeu) {
    // Jede Vergabeprüfung verrät, ob es ein Konto gibt; die Registrierung verbirgt das.
    const zuOft = await kontoGedrosselt(k, 'profil-vergabe', user.id, 10, 60 * 60 * 1000);
    if (zuOft) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: zuOft.waitMin });
    if (nameNeu && e.username && (await k.konten.nameVergeben(e.username, user.id)))
      fachfehler('ungueltig', 'benutzername_vergeben');
  }
  const felder: Record<string, unknown> = {};
  if (e.username) felder.username = e.username;
  if (e.first_name !== undefined) felder.first_name = e.first_name || null;
  if (e.last_name !== undefined) felder.last_name = e.last_name || null;
  if (!emailNeu) {
    await k.konten.aendereProfil(user.id, felder);
    return { emailChanged: false };
  }
  const email = String(e.email);
  const token = crypto.randomBytes(32).toString('hex');
  await k.konten.merkeEmailNeu(user.id, email, hashToken(token), new Date(Date.now() + 24 * 60 * 60 * 1000));
  await k.konten.aendereProfil(user.id, felder);
  return { emailChanged: true, emailSent: await adressMails(k, user, email, token) };
}

/** Sprache des Kontos, nicht die Vorgabe. Belegt antwortet wie frei, sonst
 * liessen sich Adressen abfragen; der Inhaber bekommt einen Hinweis statt des Links. */
async function adressMails(k: KontoKontext, user: Konto, email: string, token: string): Promise<boolean> {
  // Auch die des Inhabers einer Adresse, eines anderen Kontos: im Systemrahmen.
  const sprache = async (uid: number) =>
    String(
      wertOder(
        await versuche(
          'anmeldung:sprache',
          imSystemkontext('adressmail', () => k.einstellungen.getSetting(uid, 'language', 'de')),
        ),
        'de',
      ),
    );
  const lang = await sprache(user.id);
  const basis = mailBasisUrl();
  let gesendet = false;
  const inhaber = await k.konten.kontoMitEmail(email);
  if (inhaber && inhaber.id !== user.id) {
    if (basis)
      gesendet = wertOder(
        await versuche(
          'anmeldung:versuchsmail',
          k.mail.sendRegistrierungsVersuchMail(inhaber.email, await sprache(inhaber.id), 'adresse'),
        ),
        { success: false },
      ).success;
  } else if (basis) {
    gesendet = wertOder(
      await versuche('anmeldung:bestaetigungsmail', k.mail.sendVerificationMail(email, token, basis, lang, 'adresse')),
      { success: false },
    ).success;
  }
  // Die alte Adresse erfährt davon — war es nicht der Inhaber, merkt er es so.
  if (user.email)
    await versuche(
      'anmeldung:hinweis-alte-adresse',
      k.mail.sendEmailGeaendertMail(user.email, user.username, email, lang),
    );
  return gesendet;
}

/** Der Name aus der Tabelle: Mit App-Token gibt es keine Sitzung, die ihn trägt. */
export async function eigenesPasswortAendern(k: KontoKontext, uid: number, neu: string, passkeysWiderrufen: boolean) {
  const konto = await k.konten.kontoKurz(uid);
  const mangel = passwortMangel(neu, konto?.username);
  if (mangel) fachfehler('ungueltig', mangel);
  await K.aendereEigenesPasswort(k, uid, neu, { passkeysWiderrufen });
  hinweisNebenher(k, uid, 'passwort_geaendert');
  return konto;
}
