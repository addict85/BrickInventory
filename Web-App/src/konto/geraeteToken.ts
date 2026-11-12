/** Geräte-Tokens: ausstellen, prüfen, tauschen, widerrufen, aufräumen. */
import { konfig } from '../infra/konfig';
import crypto from 'node:crypto';
import * as V from '../infra/validate';
import * as repo from './repository/zugaenge';
import type { TokenScope } from './repository/zugaenge';
import { hinweisNebenher } from './kontoHinweis';
import { zaehleFehlversuch, zuVieleFehlversuche } from './tokenFehlversuche';
import { kontoBereich } from './prozess';
import {
  cacheStand,
  tokenAusCache,
  merkeEintrag,
  vergissEintrag,
  invalidateToken,
  leereTokenCache,
  type CacheEintrag,
  type TokenBenutzer,
} from './tokenCache';

export type { TokenScope, TokenBenutzer };

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const TAG_MS = 86_400_000;

/** Gerätezugänge haben kein festes Ende; diese Frist begrenzt, wie lange ein
 * vergessenes Gerät gilt. */
export const TOKEN_IDLE_DAYS = konfig().tokenLeerlaufTage;

/** Ab 30 Tagen meldet jede Antwort die Rotation; ein unbegrenzter Token gilt
 * nach 60 Tagen nur noch für den Tausch — so stirbt eine gestohlene Kopie,
 * sobald das echte Gerät tauscht, und ein Gerät, das nie tauscht, fällt auf. */
export const ROTATION_FAELLIG_TAGE = 30;
export const ROTATION_PFLICHT_TAGE = 60;
/** Falls die Antwort des Tauschs verloren geht. */
export const UEBERLAPPUNG_MS = 5 * 60 * 1000;
/** So lange nach dem Ende der Überlappung gilt ein alter Token als Nachzügler, nicht als Kopie. */
export const WIEDERVERWENDUNG_SCHONFRIST_S = 60;

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
  return `${teile
    .slice(0, 3)
    .map(g => g.toLowerCase().replace(/^0+(?=.)/, ''))
    .join(':')}::/48`;
}

export interface TokenPruefung {
  nutzer: TokenBenutzer | null;
  grund?: 'token_rotation_noetig' | 'zu_viele_anfragen';
}

/** `zweck: 'rotation'` lässt einen unbegrenzten Token auch nach der
 * Pflichtfrist durch — nur für den Tausch selbst. */
export async function pruefeToken(
  token: string | null | undefined,
  o: { ip?: string | null | undefined; zweck?: 'nutzung' | 'rotation' } = {},
): Promise<TokenPruefung> {
  if (!token) return { nutzer: null };
  const now = Date.now();
  const ergebnis = (u: TokenBenutzer): TokenPruefung =>
    o.zweck !== 'rotation' && rotationPflicht(u, now)
      ? { nutzer: null, grund: 'token_rotation_noetig' }
      : { nutzer: u };

  const stand = cacheStand();
  const hit = tokenAusCache(token, stand, now);
  if (hit) {
    // Beide Fristen auch hier: Dieser Zweig fragt die Datenbank nicht.
    if (fristErreicht(hit.user.expires_at, now) || fristErreicht(hit.user.hard_expires_at, now)) {
      vergissEintrag(token);
      return { nutzer: null };
    }
    _touchLastUsed(hit, o.ip);
    return ergebnis(hit.user);
  }

  // Erst nach dem Cache: Wer einen gültigen Token im Cache hat, wird nie gebremst.
  if (zuVieleFehlversuche(o.ip)) return { nutzer: null, grund: 'zu_viele_anfragen' };
  const hashed = hashToken(token);
  const row: TokenBenutzer | undefined = await kontoBereich().zugaenge.gueltigerToken(hashed);
  if (!row) {
    vergissEintrag(token);
    if (!(await meldeWiederverwendung(hashed))) await zaehleFehlversuch(o.ip);
    return { nutzer: null };
  }
  // Verwalterrecht nur mit Scope `voll`, an dieser einen Stelle entschieden,
  // damit alle Wächter es gleich sehen.
  row.is_admin = row.konto_is_admin === true && row.scope === 'voll';
  if (row.vorgaenger) {
    await kontoBereich().zugaenge.beendeUeberlappung(row.vorgaenger, hashed);
    row.vorgaenger = null;
    leereTokenCache();
  }

  const entry: CacheEintrag = { user: row, cachedAt: now, dbKey: hashed };
  merkeEintrag(token, entry, stand);
  _touchLastUsed(entry, o.ip);
  return ergebnis(row);
}

/** Ein ersetzter Token kam nach der Schonfrist wieder: Familie sperren, Inhaber benachrichtigen. */
async function meldeWiederverwendung(hash: string): Promise<boolean> {
  const z = await kontoBereich().zugaenge.sperreFamilie(hash, WIEDERVERWENDUNG_SCHONFRIST_S);
  if (!z) return false;
  leereTokenCache();
  console.warn(`[tokens] ersetzter Token erneut benutzt — Familie von Konto ${z.user_id} gesperrt`);
  hinweisNebenher(z.user_id, 'token_wiederverwendet', z.label ?? undefined);
  return true;
}

