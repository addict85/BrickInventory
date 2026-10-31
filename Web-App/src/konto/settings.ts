/** Einstellungen lesen und schreiben — die eine Stelle für Konto- und globale Werte. */

import { nacharbeit } from '../auftraege/nacharbeit';
import * as db from '../../db/database';
import * as repo from './repository/einstellungen';
import { sperreHaushaltswaehrung } from '../../db/txLock';
import { verschluessele, entschluessele, istVerschluesselt } from '../infra/geheimnis';
import { fehlerWerfen } from '../infra/fehlerTexte';
import { meldeUndLiefere } from '../infra/httpError';

/** Konto-Einstellung mit Rückfall auf die globale, dann auf `fallback`. */
export async function getSetting(userId: number, key: string, fallback?: any) {
  const eigen = await repo.nutzerWert(userId, key);
  if (eigen) return eigen;
  return klar(key, await repo.globalerWert(key)) || fallback;
}

/** Geheime Werte liegen verschlüsselt (src/infra/geheimnis.ts); hier werden sie wieder lesbar. */
function klar(key: string, wert: string | null | undefined): string | null | undefined {
  return SECRET_KEYS.has(key) ? entschluessele(wert) : wert;
}

/** Nur die globale Einstellung (z. B. SMTP). */
export async function getGlobalSetting(key: string, fallback: any = null) {
  const g = await repo.globalerWert(key).catch(meldeUndLiefere(`einstellungen:${key}`, null));
  return klar(key, g) ?? fallback;
}

// Was ein Konto selbst setzen darf. Die Werte landen ungeprüft in Seiten,
// PDFs und Preisabfragen; eine Währung wie "<img …>" oder "XYZ" hätte sonst
// jede Bewertung des Kontos stillschweigend auf null gesetzt.
export const WAEHRUNGEN = new Set(['CHF', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'AUD', 'CAD', 'DKK']);
/** Die Designs — dieselbe Liste wie ALLOWED in public/js/00-theme-boot.js (theme.test.js). */
export const DESIGNS: readonly string[] = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];
const NUTZER_REGELN: Record<string, (v: string) => boolean> = {
  currency: v => WAEHRUNGEN.has(v),
  language: v => v === 'de' || v === 'en',
  user_default_condition: v => v === 'N' || v === 'U' || v === '',
  price_cache_ttl: v => /^\d{1,4}$/.test(v) && +v >= 1 && +v <= 8760,
  app_theme: v => DESIGNS.includes(v),
};

/**
 * Konto-Einstellung schreiben — die eine Stelle für Formular, Import und /api/v1.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#setusersetting
 */
export async function setUserSetting(userId: number, key: string, value: any) {
  const v = String(value).trim();
  const regel = NUTZER_REGELN[key];
  if (regel && !regel(v)) fehlerWerfen('wert_ungueltig', 400);
  if (key === 'currency') return setzeHaushaltswaehrung(userId, v);
  await repo.schreibeNutzerWert(userId, key, v);
}

/**
 * Die Währung gilt für den ganzen Haushalt: Die Haushaltssicht summiert
 * Beträge, und zwei Währungen ergäben eine Summe, der man den Fehler nicht
 * ansieht. redeemInvite() prüft die Gleichheit unter derselben Sperre.
 */
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

/**
 * Der wirksame Erfassungs-Zustand eines Nutzers: eigener Wert → globaler Standard → 'N'.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#nutzerstandardzustand
 */
export async function nutzerStandardZustand(userId: number): Promise<'N' | 'U'> {
  const eigen = await repo.nutzerWert(userId, 'user_default_condition').catch(meldeUndLiefere('einstellungen:zustand', null));
  if (eigen === 'N' || eigen === 'U') return eigen;
  return globalDefaultCondition();
}

/**
 * Welcher Zustand gilt für einen Marktpreis: Eingabe → Bestand → Standard.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#zustandfuerpreis
 * @param eingabe Was im Rumpf steht; alles ausser 'N'/'U' zählt als nichts.
 * @param bisher  Der bisherige Zustand des Bestands, falls vorhanden.
 * @param userId  Für den Standard, wenn beides fehlt.
 */
export async function zustandFuerPreis(
  eingabe: unknown,
  bisher: string | null | undefined,
  userId: number,
): Promise<string> {
  if (eingabe === 'N' || eingabe === 'U') return eingabe;
  if (bisher) return bisher;
  return await nutzerStandardZustand(userId).catch(() => 'N');
}

/** Der globale Standard-Zustand (Verwaltung), ohne Wert des Nutzers. */
export async function globalDefaultCondition(): Promise<'N' | 'U'> {
  const g = await repo.globalerWert('default_price_condition').catch(meldeUndLiefere('einstellungen:standardzustand', null));
  return g === 'U' ? 'U' : 'N';
}

/**
 * Globale Einstellung schreiben — die EINE Stelle dafuer.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#setglobalsetting
 */
export async function setGlobalSetting(key: string, value: unknown) {
  await repo.schreibeGlobalenWert(key, SECRET_KEYS.has(key) ? verschluessele(String(value)) : String(value));
}

/**
 * Geheime Werte aus der Zeit vor der Verschlüsselung einmal verschlüsseln.
 * `AND value = $3`: Hat ein anderer Prozess die Zeile inzwischen neu
 * geschrieben, bleibt sie, wie sie ist.
 */
export async function verschluesseleGlobaleAltwerte(): Promise<number> {
  let n = 0;
  for (const z of await repo.globaleWerte([...SECRET_KEYS])) {
    if (!z.value || istVerschluesselt(z.value)) continue;
    if (await repo.ersetzeGlobalenWert(z.key, z.value, verschluessele(z.value))) n++;
  }
  return n;
}

