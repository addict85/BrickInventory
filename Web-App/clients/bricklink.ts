// ── Warum diese Datei nicht mehr in routes/ liegt (Nachtrag 131) ────────────
//
// Wie rebrickable.ts und brickset.ts (Nachtrag 126): KEINE einzige Route, nie
// als Router montiert — ein reiner API-Client. Aufgefallen ist es erst jetzt,
// weil utils/setService.ts von hier getItemImageUrl() braucht und ein Modul
// unter utils/ keinen Router importieren soll.
//

import crypto from 'crypto';
import https from 'https';
import * as db from '../db/database';

const BASE = 'https://api.bricklink.com/api/store/v1';

async function getCredentials() {
  const rows = await db.all("SELECT key, value FROM global_settings WHERE key IN ('bricklink_consumer_key','bricklink_consumer_secret','bricklink_token','bricklink_token_secret')");
  const c: Record<string, string> = {};
  rows.forEach(r => { c[r.key] = r.value; });
  return c;
}

function pct(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildAuthHeader(method, baseUrl, queryParams, creds) {
  const ts    = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const op = {
    oauth_consumer_key: creds.bricklink_consumer_key, oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: ts,
    oauth_token: creds.bricklink_token, oauth_version: '1.0',
  };
  const all = Object.assign({}, queryParams, op);
  const paramStr = Object.keys(all).sort().map(k => pct(k) + '=' + pct(all[k])).join('&');
  const sigBase  = method.toUpperCase() + '&' + pct(baseUrl) + '&' + pct(paramStr);
  const sigKey   = pct(creds.bricklink_consumer_secret) + '&' + pct(creds.bricklink_token_secret);
  const sig      = crypto.createHmac('sha1', sigKey).update(sigBase).digest('base64');
  const allHeader = Object.assign({}, op, { oauth_signature: sig });
  const parts = Object.keys(allHeader).sort().map(k => `${k}="${pct(allHeader[k])}"`).join(', ');
  return `OAuth realm="", ${parts}`;
}

function httpsGet(url, authHeader): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search,
      headers: { Authorization: authHeader, Accept: 'application/json', 'User-Agent': 'BrickManager/3.0' },
      timeout: 20000,
      family: 4,
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject).on('timeout', () => reject(new Error('BrickLink timeout')));
  });
}

async function bricklinkRequest(method, path, queryParams = {}) {
  const creds = await getCredentials();
  if (!creds.bricklink_consumer_key || !creds.bricklink_consumer_secret ||
      !creds.bricklink_token || !creds.bricklink_token_secret)
    throw new Error('BrickLink API Zugangsdaten nicht vollständig.');
  const baseUrl = `${BASE}${path}`;
  const qs = Object.keys(queryParams).length
    ? '?' + Object.keys(queryParams).sort().map(k => pct(k) + '=' + pct(queryParams[k])).join('&') : '';
  const { status, body } = await httpsGet(baseUrl + qs, buildAuthHeader(method, baseUrl, queryParams, creds));
  let data;
  try { data = JSON.parse(body); } catch (_) { throw new Error(`BrickLink non-JSON (HTTP ${status}): ${body.substring(0, 200)}`); }
  if (data?.meta && data.meta.code !== 200) {
    const e = Object.assign(new Error(`BrickLink API Error ${data.meta.code}: ${data.meta.message}`), { detail: data });
    throw e;
  }
  return data?.data ?? data;
}

function getItemImageUrl(setNumber) {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  return `https://img.bricklink.com/ItemImage/SN/0/${n}.png`;
}

/** Enthält die Antwort einen brauchbaren Preis? */
function hasUsablePrice(g) {
  return parseFloat(g?.avg_price || 0) > 0 || parseFloat(g?.qty_avg_price || 0) > 0;
}

/**
 * Preisabfrage mit Rückfall von 'sold' auf 'stock'.
 *
 * 'sold' (verkauft, letzte sechs Monate) ist die ehrlichere Grundlage für „was
 * ist meine Sammlung wert" — Angebotspreise enthalten auch das, was niemand
 * zahlt. Aber: Für selten gehandelte Artikel gibt es in sechs Monaten
 * schlicht keinen Verkauf, und BrickLink liefert dann eine Antwort mit
 * avg_price = 0. Ohne Rückfall stünde dort dauerhaft kein Marktpreis.
 *
 * Reihenfolge deshalb: erst 'sold'; liefert das keinen Preis, 'stock'. Das
 * Ergebnis trägt `guide_used`, damit nachvollziehbar bleibt, woher der Wert
 * kommt (und die Anzeige es später kennzeichnen könnte).
 */
