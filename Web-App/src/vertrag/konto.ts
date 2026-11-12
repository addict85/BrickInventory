import { z } from 'zod';
import { eingabe } from '../infra/validate';
import { type Route, zeit, Erfolg, ganz, bestaetigt, OHNE_RUMPF, TEXT } from './grund';
import { GenericResponse } from './gemeinsam';

export const AppToken = z.looseObject({
  token_id: z.string(),
  label: z.string().nullable().optional(),
  created_at: zeit.nullable().optional(),
  last_used: zeit.nullable().optional(),
  expires_at: zeit.nullable().optional(),
  never_expires: z.boolean(),
  aktuell: z.boolean(),
  token_prefix: z.string().nullable().optional(),
  hard_expires_at: zeit.nullable().optional(),
  scope: z.string().nullable().optional(),
  ip_bereich: z.string().nullable().optional(),
  rotiert_am: zeit.nullable().optional(),
});

export const ForgotPasswordResponse = z.looseObject({
  success: z.boolean(),
  message: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const User = z.looseObject({
  id: z.number().int(),
  username: z.string(),
  is_admin: z.boolean(),
});

/** Was Anmeldung und Tausch über den neuen Token sagen (tokenAngaben). */
export const TokenAngaben = z.looseObject({
  scope: z.string(),
  expires_at: zeit.nullable().optional(),
  hard_expires_at: zeit.nullable().optional(),
  never_expires: z.boolean(),
  rotiert_am: zeit.nullable().optional(),
  rotation_faellig: z.boolean().optional(),
});

/** /auth/me weiss zusätzlich, ob der benutzte Token getauscht werden soll. */
export const TokenInfo = TokenAngaben.extend({ rotation_faellig: z.boolean() });

/** Die QR-Anmeldung gibt nur App-Rechte; sie nennt kein is_admin. */
/** zweiterFaktorPflicht: Verwalterrechte ohne TOTP; bis zur Einrichtung antwortet alles andere 403. */
export const AnmeldeNutzer = User.extend({
  is_admin: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  zweiterFaktorPflicht: z.boolean().optional(),
});

export const LoginResponse = z.looseObject({
  success: z.boolean(),
  token: z.string().nullable().optional(),
  user: AnmeldeNutzer.nullable().optional(),
  error: z.string().nullable().optional(),
  zweiter_faktor: z.boolean().optional(),
  never_expires: z.boolean().optional(),
  token_info: TokenAngaben.nullable().optional(),
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
  email: z.string().nullable().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  email_verified: z.boolean(),
  /** Beantragt, aber noch nicht bestätigt; bis dahin gilt `email`. */
  email_neu: z.string().nullable().optional(),
});

export const ProfilResponse = z.looseObject({
  success: z.boolean(),
  user: Profil.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const RegisterResponse = z.looseObject({
  success: z.boolean(),
  message: z.string().nullable().optional(),
  email_sent: z.boolean().optional(),
  console_mode: z.boolean().optional(),
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
  token: z.string().nullable().optional(),
  token_info: TokenAngaben.nullable().optional(),
  alt_gueltig_bis: zeit.nullable().optional(),
  ueberlappung_sek: z.number().int().nullable().optional(),
});

export const TokenWiderruf = z.looseObject({
  success: z.boolean(),
  deleted: z.number().int().optional(),
});

export const TokensResponse = z.looseObject({
  success: z.boolean(),
  tokens: z.array(AppToken),
  error: z.string().nullable().optional(),
});

export const ZweiterFaktorCodes = z.looseObject({
  success: z.boolean(),
  codes: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
});

export const ZweiterFaktorEinrichtung = z.looseObject({
  success: z.boolean(),
  geheimnis: z.string().nullable().optional(),
  otpauth: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const ZweiterFaktorStand = z.looseObject({
  success: z.boolean(),
  aktiv: z.boolean(),
  codes_uebrig: z.number().int(),
  error: z.string().nullable().optional(),
});

/** Die Kontenliste der Verwaltung (nur Web). */
export const KontoInListe = z.looseObject({
  id: ganz,
  username: z.string(),
  is_admin: z.boolean(),
  is_active: z.boolean(),
  created_at: zeit.nullable(),
  zweiter_faktor: z.boolean(),
  wartet_auf_bestaetigung: z.boolean().optional(),
});
export const KontenListe = z.looseObject({ success: z.literal(true), users: z.array(KontoInListe) });
export const KontoAktiv = z.looseObject({ success: z.literal(true), is_active: z.boolean() });

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
  token_days: ganz.nullable().optional(),
  fp: z.string().optional(),
  zert_sha256: z.string().optional(),
});
export const Passkey = z.looseObject({
  id: ganz,
  name: z.string().nullable(),
  transports: z.string().nullable().optional(),
  created_at: zeit.nullable(),
  last_used: zeit.nullable(),
});
export const PasskeyListe = z.looseObject({
  success: z.literal(true),
  verfuegbar: z.boolean(),
  passkeys: z.array(Passkey),
});
/** Die Optionen gehen unverändert an WebAuthn (navigator.credentials); ihre Form legt @simplewebauthn fest. */
export const PasskeyOptionen = z.looseObject({ success: z.literal(true), optionen: z.record(z.string(), z.unknown()) });
export const PasskeyAngelegt = z.looseObject({
  success: z.literal(true),
  passkey: z.looseObject({ id: ganz, name: z.string() }),
});
/** Wie die Passwort-Anmeldung: Mit `mit_token` (App) kommt auch der Token. */
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
/** Anzahl gelöschter Zeilen, wie beim Widerruf eines Tokens. */
export const Geloescht = z.looseObject({ success: z.literal(true), deleted: ganz });
/** `deleted` zählt die Browser-Sitzungen, `zugaenge` die App-Zugänge. */
export const AndereBeendet = Geloescht.extend({ zugaenge: ganz.optional() });

/** Der Scan meldet das Gerät an; den Code zeigt die App, eingetippt wird er im Browser. */
export const QrMeldung = z.looseObject({
  success: z.literal(true),
  wartet: z.literal(true),
  abholung: z.string(),
  code: z.string(),
  expires_in: ganz,
});
/** Bis zur Bestätigung nur `wartet`; mit `vorschau` dann nur `username`, sonst wie eine Anmeldung,
 * Name und Konto zusätzlich flach, dazu die Nonce für die Attestation des Geräteschlüssels. */
export const QrAbholung = LoginResponse.extend({
  wartet: z.boolean(),
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
  ip_bereich: z.string().nullable(),
});
export const ProfilGespeichert = GenericResponse.extend({
  emailChanged: z.boolean().optional(),
  emailSent: z.boolean().optional(),
});

/** Eingaben der Kontorouten: Typ und Länge; die Regeln (USERNAME_RE, Passwort)
 * prüft weiter die Route. Freitext ist begrenzt, die Spalten sind `text`;
 * `label` fehlt, weil tokenLabel() jeden Wert kürzt oder ersetzt. */
const txt = (n: number) => z.string().max(n).optional();
const txtLeer = (n: number) => z.string().max(n).nullable().optional();
const PASSWORT = 1024;
const code = z
  .union([z.string().max(64), z.number()])
  .nullable()
  .optional();
/** Wie ein Token heissen und gelten soll. `label` nimmt jeden Wert: tokenLabel() kürzt oder ersetzt ihn. */
const tokenWunsch = { label: z.unknown().optional(), never_expires: z.boolean().optional(), scope: txt(20) };
const Anmeldedaten = z.strictObject({
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
/** `password` nur, damit die Route auf /change-password verweisen kann. */
const ProfilAenderung = {
  username: txt(64),
  email: txtLeer(254),
  first_name: txtLeer(100),
  last_name: txtLeer(100),
  password: txt(PASSWORT),
};
/** `password: null` schickt die App mit (ZweiterFaktorAnfrage); einen Wert nimmt die Route nicht. */
const NurCode = z.strictObject({ code, password: z.null().optional() });
const verwalterBestaetigt = <F extends z.ZodRawShape = Record<never, z.ZodType>>(felder: F = {} as F) =>
  bestaetigt(felder, 'admin_password');

export const routen = {
  'GET /api/v1/auth/registration-status': { antwort: RegistrationStatusResponse },
  'GET /api/v1/auth/profile': { antwort: ProfilResponse },
  'GET /api/v1/auth/zweiter-faktor': { antwort: ZweiterFaktorStand },
  'GET /api/v1/auth/me': { antwort: MeResponse },
  'GET /api/v1/settings/tokens': { klein: true, antwort: TokensResponse },
  'POST /api/v1/auth/login': { antwort: LoginResponse, eingabe: Anmeldedaten, geheim: true },
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
  'POST /api/v1/auth/qr-kopplung/:id/ablehnen': { antwort: Erfolg, eingabe: OHNE_RUMPF },
  'POST /api/v1/auth/logout': { eingabe: OHNE_RUMPF, antwort: GenericResponse },
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
  'POST /api/v1/auth/zweiter-faktor/einrichten': { antwort: ZweiterFaktorEinrichtung, ...bestaetigt(), geheim: true },
  'POST /api/v1/auth/zweiter-faktor/bestaetigen': { antwort: ZweiterFaktorCodes, eingabe: NurCode, geheim: true },
  'POST /api/v1/auth/zweiter-faktor/abschalten': { antwort: GenericResponse, ...bestaetigt() },
  'POST /api/v1/auth/zweiter-faktor/codes': { antwort: ZweiterFaktorCodes, eingabe: NurCode, geheim: true },
  // Bestätigt wird nur der Widerruf eines FREMDEN Zugangs; den eigenen beendet jedes Gerät selbst.
  'DELETE /api/v1/settings/tokens/:tokenId': { antwort: TokenWiderruf, ...bestaetigt() },
  'POST /api/v1/auth/token-rotieren': { eingabe: OHNE_RUMPF, antwort: TokenRotation, geheim: true },
  'GET /api/v1/auth/users': { klein: true, antwort: KontenListe },
  'POST /api/v1/auth/users': {
    antwort: Erfolg,
    ...verwalterBestaetigt({
      is_admin: eingabe.schalterOderNein('is_admin'),
      isAdmin: eingabe
        .schalterOderNein('isAdmin')
        .meta({ deprecated: true, description: 'früherer Name von is_admin' }),
      username: z.string().max(64).optional(),
      password: z.string().max(PASSWORT).optional(),
    }),
  },
  'PUT /api/v1/auth/users/:id/admin': {
    antwort: Erfolg,
    ...verwalterBestaetigt({ is_admin: eingabe.schalter('is_admin') }),
  },
  'PUT /api/v1/auth/users/:id/aktiv': {
    antwort: KontoAktiv,
    ...verwalterBestaetigt({ is_active: eingabe.schalter('is_active') }),
  },
  'PUT /api/v1/auth/users/:id/freischalten': { antwort: Erfolg, ...verwalterBestaetigt() },
  'PUT /api/v1/auth/users/:id/password': {
    antwort: Erfolg,
    ...verwalterBestaetigt({ password: z.string().max(PASSWORT).optional() }),
  },
  'DELETE /api/v1/auth/users/:id': { antwort: Erfolg, ...verwalterBestaetigt() },
  'DELETE /api/v1/auth/konto': { antwort: Erfolg, ...bestaetigt() },
  'DELETE /api/v1/auth/users/:id/zweiter-faktor': { antwort: Erfolg, ...verwalterBestaetigt() },
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
