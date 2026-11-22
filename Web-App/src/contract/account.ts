import { z } from 'zod';
import { input } from '../infra/validate';
import { type Route, time, Success, whole, confirmed, WITHOUT_BODY, TEXT } from './base';
import { GenericResponse } from './shared';

export const AppToken = z.looseObject({
  token_id: z.string(),
  label: z.string().nullable(),
  created_at: time.nullable(),
  last_used: time.nullable(),
  expires_at: time.nullable(),
  never_expires: z.boolean(),
  aktuell: z.boolean(),
  token_prefix: z.string().nullable(),
  hard_expires_at: time.nullable(),
  scope: z.string(),
  ip_range: z.string().nullable(),
  rotated_at: time,
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
  expires_at: time.nullable().optional(),
  hard_expires_at: time.nullable(),
  never_expires: z.boolean(),
  rotated_at: time.nullable().optional(),
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
  token_expires: time.nullable().optional(),
  token_last_used: time.nullable().optional(),
  token_info: TokenInfo.nullable().optional(),
});

export const Profile = z.looseObject({
  id: z.number().int(),
  username: z.string(),
  email: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email_verified: z.boolean(),
  /** Requested but not yet confirmed; until then `email` applies. */
  new_email: z.string().nullable(),
});

export const ProfileResponse = z.looseObject({
  success: z.boolean(),
  user: Profile.nullable(),
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
  alt_gueltig_bis: time.nullable(),
  ueberlappung_sek: z.number().int().nullable(),
});

export const TokenRevocation = z.looseObject({
  success: z.boolean(),
  deleted: z.number().int(),
});

export const TokensResponse = z.looseObject({
  success: z.boolean(),
  tokens: z.array(AppToken),
  error: z.string().nullable().optional(),
});

export const SecondFactorCodes = z.looseObject({
  success: z.boolean(),
  codes: z.array(z.string()),
  error: z.string().nullable().optional(),
});

