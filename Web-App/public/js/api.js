import { LANG, tRaw } from '../i18n.js';
import { emit } from './events.js';
import { rememberSessionEnd } from './messages.js';
import { receiveResponse, showConnection } from './connection.js';

// The wrapper around the own API. Every call goes through here, so that language, connection banner, session end and
// cache apply the same way for all.

/**
 * Every path to the own API runs through here: language, connection banner and the end of the session (401) then
 * apply to uploads, downloads and streams too. Only throws on a network error or abort; the caller checks
 * the status.
 * @param {string} method
 * @param {string} path  without `/api`, e.g. `/v2/sets`
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
  if (res.status === 401) emit('sessionEnded', path);
  return res;
}

/**
 * JSON of a response whose fields should stay unchanged (e.g. an own
 * `status` that api() would overwrite with the HTTP status). null on a network error,
 * error status or a response that is not JSON.
 * @template {string} M
 * @template {string} P
 * @param {M} method @param {P} path
 * @returns {Promise<import('../../frontend-types/api').ApiData<M, P>>}
 */
export async function apiData(method, path) {
  try {
    const r = await apiRaw(method, path);
    return r.ok ? await r.json() : null;
  } catch (_) {
    return null;
  }
}

/** An error body without `success`: the status and a sentence are added. @param {Record<string, unknown>} data
 * @param {number} status */
function failedBody(data, status) {
  return {
    ...data,
    success: false,
    status,
    error: String(data.error || tRaw('api.server_error', { status })),
  };
}

/** What the session reacts to: an ended session, a password change or a second factor that is due.
 * @param {number} status @param {string} path @param {Record<string, unknown> | null} data */
function afterResponse(status, path, data) {
  if (status === 401 && data?.error && !/^\/v2\/auth\/(me|login)/.test(path)) rememberSessionEnd(String(data.error));
  if (status === 403 && data?.code === 'password_change_required') emit('passwordChangeRequired');
  if (status === 403 && data?.code === 'second_factor_mandatory') emit('secondFactorRequired');
}

/**
 * Call of the own API with a JSON response. Always delivers an object, never an exception: every failure
 * (network, proxy error page, status without `success`) comes as `{ success: false, error, status }`, as from the
 * server. The response type is delivered by the contract (frontend-types/api.d.ts) if the path is written as a literal or
 * template. FormData goes as an upload, everything else as JSON.
 * @template {string} M
 * @template {string} P
 * @param {M} method
 * @param {P} path
 * @param {FormData | object | null} [body]
 * @param {{ signal?: AbortSignal, cache?: RequestCache }} [o]
 * @returns {Promise<import('../../frontend-types/api').ApiResponse<M, P>>}
 */
export async function api(method, path, body, o = {}) {
  let res;
  try {
    res = await apiRaw(method, path, { ...o, body: body ?? null });
  } catch (_) {
    const alt = method === 'GET' ? offCache(path) : null;
    if (alt) return { ...alt, offCache: true };
    return { success: false, error: tRaw('api.unreachable'), networkError: true, status: 0 };
  }
  /** @type {Record<string, unknown> | null} */
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    console.warn('[api]', method, path, 'response is not JSON (status ' + res.status + ')');
    return {
      success: false,
      status: res.status,
      error: res.ok ? tRaw('api.unexpected') : tRaw('api.server_error', { status: res.status }),
    };
  }
  const isObject = !!data && typeof data === 'object';
  if (res.status === 429 && data && isObject) data.waitSec = Number(res.headers.get('Retry-After')) || 0;
  if (!res.ok && data && isObject && data.success === undefined) return failedBody(data, res.status);
  if (data && typeof data === 'object') data.status = res.status;
  if (method === 'GET' && res.ok && data?.success !== false) inCache(path, data);
  afterResponse(res.status, path, data);
  return /** @type {import('../../frontend-types/api').ApiResponse<M, P>} */ (/** @type {unknown} */ (data));
}

/**
 * An event stream of the own API: EventSource with the session cookie, every event as an object according to the
 * contract (`Stream` in frontend-types/contract.d.ts). Without EventSource null; then the caller polls.
 * If the stream breaks off, it is closed, and `error` decides about the fallback.
 * @template {string} P
 * @param {P} path  without `/api`, e.g. `/v2/sets/import/csv/stream`
 * @param {{ event: (e: import('../../frontend-types/api').StreamEvent<P>) => void, error: () => void }} o
 * @returns {{ close: () => void } | null}
 */
export function stream(path, o) {
  if (typeof EventSource === 'undefined') return null;
  let es;
  try {
    es = new EventSource('/api' + path, { withCredentials: true });
  } catch (e) {
    console.warn('[stream]', path, e);
    return null;
  }
  const source = es;
  source.onmessage = m => {
    let e;
    try {
      e = JSON.parse(m.data);
    } catch (_) {
      console.warn('[stream]', path, 'event is not JSON');
      return;
    }
    o.event(e);
  };
  source.onerror = () => {
    source.close();
    o.error();
  };
  return { close: () => source.close() };
}

/**
 * Message text for an exception from fetch(). The browser says "Failed to fetch" or "NetworkError…"; the
 * user should read what it means.
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

// ── Cache for read accesses ─────────────────────────────────────────────────
// Without network, lists show this tab's last loaded state instead of an error. sessionStorage: only
// this tab, gone on logout (emptyCache).
const ZS = 'bim_api:';

const ZS_PATHS = /^\/v2\/(wanted|sets|stats|parts|minifigs|finance\/|catalog\/sets\?)/;

/** @param {string} path @param {unknown} data */
function inCache(path, data) {
  if (!ZS_PATHS.test(path)) return;
  try {
    const s = JSON.stringify(data);
    if (s.length < 400_000) sessionStorage.setItem(ZS + path, s);
  } catch (_) {
    /* full or blocked: then without */
  }
}

/** @param {string} path */
function offCache(path) {
  try {
    const s = sessionStorage.getItem(ZS + path);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

export function emptyCache() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith(ZS)) sessionStorage.removeItem(k);
  } catch (_) {
    /* without storage there is nothing to clear */
  }
}
