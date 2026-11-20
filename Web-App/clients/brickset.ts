// Ein API-Client, kein Router: Schlüssel, Kontingent und Wiedervorlage kommen über ./zugang.

import type { z } from 'zod';
import { BsResponse, BsInstructions, BsSets, checkResponse } from './antworten';
import { holeHttps, excerpt } from '../src/infra/abruf';
import type { ClientsAccess } from './zugang';
import { fehlertext, reportError } from '../src/infra/fehler';
import { asFetchError } from './abrufFehler';
import { withVersion } from '../src/infra/setNummer';
import { versuche } from '../src/infra/ergebnis';

const BASE = 'https://brickset.com/api/v3.asmx';

async function getApiKey(kl: ClientsAccess) {
  return (await kl.schluessel('brickset_api_key')) || '';
}

/** Netz- und Zeitfehler des Helfers tragen isTransient; der Aufrufer reiht dann neu ein. */
async function httpsGetOnce(url: string): Promise<{ status: number; body: string }> {
  const r = await holeHttps(url, {
    hosts: ['brickset.com'],
    maxBytes: 8 * 1024 * 1024,
    zeitlimitMs: 30_000,
    kopfzeilen: { 'User-Agent': 'BrickInventory/2026.06.17' },
  });
  return { status: r.status, body: r.koerper.toString('utf8') };
}

// Leichter Sofort-Retry für kurzzeitige Aussetzer, bevor auf die (tägliche)
// Retry-Queue zurückgefallen wird. Nur transiente Fehler werden wiederholt.
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
  let roh: unknown;
  try {
    roh = JSON.parse(body);
  } catch (_) {
    throw new Error(`Brickset: invalid JSON response: ${excerpt(body)}`);
  }
  // Erst die Hülle: Eine Fehlerantwort trägt nur status und message.
  const data = checkResponse('Brickset', BsResponse, roh);
  if (data.status === 'error') {
    if (data.message?.toLowerCase().includes('daily api key usage limit')) throw new BricksetQuotaError();
    const err = Object.assign(new Error(`Brickset API error: ${data.message}`), { detail: data });
    throw err;
  }
  return checkResponse('Brickset', schema, roh);
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
  // Jeder andere Status ins Log: Sonst sähe eine 502 aus, als täte die Warteschlange nichts.
  if (status !== 200)
    console.log(`  Brickset HTTP ${status} for ${label}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
  return status === 200;
}

/** Zur Wiedervorlage vormerken; false, wenn das Set schon zu oft vorgemerkt war (dann gilt
 * die Ausweichquelle). `soon` für 5xx der Gegenseite: Sie hängen nicht am Tageskontingent. */
async function enqueueRetry(kl: ClientsAccess, setNumber: string, errorMsg: string | null = null, soon = false) {
  const r = await versuche('brickset:vormerken', kl.bricksetReserve(setNumber, errorMsg || 'Quota exceeded', soon));
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
    // Lässt sich das Kontingent nicht lesen, wird gefragt: lieber ein Abruf zu viel als ein falsches „voll“.
    reportError('brickset:kontingent', e);
    return true;
  }
}

/** Dieses Set aus der Brickset-Wiederholungsliste nehmen. */
async function fromRetryQueue(kl: ClientsAccess, setNumber: string) {
  return kl.bricksetForgotten(setNumber);
}

// Remove from queue when a non-quota error occurs — no point retrying
async function removeFromQueue(kl: ClientsAccess, setNumber: string) {
  await versuche('brickset:wiedervorlage', fromRetryQueue(kl, setNumber));
  console.log(
    `[brickset] ${setNumber}: non-quota error — removed from retry queue, using fallback`
      .replace(/\r?\n/g, ' ⏎ ')
      .replace(/\n|\r/g, ''),
  );
}

async function setAngaben(kl: ClientsAccess, setNumber: string) {
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
    await versuche('brickset:wiedervorlage', fromRetryQueue(kl, n));
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
        : fehlertext(e);
      await enqueueRetry(kl, n, errMsg);
      return null;
    }
    if (f.isTransient) {
      // Timeout / Netzwerkfehler ist transient (Brickset gerade langsam/nicht
      // erreichbar) → in der Retry-Queue BEHALTEN statt dauerhaft aufzugeben.
      await enqueueRetry(kl, n, fehlertext(e), true);
      console.log(
        `  Brickset setAngaben transient error for ${n}: ${fehlertext(e)} — für Retry heute eingereiht`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      return null;
    }
    await removeFromQueue(kl, n);
    console.log(
      `  Brickset setAngaben failed for ${n}: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''),
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
      // 5xx ist ein Fehler der Gegenseite, kein Kontingentproblem.
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
        : `Quota exceeded: ${fehlertext(e)}`;
      const requeued = await enqueueRetry(kl, n, errMsg);
      return { instructions: [], usesFallback: !requeued };
    }
    if (f.isTransient) {
      // Timeout / Netzwerkfehler ist transient → in der Retry-Queue behalten und
      // NICHT sofort auf die Fallback-Quellen ausweichen (usesFallback=false),
      // solange ein Retry ansteht.
      const requeued = await enqueueRetry(kl, n, fehlertext(e));
      console.log(
        `  Brickset getInstructions transient error for ${n}: ${fehlertext(e)} — für Retry eingereiht`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      return { instructions: [], usesFallback: !requeued };
    }
    await removeFromQueue(kl, n);
    const detail = f.detail ? ` | response: ${excerpt(JSON.stringify(f.detail), 300)}` : '';
    console.log(
      `  Brickset getInstructions failed for ${n}: ${fehlertext(e)}${detail}`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    return { instructions: [], usesFallback: true };
  }
}

