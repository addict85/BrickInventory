
import { nacharbeit } from '../auftraege/nacharbeit';
import * as db from '../../db/database';
import * as repo from './repository/einstellungen';
import { sperreHaushaltswaehrung } from '../../db/txLock';
import { verschluessele, entschluessele, istVerschluesselt } from '../infra/geheimnis';
import { fehlerWerfen } from '../infra/fehlerTexte';
import { meldeUndLiefere } from '../infra/httpError';
import crypto from 'node:crypto';

export async function getSetting(userId: number, key: string, fallback?: any) {
  const eigen = await repo.nutzerWert(userId, key);
  if (eigen) return eigen;
  return klar(key, await repo.globalerWert(key)) || fallback;
}

/** Geheime Werte liegen verschlüsselt (src/infra/geheimnis.ts). */
function klar(key: string, wert: string | null | undefined): string | null | undefined {
  return SECRET_KEYS.has(key) ? entschluessele(wert) : wert;
}

export async function getGlobalSetting(key: string, fallback: any = null) {
  const g = await repo.globalerWert(key).catch(meldeUndLiefere(`einstellungen:${key}`, null));
  return klar(key, g) ?? fallback;
}

// Was ein Konto selbst setzen darf: Die Werte landen in Seiten, PDFs und
// Preisabfragen; „XYZ" als Währung setzte jede Bewertung still auf null.
export const WAEHRUNGEN = new Set(['CHF', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'AUD', 'CAD', 'DKK']);
/** Dieselbe Liste wie ALLOWED in public/js/00-theme-boot.js (theme.test.js). */
export const DESIGNS: readonly string[] = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];
const NUTZER_REGELN: Record<string, (v: string) => boolean> = {
  currency: v => WAEHRUNGEN.has(v),
  language: v => v === 'de' || v === 'en',
  user_default_condition: v => v === 'N' || v === 'U' || v === '',
  price_cache_ttl: v => /^\d{1,4}$/.test(v) && +v >= 1 && +v <= 8760,
  app_theme: v => DESIGNS.includes(v),
};

/** Die eine Schreibstelle: Ein Währungswechsel muss den Preis-Job anstossen,
 * weil der Preis-Cache je Währung verschlüsselt ist.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#setusersetting */
export async function setUserSetting(userId: number, key: string, value: any) {
  const v = String(value).trim();
  const regel = NUTZER_REGELN[key];
  if (regel && !regel(v)) fehlerWerfen('wert_ungueltig', 400);
  if (key === 'currency') return setzeHaushaltswaehrung(userId, v);
  await repo.schreibeNutzerWert(userId, key, v);
}

/** Für den ganzen Haushalt: Zwei Währungen ergäben eine Summe, der man den
 * Fehler nicht ansieht. redeemInvite() prüft unter derselben Sperre. */
async function setzeHaushaltswaehrung(userId: number, waehrung: string) {
  const vorher = await db.transaction(async (tx) => {
    await sperreHaushaltswaehrung(tx);
    const alt = await repo.nutzerWert(userId, 'currency', tx);
    await repo.setzeWaehrungFuer(tx, await repo.verbundeneKonten(tx, userId), waehrung);
    return alt;
  });
  if (vorher !== waehrung) {
    console.log(`[settings] Währung für Benutzer ${userId} und seinen Haushalt geändert (${vorher ?? '—'} → ${waehrung}) — Preis-Job wird angestossen`);
    setImmediate(() => nacharbeit().preisJobAnstossen());
  }
}

/** Eigener Wert → globaler Standard → 'N'; eine Stelle statt drei Fassungen.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#nutzerstandardzustand */
export async function nutzerStandardZustand(userId: number): Promise<'N' | 'U'> {
  const eigen = await repo.nutzerWert(userId, 'user_default_condition').catch(meldeUndLiefere('einstellungen:zustand', null));
  if (eigen === 'N' || eigen === 'U') return eigen;
  return globalDefaultCondition();
}

/** Eingabe → Bestand → Standard; eine Stelle, damit ein gebrauchtes Teil nie
 * den Neupreis bekommt.
 * @param eingabe Alles ausser 'N'/'U' zählt als nichts. */
export async function zustandFuerPreis(
  eingabe: unknown,
  bisher: string | null | undefined,
  userId: number,
): Promise<string> {
  if (eingabe === 'N' || eingabe === 'U') return eingabe;
  if (bisher) return bisher;
  return await nutzerStandardZustand(userId).catch(() => 'N');
}

export async function globalDefaultCondition(): Promise<'N' | 'U'> {
  const g = await repo.globalerWert('default_price_condition').catch(meldeUndLiefere('einstellungen:standardzustand', null));
  return g === 'U' ? 'U' : 'N';
}

/** Ja/Nein nur als 0 oder 1: "false" las die Anzeige als aus, die Durchsetzung als an. */
const JA_NEIN = new Set(['registration_enabled', 'smtp_secure', 'einrichtung_erledigt']);
/** Ein unlesbarer Fingerabdruck oder ein kaputtes PEM fiele sonst erst beim Versand auf. */
const GLOBALE_REGELN: Record<string, (v: string) => boolean> = {
  smtp_tls_fingerprint: v => v === '' || /^[0-9A-F]{64}$/.test(v.replace(/[\s:]/g, '').toUpperCase()),
  smtp_tls_ca: v => {
    if (v.trim() === '') return true;
    try { return !!new crypto.X509Certificate(v); } catch { return false; }
  },
};

