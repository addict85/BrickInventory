import { z } from 'zod';
import { eingabe } from '../validate';
import { type Route, zeit, Erfolg, ganz } from './grund';
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
export const AnmeldeNutzer = User.extend({ is_admin: z.boolean().optional(), mustChangePassword: z.boolean().optional() });

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
  user: User.extend({ mustChangePassword: z.boolean().optional() }).nullable().optional(),
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
  id: ganz, username: z.string(), is_admin: z.boolean(), is_active: z.boolean(), created_at: zeit.nullable(),
  zweiter_faktor: z.boolean(),
});
export const KontenListe = z.looseObject({ success: z.literal(true), users: z.array(KontoInListe) });
export const KontoAktiv = z.looseObject({ success: z.literal(true), is_active: z.boolean() });

export const TokenErstellt = z.looseObject({
  success: z.literal(true), token: z.string(), label: z.string().nullable(), never_expires: z.boolean(),
  token_info: TokenAngaben.nullable(),
});
export const QrToken = z.looseObject({
  success: z.literal(true), token: z.string(), expires_in: ganz, url: z.string(),
  token_days: ganz.nullable().optional(), fp: z.string().optional(),
});
export const Passkey = z.looseObject({
  id: ganz, name: z.string().nullable(), transports: z.string().nullable().optional(),
  created_at: zeit.nullable(), last_used: zeit.nullable(),
});
export const PasskeyListe = z.looseObject({ success: z.literal(true), verfuegbar: z.boolean(), passkeys: z.array(Passkey) });
/** Die Optionen gehen unverändert an WebAuthn (navigator.credentials); ihre Form legt @simplewebauthn fest. */
export const PasskeyOptionen = z.looseObject({ success: z.literal(true), optionen: z.record(z.string(), z.unknown()) });
export const PasskeyAngelegt = z.looseObject({ success: z.literal(true), passkey: z.looseObject({ id: ganz, name: z.string() }) });
/** Wie die Passwort-Anmeldung: Mit `mit_token` (App) kommt auch der Token. */
export const PasskeyAnmeldung = LoginResponse.extend({
  success: z.literal(true),
  user: z.looseObject({ id: ganz, username: z.string(), is_admin: z.boolean(), mustChangePassword: z.boolean().optional() }),
});
/** Anzahl gelöschter Zeilen, wie beim Widerruf eines Tokens. */
export const Geloescht = z.looseObject({ success: z.literal(true), deleted: ganz });

/** Die QR-Anmeldung nennt Name und Konto zusätzlich flach (ältere Web-Oberfläche). */
export const QrLoginResponse = LoginResponse.extend({ username: z.string(), isAdmin: z.literal(false), userId: ganz });
export const ProfilGespeichert = GenericResponse.extend({ emailChanged: z.boolean().optional(), emailSent: z.boolean().optional() });

/** Eingaben der Kontorouten: Typ und Länge; die Regeln (USERNAME_RE, Passwort)
 * prüft weiter die Route. Freitext ist begrenzt, die Spalten sind `text`;
 * `label` fehlt, weil tokenLabel() jeden Wert kürzt oder ersetzt. */
const txt = (n: number) => z.string().max(n).optional();
const txtLeer = (n: number) => z.string().max(n).nullable().optional();
const PASSWORT = 1024;
const code = z.union([z.string().max(64), z.number()]).nullable().optional();
const Verwalter = { admin_password: txt(PASSWORT) };
const Anmeldedaten = z.looseObject({ username: txt(254), password: txt(PASSWORT), code, ohne_token: z.boolean().optional(),
  never_expires: z.boolean().optional(), scope: txt(20), passkey: z.record(z.string(), z.unknown()).nullable().optional() });
const Registrierung = z.looseObject({ username: txt(64), email: txt(254), first_name: txtLeer(100), last_name: txtLeer(100),
  password: txt(PASSWORT), language: txt(10) });
const ProfilAenderung = z.looseObject({ username: txt(64), email: txtLeer(254), first_name: txtLeer(100), last_name: txtLeer(100),
  password_current: txt(PASSWORT), code });
const NurPasswort = z.looseObject({ password: txt(PASSWORT), code });

