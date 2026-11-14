/** Der Zwischenspeicher geprüfter Geräte-Tokens. Er spart je Anfrage zwei
 * Datenbank-Rundläufe, weil die App beim Öffnen viele Anfragen parallel feuert;
 * gelten darf er nur, solange ein Widerruf ihn sicher erreicht. */
import type { TokenScope } from './repository/zugaenge';
import { meldeZugangsAenderung } from './zugangsAenderung';
import type { KontoKontext } from './kontext';

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

/** Je Zugang: Ein Token gilt nur in der Datenbank, aus der er stammt. `stand` zählt
 * jedes Leeren: Eine Zeile, die vor einem Widerruf gelesen wurde, kommt danach nicht mehr hinein. */
const speicher = (k: KontoKontext) =>
  k.faecher.fach('tokenCache', () => ({ eintraege: new Map<string, CacheEintrag>(), stand: 0, verteilt: false }));

function leere(k: KontoKontext): void {
  const c = speicher(k);
  c.eintraege.clear();
  c.stand++;
  meldeZugangsAenderung();
}

function _pruneCache(k: KontoKontext) {
  const { eintraege } = speicher(k);
  if (eintraege.size <= 200) return;
  const cutoff = Date.now() - TOKEN_TTL_MS;
  for (const [t, v] of eintraege) {
    if (v.cachedAt < cutoff) eintraege.delete(t);
  }
}

/** Der Stand vor dem Lesen, oder null, wenn der Cache gerade nicht gelten darf. */
export function cacheStand(k: KontoKontext): number | null {
  return cacheNutzbar(k) ? speicher(k).stand : null;
}

export function tokenAusCache(
  k: KontoKontext,
  token: string,
  stand: number | null,
  jetzt: number,
): CacheEintrag | undefined {
  if (stand === null) return undefined;
  const hit = speicher(k).eintraege.get(token);
  return hit && jetzt - hit.cachedAt < TOKEN_TTL_MS ? hit : undefined;
}

/** Nur, wenn seit dem Lesen kein Widerruf kam. */
export function merkeEintrag(k: KontoKontext, token: string, eintrag: CacheEintrag, stand: number | null): void {
  const c = speicher(k);
  if (stand !== null && stand === c.stand) c.eintraege.set(token, eintrag);
  _pruneCache(k);
}

export function vergissEintrag(k: KontoKontext, token: string): void {
  speicher(k).eintraege.delete(token);
}

/** Damit der Token sofort ungültig wird, nicht erst nach Ablauf des Caches. */
export function invalidateToken(k: KontoKontext, token: string | null | undefined): void {
  if (!token) return;
  const c = speicher(k);
  c.eintraege.delete(token);
  c.stand++;
  meldeZugangsAenderung();
  meldeWiderruf(k);
}

/** Jeder Web-Prozess hält seinen eigenen Cache; ein Widerruf leert ihn in allen.
 * Ohne stehende Horch-Verbindung käme ein fremder Widerruf nicht an: Dann gilt
 * nur die Datenbank (fail closed). */
const WIDERRUF_KANAL = 'token_widerrufen';
export function horcheAufTokenWiderruf(k: KontoKontext): void {
  speicher(k).verteilt = true;
  k.db.benachrichtigung.listen(WIDERRUF_KANAL, () => leere(k));
}
function cacheNutzbar(k: KontoKontext): boolean {
  if (speicher(k).verteilt && k.db.benachrichtigung.hoertZu(WIDERRUF_KANAL)) return true;
  leere(k);
  return false;
}
function meldeWiderruf(k: KontoKontext): void {
  if (speicher(k).verteilt) void k.db.benachrichtigung.notify(WIDERRUF_KANAL);
}

/** Für Löschungen ohne Klartext (die Token-Verwaltung kennt nur den
 * Hash-Anfang). Den Cache hält nur der Web-Prozess. */
export function leereTokenCache(k: KontoKontext): void {
  leere(k);
  meldeWiderruf(k);
}
