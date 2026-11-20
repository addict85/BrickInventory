// An API client, not a router: key and quota come in through ./access.
import crypto from 'node:crypto';
import { holeHttps, excerpt } from '../src/infra/fetch';
import type { ClientsAccess, KeyName } from './access';

const BASE = 'https://api.bricklink.com/api/store/v1';

async function getCredentials(kl: Pick<ClientsAccess, 'schluessel'>) {
  const schluessel: KeyName[] = [
    'bricklink_consumer_key',
    'bricklink_consumer_secret',
    'bricklink_token',
    'bricklink_token_secret',
  ];
  const rows = await Promise.all(schluessel.map(async key => ({ key, value: await kl.schluessel(key) })));
  const c: Record<string, string> = {};
  rows.forEach(r => {
    c[r.key] = r.value;
  });
  return c;
}

/** The four BrickLink credentials, spelled out: a typo in a name would
 * otherwise look like an expired key (401). */
type BricklinkAccess = {
  bricklink_consumer_key: string;
  bricklink_consumer_secret: string;
  bricklink_token: string;
  bricklink_token_secret: string;
};

// `unknown`: strings AND numbers from the query parameters flow in
// here; the body turns them into String(s).
function pct(s: unknown) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildAuthHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string | number>,
  creds: BricklinkAccess,
) {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const op = {
    oauth_consumer_key: creds.bricklink_consumer_key,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: ts,
    oauth_token: creds.bricklink_token,
    oauth_version: '1.0',
  };
  const all = Object.assign({}, queryParams, op);
  const paramStr = Object.keys(all)
    .sort()
    .map(k => pct(k) + '=' + pct(all[k]))
    .join('&');
  const sigBase = method.toUpperCase() + '&' + pct(baseUrl) + '&' + pct(paramStr);
  const sigKey = pct(creds.bricklink_consumer_secret) + '&' + pct(creds.bricklink_token_secret);
  const sig = crypto.createHmac('sha1', sigKey).update(sigBase).digest('base64');
  const allHeader: Record<string, string> = Object.assign({}, op, { oauth_signature: sig });
  const parts = Object.keys(allHeader)
    .sort()
    .map(k => `${k}="${pct(allHeader[k])}"`)
    .join(', ');
  return `OAuth realm="", ${parts}`;
}

/** Maintenance: BrickLink redirects every request; not an error of the single set. */
class BricklinkNotReachable extends Error {
  code = 'bricklink_nicht_erreichbar';
}

async function httpsGet(url: string, authHeader: string): Promise<{ status: number; body: string; ziel: string }> {
  const r = await holeHttps(url, {
    hosts: ['api.bricklink.com'],
    maxBytes: 8 * 1024 * 1024,
    zeitlimitMs: 20_000,
    redirects: 0,
    kopfzeilen: { Authorization: authHeader, Accept: 'application/json', 'User-Agent': 'BrickManager/3.0' },
  });
  return { status: r.status, body: r.koerper.toString('utf8'), ziel: String(r.kopf.location ?? '') };
}

function targetHost(ziel: string): string {
  try {
    return new URL(ziel).hostname;
  } catch {
    return 'unbekannt';
  }
}

/** Maintenance pages come as HTML; the message therefore shows the start of the body. */
function readJson(body: string, status: number) {
  try {
    return JSON.parse(body);
  } catch (_) {
    throw new Error(`BrickLink non-JSON (HTTP ${status}): ${excerpt(body)}`);
  }
}

async function bricklinkRequest(
  kl: Pick<ClientsAccess, 'schluessel' | 'zaehle'>,
  method: string,
  path: string,
  queryParams: Record<string, string | number> = {},
) {
  const roh = await getCredentials(kl);
  if (
    !roh.bricklink_consumer_key ||
    !roh.bricklink_consumer_secret ||
    !roh.bricklink_token ||
    !roh.bricklink_token_secret
  )
    throw Object.assign(new Error('BrickLink API Zugangsdaten nicht vollständig.'), { code: 'bricklink_zugang_fehlt' });
  // The guard above checks exactly these four fields — so it must also
  // PRODUCE the type, not just claim it. getCredentials() returns
  // a Record<string,string>, and the compiler cannot derive a fixed shape
  // from truthiness checks. This way each of the four names appears exactly once, and
  // a typo is a compile error instead of a 401.
  const creds: BricklinkAccess = {
    bricklink_consumer_key: roh.bricklink_consumer_key,
    bricklink_consumer_secret: roh.bricklink_consumer_secret,
    bricklink_token: roh.bricklink_token,
    bricklink_token_secret: roh.bricklink_token_secret,
  };
  const baseUrl = `${BASE}${path}`;
  const qs = Object.keys(queryParams).length
    ? '?' +
      Object.keys(queryParams)
        .sort()
        .map(k => pct(k) + '=' + pct(queryParams[k]))
        .join('&')
    : '';
  // Counted here, at the only exit to BrickLink: fallbacks (sold →
  // stock, set → gear → book) are calls of their own and cost their own quota.
  const rl = await kl.zaehle('bricklink');
  if (!rl.allowed) throw new Error(`BrickLink Tageslimit erreicht (${rl.limit} Aufrufe/Tag)`);
  const { status, body, ziel } = await httpsGet(baseUrl + qs, buildAuthHeader(method, baseUrl, queryParams, creds));
  if (status >= 300 && status < 400)
    throw new BricklinkNotReachable(
      `BrickLink nicht erreichbar (Umleitung ${status} nach ${targetHost(ziel)}, vermutlich Wartung)`,
    );
  const data = readJson(body, status);
  if (data?.meta && data.meta.code !== 200) {
    const e = Object.assign(new Error(`BrickLink API Error ${data.meta.code}: ${data.meta.message}`), { detail: data });
    throw e;
  }
  return data?.data ?? data;
}

/** A small signed request — for the test button of the setup. */
/** One client per access: key and quota come from there. */
export function createBricklink(kl: Pick<ClientsAccess, 'schluessel' | 'zaehle'>) {
  return {
    bricklinkRequest: (method: string, path: string, queryParams: Record<string, string | number> = {}) =>
      bricklinkRequest(kl, method, path, queryParams),
    checkBricklinkAccess: async (): Promise<void> => {
      await bricklinkRequest(kl, 'GET', '/colors/1');
    },
  };
}

export { BricklinkNotReachable };
