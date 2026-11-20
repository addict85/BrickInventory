/** Geräte-Tokens: ausstellen, prüfen, tauschen, widerrufen, aufräumen. */
import crypto from 'node:crypto';
import * as V from '../infra/validate';
import * as repo from './repository/zugaenge';
import type { TokenScope } from './repository/zugaenge';
import { hintInBackground } from './kontoHinweis';
import { countFailedAttempt, toManyFailedAttempts } from './tokenFehlversuche';
import { inSystemContext } from '../infra/kontoKontext';
import {
  cacheStand,
  tokenFromCache,
  rememberEntry,
  forgetEntry,
  tokenForgotten,
  emptyTokenCache,
  type CacheEntry,
  type TokenUser,
} from './tokenCache';
import type { AccountContext } from './kontext';
import { reportError } from '../infra/fehler';
import { fachfehler } from '../infra/fehlerTexte';
import { versuche } from '../infra/ergebnis';

export type { TokenScope, TokenUser };

/** Ob die Kennung (Präfix des gespeicherten Hashs) zum Token der Anfrage gehört. */
export function ownAccess(token: string | null, kennung: string): boolean {
  return !!token && tokenDigest(token).startsWith(kennung);
}

export function tokenDigest(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const TAG_MS = 86_400_000;

/** Gerätezugänge haben kein festes Ende; diese Frist begrenzt, wie lange ein
 * vergessenes Gerät gilt. */

/** Ab 30 Tagen meldet jede Antwort die Rotation; ein unbegrenzter Token gilt
 * nach 60 Tagen nur noch für den Tausch — so stirbt eine gestohlene Kopie,
 * sobald das echte Gerät tauscht, und ein Gerät, das nie tauscht, fällt auf. */
export const ROTATION_DUE_DAYS = 30;
export const ROTATION_REQUIRED_DAYS = 60;
/** Falls die Antwort des Tauschs verloren geht. */
export const OVERLAP_MS = 5 * 60 * 1000;
/** So lange nach dem Ende der Überlappung gilt ein alter Token als Nachzügler, nicht als Kopie. */
export const REUSE_GRACE_PERIOD_S = 60;

/** `null` heisst „unbegrenzt", nicht „sofort abgelaufen". */
function deadlineReached(zeitpunkt: string | Date | null | undefined, jetzt: number): boolean {
  return !!zeitpunkt && new Date(zeitpunkt).getTime() <= jetzt;
}

const daysSince = (zeitpunkt: string | Date | null | undefined, jetzt: number): number =>
  zeitpunkt ? (jetzt - new Date(zeitpunkt).getTime()) / TAG_MS : 0;

export function rotationDue(u: TokenUser, jetzt = Date.now()): boolean {
  return daysSince(u.rotated_at, jetzt) >= ROTATION_DUE_DAYS;
}

export function rotationRequired(u: TokenUser, jetzt = Date.now()): boolean {
  return u.never_expires === true && daysSince(u.rotated_at, jetzt) >= ROTATION_REQUIRED_DAYS;
}

/** /24 bzw. /48: genug, um ein fremdes Netz zu erkennen; die genaue Adresse
 * wird nicht gespeichert. */
export function ipArea(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = /^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/i.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (!ip.includes(':')) return null;
  const [kopf = '', rest] = ip.split('::');
  const teile = kopf ? kopf.split(':') : [];
  // „a::b" hat links weniger als drei Gruppen: die fehlenden sind Nullen.
  while (teile.length < 3 && rest !== undefined) teile.push('0');
  if (teile.length < 3 || teile.slice(0, 3).some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return `${teile
    .slice(0, 3)
    .map(g => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/48`;
}

export interface TokenCheck {
  nutzer: TokenUser | null;
  grund?: 'token_rotation_noetig' | 'zu_viele_anfragen';
}

/** `zweck: 'rotation'` lässt einen unbegrenzten Token auch nach der
 * Pflichtfrist durch — nur für den Tausch selbst. */
/** Für den Strom: lebt der Zugang noch? Gefragt wird mit dem Klartext, der Hash bleibt im Konto. */
export async function tokenGilt(k: AccountContext, klartext: string): Promise<boolean> {
  return !!(await k.zugaenge.validToken(tokenDigest(klartext)));
}

export async function pruefeToken(
  k: AccountContext,
  token: string | null | undefined,
  o: { ip?: string | null | undefined; zweck?: 'nutzung' | 'rotation' } = {},
): Promise<TokenCheck> {
  if (!token) return { nutzer: null };
  const now = k.uhr.jetzt();
  const ergebnis = (u: TokenUser): TokenCheck =>
    o.zweck !== 'rotation' && rotationRequired(u, now)
      ? { nutzer: null, grund: 'token_rotation_noetig' }
      : { nutzer: u };

  const stand = cacheStand(k);
  const hit = tokenFromCache(k, token, stand, now);
  if (hit) {
    // Beide Fristen auch hier: Dieser Zweig fragt die Datenbank nicht.
    if (deadlineReached(hit.user.expires_at, now) || deadlineReached(hit.user.hard_expires_at, now)) {
      forgetEntry(k, token);
      return { nutzer: null };
    }
    _touchLastUsed(k, hit, o.ip);
    return ergebnis(hit.user);
  }

  // Erst nach dem Cache: Wer einen gültigen Token im Cache hat, wird nie gebremst.
  if (toManyFailedAttempts(o.ip)) return { nutzer: null, grund: 'zu_viele_anfragen' };
  const hashed = tokenDigest(token);
  const row: TokenUser | undefined = await k.zugaenge.validToken(hashed);
  if (!row) {
    forgetEntry(k, token);
    if (!(await reportReuse(k, hashed))) await countFailedAttempt(k, o.ip);
    return { nutzer: null };
  }
  // Verwalterrecht nur mit Scope `voll`, an dieser einen Stelle entschieden,
  // damit alle Wächter es gleich sehen.
  row.is_admin = row.konto_is_admin === true && row.scope === 'voll';
  if (row.previous_token) {
    await k.zugaenge.endOverlap(row.previous_token, hashed);
    row.previous_token = null;
    emptyTokenCache(k);
  }

  const entry: CacheEntry = { user: row, cachedAt: now, dbKey: hashed };
  rememberEntry(k, token, entry, stand);
  _touchLastUsed(k, entry, o.ip);
  return ergebnis(row);
}

/** Ein ersetzter Token kam nach der Schonfrist wieder: Familie sperren, Inhaber benachrichtigen. */
async function reportReuse(k: AccountContext, hash: string): Promise<boolean> {
  const z = await k.zugaenge.lockFamily(hash, REUSE_GRACE_PERIOD_S);
  if (!z) return false;
  emptyTokenCache(k);
  console.warn(`[tokens] ersetzter Token erneut benutzt — Familie von Konto ${z.user_id} gesperrt`);
  hintInBackground(k, z.user_id, 'token_wiederverwendet', z.label ?? undefined);
  return true;
}

export async function nutzerZumToken(
  k: AccountContext,
  token: string | null | undefined,
  o: { ip?: string | null | undefined; zweck?: 'nutzung' | 'rotation' } = {},
): Promise<TokenUser | null> {
  return (await pruefeToken(k, token, o)).nutzer;
}

/** Höchstens einmal je Tag und Token, ohne den Anfrageweg aufzuhalten. Die
 * Entscheidung fällt am gelesenen Datensatz, damit sie über mehrere Worker
 * gilt; die WHERE-Klausel fängt den Wettlauf. */
function _touchLastUsed(k: AccountContext, entry: CacheEntry, ip?: string | null): void {
  const jetzt = k.uhr.jetzt();
  const u = entry.user;
  const zuletzt = u.last_used ? new Date(u.last_used).getTime() : 0;
  const ziel = jetzt + k.konfig.tokenIdleDays * TAG_MS;
  const deadlineLags = u.sliding === true && !!u.expires_at && new Date(u.expires_at).getTime() < ziel - TAG_MS;
  if ((jetzt - zuletzt < TAG_MS && !deadlineLags) || entry.schreibt) return;
  entry.schreibt = true;
  void k.zugaenge
    .touchToken(entry.dbKey, k.konfig.tokenIdleDays, ipArea(ip))
    .then(() => {
      // Den Cache mitziehen, sonst wiese der Treffer-Zweig einen gerade
      // erneuerten Token am alten Fristende einmal ab.
      u.last_used = new Date(jetzt);
      if (deadlineLags || (u.sliding === true && u.expires_at)) u.expires_at = new Date(ziel);
    })
    .catch((e: unknown) => reportError('token:last_used schreiben', e))
    .finally(() => {
      entry.schreibt = false;
    });
}

/** Ohne das löscht ein "%" als tokenId alle Tokens des Nutzers auf einmal. */
export function escapeLike(s: unknown): string {
  return String(s ?? '').replace(/([%_\\])/g, '\\$1');
}

/** 0, weil null schon „nichts gewählt, Gleitfrist" heisst und beide mit der
 * Nonce in einem Feld reisen. */
export const UNLIMITED = 0;

/** „unbegrenzt" ist nicht die Vorgabe: Es nimmt die einzige selbsttätige
 * Reissleine für ein verlorenes Gerät weg. */
const TOKEN_RUNTIMES: Record<string, number> = {
  '1m': 30,
  '2m': 60,
  '6m': 180,
  '12m': 365,
  unbegrenzt: UNLIMITED,
};

/** Die Wahlen, die der QR-Dialog anbieten darf. */
export const RUNTIME_CHOICES: readonly string[] = Object.freeze(Object.keys(TOKEN_RUNTIMES));

/** fromTable statt direktem Zugriff: 'constructor' lieferte sonst eine geerbte Funktion.
 * @returns Tage, oder null für „keine feste Frist" */
export function runtimeDays(wahl: unknown): number | null {
  if (wahl === undefined || wahl === null || wahl === '') return null;
  return V.fromTable(TOKEN_RUNTIMES, String(wahl)) ?? null;
}

export interface TokenOptions {
  /** Vorgabe `app`: Verwalterrechte gibt es nur auf ausdrücklichen Wunsch. */
  scope?: TokenScope;
  ip?: string | null | undefined;
}

/** Je Konto und Art (Sitzung, Token): Anmelden darf die Tabellen nicht beliebig füllen.
 * Es fällt der am längsten unbenutzte Zugang. */
export const ACCESSES_AT_MOST = 50;

/** @param dauerhaft  true = Gerätezugang mit Gleitfrist; false = sieben feste
 *                   Tage — Benutzung durch einen Angreifer soll ihn nicht verlängern.
 * @param fixedDays  `UNLIMITED` (0) = ohne Ablauf, nur über HTTPS und mit Rotationspflicht. */
export async function createToken(
  k: AccountContext,
  userId: number,
  label = 'Android App',
  dauerhaft = false,
  fixedDays: number | null = null,
  o: TokenOptions = {},
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = tokenDigest(token);
  await k.zugaenge.putTokenAn({
    hash,
    userId,
    label,
    scope: o.scope === 'voll' ? 'voll' : 'app',
    bereich: ipArea(o.ip),
    art: !dauerhaft ? 'kurz' : fixedDays === UNLIMITED ? 'unbegrenzt' : 'gleitend',
    idleDays: k.konfig.tokenIdleDays,
    fixedDays: fixedDays && fixedDays > 0 ? fixedDays : null,
  });
  if (await k.zugaenge.capTokens(userId, hash, ACCESSES_AT_MOST - 1)) emptyTokenCache(k);
  return token;
}

export interface Tausch {
  token: string;
  scope: TokenScope;
  expires_at: Date | null;
  hard_expires_at: Date | null;
  never_expires: boolean;
  rotated_at: Date;
  alt_gueltig_bis: Date;
}

/** Ein zweiter Tausch so kurz danach ist gleichzeitig (409), keine verlorene Antwort. */
export const SWAP_LOCK_S = 30;

/** Der alte gilt danach höchstens OVERLAP_MS. Ein zweiter Tausch ersetzt den unbenutzten
 * Nachfolger nur aus demselben Netz (sonst Kopie: Familie endet) und erst nach SWAP_LOCK_S. */
export async function rotateToken(kx: AccountContext, alt: string, ip?: string | null): Promise<Tausch | null> {
  const altHash = tokenDigest(alt);
  const neu = crypto.randomBytes(32).toString('hex');
  const newHash = tokenDigest(neu);
  let kopie: { user_id: number; label: string | null } | null = null;
  // Der Tausch kommt ohne Sitzung: Der alte Token ist der einzige Ausweis.
  const ergebnis = await inSystemContext('tokentausch', () =>
    kx.transaktion(async t => {
      const z = await repo.lockSwapSource(t.db, altHash);
      if (!z) return null;
      const offen = z.replaced_by ? await repo.unusedSuccessor(t.db, z.replaced_by, altHash) : undefined;
      const bereich = ipArea(ip);
      if (offen?.ip_range && bereich && offen.ip_range !== bereich) {
        await repo.deleteFamily(t.db, z.user_id, z.created_at);
        kopie = { user_id: z.user_id, label: z.label };
        return null;
      }
      if (offen && offen.alter_s < SWAP_LOCK_S) return 'laeuft' as const;
      if (z.replaced_by) await repo.deleteUnusedSuccessor(t.db, z.replaced_by, altHash);
      const zeile = await repo.putSuccessorAn(t.db, newHash, altHash, z, t.konfig.tokenIdleDays, ipArea(ip));
      const vorher = await repo.limitTimePredecessor(t.db, altHash, newHash, OVERLAP_MS / 1000);
      return {
        token: neu,
        scope: z.scope,
        expires_at: zeile!.expires_at,
        hard_expires_at: zeile!.hard_expires_at,
        never_expires: z.never_expires,
        rotated_at: zeile!.rotated_at,
        alt_gueltig_bis: vorher!.expires_at,
      };
    }),
  );
  if (ergebnis || kopie) emptyTokenCache(kx);
  if (kopie) {
    const k: { user_id: number; label: string | null } = kopie;
    console.warn(`[tokens] zweiter Tausch aus einem anderen Netz — Familie von Konto ${k.user_id} gesperrt`);
    hintInBackground(kx, k.user_id, 'token_wiederverwendet', k.label ?? undefined);
  }
  if (ergebnis === 'laeuft') fachfehler('konflikt', 'tausch_laeuft');
  return ergebnis;
}

export async function tokenLoeschen(k: AccountContext, token: string): Promise<void> {
  if (!token) return;
  await k.zugaenge.loescheToken(tokenDigest(token));
  tokenForgotten(k, token);
}

/** Ohne Fang: ein Sicherheitsschritt. Scheitert er still, meldet der Aufrufer
 * Erfolg, während die alten Tokens weitergelten. */
export async function revokeAllTokens(k: AccountContext, userId: number): Promise<void> {
  await k.zugaenge.deleteTokensOfAccount(userId);
  emptyTokenCache(k);
}

/** Altzeilen bekommen zuerst ihre Gleitfrist, damit sie fallen wie neue. Jeder Schritt
 * läuft; scheitert einer, wirft der Lauf danach, und das Aufräumen wiederholt ihn. */
export async function tokensCleanup(k: AccountContext) {
  const ohne: string[] = [];
  const schritt = async (was: string, work: () => Promise<number>) => {
    const r = await versuche(`tokens:${was}`, work);
    if (!r.ok) ohne.push(was);
    return r.ok ? r.wert : 0;
  };
  const m = await schritt('Altzeilen nachziehen', () => k.zugaenge.pullAltzeilenAfter(k.konfig.tokenIdleDays));
  if (m)
    console.log(`[tokens] ${m} Token ohne Ablaufdatum auf die Gleitfrist von ${k.konfig.tokenIdleDays} Tagen gesetzt`);
  const abgelaufen = await schritt('abgelaufene', () => k.zugaenge.deleteExpired());
  const n = await schritt('ungenutzte', () => k.zugaenge.deleteUnused(k.konfig.tokenIdleDays));
  await schritt('verbrauchte', () => k.zugaenge.deleteOrphanedConsumed());
  if (n) console.log(`[tokens] ${n} Token seit über ${k.konfig.tokenIdleDays} Tagen ungenutzt — entfernt`);
  if (ohne.length) throw new Error(`Token-Aufräumen ohne: ${ohne.join(', ')}`);
  return abgelaufen + n;
}
