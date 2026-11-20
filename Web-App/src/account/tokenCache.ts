/** Der Zwischenspeicher geprüfter Geräte-Tokens. Er spart je Anfrage zwei
 * Datenbank-Rundläufe, weil die App beim Öffnen viele Anfragen parallel feuert;
 * gelten darf er nur, solange ein Widerruf ihn sicher erreicht. */
import type { TokenScope } from './repository/accesses';
import { reportAccessChange } from './accessChange';
import { processEvent } from '../infra/event';
import type { AccountContext } from './context';

/** Typisiert, weil ein vertippter Feldname `undefined` liefert und das in einer
 * Sicherheitsprüfung still als „nein" durchgeht. */
export interface TokenUser {
  user_id: number;
  username: string;
  is_admin?: boolean;
  /** Die GLEITENDE Frist: „so lange ungenutzt". */
  expires_at?: string | Date | null;
  /** Die FESTE Frist, falls beim QR-Code eine gewählt wurde. `null` = keine. */
  hard_expires_at?: string | Date | null;
  last_used?: string | Date | null;
  sliding?: boolean;
  never_expires?: boolean;
  scope: TokenScope;
  rotated_at?: string | Date | null;
  previous_token?: string | null;
  [k: string]: unknown;
}

export interface CacheEntry {
  user: TokenUser;
  cachedAt: number;
  dbKey: string;
  /** Ein Schreibvorgang läuft schon; ein zweiter wäre derselbe. */
  schreibt?: boolean;
}

/** Obergrenze für einen Eintrag; ein Widerruf leert ihn sofort (NOTIFY). */
export const TOKEN_TTL_MS = 5 * 1000;

/** Je Zugang: Ein Token gilt nur in der Datenbank, aus der er stammt. `stand` zählt
 * jedes Leeren: Eine Zeile, die vor einem Widerruf gelesen wurde, kommt danach nicht mehr hinein. */
const speicher = (k: AccountContext) =>
  k.faecher.fach('tokenCache', () => ({ eintraege: new Map<string, CacheEntry>(), stand: 0, verteilt: false }));

function leere(k: AccountContext): void {
  const c = speicher(k);
  c.eintraege.clear();
  c.stand++;
  reportAccessChange();
}

function _pruneCache(k: AccountContext) {
  const { eintraege } = speicher(k);
  if (eintraege.size <= 200) return;
  const cutoff = k.uhr.jetzt() - TOKEN_TTL_MS;
  for (const [t, v] of eintraege) {
    if (v.cachedAt < cutoff) eintraege.delete(t);
  }
}

/** Der Stand vor dem Lesen, oder null, wenn der Cache gerade nicht gelten darf. */
export function cacheStand(k: AccountContext): number | null {
  return tokenCacheUsable(k) ? speicher(k).stand : null;
}

export function tokenFromCache(
  k: AccountContext,
  token: string,
  stand: number | null,
  jetzt: number,
): CacheEntry | undefined {
  if (stand === null) return undefined;
  const hit = speicher(k).eintraege.get(token);
  return hit && jetzt - hit.cachedAt < TOKEN_TTL_MS ? hit : undefined;
}

/** Nur, wenn seit dem Lesen kein Widerruf kam. */
export function rememberEntry(k: AccountContext, token: string, eintrag: CacheEntry, stand: number | null): void {
  const c = speicher(k);
  if (stand !== null && stand === c.stand) c.eintraege.set(token, eintrag);
  _pruneCache(k);
}

export function forgetEntry(k: AccountContext, token: string): void {
  speicher(k).eintraege.delete(token);
}

/** Damit der Token sofort ungültig wird, nicht erst nach Ablauf des Caches. */
export function tokenForgotten(k: AccountContext, token: string | null | undefined): void {
  if (!token) return;
  const c = speicher(k);
  c.eintraege.delete(token);
  c.stand++;
  reportAccessChange();
  reportRevocation(k);
}

/** Jeder Web-Prozess hält seinen eigenen Cache; ein Widerruf leert ihn in allen.
 * Ohne stehende Horch-Verbindung käme ein fremder Widerruf nicht an: Dann gilt
 * nur die Datenbank (fail closed). */
const REVOCATION_CHANNEL = 'token_widerrufen';
const revocation = (k: AccountContext) =>
  k.faecher.fach('tokenWiderruf', () => {
    const e = processEvent('tokenWiderruf', REVOCATION_CHANNEL);
    e.horche(() => leere(k));
    return e;
  });
export function listenOnTokenRevocation(k: AccountContext): void {
  speicher(k).verteilt = true;
  revocation(k).connect(k.db.notification);
}
function tokenCacheUsable(k: AccountContext): boolean {
  if (speicher(k).verteilt && k.db.notification.listensTo(REVOCATION_CHANNEL)) return true;
  leere(k);
  return false;
}
function reportRevocation(k: AccountContext): void {
  if (speicher(k).verteilt) void revocation(k).melde(k.db.notification);
}

/** Für Löschungen ohne Klartext (die Token-Verwaltung kennt nur den
 * Hash-Anfang). Den Cache hält nur der Web-Prozess. */
export function emptyTokenCache(k: AccountContext): void {
  leere(k);
  reportRevocation(k);
}
