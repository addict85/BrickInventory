/** Anmeldung und Geräte-Tokens. Der Token-Cache spart je Anfrage zwei
 * Datenbank-Rundläufe, weil die App beim Öffnen viele Anfragen parallel feuert. */
import * as passwortRegel from '../infra/passwortRegel';
import { konfig } from '../infra/konfig';
import * as db from '../../db/database';
import * as pgNotify from '../../db/pgNotify';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { passwortPasst, BcryptUeberlast } from './bcryptSchranke';
import { checkLoginAllowed, bekannteAnmeldung, gibAnmeldeplatzFrei, recordLoginFailure, recordLoginSuccess, meldeAnmeldeereignis, meldeAnmeldung, MAX_ATTEMPTS } from './loginLimiter';
import type { Anmeldeereignis, Anmeldeweg } from './loginLimiter';
import { kontoGedrosselt } from './zielDrossel';
import * as zf from './zweiterFaktor';
import * as passkeys from './passkeys';
import * as V from '../infra/validate';
import type { FehlerArt, FehlerCode } from '../infra/fehlerTexte';
import * as repo from './repository/zugaenge';
import * as kontenRepo from './repository/konten';
import type { TokenScope } from './repository/zugaenge';
import { erhoeheSitzungsVersion } from './sitzungsVersion';
import { hinweisNebenher } from './kontoHinweis';
import { zaehleFehlversuch, zuVieleFehlversuche } from './tokenFehlversuche';

export type { TokenScope };

/** Typisiert, weil ein vertippter Feldname `undefined` liefert und das in einer
 * Sicherheitsprüfung still als „nein" durchgeht. */
export interface TokenBenutzer {
  user_id: number;
  username: string;
  is_admin?: number;
  /** Die GLEITENDE Frist: „so lange ungenutzt" (siehe _touchLastUsed). */
  expires_at?: string | Date | null;
  /** Die FESTE Frist, falls beim QR-Code eine gewählt wurde. `null` = keine. */
  hard_expires_at?: string | Date | null;
  last_used?: string | Date | null;
  sliding?: boolean;
  never_expires?: boolean;
  scope: TokenScope;
  rotiert_am?: string | Date | null;
  vorgaenger?: string | null;
  [k: string]: unknown;
}

interface CacheEintrag {
  user: TokenBenutzer;
  cachedAt: number;
  dbKey: string;
  /** Ein Schreibvorgang läuft schon; ein zweiter wäre derselbe. */
  schreibt?: boolean;
}

