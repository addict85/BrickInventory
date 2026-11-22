import { z } from 'zod';
import { eingabe } from '../infra/validate';
import { type Route, zeit, Erfolg, ganz, bestaetigt, WITHOUT_BODY, TEXT } from './base';
import { GenericResponse } from './shared';

export const AppToken = z.looseObject({
  token_id: z.string(),
  label: z.string().nullable(),
  created_at: zeit.nullable(),
  last_used: zeit.nullable(),
  expires_at: zeit.nullable(),
  never_expires: z.boolean(),
  aktuell: z.boolean(),
  token_prefix: z.string().nullable(),
  hard_expires_at: zeit.nullable(),
  scope: z.string(),
  ip_range: z.string().nullable(),
  rotated_at: zeit,
});

export const ForgotPasswordResponse = z.looseObject({
  success: z.boolean(),
  message: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const User = z.looseObject({
  id: z.number().int(),
  username: z.string(),
  is_admin: z.boolean(),
});

/** What login and swap say about the new token (tokenDetails). */
export const TokenAngaben = z.looseObject({
  scope: z.string(),
  expires_at: zeit.nullable().optional(),
  hard_expires_at: zeit.nullable(),
  never_expires: z.boolean(),
  rotated_at: zeit.nullable().optional(),
  rotation_faellig: z.boolean().optional(),
});

/** /auth/me additionally knows whether the token used should be swapped. */
export const TokenInfo = TokenAngaben.extend({ rotation_faellig: z.boolean() });

/** The QR login only grants app rights; it names no is_admin. */
/** zweiterFaktorPflicht: admin rights without TOTP; until set up, everything else answers 403. */
export const AnmeldeNutzer = User.extend({
  is_admin: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  zweiterFaktorPflicht: z.boolean().optional(),
});

export const LoginResponse = z.looseObject({
  success: z.boolean(),
  token: z.string().nullable().optional(),
  /** The app also reads the refusal (zweiter_faktor) into this shape; the account is missing there. */
  user: AnmeldeNutzer.optional(),
  error: z.string().nullable().optional(),
  zweiter_faktor: z.boolean().optional(),
  never_expires: z.boolean(),
  token_info: TokenAngaben.nullable().optional(),
  keks_fehlt: z.boolean(),
});

export const MeResponse = z.looseObject({
  success: z.boolean(),
  loggedIn: z.boolean(),
  user: User.extend({ mustChangePassword: z.boolean().optional(), zweiterFaktorPflicht: z.boolean() })
    .nullable()
    .optional(),
  token_expires: zeit.nullable().optional(),
  token_last_used: zeit.nullable().optional(),
  token_info: TokenInfo.nullable().optional(),
});

export const Profil = z.looseObject({
  id: z.number().int(),
  username: z.string(),
  email: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email_verified: z.boolean(),
  /** Requested but not yet confirmed; until then `email` applies. */
  new_email: z.string().nullable(),
});

export const ProfilResponse = z.looseObject({
  success: z.boolean(),
  user: Profil.nullable(),
  error: z.string().nullable().optional(),
});

export const RegisterResponse = z.looseObject({
  success: z.boolean(),
  message: z.string(),
  email_sent: z.boolean(),
  console_mode: z.boolean(),
  error: z.string().nullable().optional(),
});

export const RegistrationStatusResponse = z.looseObject({
  enabled: z.boolean(),
  passkey: z.boolean().optional(),
  passwort_vergessen: z.boolean().optional(),
  mail_versand: z.boolean().optional(),
});

export const TokenRotation = z.looseObject({
  success: z.boolean(),
  token: z.string().nullable(),
  token_info: TokenAngaben.nullable(),
  alt_gueltig_bis: zeit.nullable(),
  ueberlappung_sek: z.number().int().nullable(),
});

export const TokenWiderruf = z.looseObject({
  success: z.boolean(),
  deleted: z.number().int(),
});

export const TokensResponse = z.looseObject({
  success: z.boolean(),
  tokens: z.array(AppToken),
  error: z.string().nullable().optional(),
});

export const ZweiterFaktorCodes = z.looseObject({
  success: z.boolean(),
  codes: z.array(z.string()),
  error: z.string().nullable().optional(),
});

export const ZweiterFaktorEinrichtung = z.looseObject({
  success: z.boolean(),
  geheimnis: z.string().nullable(),
  otpauth: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const ZweiterFaktorStand = z.looseObject({
  success: z.boolean(),
  aktiv: z.boolean(),
  codes_uebrig: z.number().int(),
  /** Open codes could be of the old kind (before 01.11.2026) and then only apply until then. */
  alte_codes_bis: zeit.nullable(),
  error: z.string().nullable().optional(),
});

/** The admin's account list (web only). */
export const KontoInListe = z.looseObject({
  id: ganz,
  username: z.string(),
  is_admin: z.boolean(),
  is_active: z.boolean(),
  created_at: zeit.nullable(),
  zweiter_faktor: z.boolean(),
  wartet_auf_bestaetigung: z.boolean(),
  angekuendigt: z.array(
    z.looseObject({
      type: z.enum(['passwort', 'zweiter_faktor', 'deaktivieren', 'rolle_entziehen', 'loeschen']),
      effective_at: z.string(),
    }),
  ),
});
export const KontenListe = z.looseObject({ success: z.literal(true), users: z.array(KontoInListe) });
export const KontoAktiv = z.looseObject({
  success: z.literal(true),
  is_active: z.boolean(),
  effective_at: z.string().optional(),
});

export const TokenErstellt = z.looseObject({
  success: z.literal(true),
  token: z.string(),
  label: z.string().nullable(),
  never_expires: z.boolean(),
  token_info: TokenAngaben.nullable(),
});
export const QrToken = z.looseObject({
  success: z.literal(true),
  token: z.string(),
  kopplung: ganz,
  expires_in: ganz,
  url: z.string(),
  token_days: ganz.nullable(),
  fp: z.string().optional(),
  zert_sha256: z.string().optional(),
});
export const Passkey = z.looseObject({
  id: ganz,
  name: z.string().nullable(),
  transports: z.string().nullable(),
  created_at: zeit,
  last_used: zeit.nullable(),
});
export const PasskeyListe = z.looseObject({
  success: z.literal(true),
  verfuegbar: z.boolean(),
  passkeys: z.array(Passkey),
});
/** The options go to WebAuthn (navigator.credentials) unchanged; their shape is defined by @simplewebauthn. */
export const PasskeyOptionen = z.looseObject({ success: z.literal(true), optionen: z.record(z.string(), z.unknown()) });
export const PasskeyAngelegt = z.looseObject({
  success: z.literal(true),
  passkey: z.looseObject({ id: ganz, name: z.string() }),
});
/** Like the password login: with `mit_token` (app) the token comes along too. */
export const PasskeyAnmeldung = LoginResponse.extend({
  success: z.literal(true),
  user: z.looseObject({
    id: ganz,
    username: z.string(),
    is_admin: z.boolean(),
    mustChangePassword: z.boolean().optional(),
    zweiterFaktorPflicht: z.boolean().optional(),
  }),
});
/** Number of deleted rows, as when revoking a token. */
export const Geloescht = z.looseObject({ success: z.literal(true), deleted: ganz });
/** `deleted` counts the browser sessions, `zugaenge` the app accesses. */
export const AndereBeendet = Geloescht.extend({ zugaenge: ganz.optional() });

/** The scan registers the device; the code is shown by the app and typed in the browser. */
export const QrMeldung = z.looseObject({
  success: z.literal(true),
  wartet: z.literal(true),
  abholung: z.string(),
  code: z.string(),
  expires_in: ganz,
});
/** At first only `wartet`, with `vorschau` only `username`, otherwise a login including the nonce for the attestation.
 * Without keks_fehlt: the pickup always yields a token, never a session. */
export const QrAbholung = LoginResponse.omit({ keks_fehlt: true }).extend({
  wartet: z.boolean(),
  never_expires: z.boolean().optional(),
  username: z.string().optional(),
  isAdmin: z.literal(false).optional(),
  userId: ganz.optional(),
  vorschau: z.literal(true).optional(),
  schluessel_nonce: z.string().optional(),
});
export const QrKopplungStand = z.looseObject({
  success: z.literal(true),
  stand: z.enum(['offen', 'wartet', 'bestaetigt', 'abgeholt', 'abgelehnt', 'abgelaufen']),
  geraet: z.string().nullable(),
  ip_range: z.string().nullable(),
});
export const ProfilGespeichert = GenericResponse.extend({
  emailChanged: z.boolean().optional(),
  emailSent: z.boolean().optional(),
});

/** Inputs of the account routes: type and length; the rules (USERNAME_RE, password)
 * are still checked by the route. Free text is limited, the columns are `text`;
 * `label` is missing because tokenLabel() shortens or replaces every value. */
const txt = (n: number) => z.string().max(n).optional();
const txtLeer = (n: number) => z.string().max(n).nullable().optional();
/** For an admin account: from when the change applies (src/account/adminActions.ts). */
export const VerwalterWeg = Erfolg.extend({ effective_at: z.string().optional() });
const PASSWORT = 1024;
const code = z
  .union([z.string().max(64), z.number()])
  .nullable()
  .optional();
/** What a token should be called and how long it applies. `label` accepts any value: tokenLabel() shortens or replaces it. */
const tokenWunsch = { label: z.unknown().optional(), never_expires: z.boolean().optional(), scope: txt(20) };
const Credentials = z.strictObject({
  username: txt(254),
  password: txt(PASSWORT),
  code,
  ohne_token: z.boolean().optional(),
  ...tokenWunsch,
  passkey: z.record(z.string(), z.unknown()).nullable().optional(),
});
const Registrierung = z.strictObject({
  username: txt(64),
  email: txt(254),
  first_name: txtLeer(100),
  last_name: txtLeer(100),
  password: txt(PASSWORT),
  language: txt(10),
});
/** `password` only so that the route can point to /change-password. */
const ProfilAenderung = {
  username: txt(64),
  email: txtLeer(254),
  first_name: txtLeer(100),
  last_name: txtLeer(100),
  password: txt(PASSWORT),
};
/** The app sends `password: null` along (ZweiterFaktorAnfrage); the route accepts no value. */
const NurCode = z.strictObject({ code, password: z.null().optional() });
const adminConfirmed = <F extends z.ZodRawShape = Record<never, z.ZodType>>(felder: F = {} as F) =>
  bestaetigt(felder, 'admin_password');

export const routen = {
  'GET /api/v1/auth/registration-status': { antwort: RegistrationStatusResponse },
  'GET /api/v1/auth/profile': { antwort: ProfilResponse },
  'GET /api/v1/auth/zweiter-faktor': { antwort: ZweiterFaktorStand },
  'GET /api/v1/auth/me': { antwort: MeResponse },
  'GET /api/v1/settings/tokens': { klein: true, antwort: TokensResponse },
  'POST /api/v1/auth/login': { antwort: LoginResponse, eingabe: Credentials, geheim: true },
  'POST /api/v1/auth/qr-login': {
    antwort: QrMeldung,
    eingabe: z.strictObject({ token: txt(200), label: z.unknown().optional() }),
    geheim: true,
  },
  'POST /api/v1/auth/qr-login/abholen': {
    antwort: QrAbholung,
    eingabe: z.strictObject({ abholung: txt(100), vorschau: z.boolean().optional() }),
    geheim: true,
  },
  'POST /api/v1/auth/qr-login/verwerfen': {
    antwort: Erfolg,
    eingabe: z.strictObject({ abholung: txt(100) }),
    geheim: true,
  },
  'GET /api/v1/auth/qr-kopplung/:id': { antwort: QrKopplungStand },
  'POST /api/v1/auth/qr-kopplung/:id/bestaetigen': { antwort: Erfolg, eingabe: z.strictObject({ code: txt(20) }) },
  'POST /api/v1/auth/qr-kopplung/:id/ablehnen': { antwort: Erfolg, eingabe: WITHOUT_BODY },
  'POST /api/v1/auth/logout': { eingabe: WITHOUT_BODY, antwort: GenericResponse },
  'POST /api/v1/auth/register': { antwort: RegisterResponse, eingabe: Registrierung },
  'POST /api/v1/auth/forgot-password': {
    antwort: ForgotPasswordResponse,
    eingabe: z.strictObject({ email: txt(254) }),
  },
  'POST /api/v1/auth/bestaetigung-erneut': {
    antwort: ForgotPasswordResponse,
    eingabe: z.strictObject({ email: txt(254) }),
  },
  'POST /api/v1/auth/email-bestaetigen': { antwort: Erfolg, eingabe: z.strictObject({ token: txt(200) }) },
  'POST /api/v1/auth/email-bestaetigen/vorschau': {
    antwort: z.looseObject({ success: z.literal(true), username: z.string() }),
    eingabe: z.strictObject({ token: txt(200) }),
  },
  'PUT /api/v1/auth/profile': { antwort: ProfilGespeichert, ...bestaetigt(ProfilAenderung, 'password_current') },
  'POST /api/v1/auth/change-password': {
    antwort: GenericResponse,
    ...bestaetigt(
      { newPassword: z.string().max(PASSWORT).optional(), passkeys_widerrufen: z.boolean().optional() },
      'current',
    ),
  },
  'POST /api/v1/auth/zweiter-faktor/einrichten': {
    antwort: ZweiterFaktorEinrichtung,
    ...bestaetigt(),
    geheim: true,
    schritt: 'zweiter_faktor',
  },
  'POST /api/v1/auth/zweiter-faktor/bestaetigen': { antwort: ZweiterFaktorCodes, eingabe: NurCode, geheim: true },
  'POST /api/v1/auth/zweiter-faktor/abschalten': { antwort: GenericResponse, ...bestaetigt() },
  'POST /api/v1/auth/zweiter-faktor/codes': {
    antwort: ZweiterFaktorCodes,
    eingabe: NurCode,
    geheim: true,
    schritt: 'zweiter_faktor',
  },
  // Only revoking a FOREIGN access is confirmed; every device ends its own itself.
  'DELETE /api/v1/settings/tokens/:tokenId': { antwort: TokenWiderruf, ...bestaetigt() },
  'POST /api/v1/auth/token-rotieren': { eingabe: WITHOUT_BODY, antwort: TokenRotation, geheim: true },
  'GET /api/v1/auth/users': { klein: true, antwort: KontenListe },
  'POST /api/v1/auth/users': {
    antwort: Erfolg,
    ...adminConfirmed({
      is_admin: eingabe.toggleOrNo('is_admin'),
      isAdmin: eingabe.toggleOrNo('isAdmin').meta({ deprecated: true, description: 'former name of is_admin' }),
      username: z.string().max(64).optional(),
      password: z.string().max(PASSWORT).optional(),
    }),
  },
  'PUT /api/v1/auth/users/:id/admin': {
    antwort: VerwalterWeg,
    ...adminConfirmed({ is_admin: eingabe.schalter('is_admin') }),
  },
  'PUT /api/v1/auth/users/:id/aktiv': {
    antwort: KontoAktiv,
    ...adminConfirmed({ is_active: eingabe.schalter('is_active') }),
  },
  'PUT /api/v1/auth/users/:id/freischalten': { antwort: Erfolg, ...adminConfirmed() },
  'PUT /api/v1/auth/users/:id/password': {
    antwort: VerwalterWeg,
    ...adminConfirmed({ password: z.string().max(PASSWORT).optional() }),
  },
  'DELETE /api/v1/auth/users/:id': { antwort: VerwalterWeg, ...adminConfirmed() },
  'DELETE /api/v1/auth/konto': { antwort: Erfolg, ...bestaetigt() },
  'DELETE /api/v1/auth/users/:id/zweiter-faktor': { antwort: VerwalterWeg, ...adminConfirmed() },
  'POST /api/v1/auth/token-create': { antwort: TokenErstellt, ...bestaetigt(tokenWunsch), geheim: true },
  'POST /api/v1/auth/qr-token': {
    antwort: QrToken,
    ...bestaetigt({
      gueltigkeit: z
        .union([TEXT(20), ganz])
        .nullable()
        .optional(),
    }),
    geheim: true,
  },
  'POST /api/v1/auth/uebernahme-abbrechen': {
    antwort: Erfolg,
    eingabe: z.strictObject({ token: txt(200) }),
  },
  'POST /api/v1/auth/anmeldung-freigeben': {
    antwort: Erfolg,
    eingabe: z.strictObject({ token: txt(400) }),
  },
  'POST /api/v1/auth/reset-password': {
    antwort: ForgotPasswordResponse,
    eingabe: z.strictObject({ token: txt(200), password: txt(PASSWORT) }),
  },
  'GET /api/v1/auth/passkeys': { klein: true, antwort: PasskeyListe },
  'DELETE /api/v1/auth/passkeys/:id': { antwort: Geloescht, ...bestaetigt() },
  'POST /api/v1/auth/passkey/registrieren/optionen': { antwort: PasskeyOptionen, ...bestaetigt() },
  'POST /api/v1/auth/passkey/registrieren': {
    antwort: PasskeyAngelegt,
    eingabe: z.strictObject({ name: txtLeer(100), antwort: z.record(z.string(), z.unknown()).nullable().optional() }),
  },
  'POST /api/v1/auth/passkey/anmelden/optionen': {
    eingabe: z.strictObject({ zweck: TEXT(40).optional() }),
    antwort: PasskeyOptionen,
  },
  'POST /api/v1/auth/passkey/anmelden': {
    antwort: PasskeyAnmeldung,
    geheim: true,
    eingabe: z.strictObject({
      antwort: z.record(z.string(), z.unknown()).nullable().optional(),
      mit_token: z.boolean().optional(),
      ...tokenWunsch,
    }),
  },
  'POST /api/v1/settings/sessions/andere-beenden': {
    antwort: AndereBeendet,
    ...bestaetigt({ zugaenge: z.boolean().optional() }),
  },
} satisfies Record<string, Route>;
