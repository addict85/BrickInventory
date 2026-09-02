/**
 * Settings-Helfer — zentrale Implementierung.
 *
 * Vorher als Kopien in routes/finance.js, routes/api_v1.js (User-Fallback-
 * Variante) und routes/mailer.js (nur global) vorhanden.
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
 *
 * ── Warum es diesen Helfer gibt ─────────────────────────────────────────────
 * Der Preis-Cache ist über set_number + condition + currency_code
 * verschlüsselt. Wer die Währung wechselt, hat ab diesem Moment für JEDES Set
 * einen Cache-Fehlschlag — und die Bewertung versucht dann je Set einen
 * Live-Abruf bei BrickLink, im Anfragepfad. Im Lastprofil (Nachtrag 27b):
 * 21 Sekunden statt 53 Millisekunden für den Finanzreiter, dazu geht jeder
 * dieser Abrufe auf das Tageskontingent.
 *
 * Der Cache füllt sich zwar von selbst wieder, aber erst Abruf für Abruf beim
 * Ansehen — oder beim nächsten planmässigen Preislauf, der bis zu
 * price_job_interval_minutes entfernt ist. Deshalb: Ändert sich die WÄHRUNG
 * tatsächlich (nicht bei jedem Speichern der Einstellungsseite — das Formular
 * schickt immer alle Felder), wird der Preis-Job sofort angestossen.
 * runPriceRefresh() liest je Nutzer die Währung, holt nur, was im Cache fehlt,
 * und triggerNow() hält die Sperre 55 selbst — mehrfaches Anstossen ist
 * dadurch harmlos, egal in welchem Worker das hier läuft.
 *
 * setImmediate + spätes require: Die Antwort auf das Speichern wartet nicht
 * auf den Preislauf, und utils/settings ↔ jobs/priceJob bilden keinen
 * Import-Kreis.
 *
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
 *
 * ── Warum das hier steht (Etappe 6) ─────────────────────────────────────────
 * Dieselbe Regel stand dreimal im Baum: in GET /api/settings/user/default-
 * condition (Webapp), in GET /api/v1/settings als `effective_condition`
 * (Android) und ein viertes Mal als Rückfall in der App selbst. Drei Fassungen
 * einer Regel, die aus zwei Tabellen liest — genau das Muster, an dem in
 * diesem Projekt schon mehrere Zahlen auseinandergelaufen sind.
 *
 * Beide Server-Wege lesen jetzt hier. Ein Wert, der nicht 'N' oder 'U' ist,
 * zählt als nicht gesetzt: In user_settings kann eine leere Zeichenkette
 * stehen (so leert das Formular den Wert), und die dürfte den globalen
 * Standard nicht verdrängen.
 *
 * @param {number|string} userId
 * @returns {Promise<'N'|'U'>}
 */
async function effectiveCondition(userId: number): Promise<'N' | 'U'> {
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
 *
 * ── Warum es das jetzt gibt ─────────────────────────────────────────────────
 * NACHGEMESSEN: `global_settings` wurde aus 22 Dateien direkt angefasst, in
 * vier verschiedenen Schreibweisen fuer dasselbe Lesen und mit neun eigenen
 * INSERT-Varianten fuer dasselbe Schreiben. Eine davon setzte `updated_at`,
 * die uebrigen acht nicht — das Feld blieb dort auf dem Wert des allerersten
 * Anlegens stehen.
 *
 * Gelesen wird `updated_at` heute nirgends. Genau deshalb ist es einheitlich
 * zu setzen billig und richtig: Es kostet nichts, und wer es kuenftig braucht
 * („wann wurde das Kontingent zuletzt geaendert?"), findet einen Wert vor,
 * dem er trauen kann.
 *
 * Der Wert wird als Zeichenkette abgelegt, weil die Spalte TEXT ist — eine
 * Zahl oder ein Wahrheitswert kaeme sonst je nach Aufrufer als '1', 'true'
 * oder '1.0' an.
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
 *
 * Getrennt von setGlobalSetting(), weil hier bewusst die Uhr der DATENBANK
 * schreibt und nicht die des Prozesses: Diese Zeilen schreibt ein Worker und
 * liest ein anderer. Käme die Zeit aus dem jeweiligen Node-Prozess, entschiede
 * bei auseinanderlaufenden Uhren der Schreiber darüber, was der Leser für
 * frisch hält.
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

export { getSetting, getGlobalSetting, setGlobalSetting, setGlobalTrigger, deleteGlobalSetting, setUserSetting, effectiveCondition, globalDefaultCondition };