export const routen = {
  'GET /api/v1/auth/registration-status': { antwort: RegistrationStatusResponse },
  'GET /api/v1/auth/profile': { antwort: ProfilResponse },
  'GET /api/v1/auth/zweiter-faktor': { antwort: ZweiterFaktorStand },
  'GET /api/v1/auth/me': { antwort: MeResponse },
  'GET /api/v1/settings/tokens': { antwort: TokensResponse },
  'POST /api/v1/auth/login': { antwort: LoginResponse, eingabe: Anmeldedaten },
  'POST /api/v1/auth/qr-login': { antwort: QrLoginResponse, eingabe: z.looseObject({ token: txt(200) }) },
  'POST /api/v1/auth/logout': { antwort: GenericResponse },
  'POST /api/v1/auth/register': { antwort: RegisterResponse, eingabe: Registrierung },
  'POST /api/v1/auth/forgot-password': { antwort: ForgotPasswordResponse, eingabe: z.looseObject({ email: txt(254) }) },
  'POST /api/v1/auth/bestaetigung-erneut': { antwort: ForgotPasswordResponse, eingabe: z.looseObject({ email: txt(254) }) },
  'PUT /api/v1/auth/profile': { antwort: ProfilGespeichert, eingabe: ProfilAenderung },
  'POST /api/v1/auth/change-password': { antwort: GenericResponse, eingabe: z.looseObject({ current: txt(PASSWORT), newPassword: txt(PASSWORT), code }) },
  'POST /api/v1/auth/zweiter-faktor/einrichten': { antwort: ZweiterFaktorEinrichtung, eingabe: NurPasswort },
  'POST /api/v1/auth/zweiter-faktor/bestaetigen': { antwort: ZweiterFaktorCodes, eingabe: NurPasswort },
  'POST /api/v1/auth/zweiter-faktor/abschalten': { antwort: GenericResponse, eingabe: NurPasswort },
  'POST /api/v1/auth/zweiter-faktor/codes': { antwort: ZweiterFaktorCodes, eingabe: NurPasswort },
  'DELETE /api/v1/settings/tokens/:tokenId': { antwort: TokenWiderruf },
  'POST /api/v1/auth/token-rotieren': { antwort: TokenRotation },
  'GET /api/v1/auth/users': { antwort: KontenListe },
  'POST /api/v1/auth/users': { antwort: Erfolg, eingabe: z.looseObject({ is_admin: eingabe.schalter('is_admin', false), username: txt(64), password: txt(PASSWORT), ...Verwalter }) },
  'PUT /api/v1/auth/users/:id/admin': { antwort: Erfolg, eingabe: z.looseObject({ is_admin: eingabe.schalter('is_admin'), ...Verwalter }) },
  'PUT /api/v1/auth/users/:id/aktiv': { antwort: KontoAktiv, eingabe: z.looseObject({ is_active: eingabe.schalter('is_active'), ...Verwalter }) },
  'PUT /api/v1/auth/users/:id/password': { antwort: Erfolg, eingabe: z.looseObject({ password: txt(PASSWORT), ...Verwalter }) },
  'DELETE /api/v1/auth/users/:id': { antwort: Erfolg },
  'DELETE /api/v1/auth/users/:id/zweiter-faktor': { antwort: Erfolg },
  'POST /api/v1/auth/token-create': { antwort: TokenErstellt, eingabe: z.looseObject({ password: txt(PASSWORT), scope: txt(20) }) },
  'POST /api/v1/auth/qr-token': { antwort: QrToken, eingabe: z.looseObject({ password: txt(PASSWORT) }) },
  'POST /api/v1/auth/reset-password': { antwort: ForgotPasswordResponse, eingabe: z.looseObject({ token: txt(200), password: txt(PASSWORT) }) },
  'GET /api/v1/auth/passkeys': { antwort: PasskeyListe },
  'DELETE /api/v1/auth/passkeys/:id': { antwort: Geloescht, eingabe: NurPasswort },
  'POST /api/v1/auth/passkey/registrieren/optionen': { antwort: PasskeyOptionen },
  'POST /api/v1/auth/passkey/registrieren': { antwort: PasskeyAngelegt, eingabe: z.looseObject({ name: txtLeer(100) }) },
  'POST /api/v1/auth/passkey/anmelden/optionen': { antwort: PasskeyOptionen },
  'POST /api/v1/auth/passkey/anmelden': { antwort: PasskeyAnmeldung },
  'POST /api/v1/settings/sessions/andere-beenden': { antwort: Geloescht },
} satisfies Record<string, Route>;
