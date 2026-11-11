/** Der Zwischenspeicher geprüfter Geräte-Tokens. Er spart je Anfrage zwei
 * Datenbank-Rundläufe, weil die App beim Öffnen viele Anfragen parallel feuert;
 * gelten darf er nur, solange ein Widerruf ihn sicher erreicht. */
import type { TokenScope } from './repository/zugaenge';
import { kontoBereich } from './prozess';

/** Typisiert, weil ein vertippter Feldname `undefined` liefert und das in einer
 * Sicherheitsprüfung still als „nein" durchgeht. */
export interface TokenBenutzer {
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
  rotiert_am?: string | Date | null;
  vorgaenger?: string | null;
  [k: string]: unknown;
}

export interface CacheEintrag {
  user: TokenBenutzer;
  cachedAt: number;
  dbKey: string;
  /** Ein Schreibvorgang läuft schon; ein zweiter wäre derselbe. */
  schreibt?: boolean;
}

/** Obergrenze für einen Eintrag; ein Widerruf leert ihn sofort (NOTIFY). */
export const TOKEN_TTL_MS = 5 * 1000;

const _tokenCache = new Map<string, CacheEintrag>();
/** Zählt jedes Leeren: Eine Zeile, die vor einem Widerruf gelesen wurde, kommt danach nicht mehr hinein. */
let _stand = 0;
function leere(): void {
  _tokenCache.clear();
  _stand++;
}

function _pruneCache() {
  if (_tokenCache.size <= 200) return;
  const cutoff = Date.now() - TOKEN_TTL_MS;
  for (const [k, v] of _tokenCache) {
    if (v.cachedAt < cutoff) _tokenCache.delete(k);
  }
}

/** Der Stand vor dem Lesen, oder null, wenn der Cache gerade nicht gelten darf. */
export function cacheStand(): number | null {
  return cacheNutzbar() ? _stand : null;
}

export function tokenAusCache(token: string, stand: number | null, jetzt: number): CacheEintrag | undefined {
  if (stand === null) return undefined;
  const hit = _tokenCache.get(token);
  return hit && jetzt - hit.cachedAt < TOKEN_TTL_MS ? hit : undefined;
}

/** Nur, wenn seit dem Lesen kein Widerruf kam. */
export function merkeEintrag(token: string, eintrag: CacheEintrag, stand: number | null): void {
  if (stand !== null && stand === _stand) _tokenCache.set(token, eintrag);
  _pruneCache();
}

export function vergissEintrag(token: string): void {
  _tokenCache.delete(token);
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
  kontoBereich().db.benachrichtigung.listen(WIDERRUF_KANAL, leere);
}
function cacheNutzbar(): boolean {
  if (_verteilt && kontoBereich().db.benachrichtigung.hoertZu(WIDERRUF_KANAL)) return true;
  leere();
  return false;
}
function meldeWiderruf(): void {
  if (_verteilt) void kontoBereich().db.benachrichtigung.notify(WIDERRUF_KANAL);
}

/** Für Löschungen ohne Klartext (die Token-Verwaltung kennt nur den
 * Hash-Anfang). Den Cache hält nur der Web-Prozess. */
export function leereTokenCache(): void {
  leere();
  meldeWiderruf();
}
