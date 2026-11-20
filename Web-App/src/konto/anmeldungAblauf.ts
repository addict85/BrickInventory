/** Was nach einer gelungenen Prüfung geschieht: Token ausstellen, Passwort ändern,
 * QR-Zugang anlegen. Die Routen in routes/auth.ts prüfen, rufen und antworten;
 * Sitzung und Keks bleiben dort, weil sie an der Anfrage hängen. */
import * as K from './konten';
import { createToken, runtimeDays, UNLIMITED } from './geraeteToken';
import { APP_MAX_DURATION_DAYS, tokenDetails, tokenLabel, tokenScope } from './tokenWunsch';
import { hintInBackground } from './kontoHinweis';
import * as QR from './qrKopplung';
import { basisUrl, hintWithoutBaseUrl, viaTls, unlimitedOnlyWithTls } from '../infra/basisUrl';
import { tlsStand } from '../infra/tlsWurzel';
import { fachfehler } from '../infra/fehlerTexte';
import { passwordLack } from '../infra/passwortRegel';
import { versuche, valueOr } from '../infra/ergebnis';
import type { AccountContext } from './kontext';

export type Angemeldet = { id: number | string; username: string; is_admin: boolean; must_change_password?: boolean };
/** Wie der Token heissen und gelten soll; beide Anmeldewege prüft der Vertrag. */
export type TokenWish = { label?: unknown; never_expires?: boolean | undefined; scope?: string | undefined };

/** Die Antwort nach Passwort oder Passkey. Ohne `withToken` trägt die Sitzung
 * (httpOnly-Keks); ein Token wäre im Browser per Skript auslesbar. */
export async function loginResponse(
  k: AccountContext,
  user: Angemeldet,
  wish: TokenWish,
  withToken: boolean,
  ip: string | undefined,
) {
  const uid = Number(user.id);
  let token: string | null = null;
  if (withToken) {
    const dauerhaft = wish.never_expires === true;
    // Ein Token, den die Datenbank nie sah, liefe im SSE-Kanal in ein 401.
    const neu = await versuche(
      'login:token',
      createToken(
        k,
        uid,
        tokenLabel(wish.label, 'webapp-session'),
        dauerhaft,
        dauerhaft ? APP_MAX_DURATION_DAYS : null,
        { scope: tokenScope(wish.scope), ip },
      ),
    );
    token = valueOr(neu, null);
    if (!token) fachfehler('intern', 'token_nicht_ausgestellt');
    hintInBackground(k, uid, 'token_neu', tokenLabel(wish.label, 'webapp-session'));
  }
  // Verwalterrechte trägt die Sitzung und ein Token mit Scope `voll`, nicht `app`.
  const verwalter = user.is_admin && (!withToken || tokenScope(wish.scope) === 'voll');
  return {
    ...(token ? { token, token_info: await tokenDetails(k, token) } : {}),
    // Mit gleitender Frist ist nichts unbegrenzt.
    never_expires: false as const,
    user: {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin,
      mustChangePassword: user.must_change_password,
      zweiterFaktorPflicht: await K.openFactorRequired(k, uid, verwalter),
    },
  };
}

/** Ein dauerhafter Gerätezugang; die Mail meldet ihn dem Inhaber. */
export async function devicesTokenIssue(
  k: AccountContext,
  uid: number,
  label: unknown,
  scope: unknown,
  ip: string | undefined,
) {
  const name = tokenLabel(label, 'Android App');
  const token = await createToken(k, uid, name, true, null, { scope: tokenScope(scope), ip });
  hintInBackground(k, uid, 'token_neu', name);
  return { token, label: name, token_info: await tokenDetails(k, token) };
}

/** Ohne Adresse verweigern statt raten: Eine falsche Adresse im QR-Code fiele
 * erst später in einem anderen Netz auf. */
export async function createQrAccess(k: AccountContext, uid: number, gueltigkeit: unknown) {
  const basis = basisUrl();
  if (!basis) {
    hintWithoutBaseUrl('auth:qr', 'der QR-Code zur Verknuepfung der App laesst sich nicht erzeugen.');
    fachfehler('nicht_verfuegbar', 'qr_ohne_basis_url');
  }
  const tage = runtimeDays(gueltigkeit) ?? APP_MAX_DURATION_DAYS;
  if (tage === UNLIMITED) unlimitedOnlyWithTls(basis);
  const { token, kopplung } = await QR.create(k, uid, tage);
  hintInBackground(k, uid, 'qr_zugang_neu');
  // `fp` nur mit TLS: Die App pinnt damit die Wurzel der internen CA.
  const ca = viaTls(basis) ? await tlsStand() : null;
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
export async function eigenesPasswortAendern(k: AccountContext, uid: number, neu: string, passkeysWiderrufen: boolean) {
  const konto = await k.konten.accountShort(uid);
  const mangel = passwordLack(neu, konto?.username);
  if (mangel) fachfehler('ungueltig', mangel);
  await K.aendereEigenesPasswort(k, uid, neu, { passkeysWiderrufen });
  hintInBackground(k, uid, 'passwort_geaendert');
  return konto;
}
