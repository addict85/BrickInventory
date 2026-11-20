import { LANG, tRaw } from '../i18n.js';
import { emit } from './events.js';
import { rememberSessionEnd } from './messages.js';
import { receiveResponse, showConnection } from './connection.js';

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
export async function apiRaw(method, path, o = {}) {
  /** @type {Record<string, string>} */
  const headers = { 'Accept-Language': LANG, ...o.headers };
  /** @type {RequestInit} */
  const init = { method, headers, credentials: 'same-origin' };
  if (o.body instanceof FormData) init.body = o.body;
  else if (o.body) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(o.body);
  }
  if (o.signal) init.signal = o.signal;
  if (o.cache) init.cache = o.cache;
  let res;
  try {
    res = await fetch('/api' + path, init);
  } catch (e) {
    if (/** @type {{ name?: string } | null} */ (e)?.name !== 'AbortError') {
      console.warn('[api]', method, path, e);
      showConnection(false);
    }
    throw e;
  }
  receiveResponse();
  if (res.status === 401) emit('sitzungBeendet', path);
  return res;
}

/**
 * JSON einer Antwort, deren Felder unverändert bleiben sollen (etwa ein eigenes
 * `status`, das api() mit dem HTTP-Status überschriebe). null bei Netzfehler,
 * Fehlerstatus oder einer Antwort, die kein JSON ist.
 * @template {string} M
 * @template {string} P
 * @param {M} method @param {P} path
 * @returns {Promise<import('../../frontend-types/api').ApiDaten<M, P>>}
 */
export async function apiData(method, path) {
  try {
    const r = await apiRaw(method, path);
    return r.ok ? await r.json() : null;
  } catch (_) {
    return null;
  }
}

/**
 * Aufruf der eigenen API mit JSON-Antwort. Liefert immer ein Objekt, nie eine Ausnahme: Jeder Fehlschlag
 * (Netz, Proxy-Fehlerseite, Status ohne `success`) kommt als `{ success: false, error, status }`, wie vom
 * Server. Den Typ der Antwort liefert der Vertrag (frontend-types/api.d.ts), wenn der Pfad als Literal oder
 * Vorlage dasteht. FormData geht als Upload, alles andere als JSON.
 * @template {string} M
 * @template {string} P
 * @param {M} method
 * @param {P} path
 * @param {FormData | object | null} [body]
 * @param {{ signal?: AbortSignal, cache?: RequestCache }} [o]
 * @returns {Promise<import('../../frontend-types/api').ApiAntwort<M, P>>}
 */
export async function api(method, path, body, o = {}) {
  let res;
  try {
    res = await apiRaw(method, path, { ...o, body: body ?? null });
  } catch (_) {
    const alt = method === 'GET' ? ausZwischenspeicher(path) : null;
    if (alt) return { ...alt, ausZwischenspeicher: true };
    return { success: false, error: tRaw('api.unreachable'), networkError: true, status: 0 };
  }
  /** @type {Record<string, unknown> | null} */
  let daten = null;
  try {
    daten = await res.json();
  } catch (_) {
    console.warn('[api]', method, path, 'Antwort ist kein JSON (Status ' + res.status + ')');
    return {
      success: false,
      status: res.status,
      error: res.ok ? tRaw('api.unexpected') : tRaw('api.server_error', { status: res.status }),
    };
  }
  if (res.status === 429 && daten && typeof daten === 'object')
    daten.waitSec = Number(res.headers.get('Retry-After')) || 0;
  if (!res.ok && daten && typeof daten === 'object' && daten.success === undefined) {
    return {
      ...daten,
      success: false,
      status: res.status,
      error: String(daten.error || tRaw('api.server_error', { status: res.status })),
    };
  }
  if (daten && typeof daten === 'object') daten.status = res.status;
  if (method === 'GET' && res.ok && daten?.success !== false) inCache(path, daten);
  if (res.status === 401 && daten?.error && !/^\/v1\/auth\/(me|login)/.test(path))
    rememberSessionEnd(String(daten.error));
  if (res.status === 403 && daten?.code === 'passwort_wechsel_noetig') emit('passwortWechselNoetig');
  if (res.status === 403 && daten?.code === 'zweiter_faktor_pflicht') emit('zweiterFaktorPflicht');
  return /** @type {import('../../frontend-types/api').ApiAntwort<M, P>} */ (/** @type {unknown} */ (daten));
}

/**
 * Ein Ereignisstrom der eigenen API: EventSource mit dem Sitzungscookie, jedes Ereignis als Objekt nach dem
 * Vertrag (`Strom` in frontend-types/contract.d.ts). Ohne EventSource null; dann fragt der Aufrufer ab.
 * Bricht der Strom ab, ist er geschlossen, und `fehler` entscheidet über den Rückfall.
 * @template {string} P
 * @param {P} path  ohne `/api`, z. B. `/v1/sets/import/csv/stream`
 * @param {{ ereignis: (e: import('../../frontend-types/api').StromEreignis<P>) => void, fehler: () => void }} o
 * @returns {{ schliesse: () => void } | null}
 */
export function strom(path, o) {
  if (typeof EventSource === 'undefined') return null;
  let es;
  try {
    es = new EventSource('/api' + path, { withCredentials: true });
  } catch (e) {
    console.warn('[strom]', path, e);
    return null;
  }
  const quelle = es;
  quelle.onmessage = m => {
    let e;
    try {
      e = JSON.parse(m.data);
    } catch (_) {
      console.warn('[strom]', path, 'Ereignis ist kein JSON');
      return;
    }
    o.ereignis(e);
  };
  quelle.onerror = () => {
    quelle.close();
    o.fehler();
  };
  return { schliesse: () => quelle.close() };
}

/**
 * Meldetext für eine Ausnahme aus fetch(). Der Browser sagt „Failed to fetch“ oder „NetworkError…“; der
 * Nutzer soll lesen, was es heisst.
 * @param {unknown} e
 */
export function errorMessage(e) {
  const text = String(/** @type {{ message?: unknown } | null} */ (e)?.message ?? e ?? '');
  if (
    /failed to fetch|networkerror|load failed|network request failed/i.test(text) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  )
    return tRaw('api.unreachable');
  return text || tRaw('common.unknown_error');
}

// ── Zwischenspeicher für Lesezugriffe ──────────────────────────────────────
// Ohne Netz zeigen Listen den zuletzt geladenen Stand dieses Tabs statt eines Fehlers. sessionStorage: nur
// dieser Tab, weg beim Abmelden (emptyCache).
const ZS = 'bim_api:';

const ZS_PATHS = /^\/v1\/(wanted|sets|stats|parts|minifigs|finance\/|catalog\/sets\?)/;

/** @param {string} pfad @param {unknown} daten */
function inCache(pfad, daten) {
  if (!ZS_PATHS.test(pfad)) return;
  try {
    const s = JSON.stringify(daten);
    if (s.length < 400_000) sessionStorage.setItem(ZS + pfad, s);
  } catch (_) {
    /* voll oder gesperrt: dann ohne */
  }
}

/** @param {string} pfad */
function ausZwischenspeicher(pfad) {
  try {
    const s = sessionStorage.getItem(ZS + pfad);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

export function emptyCache() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(ZS)) sessionStorage.removeItem(k);
  } catch (_) {
    /* ohne Speicher nichts zu leeren */
  }
}