/** Globale Einstellung entfernen — „fehlt“ ist etwas anderes als „leer“. */
export async function deleteGlobalSetting(...keys: string[]) {
  if (keys.length === 0) return;
  await repo.loescheGlobaleWerte(keys);
}

/** Einstellung eines Kontos entfernen: Danach gilt die Vorgabe der Installation. */
export async function deleteUserSetting(userId: number, key: string) {
  await repo.loescheNutzerWert(userId, key);
}

// Einstellungen LESEN — eine Fassung fuer beide Oberflaechen
//  Warum das hierher gehoert (Marcos Vorgabe: „die beiden Apps sollen gleich
//    funktionieren")
// Ausführlich: docs/begruendungen/src/konto/settings.ts.md#abschnitt

/**
 * Schlüssel aus global_settings, deren WERT ein Geheimnis ist.
 * Ausführlich: docs/begruendungen/src/konto/settings.ts.md#secret-keys
 */
export const SECRET_KEYS = new Set([
  'bricklink_consumer_key', 'bricklink_consumer_secret',
  'bricklink_token', 'bricklink_token_secret',
  'brickset_api_key', 'rebrickable_api_key',
  'smtp_pass',
]);

/**
 * Kein Geheimnis, aber Sache des Verwalters: Mailserver, Konto und Absender
 * verraten, wohin die Rücksetz-Mails gehen und mit welchem Konto.
 * Nicht-Verwalter brauchen davon nichts für ihre Einstellungsseite.
 */
const NUR_VERWALTER = /^smtp_/;

/** Erkennungszeichen der Maske — kommt in echten Schlüsseln nicht vor. */
const MASK_CHAR = '\u2022';

/**
 * Geheimen Wert durch eine Maske ersetzen, die nur „gesetzt" sagt. Kein
 * einziges Zeichen des Werts geht mit: Schon die letzten vier verkürzen das
 * Raten eines kurzen Schlüssels und verraten, ob zwei Installationen denselben
 * tragen. Leer bleibt leer — das ist „nicht gesetzt".
 */
export function maskSecret(value: string | null | undefined) {
  return String(value ?? '') ? MASK_CHAR.repeat(12) : '';
}

/** Kam die ausgelieferte Maske unverändert zurück statt eines neuen Geheimnisses? */
export function isMaskedValue(value: string | null | undefined) {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

/**
 * Globale Werte für einen Client: Nicht-Verwalter sehen die Schlüssel nicht,
 * Verwalter bekommen Geheimnisse maskiert.
 */
export function sanitizeGlobal(global: any, isAdmin: boolean) {
  const out: any = {};
  for (const [k, v] of Object.entries(global)) {
    if (SECRET_KEYS.has(k)) {
      // Nicht-Admins sehen den Schlüssel überhaupt nicht — auch nicht maskiert.
      if (isAdmin) out[k] = maskSecret(v as string | null | undefined);
      continue;
    }
    if (!isAdmin && NUR_VERWALTER.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** Die gespeicherten Einstellungen eines Nutzers als Schlüssel-Wert-Paare. */
export async function nutzerEinstellungen(userId: number): Promise<Record<string, any>> {
  return Object.fromEntries((await repo.nutzerWerte(userId)).map(r => [r.key, r.value]));
}

/**
 * Einstellungen so, wie sie an einen Client gehen dürfen: globale Werte
 * durch sanitizeGlobal(), darüber die des Nutzers.
 */
export async function readSettings(userId: number, isAdmin: boolean) {
  const raw = Object.fromEntries((await repo.globaleWerte()).map(r => [r.key, klar(r.key, r.value)]));
  return { ...sanitizeGlobal(raw, !!isAdmin), ...await nutzerEinstellungen(userId) };
}

/**
 * Die globalen Werte für den Konfigurationsexport — ohne Geheimnisse: Die
 * Datei wird heruntergeladen und weitergegeben, Schlüssel trägt man beim
 * Wiederherstellen neu ein.
 */
export async function globaleWerteOhneGeheimnisse(): Promise<Record<string, string>> {
  const aus: Record<string, string> = {};
  for (const r of await repo.globaleWerte())
    if (!SECRET_KEYS.has(r.key)) aus[r.key] = r.value;
  return aus;
}

// ── Design je Konto ─────────────────────────────────────────────────────────
// Der Verwalter setzt die Vorgabe (global_settings.app_theme), ein Konto darf
// sie in user_settings.app_theme überschreiben. Ohne eigene Zeile gilt die
// Vorgabe — so folgen alle, die nichts gewählt haben, einem Wechsel des Verwalters.
export async function designFuer(userId?: number | null): Promise<{ theme: string; vorgabe: string; eigenes: string | null }> {
  const g = await getGlobalSetting('app_theme');
  const vorgabe = DESIGNS.includes(g) ? g : 'classic';
  const u = userId ? await repo.nutzerWert(userId, 'app_theme') : null;
  const eigenes = u && DESIGNS.includes(u) ? u : null;
  return { theme: eigenes ?? vorgabe, vorgabe, eigenes };
}

/** Eigenes Design setzen; leer oder null löscht die Zeile, dann gilt wieder die Vorgabe. */
export async function setzeEigenesDesign(userId: number, theme: unknown): Promise<void> {
  const v = String(theme ?? '').trim();
  if (!v) { await repo.loescheNutzerWert(userId, 'app_theme'); return; }
  await setUserSetting(userId, 'app_theme', v);
}