async function getPriceGuide(setNumber, condition = 'N', guideType = 'sold', currencyCode = 'EUR') {
  const first = await getPriceGuideRaw(setNumber, condition, guideType, currencyCode);
  if (hasUsablePrice(first) || guideType !== 'sold') {
    return { ...first, guide_used: guideType };
  }
  // Kein Verkauf in sechs Monaten → aktuelle Angebote heranziehen.
  try {
    const alt = await getPriceGuideRaw(setNumber, condition, 'stock', currencyCode);
    if (hasUsablePrice(alt)) return { ...alt, guide_used: 'stock', guide_fallback: true };
  } catch (_) { /* Rückfall ist optional — dann bleibt es beim leeren Ergebnis */ }
  return { ...first, guide_used: guideType };
}

// Vorgabe 'N': Ein Aufruf ohne expliziten Zustand hat vorher den
// GEBRAUCHT-Preis geholt und im Cache abgelegt.
async function getPriceGuideRaw(setNumber, condition = 'N', guideType = 'sold', currencyCode = 'EUR') {
  const n = setNumber.includes('-') ? setNumber : `${setNumber}-1`;
  const bare = n.replace(/-[0-9]+$/, '');
  const params = { guide_type: guideType, new_or_used: condition, currency_code: currencyCode, vat: 'N' };
  const cached = await db.get('SELECT is_gear, bl_type FROM catalog_cache WHERE set_number = $1', [n]);
  if (cached?.bl_type === 'GEAR') return await bricklinkRequest('GET', `/items/gear/${bare}/price`, params);
  if (cached?.bl_type === 'BOOK') return await bricklinkRequest('GET', `/items/book/${bare}/price`, params);
  if (cached?.is_gear === 1 && cached?.bl_type === 'NONE') throw new Error(`${n} — kein BrickLink-Preis verfügbar`);
  try {
    return await bricklinkRequest('GET', `/items/set/${n}/price`, params);
  } catch (e) {
    const code = e.detail?.meta?.code;
    if (code === 404 || code === 400) {
      // Try gear endpoint
      try {
        const result = await bricklinkRequest('GET', `/items/gear/${bare}/price`, params);
        await db.run('INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,0) ON CONFLICT (set_number) DO UPDATE SET bl_type=$3, is_gear=0', [n, `Set ${n}`, 'GEAR']);
        return result;
      } catch (e2) {
        if (e2.detail?.meta?.code !== 404 && e2.detail?.meta?.code !== 400) throw e2;
        // Try book endpoint
        try {
          const result = await bricklinkRequest('GET', `/items/book/${bare}/price`, params);
          await db.run('INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,0) ON CONFLICT (set_number) DO UPDATE SET bl_type=$3, is_gear=0', [n, `Set ${n}`, 'BOOK']);
          return result;
        } catch (e3) {
          if (e3.detail?.meta?.code !== 404 && e3.detail?.meta?.code !== 400) throw e3;
          await db.run('INSERT INTO catalog_cache (set_number, name, bl_type, is_gear) VALUES ($1,$2,$3,1) ON CONFLICT (set_number) DO UPDATE SET bl_type=$3, is_gear=1', [n, `Set ${n}`, 'NONE']);
          throw new Error(`${n} nicht auf BrickLink gefunden (Set/Gear/Book) — kein Preis`);
        }
      }
    }
    throw e;
  }
}

/**
 * Zwischenspeicher leeren — ohne Setnummer den ganzen.
 *
 * Der Parameter war ohne Vorgabe deklariert, obwohl der else-Zweig genau den
 * Aufruf OHNE Argument bedient (Verwaltung → „Alle Caches leeren"). Solange der
 * Aufrufer die Funktion per spätem `require()` holte, fiel das niemandem auf:
 * `require()` liefert `any`, und `any` prüft keine Argumentzahl. Mit dem echten
 * Import meldete tsc es sofort (Nachtrag 132).
 */
async function clearSubsetsCache(sn: string | null = null) {
  if (sn) await db.run('DELETE FROM subsets_cache WHERE set_number = $1', [sn.includes('-') ? sn : `${sn}-1`]);
  else await db.run('DELETE FROM subsets_cache');
}
/** Siehe clearSubsetsCache(): ohne Setnummer der ganze Zwischenspeicher. */
async function clearCatalogCache(sn: string | null = null) {
  if (sn) await db.run('DELETE FROM catalog_cache WHERE set_number = $1', [sn.includes('-') ? sn : `${sn}-1`]);
  else await db.run('DELETE FROM catalog_cache');
}
async function getCacheStats() {
  const [s, c, p] = await Promise.all([
    db.get('SELECT COUNT(*) as c FROM subsets_cache'),
    db.get('SELECT COUNT(*) as c FROM catalog_cache'),
    db.get('SELECT COUNT(*) as c FROM price_cache'),
  ]);
  return { subsets: parseInt(s.c), catalog: parseInt(c.c), prices: parseInt(p.c) };
}

export { bricklinkRequest, getItemImageUrl, getPriceGuide, clearSubsetsCache, clearCatalogCache, getCacheStats };
