// ── Warum diese Datei nicht mehr in routes/ liegt ────────────
//
// Wie rebrickable.ts und brickset.ts: KEINE einzige Route, nie
// als Router montiert — ein reiner API-Client. Aufgefallen ist es erst jetzt,
// weil src/sets/setService.ts von hier getItemImageUrl() braucht und ein Modul
// unter utils/ keinen Router importieren soll.
//

import crypto from 'crypto';
import https from 'https';
import { getGlobalSetting } from '../src/konto/settings';
import { mitVersion } from '../src/sets/setNummer';
import { checkAndIncrementRateLimit } from '../src/katalog/apiKontingent';

const BASE = 'https://api.bricklink.com/api/store/v1';

async function getCredentials() {
  const schluessel = ['bricklink_consumer_key', 'bricklink_consumer_secret', 'bricklink_token', 'bricklink_token_secret'];
  const rows = await Promise.all(schluessel.map(async key => ({ key, value: await getGlobalSetting(key) })));
  const c: Record<string, string> = {};
  rows.forEach(r => { c[r.key] = r.value; });
  return c;
}

/**
 * Die vier BrickLink-Zugangsdaten aus den globalen Einstellungen.
 *
 * Ausgeschrieben statt `any`: Ein Tippfehler in einem dieser vier Namen ergaebe
 * `undefined` in der Signatur, und die Anfrage kaeme mit 401 zurueck — ein
 * Fehlerbild, das nach abgelaufenen Schluesseln aussieht statt nach einem
 * Schreibfehler.
 */
type BricklinkZugang = {
  bricklink_consumer_key: string;
  bricklink_consumer_secret: string;
  bricklink_token: string;
  bricklink_token_secret: string;
};

// `unknown`: Hier laufen Zeichenketten UND Zahlen aus den Abfrageparametern
// hinein; der Rumpf macht String(s) daraus.
function pct(s: unknown) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildAuthHeader(method: string, baseUrl: string,
                        queryParams: Record<string, string | number>,
                        creds: BricklinkZugang) {
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
  const allHeader: Record<string, string> = Object.assign({}, op, { oauth_signature: sig });
  const parts = Object.keys(allHeader).sort().map(k => `${k}="${pct(allHeader[k])}"`).join(', ');
  return `OAuth realm="", ${parts}`;
}

function httpsGet(url: string, authHeader: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search,
      headers: { Authorization: authHeader, Accept: 'application/json', 'User-Agent': 'BrickManager/3.0' },
      timeout: 20000,
      family: 4,
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject).on('timeout', () => reject(new Error('BrickLink timeout')));
  });
}

async function bricklinkRequest(method: string, path: string,
                                queryParams: Record<string, string | number> = {}) {
  const roh = await getCredentials();
  if (!roh.bricklink_consumer_key || !roh.bricklink_consumer_secret ||
      !roh.bricklink_token || !roh.bricklink_token_secret)
    throw new Error('BrickLink API Zugangsdaten nicht vollständig.');
  // Der Waechter darueber prueft genau diese vier Felder — er soll den Typ
  // deshalb auch HERSTELLEN und nicht nur behaupten. getCredentials() liefert
  // ein Record<string,string>, und aus Wahrheitspruefungen kann der Uebersetzer
  // keine feste Form ableiten. So steht jeder der vier Namen genau einmal, und
  // ein Schreibfehler ist ein Uebersetzungsfehler statt eines 401.
  const creds: BricklinkZugang = {
    bricklink_consumer_key:    roh.bricklink_consumer_key,
    bricklink_consumer_secret: roh.bricklink_consumer_secret,
    bricklink_token:           roh.bricklink_token,
    bricklink_token_secret:    roh.bricklink_token_secret,
  };
  const baseUrl = `${BASE}${path}`;
  const qs = Object.keys(queryParams).length
    ? '?' + Object.keys(queryParams).sort().map(k => pct(k) + '=' + pct(queryParams[k])).join('&') : '';
  // Gezählt wird hier, am einzigen Ausgang zu BrickLink: Rückfälle (sold →
  // stock, set → gear → book) sind eigene Aufrufe und kosten eigenes Kontingent.
  // Lazy require wie in src/katalog/rateLimiter.ts — preise.ts importiert diese Datei.
  const rl = await checkAndIncrementRateLimit('bricklink');
  if (!rl.allowed) throw new Error(`BrickLink Tageslimit erreicht (${rl.limit} Aufrufe/Tag)`);
  const { status, body } = await httpsGet(baseUrl + qs, buildAuthHeader(method, baseUrl, queryParams, creds));
  let data;
  try { data = JSON.parse(body); } catch (_) { throw new Error(`BrickLink non-JSON (HTTP ${status}): ${body.substring(0, 200)}`); }
  if (data?.meta && data.meta.code !== 200) {
    const e = Object.assign(new Error(`BrickLink API Error ${data.meta.code}: ${data.meta.message}`), { detail: data });
    throw e;
  }
  return data?.data ?? data;
}

function getItemImageUrl(setNumber: string) {
  const n = mitVersion(setNumber);
  return `https://img.bricklink.com/ItemImage/SN/0/${encodeURIComponent(n)}.png`;
}

/** Ein kleiner signierter Abruf — für den Testknopf der Einrichtung. */
async function pruefeBricklinkZugang(): Promise<void> {
  await bricklinkRequest('GET', '/colors/1');
}

export { pruefeBricklinkZugang, bricklinkRequest, getItemImageUrl };
