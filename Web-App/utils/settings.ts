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
 * Welcher Zustand gilt für einen Marktpreis: Eingabe → Bestand → Standard.
 *
 * ── Warum das hier steht ────────────────────────────────────────────────────
 * Dieselbe Staffelung stand VIERMAL im Baum, in zwei Fassungen:
 *
 *   routes/parts.ts:437     Eingabe → Bestand → Standard   (Bearbeiten)
 *   routes/minifigs.ts:471  Eingabe → Bestand → Standard   (Bearbeiten)
 *   routes/parts.ts:410              Bestand → Standard    (Erfassen)
 *   routes/minifigs.ts:438           Bestand → Standard    (Erfassen)
 *
 * Die zweite ist keine andere Regel, sondern derselbe Fall ohne Eingabe — der
 * Erfassen-Weg bekommt schlicht keinen Zustand mitgeschickt. Aufgefallen ist
 * das erst bei einem mechanischen Vergleich gleicher Codeblöcke; die beiden
 * Nachträge 146 und 147 haben genau daran gelitten, dass Bearbeiten und
 * Erfassen getrennte Wege sind und jeweils einzeln nachgezogen werden mussten.
 *
 * Ein Absatz aus routes/parts.ts sagt, worum es geht: „Zustand der neuen
 * Erfassung folgt dem Teil selbst (bzw. dem User-Default), nicht hartkodiert
 * 'N' — sonst bekäme ein als \"Gebraucht\" geführtes Teil bei jeder
 * Mengen-Erhöhung eine \"Neu\"-Erfassung."
 *
 * ── Eine Feinheit, die erhalten bleiben muss ────────────────────────────────
 * Ein LEERER `bisher` (die leere Zeichenkette, wie sie das Formular schreibt)
 * zählt als nicht gesetzt und fällt auf den Standard durch — genau wie an den
 * vier Stellen vorher, die dafür `||` benutzt haben. Mit `??` wäre das eine
 * stille Verhaltensänderung; in diesem Projekt sind an dieser Naht zwischen
 * JS-Falsy und Kotlin-Null schon mehrfach Zahlen auseinandergelaufen.
 *
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
  return await effectiveCondition(userId).catch(() => 'N');
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

export { getSetting, getGlobalSetting, setGlobalSetting, setGlobalTrigger, deleteGlobalSetting, setUserSetting, effectiveCondition, globalDefaultCondition, zustandFuerPreis };

// ═══════════════════════════════════════════════════════════════════════════
// Einstellungen LESEN — eine Fassung fuer beide Oberflaechen
// ═══════════════════════════════════════════════════════════════════════════
//
// ── Warum das hierher gehoert (Marcos Vorgabe: „die beiden Apps sollen gleich
//    funktionieren") ────────────────────────────────────────────────────────
//
// readSettings() stand in routes/settings.ts und war damit nur der Webapp
// zugaenglich. Die Token-Route /api/v1/settings baute ihre Antwort deshalb
// SELBST: eine eigene Abfrage auf user_settings und eine eigene Vorgabeliste.
//
// Das war nicht nur doppelt, es war falsch. price_cache_ttl und
// default_price_condition sind GLOBALE Einstellungen; die v1-Route las aber
// nur user_settings und lieferte sonst ihre fest verdrahtete 24 bzw. 'N'.
// Gemessen: Steht global 48, sieht die Webapp 48 und die App 24. Was der
// Verwalter einstellt, kam am Telefon nie an.
//
// Der Paritaetstest hat es nicht gefunden, weil seine Vorlage
// price_cache_ttl als BENUTZER-Einstellung schreibt — damit lasen beide
// dasselbe, und der globale Weg wurde nie beruehrt. Und selbst als globaler
// Wert waere er blind geblieben: initSchema() legt price_cache_ttl mit '24'
// an, genau der Zahl, die hier fest verdrahtet stand. Zwei Wege, ein
// Ergebnis, keine Abweichung zu sehen.
//
// Jetzt lesen beide hier. Die Kuratierung (was die App bekommt) bleibt in der
// v1-Route, denn das ist eine Entscheidung ueber die Ansicht, keine ueber die
// Daten.

/**
 * Schlüssel aus global_settings, deren WERT ein Geheimnis ist.
 *
 * ── Warum das nötig wurde ───────────────────────────────────────────────────
 * GET /api/settings/ hat die komplette global_settings-Tabelle in die Antwort
 * gespreadet — inklusive bricklink_consumer_secret, bricklink_token_secret,
 * brickset_api_key, rebrickable_api_key und smtp_pass. Schreiben durfte nur
 * ein Admin, LESEN aber jedes angemeldete Konto. Ein zweiter Benutzer ohne
 * Admin-Rechte konnte damit sämtliche API-Zugangsdaten der Installation
 * abziehen. Dasselbe galt für GET /api/settings/export.
 *
 * Verschärfend: Die Werte landeten im Frontend-JavaScript und damit im
 * Browser-Speicher — jede XSS-Lücke wäre automatisch ein Schlüsseldiebstahl
 * gewesen.
 *
 * Jetzt: Geheimnisse gehen nur maskiert raus (Länge + letzte vier Zeichen,
 * damit man im Formular erkennt, OB und WELCHER Wert hinterlegt ist).
 * Geschrieben wird nur, wenn der Client einen echten neuen Wert schickt —
 * die Maske selbst wird beim Speichern ignoriert (siehe isMaskedValue).
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
 *
 * ── Warum als eigener Helfer ────────────────────────────────────────────────
 * Es gibt ZWEI Leserouten mit demselben Inhalt und verschiedener Verpackung:
 * `/` liefert flach, `/raw` unter `settings`. Die Abfrage stand zweimal da —
 * und nur die Fassung in `/` bekam die Maskierung. `/raw` gab die komplette
 * global_settings-Tabelle roh heraus, samt bricklink_*_secret,
 * brickset_api_key, rebrickable_api_key und smtp_pass, an JEDES angemeldete
 * Konto (der Router trägt nur requireLogin). Und ausgerechnet `/raw` ist die
 * Route, die die Einstellungsseite lädt (public/js/05-settings.js,
 * loadSettings) — die Maskierung war damit für ihren eigentlichen Konsumenten
 * wirkungslos.
 *
 * Jetzt lesen beide durch dieselbe Funktion; eine neue Verpackung kann die
 * Maskierung nicht mehr versehentlich umgehen.
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
