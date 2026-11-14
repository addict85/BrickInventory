/** Was nach einer gelungenen Prüfung geschieht: Token ausstellen, Passwort ändern,
 * QR-Zugang anlegen. Die Routen in routes/auth.ts prüfen, rufen und antworten;
 * Sitzung und Keks bleiben dort, weil sie an der Anfrage hängen. */
import * as K from './konten';
import { tokenAnlegen, laufzeitTage, UNBEGRENZT } from './geraeteToken';
import { APP_HOECHSTDAUER_TAGE, tokenAngaben, tokenLabel, tokenScope } from './tokenWunsch';
import { hinweisNebenher } from './kontoHinweis';
import * as zf from './zweiterFaktor';
import * as QR from './qrKopplung';
import { basisUrl, hinweisOhneBasisUrl, ueberTls, unbegrenztNurMitTls } from '../infra/basisUrl';
import { tlsStand } from '../infra/tlsWurzel';
import { fachfehler } from '../infra/fehlerTexte';
import { passwortMangel } from '../infra/passwortRegel';
import { versuche, wertOder } from '../infra/ergebnis';
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

/** Der Name aus der Tabelle: Mit App-Token gibt es keine Sitzung, die ihn trägt. */
export async function eigenesPasswortAendern(k: KontoKontext, uid: number, neu: string, passkeysWiderrufen: boolean) {
  const konto = await k.konten.kontoKurz(uid);
  const mangel = passwortMangel(neu, konto?.username);
  if (mangel) fachfehler('ungueltig', mangel);
  await K.aendereEigenesPasswort(k, uid, neu, { passkeysWiderrufen });
  hinweisNebenher(k, uid, 'passwort_geaendert');
  return konto;
}