export interface KontoZustand {
  is_active: boolean;
  email_verified: boolean;
  email?: string | null;
  is_admin: boolean;
  registrierung_offen?: boolean;
  [k: string]: unknown;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Leer zählt wie „nicht da": Der Hash eines leeren Strings ist ein gültiger
 * SHA-256-Wert. */
export async function verifiziereEmailToken(token: unknown): Promise<{ ok: boolean; grund?: string; userId?: number }> {
  if (token === undefined || token === null || String(token).trim() === '') {
    return { ok: false, grund: 'fehlt' };
  }
  const neu = await kontenRepo.uebernimmEmailNeu(hashToken(String(token)));
  if (!neu) return { ok: false, grund: 'ungueltig' };
  return neu.ok ? { ok: true, userId: neu.id } : { ok: false, grund: 'vergeben', userId: neu.id };
}

/** Obergrenze für einen Eintrag; ein Widerruf leert ihn sofort (NOTIFY). */
export const TOKEN_TTL_MS = 5 * 1000;
const TAG_MS = 86_400_000;

/** Ab 30 Tagen meldet jede Antwort die Rotation; ein unbegrenzter Token gilt
 * nach 60 Tagen nur noch für den Tausch — so stirbt eine gestohlene Kopie,
 * sobald das echte Gerät tauscht, und ein Gerät, das nie tauscht, fällt auf. */
export const ROTATION_FAELLIG_TAGE = 30;
export const ROTATION_PFLICHT_TAGE = 60;
/** Falls die Antwort des Tauschs verloren geht. */
export const UEBERLAPPUNG_MS = 5 * 60 * 1000;
/** So lange nach dem Ende der Überlappung gilt ein alter Token als Nachzügler, nicht als Kopie. */
export const WIEDERVERWENDUNG_SCHONFRIST_S = 60;

const _tokenCache = new Map<string, CacheEintrag>();
/** Zählt jedes Leeren: Eine Zeile, die vor einem Widerruf gelesen wurde, kommt danach nicht mehr hinein. */
let _stand = 0;
function leere(): void { _tokenCache.clear(); _stand++; }

function _pruneCache() {
  if (_tokenCache.size <= 200) return;
  const cutoff = Date.now() - TOKEN_TTL_MS;
  for (const [k, v] of _tokenCache) {
    if (v.cachedAt < cutoff) _tokenCache.delete(k);
  }
}

/** `null` heisst „unbegrenzt", nicht „sofort abgelaufen". */
function fristErreicht(zeitpunkt: string | Date | null | undefined, jetzt: number): boolean {
  return !!zeitpunkt && new Date(zeitpunkt).getTime() <= jetzt;
}

const tageSeit = (zeitpunkt: string | Date | null | undefined, jetzt: number): number =>
  zeitpunkt ? (jetzt - new Date(zeitpunkt).getTime()) / TAG_MS : 0;

export function rotationFaellig(u: TokenBenutzer, jetzt = Date.now()): boolean {
  return tageSeit(u.rotiert_am, jetzt) >= ROTATION_FAELLIG_TAGE;
}

export function rotationPflicht(u: TokenBenutzer, jetzt = Date.now()): boolean {
  return u.never_expires === true && tageSeit(u.rotiert_am, jetzt) >= ROTATION_PFLICHT_TAGE;
}

/** /24 bzw. /48: genug, um ein fremdes Netz zu erkennen; die genaue Adresse
 * wird nicht gespeichert. */
export function ipBereich(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!ip.includes(':')) return null;
  const [kopf = '', rest] = ip.split('::');
  const teile = kopf ? kopf.split(':') : [];
  // „a::b" hat links weniger als drei Gruppen: die fehlenden sind Nullen.
  while (teile.length < 3 && rest !== undefined) teile.push('0');
  if (teile.length < 3 || teile.slice(0, 3).some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${teile.slice(0, 3).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/48`;
}

export interface TokenPruefung { nutzer: TokenBenutzer | null; grund?: 'token_rotation_noetig' | 'zu_viele_anfragen' }

/** `zweck: 'rotation'` lässt einen unbegrenzten Token auch nach der
 * Pflichtfrist durch — nur für den Tausch selbst. */
export async function pruefeToken(token: string | null | undefined,
                           o: { ip?: string | null | undefined; zweck?: 'nutzung' | 'rotation' } = {}): Promise<TokenPruefung> {
  if (!token) return { nutzer: null };
  const now = Date.now();
  const ergebnis = (u: TokenBenutzer): TokenPruefung =>
    o.zweck !== 'rotation' && rotationPflicht(u, now)
      ? { nutzer: null, grund: 'token_rotation_noetig' } : { nutzer: u };

  const nutzbar = cacheNutzbar(), stand = _stand;
  const hit = nutzbar ? _tokenCache.get(token) : undefined;
  if (hit && now - hit.cachedAt < TOKEN_TTL_MS) {
    // Beide Fristen auch hier: Dieser Zweig fragt die Datenbank nicht.
    if (fristErreicht(hit.user.expires_at, now) || fristErreicht(hit.user.hard_expires_at, now)) {
      _tokenCache.delete(token);
      return { nutzer: null };
    }
    _touchLastUsed(hit, o.ip);
    return ergebnis(hit.user);
  }

  // Erst nach dem Cache: Wer einen gültigen Token im Cache hat, wird nie gebremst.
  if (zuVieleFehlversuche(o.ip)) return { nutzer: null, grund: 'zu_viele_anfragen' };
  const hashed = hashToken(token);
  const row: TokenBenutzer | undefined = await repo.gueltigerToken(hashed);
  if (!row) {
    _tokenCache.delete(token);
    if (!await meldeWiederverwendung(hashed)) await zaehleFehlversuch(o.ip);
    return { nutzer: null };
  }
  // Verwalterrecht nur mit Scope `voll`, an dieser einen Stelle entschieden,
  // damit alle Wächter es gleich sehen.
  row.is_admin = row.konto_is_admin && row.scope === 'voll' ? 1 : 0;
  if (row.vorgaenger) {
    await repo.beendeUeberlappung(row.vorgaenger, hashed);
    row.vorgaenger = null;
    leereTokenCache();
  }

  const entry: CacheEintrag = { user: row, cachedAt: now, dbKey: hashed };
  if (nutzbar && stand === _stand) _tokenCache.set(token, entry);
  _pruneCache();
  _touchLastUsed(entry, o.ip);
  return ergebnis(row);
}

/** Ein ersetzter Token kam nach der Schonfrist wieder: Familie sperren, Inhaber benachrichtigen. */
async function meldeWiederverwendung(hash: string): Promise<boolean> {
  const z = await repo.sperreFamilie(hash, WIEDERVERWENDUNG_SCHONFRIST_S);
  if (!z) return false;
  leereTokenCache();
  console.warn(`[tokens] ersetzter Token erneut benutzt — Familie von Konto ${z.user_id} gesperrt`);
  hinweisNebenher(z.user_id, 'token_wiederverwendet', z.label ?? undefined);
  return true;
}

export async function validateToken(token: string | null | undefined,
                             o: { ip?: string | null | undefined; zweck?: 'nutzung' | 'rotation' } = {}): Promise<TokenBenutzer | null> {
  return (await pruefeToken(token, o)).nutzer;
}

/** Höchstens einmal je Tag und Token, ohne den Anfrageweg aufzuhalten. Die
 * Entscheidung fällt am gelesenen Datensatz, damit sie über mehrere Worker
 * gilt; die WHERE-Klausel fängt den Wettlauf. */
function _touchLastUsed(entry: CacheEintrag, ip?: string | null): void {
  const jetzt = Date.now();
  const u = entry.user;
  const zuletzt = u.last_used ? new Date(u.last_used).getTime() : 0;
  const ziel = jetzt + TOKEN_IDLE_DAYS * TAG_MS;
  const fristHinkt = u.sliding === true && !!u.expires_at
    && new Date(u.expires_at).getTime() < ziel - TAG_MS;
  if ((jetzt - zuletzt < TAG_MS && !fristHinkt) || entry.schreibt) return;
  entry.schreibt = true;
  void repo.beruehreToken(entry.dbKey, TOKEN_IDLE_DAYS, ipBereich(ip))
    .then(() => {
      // Den Cache mitziehen, sonst wiese der Treffer-Zweig einen gerade
      // erneuerten Token am alten Fristende einmal ab.
      u.last_used = new Date(jetzt);
      if (fristHinkt || (u.sliding === true && u.expires_at)) u.expires_at = new Date(ziel);
    })
    .catch(e => console.warn('[auth] last_used konnte nicht geschrieben werden:', e?.message || e))
    .finally(() => { entry.schreibt = false; });
}

/** Damit der Token sofort ungültig wird, nicht erst nach Ablauf des Caches. */
export function invalidateToken(token: string | null | undefined): void {
  if (!token) return;
  _tokenCache.delete(token);
  _stand++;
  meldeWiderruf();
}

/** Jeder Web-Prozess hält seinen eigenen Cache; ein Widerruf leert ihn in allen.
 * Ohne stehende Horch-Verbindung käme ein fremder Widerruf nicht an: Dann gilt
 * nur die Datenbank (fail closed). */
const WIDERRUF_KANAL = 'token_widerrufen';
let _verteilt = false;
export function horcheAufTokenWiderruf(): void {
  _verteilt = true;
  pgNotify.listen(WIDERRUF_KANAL, leere);
}
function cacheNutzbar(): boolean {
  if (_verteilt && pgNotify.hoertZu(WIDERRUF_KANAL)) return true;
  leere();
  return false;
}
function meldeWiderruf(): void {
  if (_verteilt) void pgNotify.notify(WIDERRUF_KANAL);
}

/** Für Löschungen ohne Klartext (die Token-Verwaltung kennt nur den
 * Hash-Anfang). Den Cache hält nur der Web-Prozess. */
export function leereTokenCache(): void {
  leere();
  meldeWiderruf();
}

export const BCRYPT_ROUNDS = 12;

/** Eine Konstante, damit alle Routen, die ein Passwort setzen, dieselbe Länge prüfen. */
export const PASSWORT_MIN_ZEICHEN = passwortRegel.PASSWORT_MIN_ZEICHEN;
export const passwortZuKurz = passwortRegel.passwortZuKurz;

export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/** Ein Name ist Freitext, aber kein Träger für Adressen oder Zeilenumbrüche:
 * Er steht in Oberflächen und Exporten, wo ein Link wie vom Server aussähe. */
export function nameGueltig(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true;
  const s = String(v);
  return s.length <= 100 && !/[\p{Cc}\u2028\u2029]/u.test(s) && !/:\/\/|www\.|https?:/i.test(s);
}

/** Geräte- und Passkey-Namen stehen wörtlich in den Hinweismails: Ohne Adressen und
 * Anführungszeichen fügt ein Eindringling dort keinen entwarnenden Satz mit Link an. */
export function geraeteNameGueltig(v: unknown): boolean {
  return nameGueltig(v) && geraeteNameInhaltGueltig(v);
}

/** Dieselbe Regel ohne Länge: Token-Labels der Anmeldung werden gekürzt statt abgewiesen. */
export function geraeteNameInhaltGueltig(v: unknown): boolean {
  if (typeof v !== 'string') return true;
  return !/[\p{Cc}\u2028\u2029]/u.test(v) && !/:\/\/|www\.|https?:/i.test(v)
    && !/["'`«»„“”‚‘’<>]/u.test(v) && !/[\p{L}\d-]\.\p{L}{2,}(?![\p{L}\d])/u.test(v);
}

export const EMAIL_RE = V.EMAIL_RE, emailGueltig: typeof V.emailGueltig = V.emailGueltig;

/** Name ODER E-Mail, weil die Anmeldung in beiden Spalten sucht. */
export function isValidLoginIdentifier(value: unknown): boolean {
  const v = String(value || '');
  return USERNAME_RE.test(v) || emailGueltig(v);
}

/** Nach erfolgreicher Passwortprüfung. Die Absage kommt als CODE, weil die
 * Route weiss, welche Sprache der Anfragende sieht.
 * @returns null = Login erlaubt */
export function assertLoginAllowed(user: KontoZustand):
    { art: FehlerArt; code: FehlerCode; unverified?: boolean } | null {
  if (!user.is_active)
    return { art: 'verboten', code: 'konto_deaktiviert' };
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

export type AnmeldeErgebnis =
  | { ok: true; user: Record<string, any> }
  | { ok: false; absage: AnmeldeAbsage };

export interface Herkunft { ip?: string | null }

/** Die einzige Stelle, an der Anmeldedaten geprüft werden: Zwei Fassungen für
 * Webapp und App waren schon einmal auseinandergelaufen.
 * @param username Benutzername ODER E-Mail-Adresse. */
export async function pruefeAnmeldedaten(herkunft: Herkunft, username: unknown, password: unknown, code?: unknown,
                                  passkeyAntwort?: unknown): Promise<AnmeldeErgebnis> {
  const absage = (art: FehlerArt, code: FehlerCode,
                  vars?: Record<string, string | number>, unverified?: boolean,
                  zweiterFaktor?: boolean): AnmeldeErgebnis =>
    ({ ok: false, absage: { art, code, ...(vars ? { vars } : {}),
                            ...(unverified ? { unverified: true } : {}),
                            ...(zweiterFaktor ? { zweiterFaktor: true } : {}) } });

  if (!username || !password)
    return absage('ungueltig', 'benutzername_passwort');
  if (!isValidLoginIdentifier(username))
    return absage('ungueltig', 'name_oder_email_eingeben');

  const ip = herkunft.ip || '?';
  const name = String(username);
  const gesperrt = await checkLoginAllowed(ip, name);
  if (gesperrt) {
    meldeAnmeldeereignis('anmeldung_gesperrt', { ip, konto: (await repo.kontoZurAnmeldung(name))?.id ?? null });
    return absage('zu_viele', gesperrt.code, gesperrt.vars);
  }

  const user = await repo.kontoZurAnmeldung(name);
  // Auch ohne Treffer, gegen DUMMY_HASH: gleiche Zeit für unbekannte Namen. Wer sich von
  // hier zuletzt angemeldet hat, wartet unter Last vorne: Eine Flut fremder Adressen sperrt ihn nicht aus.
  const vorrang = await bekannteAnmeldung(ip, name);
  let passtDasPasswort: boolean;
  try { passtDasPasswort = await passwortPasst(password, user?.password_hash || DUMMY_HASH, vorrang); }
  catch (e) {
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
    const ergaenzt = (e: AnmeldeErgebnis) => { if (!e.ok && hatPasskey) e.absage.passkey = true; return e; };
    if (!mitPasskey && !String(code ?? '').trim()) {
      // Das Passwort stimmte; nur der Code fehlt noch — kein Fehlversuch.
      await gibAnmeldeplatzFrei(ip, name);
      return ergaenzt(absage('nicht_angemeldet', 'zweiter_faktor_noetig', undefined, false, true));
    }
    const gilt = mitPasskey
      ? await passkeys.anmeldungPruefen(passkeyAntwort, 'zweiter_faktor', user.id) === user.id
      : await zf.pruefeCode(user.id, code);
    if (!gilt) {
      await fehlversuch('zweiter_faktor_falsch', ip, name, user.id);
      return ergaenzt(absage('nicht_angemeldet', 'zweiter_faktor_falsch', undefined, false, true));
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
  if (await recordLoginFailure(ip, name) !== MAX_ATTEMPTS || konto === undefined) return;
  if (!await kontoGedrosselt('sperr-hinweis', konto, 1, TAG_MS)) hinweisNebenher(konto, 'anmeldung_gebremst');
}

/** Ohne das löscht ein "%" als tokenId alle Tokens des Nutzers auf einmal. */
export function escapeLike(s: unknown): string { return String(s ?? '').replace(/([%_\\])/g, '\\$1'); }

/** 0, weil null schon „nichts gewählt, Gleitfrist" heisst und beide mit der
 * Nonce in einem Feld reisen. */
export const UNBEGRENZT = 0;

/** „unbegrenzt" ist nicht die Vorgabe: Es nimmt die einzige selbsttätige
 * Reissleine für ein verlorenes Gerät weg. */
const TOKEN_LAUFZEITEN: Record<string, number> = {
  '1m':  30,
  '2m':  60,
  '6m':  180,
  '12m': 365,
  'unbegrenzt': UNBEGRENZT,
};

/** ausTabelle statt direktem Zugriff: 'constructor' lieferte sonst eine geerbte Funktion.
 * @returns Tage, oder null für „keine feste Frist" */
export function laufzeitTage(wahl: unknown): number | null {
  if (wahl === undefined || wahl === null || wahl === '') return null;
  return V.ausTabelle(TOKEN_LAUFZEITEN, String(wahl)) ?? null;
}

export interface TokenOptionen {
  /** Vorgabe `app`: Verwalterrechte gibt es nur auf ausdrücklichen Wunsch. */
  scope?: TokenScope;
  ip?: string | null | undefined;
}

/** @param dauerhaft  true = Gerätezugang mit Gleitfrist; false = sieben feste
 *                   Tage — Benutzung durch einen Angreifer soll ihn nicht verlängern.
 * @param festeTage  `UNBEGRENZT` (0) = ohne Ablauf, nur über HTTPS und mit Rotationspflicht. */
export async function createToken(userId: number, label = 'Android App', dauerhaft = false,
                           festeTage: number | null = null, o: TokenOptionen = {}): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  await repo.legeTokenAn({
    hash, userId, label, scope: o.scope === 'voll' ? 'voll' : 'app', bereich: ipBereich(o.ip),
    art: !dauerhaft ? 'kurz' : festeTage === UNBEGRENZT ? 'unbegrenzt' : 'gleitend',
    leerlaufTage: TOKEN_IDLE_DAYS, festeTage: festeTage && festeTage > 0 ? festeTage : null,
  });
  if (await repo.kappeTokens(userId, hash, ZUGAENGE_HOECHSTENS - 1)) leereTokenCache();
  return token;
}

/** Je Konto und Art (Sitzung, Token): Anmelden darf die Tabellen nicht beliebig füllen.
 * Es fällt der am längsten unbenutzte Zugang. */
export const ZUGAENGE_HOECHSTENS = 50;
export function begrenzeSitzungen(userId: number, eigene: string): Promise<number> {
  return repo.kappeSitzungen(userId, eigene, ZUGAENGE_HOECHSTENS - 1);
}

export interface Tausch {
  token: string;
  scope: TokenScope;
  expires_at: Date | null;
  hard_expires_at: Date | null;
  never_expires: boolean;
  rotiert_am: Date;
  alt_gueltig_bis: Date;
}

/** Ein zweiter Tausch so kurz danach ist gleichzeitig (409), keine verlorene Antwort. */
export const TAUSCH_SPERRE_S = 30;

/** Der alte gilt danach höchstens UEBERLAPPUNG_MS. Ein zweiter Tausch ersetzt den unbenutzten
 * Nachfolger nur aus demselben Netz (sonst Kopie: Familie endet) und erst nach TAUSCH_SPERRE_S. */
export async function rotiereToken(alt: string, ip?: string | null): Promise<Tausch | null | 'laeuft'> {
  const altHash = hashToken(alt);
  const neu = crypto.randomBytes(32).toString('hex');
  const neuHash = hashToken(neu);
  let kopie: { user_id: number; label: string | null } | null = null;
  const ergebnis = await db.transaction(async (tx) => {
    const z = await repo.tauschQuelleSperren(tx, altHash);
    if (!z) return null;
    const offen = z.ersetzt_durch ? await repo.unbenutzterNachfolger(tx, z.ersetzt_durch, altHash) : undefined;
    const bereich = ipBereich(ip);
    if (offen && offen.ip_bereich && bereich && offen.ip_bereich !== bereich) {
      await repo.loescheFamilie(tx, z.user_id, z.created_at);
      kopie = { user_id: z.user_id, label: z.label };
      return null;
    }
    if (offen && offen.alter_s < TAUSCH_SPERRE_S) return 'laeuft' as const;
    if (z.ersetzt_durch) await repo.loescheUnbenutztenNachfolger(tx, z.ersetzt_durch, altHash);
    const zeile = await repo.legeNachfolgerAn(tx, neuHash, altHash, z, TOKEN_IDLE_DAYS, ipBereich(ip));
    const vorher = await repo.befristeVorgaenger(tx, altHash, neuHash, UEBERLAPPUNG_MS / 1000);
    return { token: neu, scope: z.scope, expires_at: zeile!.expires_at, hard_expires_at: zeile!.hard_expires_at,
             never_expires: z.never_expires, rotiert_am: zeile!.rotiert_am,
             alt_gueltig_bis: vorher!.expires_at };
  });
  if (ergebnis || kopie) leereTokenCache();
  if (kopie) {
    const k: { user_id: number; label: string | null } = kopie;
    console.warn(`[tokens] zweiter Tausch aus einem anderen Netz — Familie von Konto ${k.user_id} gesperrt`);
    hinweisNebenher(k.user_id, 'token_wiederverwendet', k.label ?? undefined);
  }
  return ergebnis;
}

export async function deleteToken(token: string): Promise<void> {
  if (!token) return;
  await repo.loescheToken(hashToken(token));
  invalidateToken(token);
}

/** In user_sessions, wo der Session-Store wirklich liegt. */
export async function revokeAllSessions(userId: number): Promise<void> {
  await erhoeheSitzungsVersion(userId);
  await repo.loescheSitzungenDesKontos(userId);
}

/** Nach dem Einschalten des zweiten Faktors: Wer schon drin war, soll nicht
 * mit einem alten Token oder einer alten Sitzung drinbleiben. */
export async function beendeAndereZugaenge(userId: number, aktuellerToken: string | null, sitzungsId: string | null): Promise<number> {
  await repo.loescheTokensDesKontos(userId, aktuellerToken ? hashToken(aktuellerToken) : null);
  leereTokenCache();
  const version = await erhoeheSitzungsVersion(userId);
  await repo.loescheSitzungenDesKontos(userId, sitzungsId);
  return version;
}

/** Ohne Fang: ein Sicherheitsschritt. Scheitert er still, meldet der Aufrufer
 * Erfolg, während die alten Tokens weitergelten. */
export async function revokeAllTokens(userId: number): Promise<void> {
  await repo.loescheTokensDesKontos(userId);
  leereTokenCache();
}

/** Gerätezugänge haben kein festes Ende; diese Frist begrenzt, wie lange ein
 * vergessenes Gerät gilt. */
export const TOKEN_IDLE_DAYS = konfig().tokenLeerlaufTage;

/** Altzeilen ohne Ablaufdatum bekommen vorher ihre Gleitfrist, damit sie nach
 * derselben Regel fallen wie neue. */
export async function purgeExpiredTokens() {
  const warn = (was: string) => (e: Error) => { console.warn(`[tokens] ${was}:`, e?.message || e); return 0; };
  const m = await repo.ziehAltzeilenNach(TOKEN_IDLE_DAYS).catch(warn('Altzeilen nachziehen'));
  if (m) console.log(`[tokens] ${m} Token ohne Ablaufdatum auf die Gleitfrist von ${TOKEN_IDLE_DAYS} Tagen gesetzt`);
  const abgelaufen = await repo.loescheAbgelaufene().catch(warn('Aufräumen abgelaufener Tokens'));
  const n = await repo.loescheUngenutzte(TOKEN_IDLE_DAYS).catch(warn('Aufräumen ungenutzter Tokens'));
  await repo.loescheVerwaisteVerbrauchte().catch(warn('Aufräumen verbrauchter Tokens'));
  if (n) console.log(`[tokens] ${n} Token seit über ${TOKEN_IDLE_DAYS} Tagen ungenutzt — entfernt`);
  return abgelaufen + n;
}
