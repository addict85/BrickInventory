// Ein API-Client, kein Router: Deshalb liegt er nicht unter routes/.

import { holeHttps, auszug } from '../src/infra/abruf';
import { getGlobalSetting } from '../src/konto/settings';
import { checkAndIncrementRateLimit } from '../src/katalog/apiKontingent';
import { fehlertext, meldeUndLiefere } from '../src/infra/fehler';
import { alsAbrufFehler } from './abrufFehler';
import { mitVersion } from '../src/sets/setNummer';
import { bricksetVormerken, bricksetAusWiedervorlage, BRICKSET_HOECHSTENS } from '../src/auftraege/bricksetAuftrag';

const BASE = 'https://brickset.com/api/v3.asmx';

async function getApiKey() {
  return (await getGlobalSetting('brickset_api_key')) || '';
}

/** Netz- und Zeitfehler des Helfers tragen isTransient; der Aufrufer reiht dann neu ein. */
async function httpsGetOnce(url: string): Promise<{ status: number; body: string }> {
  const r = await holeHttps(url, { hosts: ['brickset.com'], maxBytes: 8 * 1024 * 1024, zeitlimitMs: 30_000,
    kopfzeilen: { 'User-Agent': 'BrickInventory/2026.06.17' } });
  return { status: r.status, body: r.koerper.toString('utf8') };
}

