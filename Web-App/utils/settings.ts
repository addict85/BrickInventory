/**
 * Settings-Helfer — zentrale Implementierung.
 *
 * Vorher als Kopien in routes/finance.js, routes/api_v1.js (User-Fallback-
 * Variante) und utils/mailer.js (nur global) vorhanden.
 */

import { nacharbeit } from './nacharbeit';
import * as db from '../db/database';
import { verschluessele, entschluessele, istVerschluesselt } from './geheimnis';
import { fehlerWerfen } from './fehlerTexte';

/** User-Einstellung mit Fallback auf globale Einstellung, dann Default. */
/**
 * @param {number|string} userId
 * @param {string} key
 * @param {string} [fallback]
 * @returns {Promise<string>}
 */
async function getSetting(userId: number, key: string, fallback?: any) {
  const u = await db.get('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]);
  if (u?.value) return u.value;
  const g = await db.get('SELECT value FROM global_settings WHERE key = $1', [key]);
  return klar(key, g?.value) || fallback;
}

/** Geheime Werte liegen verschlüsselt (utils/geheimnis.ts); hier werden sie wieder lesbar. */
function klar(key: string, wert: string | null | undefined): string | null | undefined {
  return SECRET_KEYS.has(key) ? entschluessele(wert) : wert;
}

/** Nur globale Einstellung (z.B. SMTP-Konfiguration). */
/**
 * @param {string} key
 * @param {string|null} [fallback]
 * @returns {Promise<string|null>}
 */
async function getGlobalSetting(key: string, fallback: any = null) {
  const g = await db.get('SELECT value FROM global_settings WHERE key = $1', [key]).catch(() => null);
  return klar(key, g?.value) ?? fallback;
}

// Was ein Konto selbst setzen darf. Die Werte landen ungeprüft in Seiten,
// PDFs und Preisabfragen; eine Währung wie "<img …>" oder "XYZ" hätte sonst
// jede Bewertung des Kontos stillschweigend auf null gesetzt.
const WAEHRUNGEN = new Set(['CHF', 'EUR', 'USD', 'GBP', 'SEK', 'NOK', 'AUD', 'CAD', 'DKK']);
/** Die Designs — dieselbe Liste wie ALLOWED in public/js/00-theme-boot.js (theme.test.js). */
const DESIGNS: readonly string[] = ['classic', 'brick', 'werkbank', 'farbfaecher', 'noppe', 'hochglanz'];
const NUTZER_REGELN: Record<string, (v: string) => boolean> = {
  currency: v => WAEHRUNGEN.has(v),
  language: v => v === 'de' || v === 'en',
  user_default_condition: v => v === 'N' || v === 'U' || v === '',
  price_cache_ttl: v => /^\d{1,4}$/.test(v) && +v >= 1 && +v <= 8760,
  app_theme: v => DESIGNS.includes(v),
};

/**
 * User-Einstellung schreiben — die EINE Stelle für alle drei Schreibwege
 * (Webapp-Formular, Einstellungs-Import, /api/v1).
 * Ausführlich: docs/begruendungen/utils/settings.ts.md#setusersetting
 * @param {number|string} userId
 * @param {string} key
 * @param {string} value
 */
async function setUserSetting(userId: number, key: string, value: any) {
  const v = String(value).trim();
  const regel = NUTZER_REGELN[key];
  if (regel && !regel(v)) fehlerWerfen('wert_ungueltig', 400);
  if (key === 'currency') return setzeHaushaltswaehrung(userId, v);
  await db.run(
    'INSERT INTO user_settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()',
    [userId, key, v]
  );
}

/** Alle Konten, die über Verknüpfungen zusammenhängen, in beide Richtungen. */
const VERBUND_SQL = `
  WITH RECURSIVE verbund(id) AS (
    SELECT $1::int
    UNION
    SELECT CASE WHEN l.main_user_id = v.id THEN l.sub_user_id ELSE l.main_user_id END
      FROM account_links l JOIN verbund v ON v.id IN (l.main_user_id, l.sub_user_id))
  SELECT id FROM verbund`;

/** Sperre für Währung und Verknüpfung: Beide prüfen bzw. ändern dieselbe Regel. */
const HAUSHALT_WAEHRUNG_SPERRE = "SELECT pg_advisory_xact_lock(hashtext('haushalt-waehrung'))";

/**
 * Die Währung gilt für den ganzen Haushalt: Die Haushaltssicht summiert
 * Beträge, und zwei Währungen ergäben eine Summe, der man den Fehler nicht
 * ansieht. redeemInvite() prüft die Gleichheit unter derselben Sperre.
 */
async function setzeHaushaltswaehrung(userId: number, waehrung: string) {
  const vorher = await db.transaction(async (tx) => {
    await tx.run(HAUSHALT_WAEHRUNG_SPERRE);
    const alt = (await tx.get('SELECT value FROM user_settings WHERE user_id = $1 AND key = $2',
      [userId, 'currency']))?.value ?? null;
    const ids = (await tx.all(VERBUND_SQL, [userId])).map((r: { id: number }) => r.id);
    await tx.run(
      `INSERT INTO user_settings (user_id, key, value, updated_at)
       SELECT id, 'currency', $2, NOW() FROM unnest($1::int[]) AS id
       ON CONFLICT (user_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
      [ids, waehrung]);
    return alt;
  });
  if (vorher !== waehrung) {
    console.log(`[settings] Währung für Benutzer ${userId} und seinen Haushalt geändert (${vorher ?? '—'} → ${waehrung}) — Preis-Job wird angestossen`);
    setImmediate(() => nacharbeit().preisJobAnstossen());
  }
}

/**
 * Der EFFEKTIVE Erfassungs-Zustand eines Nutzers: eigener Wert → globaler
 * Standard → 'N'.
 * Ausführlich: docs/begruendungen/utils/settings.ts.md#nutzerstandardzustand
 * @param {number|string} userId
 * @returns {Promise<'N'|'U'>}
 */
async function nutzerStandardZustand(userId: number): Promise<'N' | 'U'> {
  const u = await db.get(
    "SELECT value FROM user_settings WHERE user_id=$1 AND key='user_default_condition'", [userId]
  ).catch(() => null);
  if (u?.value === 'N' || u?.value === 'U') return u.value;
  const g = await db.get(
    "SELECT value FROM global_settings WHERE key='default_price_condition'"
  ).catch(() => null);
  return g?.value === 'U' ? 'U' : 'N';
}

/**
 * Welcher Zustand gilt für einen Marktpreis: Eingabe → Bestand → Standard.
 * Ausführlich: docs/begruendungen/utils/settings.ts.md#zustandfuerpreis
 * @param eingabe Was im Rumpf steht; alles ausser 'N'/'U' zählt als nichts.
 * @param bisher  Der bisherige Zustand des Bestands, falls vorhanden.
 * @param userId  Für den Standard, wenn beides fehlt.
 */
async function zustandFuerPreis(
  eingabe: unknown,
  bisher: string | null | undefined,
  userId: number,
): Promise<string> {
  if (eingabe === 'N' || eingabe === 'U') return eingabe;
  if (bisher) return bisher;
  return await nutzerStandardZustand(userId).catch(() => 'N');
}

/**
 * Der GLOBALE Standard-Zustand (Admin-Ansicht) — ohne Benutzer-Override.
 *
 * @returns {Promise<'N'|'U'>}
 */
async function globalDefaultCondition(): Promise<'N' | 'U'> {
  const g = await db.get(
    "SELECT value FROM global_settings WHERE key='default_price_condition'"
  ).catch(() => null);
  return g?.value === 'U' ? 'U' : 'N';
}

/**
 * Globale Einstellung schreiben — die EINE Stelle dafuer.
 * Ausführlich: docs/begruendungen/utils/settings.ts.md#setglobalsetting
 */
async function setGlobalSetting(key: string, value: unknown) {
  await db.run(
    `INSERT INTO global_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, SECRET_KEYS.has(key) ? verschluessele(String(value)) : String(value)]);
}

/**
 * Geheime Werte aus der Zeit vor der Verschlüsselung einmal verschlüsseln.
 * `AND value = $3`: Hat ein anderer Prozess die Zeile inzwischen neu
 * geschrieben, bleibt sie, wie sie ist.
 */
async function verschluesseleGlobaleAltwerte(): Promise<number> {
  let n = 0;
  for (const z of await db.all('SELECT key, value FROM global_settings WHERE key = ANY($1)', [[...SECRET_KEYS]])) {
    if (!z.value || istVerschluesselt(z.value)) continue;
    const r = await db.run('UPDATE global_settings SET value = $1, updated_at = NOW() WHERE key = $2 AND value = $3',
      [verschluessele(z.value), z.key, z.value]);
    n += r?.changes || 0;
  }
  return n;
}

/**
 * Globale Einstellung entfernen.
 *
 * Es gibt einen echten Unterschied zwischen „Schlüssel fehlt" und „Wert ist
 * leer"; deshalb ein eigener Weg statt setGlobalSetting(k, '').
 */
async function deleteGlobalSetting(...keys: string[]) {
  if (keys.length === 0) return;
  await db.run(`DELETE FROM global_settings WHERE key = ANY($1)`, [keys]);
}

export { WAEHRUNGEN, HAUSHALT_WAEHRUNG_SPERRE, getSetting, getGlobalSetting, setGlobalSetting, deleteGlobalSetting, setUserSetting, nutzerStandardZustand, globalDefaultCondition, zustandFuerPreis };

// Einstellungen LESEN — eine Fassung fuer beide Oberflaechen
//  Warum das hierher gehoert (Marcos Vorgabe: „die beiden Apps sollen gleich
//    funktionieren")
// Ausführlich: docs/begruendungen/utils/settings.ts.md#abschnitt

/**
 * Schlüssel aus global_settings, deren WERT ein Geheimnis ist.
 * Ausführlich: docs/begruendungen/utils/settings.ts.md#secret-keys
 */
const SECRET_KEYS = new Set([
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
 * Geheimen Wert durch eine Maske ersetzen: 12 Punkte + die letzten vier
 * Zeichen. Leere Werte bleiben leer, damit das Formular "nicht gesetzt"
 * weiterhin von "gesetzt" unterscheiden kann.
 * @param {string|null|undefined} value
 * @returns {string}
 */
function maskSecret(value: string | null | undefined) {
  const v = String(value ?? '');
  if (!v) return '';
  return MASK_CHAR.repeat(12) + v.slice(-4);
}

/**
 * Ist der übergebene Wert die von uns ausgelieferte Maske (also unverändert
 * zurückgeschickt) statt eines echten neuen Geheimnisses?
 * @param {unknown} value
 * @returns {boolean}
 */
function isMaskedValue(value: string | null | undefined) {
  return typeof value === 'string' && value.includes(MASK_CHAR);
}

/**
 * global_settings so aufbereiten, wie sie an einen Client gehen dürfen:
 * Nicht-Admins bekommen die globalen Schlüssel gar nicht zu sehen, Admins
 * bekommen Geheimnisse maskiert.
 * @param {Record<string, string>} global
 * @param {boolean} isAdmin
 * @returns {Record<string, string>}
 */
function sanitizeGlobal(global: any, isAdmin: boolean) {
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

/**
 * Einstellungen so lesen, wie sie an einen Client gehen dürfen: globale Werte
 * durch sanitizeGlobal(), darüber die Werte des Nutzers.
 * Ausführlich: docs/begruendungen/utils/settings.ts.md#abschnitt-2
 */
/**
 * Die gespeicherten Einstellungen EINES Nutzers, als Schluessel-Wert-Paare.
 *
 * Stand zweimal da — hier und in routes/settings.ts (Konfigurations-Export).
 * Gleich geschrieben, kein gemessener Unterschied; die naechste Aenderung
 * (etwa eine Spalte dazu) soll trotzdem an einer Stelle stattfinden.
 */
export async function nutzerEinstellungen(userId: number): Promise<Record<string, any>> {
  const werte: Record<string, any> = {};
  (await db.all('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]))
    .forEach((r: any) => { werte[r.key] = r.value; });
  return werte;
}

async function readSettings(userId: number, isAdmin: boolean) {
  const raw: any = {};
  (await db.all('SELECT key, value FROM global_settings')).forEach(r => { raw[r.key] = klar(r.key, r.value); });
  const global = sanitizeGlobal(raw, !!isAdmin);
  const user: any = {};
  (await db.all('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]))
    .forEach(r => { user[r.key] = r.value; });
  return { ...global, ...user };
}

export { verschluesseleGlobaleAltwerte, SECRET_KEYS, maskSecret, isMaskedValue, sanitizeGlobal, readSettings };

// ── Design je Konto ─────────────────────────────────────────────────────────
// Der Verwalter setzt die Vorgabe (global_settings.app_theme), ein Konto darf
// sie in user_settings.app_theme überschreiben. Ohne eigene Zeile gilt die
// Vorgabe — so folgen alle, die nichts gewählt haben, einem Wechsel des Verwalters.
async function designFuer(userId?: number | null): Promise<{ theme: string; vorgabe: string; eigenes: string | null }> {
  const g = await getGlobalSetting('app_theme');
  const vorgabe = DESIGNS.includes(g) ? g : 'classic';
  const u = userId ? await db.get("SELECT value FROM user_settings WHERE user_id = $1 AND key = 'app_theme'", [userId]) : null;
  const eigenes = DESIGNS.includes(u?.value) ? u.value : null;
  return { theme: eigenes ?? vorgabe, vorgabe, eigenes };
}

/** Eigenes Design setzen; leer oder null löscht die Zeile, dann gilt wieder die Vorgabe. */
async function setzeEigenesDesign(userId: number, theme: unknown): Promise<void> {
  const v = String(theme ?? '').trim();
  if (!v) { await db.run("DELETE FROM user_settings WHERE user_id = $1 AND key = 'app_theme'", [userId]); return; }
  await setUserSetting(userId, 'app_theme', v);
}

export { DESIGNS, designFuer, setzeEigenesDesign };