export const SecondFactorSetup = z.looseObject({
  success: z.boolean(),
  geheimnis: z.string().nullable(),
  otpauth: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const SecondFactorState = z.looseObject({
  success: z.boolean(),
  aktiv: z.boolean(),
  codes_uebrig: z.number().int(),
  /** Open codes could be of the old kind (before 01.11.2026) and then only apply until then. */
  alte_codes_bis: time.nullable(),
  error: z.string().nullable().optional(),
});

/** The admin's account list (web only). */
export const AccountInList = z.looseObject({
  id: whole,
  username: z.string(),
  is_admin: z.boolean(),
  is_active: z.boolean(),
  created_at: time.nullable(),
  zweiter_faktor: z.boolean(),
  wartet_auf_bestaetigung: z.boolean(),
  angekuendigt: z.array(
    z.looseObject({
      type: z.enum(['passwort', 'zweiter_faktor', 'deaktivieren', 'rolle_entziehen', 'loeschen']),
      effective_at: z.string(),
    }),
  ),
});
export const AccountList = z.looseObject({ success: z.literal(true), users: z.array(AccountInList) });
export const AccountActive = z.looseObject({
  success: z.literal(true),
  is_active: z.boolean(),
  effective_at: z.string().optional(),
});

export const TokenCreated = z.looseObject({
  success: z.literal(true),
  token: z.string(),
  label: z.string().nullable(),
  never_expires: z.boolean(),
  token_info: TokenAngaben.nullable(),
});
export const QrToken = z.looseObject({
  success: z.literal(true),
  token: z.string(),
  kopplung: whole,
  expires_in: whole,
  url: z.string(),
  token_days: whole.nullable(),
  fp: z.string().optional(),
  zert_sha256: z.string().optional(),
});
export const Passkey = z.looseObject({
  id: whole,
  name: z.string().nullable(),
  transports: z.string().nullable(),
  created_at: time,
  last_used: time.nullable(),
});
export const PasskeyList = z.looseObject({
  success: z.literal(true),
  verfuegbar: z.boolean(),
  passkeys: z.array(Passkey),
});
/** The options go to WebAuthn (navigator.credentials) unchanged; their shape is defined by @simplewebauthn. */
export const PasskeyOptions = z.looseObject({ success: z.literal(true), optionen: z.record(z.string(), z.unknown()) });
export const PasskeyCreated = z.looseObject({
  success: z.literal(true),
  passkey: z.looseObject({ id: whole, name: z.string() }),
});
/** Like the password login: with `mit_token` (app) the token comes along too. */
export const PasskeyAnmeldung = LoginResponse.extend({
  success: z.literal(true),
  user: z.looseObject({
    id: whole,
    username: z.string(),
    is_admin: z.boolean(),
    mustChangePassword: z.boolean().optional(),
    zweiterFaktorPflicht: z.boolean().optional(),
  }),
});
/** Number of deleted rows, as when revoking a token. */
export const Deleted = z.looseObject({ success: z.literal(true), deleted: whole });
/** `deleted` counts the browser sessions, `zugaenge` the app accesses. */
export const OthersEnded = Deleted.extend({ zugaenge: whole.optional() });

/** The scan registers the device; the code is shown by the app and typed in the browser. */
export const QrMessage = z.looseObject({
  success: z.literal(true),
  wartet: z.literal(true),
  abholung: z.string(),
  code: z.string(),
  expires_in: whole,
});
/** At first only `wartet`, with `vorschau` only `username`, otherwise a login including the nonce for the attestation.
 * Without keks_fehlt: the pickup always yields a token, never a session. */
export const QrPickup = LoginResponse.omit({ keks_fehlt: true }).extend({
  wartet: z.boolean(),
  never_expires: z.boolean().optional(),
  username: z.string().optional(),
  isAdmin: z.literal(false).optional(),
  userId: whole.optional(),
  vorschau: z.literal(true).optional(),
  schluessel_nonce: z.string().optional(),
});
export const QrPairingState = z.looseObject({
  success: z.literal(true),
  stand: z.enum(['offen', 'wartet', 'bestaetigt', 'abgeholt', 'abgelehnt', 'abgelaufen']),
  geraet: z.string().nullable(),
  ip_range: z.string().nullable(),
});
export const ProfileSaved = GenericResponse.extend({
  emailChanged: z.boolean().optional(),
  emailSent: z.boolean().optional(),
});

/** Inputs of the account routes: type and length; the rules (USERNAME_RE, password)
 * are still checked by the route. Free text is limited, the columns are `text`;
 * `label` is missing because tokenLabel() shortens or replaces every value. */
const txt = (n: number) => z.string().max(n).optional();
const txtLeer = (n: number) => z.string().max(n).nullable().optional();
/** For an admin account: from when the change applies (src/account/adminActions.ts). */
export const AdminRoute = Success.extend({ effective_at: z.string().optional() });
const PASSWORD = 1024;
const code = z
  .union([z.string().max(64), z.number()])
  .nullable()
  .optional();
/** What a token should be called and how long it applies. `label` accepts any value: tokenLabel() shortens or replaces it. */
const tokenRequest = { label: z.unknown().optional(), never_expires: z.boolean().optional(), scope: txt(20) };
const Credentials = z.strictObject({
  username: txt(254),
  password: txt(PASSWORD),
  code,
  ohne_token: z.boolean().optional(),
  ...tokenRequest,
  passkey: z.record(z.string(), z.unknown()).nullable().optional(),
});
const Registration = z.strictObject({
  username: txt(64),
  email: txt(254),
  first_name: txtLeer(100),
  last_name: txtLeer(100),
  password: txt(PASSWORD),
  language: txt(10),
});
/** `password` only so that the route can point to /change-password. */
const ProfileChange = {
  username: txt(64),
  email: txtLeer(254),
  first_name: txtLeer(100),
  last_name: txtLeer(100),
  password: txt(PASSWORD),
};
/** The app sends `password: null` along (ZweiterFaktorAnfrage); the route accepts no value. */
const NurCode = z.strictObject({ code, password: z.null().optional() });
const adminConfirmed = <F extends z.ZodRawShape = Record<never, z.ZodType>>(fields: F = {} as F) =>
  confirmed(fields, 'admin_password');

export const routen = {
  'GET /api/v1/auth/registration-status': { antwort: RegistrationStatusResponse },
  'GET /api/v1/auth/profile': { antwort: ProfileResponse },
  'GET /api/v1/auth/zweiter-faktor': { antwort: SecondFactorState },
  'GET /api/v1/auth/me': { antwort: MeResponse },
  'GET /api/v1/settings/tokens': { klein: true, antwort: TokensResponse },
  'POST /api/v1/auth/login': { antwort: LoginResponse, eingabe: Credentials, geheim: true },
  'POST /api/v1/auth/qr-login': {
    antwort: QrMessage,
    eingabe: z.strictObject({ token: txt(200), label: z.unknown().optional() }),
    geheim: true,
  },
  'POST /api/v1/auth/qr-login/abholen': {
    antwort: QrPickup,
    eingabe: z.strictObject({ abholung: txt(100), vorschau: z.boolean().optional() }),
    geheim: true,
  },
  'POST /api/v1/auth/qr-login/verwerfen': {
    antwort: Success,
    eingabe: z.strictObject({ abholung: txt(100) }),
    geheim: true,
  },
  'GET /api/v1/auth/qr-kopplung/:id': { antwort: QrPairingState },
  'POST /api/v1/auth/qr-kopplung/:id/bestaetigen': { antwort: Success, eingabe: z.strictObject({ code: txt(20) }) },
  'POST /api/v1/auth/qr-kopplung/:id/ablehnen': { antwort: Success, eingabe: WITHOUT_BODY },
  'POST /api/v1/auth/logout': { eingabe: WITHOUT_BODY, antwort: GenericResponse },
  'POST /api/v1/auth/register': { antwort: RegisterResponse, eingabe: Registration },
  'POST /api/v1/auth/forgot-password': {
    antwort: ForgotPasswordResponse,
    eingabe: z.strictObject({ email: txt(254) }),
  },
  'POST /api/v1/auth/bestaetigung-erneut': {
    antwort: ForgotPasswordResponse,
    eingabe: z.strictObject({ email: txt(254) }),
  },
  'POST /api/v1/auth/email-bestaetigen': { antwort: Success, eingabe: z.strictObject({ token: txt(200) }) },
  'POST /api/v1/auth/email-bestaetigen/vorschau': {
    antwort: z.looseObject({ success: z.literal(true), username: z.string() }),
    eingabe: z.strictObject({ token: txt(200) }),
  },
  'PUT /api/v1/auth/profile': { antwort: ProfileSaved, ...confirmed(ProfileChange, 'password_current') },
  'POST /api/v1/auth/change-password': {
    antwort: GenericResponse,
    ...confirmed(
      { newPassword: z.string().max(PASSWORD).optional(), passkeys_widerrufen: z.boolean().optional() },
      'current',
    ),
  },
  'POST /api/v1/auth/zweiter-faktor/einrichten': {
    antwort: SecondFactorSetup,
    ...confirmed(),
    geheim: true,
    schritt: 'zweiter_faktor',
  },
  'POST /api/v1/auth/zweiter-faktor/bestaetigen': { antwort: SecondFactorCodes, eingabe: NurCode, geheim: true },
  'POST /api/v1/auth/zweiter-faktor/abschalten': { antwort: GenericResponse, ...confirmed() },
  'POST /api/v1/auth/zweiter-faktor/codes': {
    antwort: SecondFactorCodes,
    eingabe: NurCode,
    geheim: true,
    schritt: 'zweiter_faktor',
  },
  // Only revoking a FOREIGN access is confirmed; every device ends its own itself.
  'DELETE /api/v1/settings/tokens/:tokenId': { antwort: TokenRevocation, ...confirmed() },
  'POST /api/v1/auth/token-rotieren': { eingabe: WITHOUT_BODY, antwort: TokenRotation, geheim: true },
  'GET /api/v1/auth/users': { klein: true, antwort: AccountList },
  'POST /api/v1/auth/users': {
    antwort: Success,
    ...adminConfirmed({
      is_admin: input.toggleOrNo('is_admin'),
      isAdmin: input.toggleOrNo('isAdmin').meta({ deprecated: true, description: 'former name of is_admin' }),
      username: z.string().max(64).optional(),
      password: z.string().max(PASSWORD).optional(),
    }),
  },
  'PUT /api/v1/auth/users/:id/admin': {
    antwort: AdminRoute,
    ...adminConfirmed({ is_admin: input.schalter('is_admin') }),
  },
  'PUT /api/v1/auth/users/:id/aktiv': {
    antwort: AccountActive,
    ...adminConfirmed({ is_active: input.schalter('is_active') }),
  },
  'PUT /api/v1/auth/users/:id/freischalten': { antwort: Success, ...adminConfirmed() },
  'PUT /api/v1/auth/users/:id/password': {
    antwort: AdminRoute,
    ...adminConfirmed({ password: z.string().max(PASSWORD).optional() }),
  },
  'DELETE /api/v1/auth/users/:id': { antwort: AdminRoute, ...adminConfirmed() },
  'DELETE /api/v1/auth/konto': { antwort: Success, ...confirmed() },
  'DELETE /api/v1/auth/users/:id/zweiter-faktor': { antwort: AdminRoute, ...adminConfirmed() },
  'POST /api/v1/auth/token-create': { antwort: TokenCreated, ...confirmed(tokenRequest), geheim: true },
  'POST /api/v1/auth/qr-token': {
    antwort: QrToken,
    ...confirmed({
      gueltigkeit: z
        .union([TEXT(20), whole])
        .nullable()
        .optional(),
    }),
    geheim: true,
  },
  'POST /api/v1/auth/uebernahme-abbrechen': {
    antwort: Success,
    eingabe: z.strictObject({ token: txt(200) }),
  },
  'POST /api/v1/auth/anmeldung-freigeben': {
    antwort: Success,
    eingabe: z.strictObject({ token: txt(400) }),
  },
  'POST /api/v1/auth/reset-password': {
    antwort: ForgotPasswordResponse,
    eingabe: z.strictObject({ token: txt(200), password: txt(PASSWORD) }),
  },
  'GET /api/v1/auth/passkeys': { klein: true, antwort: PasskeyList },
  'DELETE /api/v1/auth/passkeys/:id': { antwort: Deleted, ...confirmed() },
  'POST /api/v1/auth/passkey/registrieren/optionen': { antwort: PasskeyOptions, ...confirmed() },
  'POST /api/v1/auth/passkey/registrieren': {
    antwort: PasskeyCreated,
    eingabe: z.strictObject({ name: txtLeer(100), antwort: z.record(z.string(), z.unknown()).nullable().optional() }),
  },
  'POST /api/v1/auth/passkey/anmelden/optionen': {
    eingabe: z.strictObject({ zweck: TEXT(40).optional() }),
    antwort: PasskeyOptions,
  },
  'POST /api/v1/auth/passkey/anmelden': {
    antwort: PasskeyAnmeldung,
    geheim: true,
    eingabe: z.strictObject({
      antwort: z.record(z.string(), z.unknown()).nullable().optional(),
      mit_token: z.boolean().optional(),
      ...tokenRequest,
    }),
  },
  'POST /api/v1/settings/sessions/andere-beenden': {
    antwort: OthersEnded,
    ...confirmed({ zugaenge: z.boolean().optional() }),
  },
} satisfies Record<string, Route>;
