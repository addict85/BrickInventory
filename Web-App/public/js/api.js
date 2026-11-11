import { LANG, tRaw } from '../i18n.js';
import { melde } from './ereignisse.js';
import { merkeSitzungsende } from './meldungen.js';
import { antwortErhalten, zeigeVerbindung } from './verbindung.js';

// Die Hülle um die eigene API. Jeder Aufruf geht hierüber, damit Sprache, Verbindungsband, Sitzungsende und
// Zwischenspeicher für alle gleich gelten.

/**
 * Jeder Weg zur eigenen API läuft hierüber: Sprache, Verbindungsband und das Ende der Sitzung (401) gelten
 * dann auch für Uploads, Downloads und Ströme. Wirft nur bei Netzfehler oder Abbruch; den Status prüft der
 * Aufrufer.
 * @param {string} method
 * @param {string} path  ohne `/api`, z. B. `/v1/sets`
 * @param {{ body?: FormData | object | null, signal?: AbortSignal, headers?: Record<string, string>, cache?: RequestCache }} [o]
 * @returns {Promise<Response>}
 */
export async function apiRoh(method, path, o = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'Accept-Language': LANG, ...o.headers };
  /** @type {RequestInit} */
  const init = { method, headers, credentials: 'same-origin' };
  if (o.body instanceof FormData) init.body = o.body;
  else if (o.body) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.body); }
  if (o.signal) init.signal = o.signal;
  if (o.cache) init.cache = o.cache;
  let res;
  try {
    res = await fetch('/api' + path, init);
  } catch (e) {
    if (/** @type {{ name?: string } | null} */ (e)?.name !== 'AbortError') { console.warn('[api]', method, path, e); zeigeVerbindung(false); }
    throw e;
  }
  antwortErhalten();
  if (res.status === 401) melde('sitzungBeendet', path);
  return res;
}

/**
 * JSON einer Antwort, deren Felder unverändert bleiben sollen (etwa ein eigenes
 * `status`, das api() mit dem HTTP-Status überschriebe). null bei Netzfehler,
 * Fehlerstatus oder einer Antwort, die kein JSON ist.
 * @template {string} M
 * @template {string} P
 * @param {M} method @param {P} path
 * @returns {Promise<import('../../frontend-typen/api').ApiDaten<M, P>>}
 */
export async function apiDaten(method, path) {
  try {
    const r = await apiRoh(method, path);
    return r.ok ? await r.json() : null;
  } catch (_) { return null; }
}

/**
 * Aufruf der eigenen API mit JSON-Antwort. Liefert immer ein Objekt, nie eine Ausnahme: Jeder Fehlschlag
 * (Netz, Proxy-Fehlerseite, Status ohne `success`) kommt als `{ success: false, error, status }`, wie vom
 * Server. Den Typ der Antwort liefert der Vertrag (frontend-typen/api.d.ts), wenn der Pfad als Literal oder
 * Vorlage dasteht. FormData geht als Upload, alles andere als JSON.
 * @template {string} M
 * @template {string} P
 * @param {M} method
 * @param {P} path
 * @param {FormData | object | null} [body]
 * @param {{ signal?: AbortSignal, cache?: RequestCache }} [o]
 * @returns {Promise<import('../../frontend-typen/api').ApiAntwort<M, P>>}
 */
export async function api(method, path, body, o = {}) {
  let res;
  try {
    res = await apiRoh(method, path, { ...o, body: body ?? null });
  } catch (_) {
    const alt = method === 'GET' ? ausZwischenspeicher(path) : null;
    if (alt) return { ...alt, ausZwischenspeicher: true };
    return { success:false, error:tRaw('api.unreachable'), networkError:true, status:0 };
  }
  /** @type {Record<string, unknown> | null} */
  let daten = null;
  try {
    daten = await res.json();
  } catch (_) {
    console.warn('[api]', method, path, 'Antwort ist kein JSON (Status ' + res.status + ')');
    return { success:false, status:res.status,
             error: res.ok ? tRaw('api.unexpected') : tRaw('api.server_error', { status:res.status }) };
  }
  if (!res.ok && daten && typeof daten === 'object' && daten.success === undefined) {
    return { ...daten, success:false, status:res.status,
             error: String(daten.error || tRaw('api.server_error', { status:res.status })) };
  }
  if (daten && typeof daten === 'object') daten.status = res.status;
  if (method === 'GET' && res.ok && daten?.success !== false) inZwischenspeicher(path, daten);
  if (res.status === 401 && daten?.error && !/^\/v1\/auth\/(me|login)/.test(path)) merkeSitzungsende(String(daten.error));
  if (res.status === 403 && daten?.code === 'passwort_wechsel_noetig') melde('passwortWechselNoetig');
  if (res.status === 403 && daten?.code === 'zweiter_faktor_pflicht') melde('zweiterFaktorPflicht');
  return /** @type {import('../../frontend-typen/api').ApiAntwort<M, P>} */ (/** @type {unknown} */ (daten));
}

/**
 * Meldetext für eine Ausnahme aus fetch(). Der Browser sagt „Failed to fetch“ oder „NetworkError…“; der
 * Nutzer soll lesen, was es heisst.
 * @param {unknown} e
 */
export function fehlerMeldung(e) {
  const text = String(/** @type {{ message?: unknown } | null} */ (e)?.message ?? e ?? '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text) || (typeof navigator !== 'undefined' && navigator.onLine === false))
    return tRaw('api.unreachable');
  return text || tRaw('common.unknown_error');
}

// ── Zwischenspeicher für Lesezugriffe ──────────────────────────────────────
// Ohne Netz zeigen Listen den zuletzt geladenen Stand dieses Tabs statt eines Fehlers. sessionStorage: nur
// dieser Tab, weg beim Abmelden (leereZwischenspeicher).
const ZS = 'bim_api:';

const ZS_PFADE = /^\/v1\/(wanted|sets|stats|parts|minifigs|finance\/|catalog\/sets\?)/;

/** @param {string} pfad @param {unknown} daten */
function inZwischenspeicher(pfad, daten) {
  if (!ZS_PFADE.test(pfad)) return;
  try { const s = JSON.stringify(daten); if (s.length < 400_000) sessionStorage.setItem(ZS + pfad, s); } catch (_) { /* voll oder gesperrt: dann ohne */ }
}

/** @param {string} pfad */
function ausZwischenspeicher(pfad) {
  try { const s = sessionStorage.getItem(ZS + pfad); return s ? JSON.parse(s) : null; } catch (_) { return null; }
}

export function leereZwischenspeicher() {
  try { for (const k of Object.keys(sessionStorage)) if (k.startsWith(ZS)) sessionStorage.removeItem(k); } catch (_) { /* ohne Speicher nichts zu leeren */ }
}
