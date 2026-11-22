// An API client, not a router: key, quota and resubmission come in through ./access.

import type { z } from 'zod';
import { BsResponse, BsInstructions, BsSets, checkResponse } from './responses';
import { holeHttps, excerpt } from '../src/infra/fetch';
import type { ClientsAccess } from './access';
import { errorMessage, reportError } from '../src/infra/error';
import { asFetchError } from './fetchError';
import { withVersion } from '../src/infra/setNumber';
import { attempts } from '../src/infra/result';

const BASE = 'https://brickset.com/api/v3.asmx';

async function getApiKey(kl: ClientsAccess) {
  return (await kl.schluessel('brickset_api_key')) || '';
}

/** Network and timeout errors of the helper carry isTransient; the caller then re-queues. */
async function httpsGetOnce(url: string): Promise<{ status: number; body: string }> {
  const r = await holeHttps(url, {
    hosts: ['brickset.com'],
    maxBytes: 8 * 1024 * 1024,
    zeitlimitMs: 30_000,
    kopfzeilen: { 'User-Agent': 'BrickInventory/2026.06.17' },
  });
  return { status: r.status, body: r.koerper.toString('utf8') };
}

// A light immediate retry for brief outages before falling back to the (daily)
// retry queue. Only transient errors are repeated.
async function httpsGet(url: string): Promise<{ status: number; body: string }> {
  const MAX_ATTEMPTS = 2;
  for (let i = 1; ; i++) {
    try {
      return await httpsGetOnce(url);
    } catch (e) {
      if ((e as { isTransient?: boolean } | null)?.isTransient && i < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1500 * i));
        continue;
      }
      throw e;
    }
  }
}

// Parse Brickset JSON — throws BricksetQuotaError when daily limit is exceeded
class BricksetQuotaError extends Error {
  isQuota: boolean;
  constructor() {
    super('Daily API key usage limit exceeded');
    this.isQuota = true;
  }
}

function parseResponse<T extends z.ZodType>(body: string, schema: T): z.output<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (_) {
    throw new Error(`Brickset: invalid JSON response: ${excerpt(body)}`);
  }
  // The envelope first: an error response only carries status and message.
  const data = checkResponse('Brickset', BsResponse, raw);
  if (data.status === 'error') {
    if (data.message?.toLowerCase().includes('daily api key usage limit')) throw new BricksetQuotaError();
    const err = Object.assign(new Error(`Brickset API error: ${data.message}`), { detail: data });
    throw err;
  }
  return checkResponse('Brickset', schema, raw);
}