export async function validateToken(
  token: string | null | undefined,
  o: { ip?: string | null | undefined; zweck?: 'nutzung' | 'rotation' } = {},
): Promise<TokenBenutzer | null> {
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
  const fristHinkt = u.sliding === true && !!u.expires_at && new Date(u.expires_at).getTime() < ziel - TAG_MS;
  if ((jetzt - zuletzt < TAG_MS && !fristHinkt) || entry.schreibt) return;
  entry.schreibt = true;
  void kontoBereich()
    .zugaenge.beruehreToken(entry.dbKey, TOKEN_IDLE_DAYS, ipBereich(ip))
    .then(() => {
      // Den Cache mitziehen, sonst wiese der Treffer-Zweig einen gerade
      // erneuerten Token am alten Fristende einmal ab.
      u.last_used = new Date(jetzt);
      if (fristHinkt || (u.sliding === true && u.expires_at)) u.expires_at = new Date(ziel);
    })
    .catch(e => console.warn('[auth] last_used konnte nicht geschrieben werden:', e?.message || e))
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
export const UNBEGRENZT = 0;

/** „unbegrenzt" ist nicht die Vorgabe: Es nimmt die einzige selbsttätige
 * Reissleine für ein verlorenes Gerät weg. */
const TOKEN_LAUFZEITEN: Record<string, number> = {
  '1m': 30,
  '2m': 60,
  '6m': 180,
  '12m': 365,
  unbegrenzt: UNBEGRENZT,
};

/** Die Wahlen, die der QR-Dialog anbieten darf. */
export const LAUFZEIT_WAHLEN: readonly string[] = Object.freeze(Object.keys(TOKEN_LAUFZEITEN));

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

/** Je Konto und Art (Sitzung, Token): Anmelden darf die Tabellen nicht beliebig füllen.
 * Es fällt der am längsten unbenutzte Zugang. */
export const ZUGAENGE_HOECHSTENS = 50;

/** @param dauerhaft  true = Gerätezugang mit Gleitfrist; false = sieben feste
 *                   Tage — Benutzung durch einen Angreifer soll ihn nicht verlängern.
 * @param festeTage  `UNBEGRENZT` (0) = ohne Ablauf, nur über HTTPS und mit Rotationspflicht. */
export async function createToken(
  userId: number,
  label = 'Android App',
  dauerhaft = false,
  festeTage: number | null = null,
  o: TokenOptionen = {},
): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  await kontoBereich().zugaenge.legeTokenAn({
    hash,
    userId,
    label,
    scope: o.scope === 'voll' ? 'voll' : 'app',
    bereich: ipBereich(o.ip),
    art: !dauerhaft ? 'kurz' : festeTage === UNBEGRENZT ? 'unbegrenzt' : 'gleitend',
    leerlaufTage: TOKEN_IDLE_DAYS,
    festeTage: festeTage && festeTage > 0 ? festeTage : null,
  });
  if (await kontoBereich().zugaenge.kappeTokens(userId, hash, ZUGAENGE_HOECHSTENS - 1)) leereTokenCache();
  return token;
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
  const ergebnis = await kontoBereich().db.transaction(async tx => {
    const z = await repo.tauschQuelleSperren(tx, altHash);
    if (!z) return null;
    const offen = z.ersetzt_durch ? await repo.unbenutzterNachfolger(tx, z.ersetzt_durch, altHash) : undefined;
    const bereich = ipBereich(ip);
    if (offen?.ip_bereich && bereich && offen.ip_bereich !== bereich) {
      await repo.loescheFamilie(tx, z.user_id, z.created_at);
      kopie = { user_id: z.user_id, label: z.label };
      return null;
    }
    if (offen && offen.alter_s < TAUSCH_SPERRE_S) return 'laeuft' as const;
    if (z.ersetzt_durch) await repo.loescheUnbenutztenNachfolger(tx, z.ersetzt_durch, altHash);
    const zeile = await repo.legeNachfolgerAn(tx, neuHash, altHash, z, TOKEN_IDLE_DAYS, ipBereich(ip));
    const vorher = await repo.befristeVorgaenger(tx, altHash, neuHash, UEBERLAPPUNG_MS / 1000);
    return {
      token: neu,
      scope: z.scope,
      expires_at: zeile!.expires_at,
      hard_expires_at: zeile!.hard_expires_at,
      never_expires: z.never_expires,
      rotiert_am: zeile!.rotiert_am,
      alt_gueltig_bis: vorher!.expires_at,
    };
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
  await kontoBereich().zugaenge.loescheToken(hashToken(token));
  invalidateToken(token);
}

/** Ohne Fang: ein Sicherheitsschritt. Scheitert er still, meldet der Aufrufer
 * Erfolg, während die alten Tokens weitergelten. */
export async function revokeAllTokens(userId: number): Promise<void> {
  await kontoBereich().zugaenge.loescheTokensDesKontos(userId);
  leereTokenCache();
}

/** Altzeilen ohne Ablaufdatum bekommen vorher ihre Gleitfrist, damit sie nach
 * derselben Regel fallen wie neue. */
export async function purgeExpiredTokens() {
  const warn = (was: string) => (e: Error) => {
    console.warn(`[tokens] ${was}:`, e?.message || e);
    return 0;
  };
  const m = await kontoBereich().zugaenge.ziehAltzeilenNach(TOKEN_IDLE_DAYS).catch(warn('Altzeilen nachziehen'));
  if (m) console.log(`[tokens] ${m} Token ohne Ablaufdatum auf die Gleitfrist von ${TOKEN_IDLE_DAYS} Tagen gesetzt`);
  const abgelaufen = await kontoBereich().zugaenge.loescheAbgelaufene().catch(warn('Aufräumen abgelaufener Tokens'));
  const n = await kontoBereich()
    .zugaenge.loescheUngenutzte(TOKEN_IDLE_DAYS)
    .catch(warn('Aufräumen ungenutzter Tokens'));
  await kontoBereich().zugaenge.loescheVerwaisteVerbrauchte().catch(warn('Aufräumen verbrauchter Tokens'));
  if (n) console.log(`[tokens] ${n} Token seit über ${TOKEN_IDLE_DAYS} Tagen ungenutzt — entfernt`);
  return abgelaufen + n;
}