/**
 * Set über eine freie Suchanfrage finden — EAN, Barcode oder Bestellnummer.
 */
async function findSetByQuery(kl: ClientsAccess, query: string, herkunft: string) {
  const key = await getApiKey(kl);
  if (!key) return null;
  try {
    const params = encodeURIComponent(JSON.stringify({ query, pageSize: 1 }));
    const { status, body } = await httpsGet(
      `${BASE}/getSets?apiKey=${encodeURIComponent(key)}&userHash=&params=${params}`,
    );
    if (!checkStatus(status, body, `${herkunft}:${query}`)) return null;
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
      console.log(`[brickset] Quota exceeded for ${herkunft} ${query}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      return null;
    }
    console.log(
      `[brickset] ${herkunft}-Suche für ${query} fehlgeschlagen: ${fehlertext(e)}`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    return null;
  }
}

/** Den gespeicherten Schlüssel bei Brickset prüfen (checkKey zählt nicht gegen das Kontingent). */
async function checkBricksetAccess(kl: ClientsAccess): Promise<void> {
  const key = await getApiKey(kl);
  if (!key) throw new Error('Brickset API Key nicht konfiguriert.');
  const { status, body } = await httpsGet(`${BASE}/checkKey?apiKey=${encodeURIComponent(key)}`);
  if (status !== 200) throw new Error(`Brickset HTTP ${status}`);
  parseResponse(body, BsResponse);
}

/** Ein Klient je Zugang: Schlüssel, Kontingent und Wiedervorlage kommen von dort. */
export function createBrickset(kl: ClientsAccess) {
  return {
    checkBricksetAccess: () => checkBricksetAccess(kl),
    setAngaben: (setNumber: string) => setAngaben(kl, setNumber),
    getInstructions: (setNumber: string) => getInstructions(kl, setNumber),
    getSetByEan: (ean: string) => findSetByQuery(kl, ean, 'EAN'),
    getSetByBarcode: (barcode: string) => findSetByQuery(kl, barcode, 'barcode'),
    fromRetryQueue: (setNumber: string) => fromRetryQueue(kl, setNumber),
  };
}

export type Brickset = ReturnType<typeof createBrickset>;