// Check HTTP status — throws BricksetQuotaError on 429 daily limit,
// throws retryable CloudflareRateLimitError on 1015, returns false on other non-200
function checkStatus(status: number, body: string, label: string) {
  if (status === 429) {
    // Distinguish Cloudflare 1015 from Brickset daily quota
    if (body?.includes('1015')) {
      console.log(
        `  Brickset Cloudflare rate limit (1015) for ${label} — retry in 5 min`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      const err = Object.assign(new Error(`Cloudflare rate limit (1015) for ${label}`), { isCloudflare: true });
      throw err;
    }
    console.log(`  Brickset 429 (rate limit) for ${label}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    throw new BricksetQuotaError();
  }
  // Every other status goes to the log: otherwise a 502 would look as if the queue did nothing.
  if (status !== 200)
    console.log(`  Brickset HTTP ${status} for ${label}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
  return status === 200;
}

/** Queue for resubmission; false if the set was already queued too often (then the
 * fallback source applies). `soon` for 5xx of the remote side: they do not depend on the daily quota. */
async function enqueueRetry(kl: ClientsAccess, setNumber: string, errorMsg: string | null = null, soon = false) {
  const r = await attempts('brickset:vormerken', kl.bricksetReserve(setNumber, errorMsg || 'Quota exceeded', soon));
  if (!r.ok) return false;
  const { versuch, vorgemerkt, hoechstens } = r.wert;
  if (!vorgemerkt) {
    console.log(
      `[brickset] ${setNumber}: ${hoechstens} quota retries exceeded — removed from queue, using fallback`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    return false;
  }
  console.log(
    `[brickset] ${setNumber} eingereiht (Versuch ${versuch}/${hoechstens}): ${errorMsg || 'Quota exceeded'}`
      .replace(/\r?\n/g, ' ⏎ ')
      .replace(/\n|\r/g, ''),
  );
  return true;
}

async function checkRateLimit(kl: ClientsAccess, setNumber: string) {
  try {
    const rl = await kl.zaehle('brickset');
    if (!rl.allowed) {
      await enqueueRetry(kl, setNumber, `Tageslimit erreicht (${rl.count}/${rl.limit} Aufrufe)`);
      return false;
    }
    return true;
  } catch (e) {
    // If the quota cannot be read, ask anyway: one call too many is better than a wrong "full".
    reportError('brickset:kontingent', e);
    return true;
  }
}

/** Remove this set from the Brickset retry list. */
async function fromRetryQueue(kl: ClientsAccess, setNumber: string) {
  return kl.bricksetForgotten(setNumber);
}

// Remove from queue when a non-quota error occurs — no point retrying
async function removeFromQueue(kl: ClientsAccess, setNumber: string) {
  await attempts('brickset:wiedervorlage', fromRetryQueue(kl, setNumber));
  console.log(
    `[brickset] ${setNumber}: non-quota error — removed from retry queue, using fallback`
      .replace(/\r?\n/g, ' ⏎ ')
      .replace(/\n|\r/g, ''),
  );
}

async function setDetails(kl: ClientsAccess, setNumber: string) {
  const key = await getApiKey(kl);
  if (!key) return null;
  const n = withVersion(setNumber);
  if (!(await checkRateLimit(kl, n))) return null; // limit reached — enqueued for retry
  try {
    const params = encodeURIComponent(JSON.stringify({ setNumber: n, pageSize: 1 }));
    const { status, body } = await httpsGet(
      `${BASE}/getSets?apiKey=${encodeURIComponent(key)}&userHash=&params=${params}`,
    );
    if (!checkStatus(status, body, n)) return null;
    const s = parseResponse(body, BsSets).sets?.[0];
    if (!s) return null;
    await attempts('brickset:wiedervorlage', fromRetryQueue(kl, n));
    return {
      name: s.name || null,
      year: s.year || null,
      theme: s.theme || null,
      pieces: s.pieces || null,
      minifigs: s.minifigs || null,
      image_url: s.image?.imageURL || s.image?.thumbnailURL || null,
    };
  } catch (e) {
    const f = asFetchError(e);
    if (f.isQuota) {
      const errMsg = f.detail
        ? `HTTP ${f.detail.meta?.code ?? '429'}: ${excerpt(JSON.stringify(f.detail), 300)}`
        : errorMessage(e);
      await enqueueRetry(kl, n, errMsg);
      return null;
    }
    if (f.isTransient) {
      // Timeout / network error is transient (Brickset currently slow/not
      // reachable) → KEEP it in the retry queue instead of giving up for good.
      await enqueueRetry(kl, n, errorMessage(e), true);
      console.log(
        `  Brickset setAngaben transient error for ${n}: ${errorMessage(e)} — für Retry heute eingereiht`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      return null;
    }
    await removeFromQueue(kl, n);
    console.log(
      `  Brickset setAngaben failed for ${n}: ${errorMessage(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''),
    );
    return null;
  }
}

async function getInstructions(kl: ClientsAccess, setNumber: string) {
  const key = await getApiKey(kl);
  if (!key) return { instructions: [], usesFallback: true };
  const n = withVersion(setNumber);
  if (!(await checkRateLimit(kl, n))) return { instructions: [], usesFallback: false }; // limit reached — enqueued, wait for retry
  try {
    const { status, body } = await httpsGet(
      `${BASE}/getInstructions2?apiKey=${encodeURIComponent(key)}&setNumber=${encodeURIComponent(n)}`,
    );
    if (status !== 200) {
      // 5xx is an error of the remote side, not a quota problem.
      const errMsg = `HTTP ${status}: ${excerpt(body, 300)}`;
      console.log(
        `  Brickset getInstructions HTTP ${status} for ${n}: ${excerpt(body)}`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      if (status >= 500) {
        await enqueueRetry(kl, n, errMsg, true);
        return { instructions: [], usesFallback: false };
      }
      await removeFromQueue(kl, n);
      return { instructions: [], usesFallback: true };
    }
    const data = parseResponse(body, BsInstructions);
    const instructions = (data.instructions || []).map(i => ({ url: i.URL, description: i.description }));
    return { instructions, usesFallback: instructions.length === 0 };
  } catch (e) {
    const f = asFetchError(e);
    if (f.isCloudflare) {
      // Cloudflare temporary block — rethrow so instructionQueue can retry in 5 min
      throw e;
    }
    if (f.isQuota) {
      const errMsg = f.detail
        ? `HTTP ${f.detail.meta?.code ?? '429'}: ${excerpt(JSON.stringify(f.detail), 300)}`
        : `Quota exceeded: ${errorMessage(e)}`;
      const requeued = await enqueueRetry(kl, n, errMsg);
      return { instructions: [], usesFallback: !requeued };
    }
    if (f.isTransient) {
      // Timeout / network error is transient → keep it in the retry queue and
      // do NOT switch to the fallback sources right away (usesFallback=false)
      // while a retry is pending.
      const requeued = await enqueueRetry(kl, n, errorMessage(e));
      console.log(
        `  Brickset getInstructions transient error for ${n}: ${errorMessage(e)} — für Retry eingereiht`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      return { instructions: [], usesFallback: !requeued };
    }
    await removeFromQueue(kl, n);
    const detail = f.detail ? ` | response: ${excerpt(JSON.stringify(f.detail), 300)}` : '';
    console.log(
      `  Brickset getInstructions failed for ${n}: ${errorMessage(e)}${detail}`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    return { instructions: [], usesFallback: true };
  }
}

/**
 * Find a set through a free search query — EAN, barcode or order number.
 */
async function findSetByQuery(kl: ClientsAccess, query: string, origin: string) {
  const key = await getApiKey(kl);
  if (!key) return null;
  try {
    const params = encodeURIComponent(JSON.stringify({ query, pageSize: 1 }));
    const { status, body } = await httpsGet(
      `${BASE}/getSets?apiKey=${encodeURIComponent(key)}&userHash=&params=${params}`,
    );
    if (!checkStatus(status, body, `${origin}:${query}`)) return null;
    const s = parseResponse(body, BsSets).sets?.[0];
    if (!s) return null;
    return {
      set_number: `${s.number}-${s.numberVariant}`,
      name: s.name ?? null,
      year: s.year ?? null,
      theme: s.theme ?? null,
      pieces: s.pieces ?? null,
      image_url: s.image?.imageURL || null,
    };
  } catch (e) {
    const f = asFetchError(e);
    if (f.isQuota) {
      console.log(`[brickset] Quota exceeded for ${origin} ${query}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      return null;
    }
    console.log(
      `[brickset] ${origin}-Suche für ${query} fehlgeschlagen: ${errorMessage(e)}`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    return null;
  }
}

/** Check the stored key with Brickset (checkKey does not count against the quota). */
async function checkBricksetAccess(kl: ClientsAccess): Promise<void> {
  const key = await getApiKey(kl);
  if (!key) throw new Error('Brickset API Key nicht konfiguriert.');
  const { status, body } = await httpsGet(`${BASE}/checkKey?apiKey=${encodeURIComponent(key)}`);
  if (status !== 200) throw new Error(`Brickset HTTP ${status}`);
  parseResponse(body, BsResponse);
}

/** One client per access: key, quota and resubmission come from there. */
export function createBrickset(kl: ClientsAccess) {
  return {
    checkBricksetAccess: () => checkBricksetAccess(kl),
    setDetails: (setNumber: string) => setDetails(kl, setNumber),
    getInstructions: (setNumber: string) => getInstructions(kl, setNumber),
    getSetByEan: (ean: string) => findSetByQuery(kl, ean, 'EAN'),
    getSetByBarcode: (barcode: string) => findSetByQuery(kl, barcode, 'barcode'),
    fromRetryQueue: (setNumber: string) => fromRetryQueue(kl, setNumber),
  };
}

export type Brickset = ReturnType<typeof createBrickset>;
