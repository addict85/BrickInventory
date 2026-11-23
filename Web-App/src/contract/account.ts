import { z } from 'zod';
import { V1_TAKEOVER_KINDS, V1_QR_STATES, V1_PASSKEY_PURPOSES } from './v1Names';
import { v1Keys, v1Values } from './v1';
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
  current: z.boolean(),
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
export const TokenDetails = z.looseObject({
  scope: z.string(),
  expires_at: time.nullable().optional(),
  hard_expires_at: time.nullable(),
  never_expires: z.boolean(),
  rotated_at: time.nullable().optional(),
  rotation_due: z.boolean().optional(),
});

/** /auth/me additionally knows whether the token used should be swapped. */
export const TokenInfo = TokenDetails.extend({ rotation_due: z.boolean() });

/** The QR login only grants app rights; it names no is_admin. */
/** secondFactorRequired: admin rights without TOTP; until set up, everything else answers 403. */
export const LoginUser = User.extend({
  is_admin: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  secondFactorRequired: z.boolean().optional(),
});

export const LoginResponse = z.looseObject({
  success: z.boolean(),
  token: z.string().nullable().optional(),
  /** The app also reads the refusal (zweiter_faktor) into this shape; the account is missing there. */
  user: LoginUser.optional(),
  error: z.string().nullable().optional(),
  second_factor: z.boolean().optional(),
  never_expires: z.boolean(),
  token_info: TokenDetails.nullable().optional(),
  cookie_missing: z.boolean(),
});

export const MeResponse = z.looseObject({
  success: z.boolean(),
  loggedIn: z.boolean(),
  user: User.extend({ mustChangePassword: z.boolean().optional(), secondFactorRequired: z.boolean() })
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
  forgot_password: z.boolean().optional(),
  mail_delivery: z.boolean().optional(),
});