// Leichter Sofort-Retry für kurzzeitige Aussetzer, bevor auf die (tägliche)
// Retry-Queue zurückgefallen wird. Nur transiente Fehler werden wiederholt.
async function httpsGet(url: string): Promise<{ status: number; body: string }> {
  const MAX_ATTEMPTS = 2;
  for (let i = 1; ; i++) {
    try {
      return await httpsGetOnce(url);
    } catch (e: any) {
      if (e?.isTransient && i < MAX_ATTEMPTS) {
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
  constructor() { super('Daily API key usage limit exceeded'); this.isQuota = true; }
}

function parseResponse(body: string) {
  let data;
  try { data = JSON.parse(body); } catch(_) { throw new Error(`Brickset: invalid JSON response: ${auszug(body)}`); }
  if (data.status === 'error') {
    if (data.message?.toLowerCase().includes('daily api key usage limit')) throw new BricksetQuotaError();
    const err = Object.assign(new Error(`Brickset API error: ${data.message}`), { detail: data });
    throw err;
  }
  return data;
}

// Check HTTP status — throws BricksetQuotaError on 429 daily limit,
// throws retryable CloudflareRateLimitError on 1015, returns false on other non-200
function checkStatus(status: number, body: string, label: string) {
  if (status === 429) {
    // Distinguish Cloudflare 1015 from Brickset daily quota
    if (body && body.includes('1015')) {
      console.log(`  Brickset Cloudflare rate limit (1015) for ${label} — retry in 5 min`);
      const err = Object.assign(new Error(`Cloudflare rate limit (1015) for ${label}`), { isCloudflare: true });
      throw err;
    }
    console.log(`  Brickset 429 (rate limit) for ${label}`);
    throw new BricksetQuotaError();
  }
  // Jeden anderen Nicht-200-Status protokollieren.
  //
  // VORHER wurde hier stillschweigend `false` geliefert; getSetInfo() gab
  // daraufhin null zurück, ohne eine Zeile zu schreiben. Im Log stand dann nur
  // "Retry queue processing done (0/1 processed)" — ohne jeden Hinweis, WARUM
  // nichts verarbeitet wurde. Bei einem 502 von Cloudflare (Brickset kurz
  // nicht erreichbar) sah das aus, als täte die Warteschlange gar nichts.
  if (status !== 200) console.log(`  Brickset HTTP ${status} for ${label}`);
  return status === 200;
}


/**
 * Zur Wiedervorlage vormerken (src/auftraege/bricksetAuftrag.ts); false, wenn das Set
 * schon zu oft vorgemerkt war — dann gilt die Ausweichquelle.
 * @param {string} setNumber
 * @param {string|null} errorMsg
 * @param {boolean} [soon] Bald erneut versuchen statt zur Tageszeit. Für vorübergehende
 *        Fehler der Gegenseite (5xx) — die haben mit dem Tageskontingent nichts
 *        zu tun, und einen Tag zu warten ist dafür sinnlos lang.
 */
async function enqueueRetry(setNumber: string, errorMsg: string | null = null, soon = false) {
  const { versuch, vorgemerkt } = await bricksetVormerken(setNumber, errorMsg || 'Quota exceeded', soon)
    .catch(meldeUndLiefere('brickset:vormerken', { versuch: 0, vorgemerkt: true }));
  if (!vorgemerkt) {
    console.log(`[brickset] ${setNumber}: ${BRICKSET_HOECHSTENS} quota retries exceeded — removed from queue, using fallback`);
    return false;
  }
  console.log(`[brickset] ${setNumber} eingereiht (Versuch ${versuch}/${BRICKSET_HOECHSTENS}): ${errorMsg || 'Quota exceeded'}`);
  return true;
}

async function checkRateLimit(setNumber: string) {
  try {
    const rl = await checkAndIncrementRateLimit('brickset', 100);
    if (!rl.allowed) {
      await enqueueRetry(setNumber, `Tageslimit erreicht (${rl.count}/${rl.limit} Aufrufe)`);
      return false;
    }
    return true;
  } catch(_) {
    return true;
  }
}

/** Dieses Set aus der Brickset-Wiederholungsliste nehmen. */
export async function ausRetryWarteschlange(setNumber: string) {
  return bricksetAusWiedervorlage(setNumber);
}

// Remove from queue when a non-quota error occurs — no point retrying
async function removeFromQueue(setNumber: string) {
  await ausRetryWarteschlange(setNumber).catch(meldeUndLiefere('brickset:wiedervorlage', undefined));
  console.log(`[brickset] ${setNumber}: non-quota error — removed from retry queue, using fallback`);
}

async function getSetInfo(setNumber: string) {
  const key = await getApiKey();
  if (!key) return null;
  const n = mitVersion(setNumber);
  if (!await checkRateLimit(n)) return null; // limit reached — enqueued for retry
  try {
    const params = encodeURIComponent(JSON.stringify({ setNumber: n, pageSize: 1 }));
    const { status, body } = await httpsGet(`${BASE}/getSets?apiKey=${encodeURIComponent(key)}&userHash=&params=${params}`);
    if (!checkStatus(status, body, n)) return null;
    const data = parseResponse(body);
    if (!data.sets?.length) return null;
    const s = data.sets[0];
    await ausRetryWarteschlange(n).catch(meldeUndLiefere('brickset:wiedervorlage', undefined));
    return { name:s.name||null, year:s.year||null, theme:s.theme||null, pieces:s.pieces||null, minifigs:s.minifigs||null, image_url:s.image?.imageURL||s.image?.thumbnailURL||null };
  } catch (e) {
    const f = alsAbrufFehler(e);
    if (f.isQuota) {
      const errMsg = f.detail
        ? `HTTP ${f.detail.meta?.code ?? '429'}: ${auszug(JSON.stringify(f.detail), 300)}`
        : fehlertext(e);
      await enqueueRetry(n, errMsg);
      return null;
    }
    if (f.isTransient) {
      // Timeout / Netzwerkfehler ist transient (Brickset gerade langsam/nicht
      // erreichbar) → in der Retry-Queue BEHALTEN statt dauerhaft aufzugeben.
      await enqueueRetry(n, fehlertext(e), true);
      console.log(`  Brickset getSetInfo transient error for ${n}: ${fehlertext(e)} — für Retry heute eingereiht`);
      return null;
    }
    await removeFromQueue(n);
    console.log(`  Brickset getSetInfo failed for ${n}: ${fehlertext(e)}`);
    return null;
  }
}

async function getInstructions(setNumber: string) {
  const key = await getApiKey();
  if (!key) return { instructions: [], usesFallback: true };
  const n = mitVersion(setNumber);
  if (!await checkRateLimit(n)) return { instructions: [], usesFallback: false }; // limit reached — enqueued, wait for retry
  try {
    const { status, body } = await httpsGet(`${BASE}/getInstructions2?apiKey=${encodeURIComponent(key)}&setNumber=${encodeURIComponent(n)}`);
    if (status !== 200) {
      // 5xx ist ein Fehler der Gegenseite, kein Kontingentproblem.
      // Ausführlich: docs/begruendungen/clients/brickset.ts.md#getinstructions-errmsg
      const errMsg = `HTTP ${status}: ${auszug(body, 300)}`;
      console.log(`  Brickset getInstructions HTTP ${status} for ${n}: ${auszug(body)}`);
      if (status >= 500) {
        await enqueueRetry(n, errMsg, true);
        return { instructions: [], usesFallback: false };
      }
      await removeFromQueue(n);
      return { instructions: [], usesFallback: true };
    }
    const data = parseResponse(body);
    const instructions = (data.instructions || [])
      .map((i: { URL: string; description?: string | null }) => ({ url: i.URL, description: i.description }));
    return { instructions, usesFallback: instructions.length === 0 };
  } catch (e) {
    const f = alsAbrufFehler(e);
    if (f.isCloudflare) {
      // Cloudflare temporary block — rethrow so instructionQueue can retry in 5 min
      throw e;
    }
    if (f.isQuota) {
      const errMsg = f.detail
        ? `HTTP ${f.detail.meta?.code ?? '429'}: ${auszug(JSON.stringify(f.detail), 300)}`
        : `Quota exceeded: ${fehlertext(e)}`;
      const requeued = await enqueueRetry(n, errMsg);
      return { instructions: [], usesFallback: !requeued };
    }
    if (f.isTransient) {
      // Timeout / Netzwerkfehler ist transient → in der Retry-Queue behalten und
      // NICHT sofort auf die Fallback-Quellen ausweichen (usesFallback=false),
      // solange ein Retry ansteht.
      const requeued = await enqueueRetry(n, fehlertext(e));
      console.log(`  Brickset getInstructions transient error for ${n}: ${fehlertext(e)} — für Retry eingereiht`);
      return { instructions: [], usesFallback: !requeued };
    }
    await removeFromQueue(n);
    const detail = f.detail ? ` | response: ${auszug(JSON.stringify(f.detail), 300)}` : '';
    console.log(`  Brickset getInstructions failed for ${n}: ${fehlertext(e)}${detail}`);
    return { instructions: [], usesFallback: true };
  }
}

/**
 * Set über eine freie Suchanfrage finden — EAN, Barcode oder Bestellnummer.
 * Ausführlich: docs/begruendungen/clients/brickset.ts.md#findsetbyquery
 */
async function findSetByQuery(query: string, herkunft: string) {
  const key = await getApiKey();
  if (!key) return null;
  try {
    const params = encodeURIComponent(JSON.stringify({ query, pageSize: 1 }));
    const { status, body } = await httpsGet(`${BASE}/getSets?apiKey=${encodeURIComponent(key)}&userHash=&params=${params}`);
    if (!checkStatus(status, body, `${herkunft}:${query}`)) return null;
    const data = parseResponse(body);
    if (!data.sets?.length) return null;
    const s = data.sets[0];
    return { set_number:`${s.number}-${s.numberVariant}`, name:s.name, year:s.year, theme:s.theme, pieces:s.pieces, image_url:s.image?.imageURL||null };
  } catch (e) {
    const f = alsAbrufFehler(e);
    if (f.isQuota) { console.log(`[brickset] Quota exceeded for ${herkunft} ${query}`); return null; }
    console.log(`[brickset] ${herkunft}-Suche für ${query} fehlgeschlagen: ${fehlertext(e)}`);
    return null;
  }
}

const getSetByEan     = (ean: string)     => findSetByQuery(ean, 'EAN');
const getSetByBarcode = (barcode: string) => findSetByQuery(barcode, 'barcode');

/** Den gespeicherten Schlüssel bei Brickset prüfen (checkKey zählt nicht gegen das Kontingent). */
async function pruefeBricksetZugang(): Promise<void> {
  const key = await getApiKey();
  if (!key) throw new Error('Brickset API Key nicht konfiguriert.');
  const { status, body } = await httpsGet(`${BASE}/checkKey?apiKey=${encodeURIComponent(key)}`);
  if (status !== 200) throw new Error(`Brickset HTTP ${status}`);
  parseResponse(body);
}

export { pruefeBricksetZugang, getSetInfo, getInstructions, getSetByEan, getSetByBarcode };
