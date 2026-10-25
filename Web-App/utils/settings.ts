/**
 * Settings-Helfer — zentrale Implementierung.
 *
 * Vorher als Kopien in routes/finance.js, routes/api_v1.js (User-Fallback-
 * Variante) und utils/mailer.js (nur global) vorhanden.
 */

import * as db from '../db/database';
import { meldeUndWeiter } from './httpError';

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
  return g?.value || fallback;
}

/** Nur globale Einstellung (z.B. SMTP-Konfiguration). */
/**
 * @param {string} key
 * @param {string|null} [fallback]
 * @returns {Promise<string|null>}
 */
async function getGlobalSetting(key: string, fallback: any = null) {
  const g = await db.get('SELECT value FROM global_settings WHERE key = $1', [key]).catch(() => null);
  return g?.value ?? fallback;
}

/**
 * User-Einstellung schreiben — die EINE Stelle für alle drei Schreibwege
 * (Webapp-Formular, Einstellungs-Import, /api/v1).
 * Ausführlich: docs/begruendungen/utils/settings.ts.md#setusersetting
 * @param {number|string} userId
 * @param {string} key
 * @param {string} value
 */
async function setUserSetting(userId: number, key: string, value: any) {
  const v = String(value);
  let vorher = null;
  if (key === 'currency') {
    vorher = (await db.get(
      'SELECT value FROM user_settings WHERE user_id = $1 AND key = $2', [userId, key]
    ).catch(() => null))?.value ?? null;
  }
  await db.run(
    'INSERT INTO user_settings (user_id, key, value, updated_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (user_id, key) DO UPDATE SET value = $3, updated_at = NOW()',
    [userId, key, v]
  );
  if (key === 'currency' && vorher !== v) {
    console.log(`[settings] Währung für Benutzer ${userId} geändert (${vorher ?? '—'} → ${v}) — Preis-Job wird angestossen`);
    setImmediate(() => {
      try { require('../jobs/priceJob').triggerNow().catch(() => {}); } catch (e) { meldeUndWeiter('einstellungen:preis-job-anstossen', e); }
    });
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
    [key, String(value)]);
}

/**
 * Auslöser-Zeile setzen (csv_sync_trigger, job_reschedule_trigger,
 * instr_queue_trigger).
 * Ausführlich: docs/begruendungen/utils/settings.ts.md#setglobaltrigger
 */
async function setGlobalTrigger(key: string) {
  await db.run(
    `INSERT INTO global_settings (key, value, updated_at) VALUES ($1, NOW()::TEXT, NOW())
     ON CONFLICT (key) DO UPDATE SET value = NOW()::TEXT, updated_at = NOW()`, [key]);
}

/**
 * Globale Einstellung entfernen.
 *
 * Es gibt einen echten Unterschied zwischen „Schlüssel fehlt" und „Wert ist
 * leer": Ein Auslöser-Schlüssel (instr_queue_trigger) gilt als abgearbeitet,
 * sobald die ZEILE weg ist — ein leerer Wert liesse die Warteschlange in einer
 * Schleife weiterlaufen. Deshalb ein eigener Weg statt setGlobalSetting(k, '').
 */
async function deleteGlobalSetting(...keys: string[]) {
  if (keys.length === 0) return;
  await db.run(`DELETE FROM global_settings WHERE key = ANY($1)`, [keys]);
}

export { getSetting, getGlobalSetting, setGlobalSetting, setGlobalTrigger, deleteGlobalSetting, setUserSetting, nutzerStandardZustand, globalDefaultCondition, zustandFuerPreis };

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
  (await db.all('SELECT key, value FROM global_settings')).forEach(r => { raw[r.key] = r.value; });
  const global = sanitizeGlobal(raw, !!isAdmin);
  const user: any = {};
  (await db.all('SELECT key, value FROM user_settings WHERE user_id = $1', [userId]))
    .forEach(r => { user[r.key] = r.value; });
  return { ...global, ...user };
}

export { SECRET_KEYS, maskSecret, isMaskedValue, sanitizeGlobal, readSettings };