export const TokenRotation = z.looseObject({
  success: z.boolean(),
  token: z.string().nullable(),
  token_info: TokenDetails.nullable(),
  old_valid_until: time.nullable(),
  overlap_seconds: z.number().int().nullable(),
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
  secret: z.string().nullable(),
  otpauth: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const SecondFactorState = z.looseObject({
  success: z.boolean(),
  active: z.boolean(),
  codes_left: z.number().int(),
  /** Open codes could be of the old kind (before 01.11.2026) and then only apply until then. */
  old_codes_until: time.nullable(),
  error: z.string().nullable().optional(),
});

/** The admin's account list (web only). */
export const AccountInList = z.looseObject({
  id: whole,
  username: z.string(),
  is_admin: z.boolean(),
  is_active: z.boolean(),
  created_at: time.nullable(),
  second_factor: z.boolean(),
  awaiting_confirmation: z.boolean(),
  announced: z.array(
    z.looseObject({
      type: v1Values(z.enum(['password', 'second_factor', 'deactivate', 'revoke_role', 'delete']), V1_TAKEOVER_KINDS),
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
  token_info: TokenDetails.nullable(),
});
export const QrToken = z.looseObject({
  success: z.literal(true),
  token: z.string(),
  pairing: whole,
  expires_in: whole,
  url: z.string(),
  token_days: whole.nullable(),
  fp: z.string().optional(),
  cert_sha256: z.string().optional(),
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
  available: z.boolean(),
  passkeys: z.array(Passkey),
});
/** The options go to WebAuthn (navigator.credentials) unchanged; their shape is defined by @simplewebauthn. */
export const PasskeyOptions = z.looseObject({ success: z.literal(true), options: z.record(z.string(), z.unknown()) });
export const PasskeyCreated = z.looseObject({
  success: z.literal(true),
  passkey: z.looseObject({ id: whole, name: z.string() }),
});
/** Like the password login: with `mit_token` (app) the token comes along too. */
export const PasskeyLogin = LoginResponse.extend({
  success: z.literal(true),
  user: z.looseObject({
    id: whole,
    username: z.string(),
    is_admin: z.boolean(),
    mustChangePassword: z.boolean().optional(),
    secondFactorRequired: z.boolean().optional(),
  }),
});
/** Number of deleted rows, as when revoking a token. */
export const Deleted = z.looseObject({ success: z.literal(true), deleted: whole });
/** `deleted` counts the browser sessions, `zugaenge` the app accesses. */
export const OthersEnded = Deleted.extend({ accesses: whole.optional() });

/** The scan registers the device; the code is shown by the app and typed in the browser. */
export const QrMessage = z.looseObject({
  success: z.literal(true),
  waiting: z.literal(true),
  pickup: z.string(),
  code: z.string(),
  expires_in: whole,
});
/** At first only `wartet`, with `vorschau` only `username`, otherwise a login including the nonce for the attestation.
 * Without cookie_missing: the pickup always yields a token, never a session. */
export const QrPickup = LoginResponse.omit({ cookie_missing: true }).extend({
  waiting: z.boolean(),
  never_expires: z.boolean().optional(),
  username: z.string().optional(),
  isAdmin: z.literal(false).optional(),
  userId: whole.optional(),
  preview: z.literal(true).optional(),
  key_nonce: z.string().optional(),
});
export const QrPairingState = z.looseObject({
  success: z.literal(true),
  state: v1Values(z.enum(['open', 'waiting', 'confirmed', 'collected', 'rejected', 'expired']), V1_QR_STATES),
  device: z.string().nullable(),
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
const optionalText = (n: number) => z.string().max(n).nullable().optional();
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
  without_token: z.boolean().optional(),
  ...tokenRequest,
  passkey: z.record(z.string(), z.unknown()).nullable().optional(),
});
const Registration = z.strictObject({
  username: txt(64),
  email: txt(254),
  first_name: optionalText(100),
  last_name: optionalText(100),
  password: txt(PASSWORD),
  language: txt(10),
});
/** `password` only so that the route can point to /change-password. */
const ProfileChange = {
  username: txt(64),
  email: optionalText(254),
  first_name: optionalText(100),
  last_name: optionalText(100),
  password: txt(PASSWORD),
};
/** The app sends `password: null` along (ZweiterFaktorAnfrage); the route accepts no value. */
const CodeOnly = z.strictObject({ code, password: z.null().optional() });
const adminConfirmed = <F extends z.ZodRawShape = Record<never, z.ZodType>>(fields: F = {} as F) =>
  confirmed(fields, 'admin_password');

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(AppToken, { current: 'aktuell' });
v1Keys(QrMessage, { waiting: 'wartet' });
v1Keys(QrPickup, { waiting: 'wartet' });

export const routes = {
  'GET /api/v2/auth/registration-status': { response: RegistrationStatusResponse },
  'GET /api/v2/auth/profile': { response: ProfileResponse },
  'GET /api/v2/auth/second-factor': { response: SecondFactorState },
  'GET /api/v2/auth/me': { response: MeResponse },
  'GET /api/v2/settings/tokens': { small: true, response: TokensResponse },
  'POST /api/v2/auth/login': { response: LoginResponse, input: Credentials, secret: true },
  'POST /api/v2/auth/qr-login': {
    response: QrMessage,
    input: z.strictObject({ token: txt(200), label: z.unknown().optional() }),
    secret: true,
  },
  'POST /api/v2/auth/qr-login/collect': {
    response: QrPickup,
    input: z.strictObject({ pickup: txt(100), preview: z.boolean().optional() }),
    secret: true,
  },
  'POST /api/v2/auth/qr-login/discard': {
    response: Success,
    input: z.strictObject({ pickup: txt(100) }),
    secret: true,
  },
  'GET /api/v2/auth/qr-pairing/:id': { response: QrPairingState },
  'POST /api/v2/auth/qr-pairing/:id/confirm': { response: Success, input: z.strictObject({ code: txt(20) }) },
  'POST /api/v2/auth/qr-pairing/:id/reject': { response: Success, input: WITHOUT_BODY },
  'POST /api/v2/auth/logout': { input: WITHOUT_BODY, response: GenericResponse },
  'POST /api/v2/auth/register': { response: RegisterResponse, input: Registration },
  'POST /api/v2/auth/forgot-password': {
    response: ForgotPasswordResponse,
    input: z.strictObject({ email: txt(254) }),
  },
  'POST /api/v2/auth/resend-confirmation': {
    response: ForgotPasswordResponse,
    input: z.strictObject({ email: txt(254) }),
  },
  'POST /api/v2/auth/confirm-email': { response: Success, input: z.strictObject({ token: txt(200) }) },
  'POST /api/v2/auth/confirm-email/preview': {
    response: z.looseObject({ success: z.literal(true), username: z.string() }),
    input: z.strictObject({ token: txt(200) }),
  },
  'PUT /api/v2/auth/profile': { response: ProfileSaved, ...confirmed(ProfileChange, 'password_current') },
  'POST /api/v2/auth/change-password': {
    response: GenericResponse,
    ...confirmed(
      { newPassword: z.string().max(PASSWORD).optional(), passkeys_revoked: z.boolean().optional() },
      'current',
    ),
  },
  'POST /api/v2/auth/second-factor/setup': {
    response: SecondFactorSetup,
    ...confirmed(),
    secret: true,
    step: 'second_factor',
  },
  'POST /api/v2/auth/second-factor/confirm': { response: SecondFactorCodes, input: CodeOnly, secret: true },
  'POST /api/v2/auth/second-factor/disable': { response: GenericResponse, ...confirmed() },
  'POST /api/v2/auth/second-factor/codes': {
    response: SecondFactorCodes,
    input: CodeOnly,
    secret: true,
    step: 'second_factor',
  },
  // Only revoking a FOREIGN access is confirmed; every device ends its own itself.
  'DELETE /api/v2/settings/tokens/:tokenId': { response: TokenRevocation, ...confirmed() },
  'POST /api/v2/auth/rotate-token': { input: WITHOUT_BODY, response: TokenRotation, secret: true },
  'GET /api/v2/auth/users': { small: true, response: AccountList },
  'POST /api/v2/auth/users': {
    response: Success,
    ...adminConfirmed({
      is_admin: input.toggleOrNo('is_admin'),
      isAdmin: input.toggleOrNo('isAdmin').meta({ deprecated: true, description: 'former name of is_admin' }),
      username: z.string().max(64).optional(),
      password: z.string().max(PASSWORD).optional(),
    }),
  },
  'PUT /api/v2/auth/users/:id/admin': {
    response: AdminRoute,
    ...adminConfirmed({ is_admin: input.flag('is_admin') }),
  },
  'PUT /api/v2/auth/users/:id/active': {
    response: AccountActive,
    ...adminConfirmed({ is_active: input.flag('is_active') }),
  },
  'PUT /api/v2/auth/users/:id/approve': { response: Success, ...adminConfirmed() },
  'PUT /api/v2/auth/users/:id/password': {
    response: AdminRoute,
    ...adminConfirmed({ password: z.string().max(PASSWORD).optional() }),
  },
  'DELETE /api/v2/auth/users/:id': { response: AdminRoute, ...adminConfirmed() },
  'DELETE /api/v2/auth/account': { response: Success, ...confirmed() },
  'DELETE /api/v2/auth/users/:id/second-factor': { response: AdminRoute, ...adminConfirmed() },
  'POST /api/v2/auth/token-create': { response: TokenCreated, ...confirmed(tokenRequest), secret: true },
  'POST /api/v2/auth/qr-token': {
    response: QrToken,
    ...confirmed({
      validity: z
        .union([TEXT(20), whole])
        .nullable()
        .optional(),
    }),
    secret: true,
  },
  'POST /api/v2/auth/cancel-takeover': {
    response: Success,
    input: z.strictObject({ token: txt(200) }),
  },
  'POST /api/v2/auth/approve-login': {
    response: Success,
    input: z.strictObject({ token: txt(400) }),
  },
  'POST /api/v2/auth/reset-password': {
    response: ForgotPasswordResponse,
    input: z.strictObject({ token: txt(200), password: txt(PASSWORD) }),
  },
  'GET /api/v2/auth/passkeys': { small: true, response: PasskeyList },
  'DELETE /api/v2/auth/passkeys/:id': { response: Deleted, ...confirmed() },
  'POST /api/v2/auth/passkey/register/options': { response: PasskeyOptions, ...confirmed() },
  'POST /api/v2/auth/passkey/register': {
    response: PasskeyCreated,
    input: z.strictObject({
      name: optionalText(100),
      response: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  },
  'POST /api/v2/auth/passkey/login/options': {
    input: z.strictObject({ purpose: v1Values(TEXT(40), V1_PASSKEY_PURPOSES).optional() }),
    response: PasskeyOptions,
  },
  'POST /api/v2/auth/passkey/login': {
    response: PasskeyLogin,
    secret: true,
    input: z.strictObject({
      response: z.record(z.string(), z.unknown()).nullable().optional(),
      with_token: z.boolean().optional(),
      ...tokenRequest,
    }),
  },
  'POST /api/v2/settings/sessions/end-others': {
    response: OthersEnded,
    ...confirmed({ accesses: z.boolean().optional() }),
  },
} satisfies Record<string, Route>;