export function globalerWertGueltig(key: string, value: unknown): boolean {
  if (JA_NEIN.has(key)) return String(value) === '0' || String(value) === '1';
  return GLOBALE_REGELN[key]?.(String(value)) ?? true;
}

/** Die EINE Schreibstelle: global_settings wurde vorher an vielen Stellen
 * verschieden angefasst.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#setglobalsetting */
export async function setGlobalSetting(key: string, value: unknown) {
  if (!globalerWertGueltig(key, value)) fehlerWerfen('wert_ungueltig', 400);
  await repo.schreibeGlobalenWert(key, SECRET_KEYS.has(key) ? verschluessele(String(value)) : String(value));
}

/** Offen nur bei genau '1'; fehlt die Zeile oder ist sie unlesbar, bleibt sie zu. */
export async function registrierungOffen(): Promise<boolean> {
  return await getGlobalSetting('registration_enabled') === '1';
}

/** `AND value = $3`: Hat ein anderer Prozess die Zeile inzwischen neu
 * geschrieben, bleibt sie, wie sie ist. */
export async function verschluesseleGlobaleAltwerte(): Promise<number> {
  let n = 0;
  for (const z of await repo.globaleWerte([...SECRET_KEYS])) {
    if (!z.value || istVerschluesselt(z.value)) continue;
    if (await repo.ersetzeGlobalenWert(z.key, z.value, verschluessele(z.value))) n++;
  }
  return n;
}

/** „Fehlt" ist etwas anderes als „leer". */
export async function deleteGlobalSetting(...keys: string[]) {
  if (keys.length === 0) return;
  await repo.loescheGlobaleWerte(keys);
}

/** Danach gilt die Vorgabe der Installation. */
export async function deleteUserSetting(userId: number, key: string) {
  await repo.loescheNutzerWert(userId, key);
}

// Einstellungen LESEN — eine Fassung für beide Oberflächen, damit die Apps
// gleich funktionieren.

/** Werden nie im Klartext ausgeliefert.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#secret-keys */
export const SECRET_KEYS = new Set([
  'bricklink_consumer_key', 'bricklink_consumer_secret',
  'bricklink_token', 'bricklink_token_secret',
  'brickset_api_key', 'rebrickable_api_key',
  'smtp_pass',
]);

/** Kein Geheimnis, aber Sache des Verwalters: Mailserver und Konto verraten,
 * wohin die Rücksetz-Mails gehen. */
const NUR_VERWALTER = /^smtp_/;

/** Kommt in echten Schlüsseln nicht vor. */
const MASK_CHAR = '\u2022';

/** Kein einziges Zeichen des Werts geht mit: Schon die letzten vier verkürzen
 * das Raten und verraten, ob zwei Installationen denselben tragen. */
export function maskSecret(value: string | null | undefined) {
  return String(value ?? '') ? MASK_CHAR.repeat(12) : '';
}

export function isMaskedValue(value: string | null | undefined) {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

/** Nicht-Verwalter sehen die Schlüssel nicht, Verwalter maskiert. */
export function sanitizeGlobal(global: any, isAdmin: boolean) {
  const out: any = {};
  for (const [k, v] of Object.entries(global)) {
    if (SECRET_KEYS.has(k)) {
      if (isAdmin) out[k] = maskSecret(v as string | null | undefined);
      continue;
    }
    if (!isAdmin && NUR_VERWALTER.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export async function nutzerEinstellungen(userId: number): Promise<Record<string, any>> {
  return Object.fromEntries((await repo.nutzerWerte(userId)).map(r => [r.key, r.value]));
}

export async function readSettings(userId: number, isAdmin: boolean) {
  const raw = Object.fromEntries((await repo.globaleWerte()).map(r => [r.key, klar(r.key, r.value)]));
  return { ...sanitizeGlobal(raw, !!isAdmin), ...await nutzerEinstellungen(userId) };
}

/** Ohne Geheimnisse: Die Datei wird weitergegeben; Schlüssel trägt man beim
 * Wiederherstellen neu ein. */
export async function globaleWerteOhneGeheimnisse(): Promise<Record<string, string>> {
  const aus: Record<string, string> = {};
  for (const r of await repo.globaleWerte())
    if (!SECRET_KEYS.has(r.key)) aus[r.key] = r.value;
  return aus;
}

// ── Design je Konto ─────────────────────────────────────────────────────────
// Ohne eigene Zeile gilt die Vorgabe des Verwalters — so folgen alle, die
// nichts gewählt haben, einem Wechsel.
export async function designFuer(userId?: number | null): Promise<{ theme: string; vorgabe: string; eigenes: string | null }> {
  const g = await getGlobalSetting('app_theme');
  const vorgabe = DESIGNS.includes(g) ? g : 'classic';
  const u = userId ? await repo.nutzerWert(userId, 'app_theme') : null;
  const eigenes = u && DESIGNS.includes(u) ? u : null;
  return { theme: eigenes ?? vorgabe, vorgabe, eigenes };
}

export async function setzeEigenesDesign(userId: number, theme: unknown): Promise<void> {
  const v = String(theme ?? '').trim();
  if (!v) { await repo.loescheNutzerWert(userId, 'app_theme'); return; }
  await setUserSetting(userId, 'app_theme', v);
}

