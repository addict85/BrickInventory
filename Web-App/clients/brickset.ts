// ── Warum diese Datei nicht mehr in routes/ liegt (Nachtrag 126) ────────────
//
// Sie enthält KEINE einzige Route und wird nirgends als Router montiert — sie
// ist ein reiner API-Client. In routes/ zu liegen war ein Erbstück, hatte aber
// Folgen: Wer sie importierte, importierte scheinbar einen Router, und die
// Kreise, die daraus entstanden, wurden mit späten `require()` umgangen.
//

import https from 'https';
import * as db from '../db/database';
import { checkAndIncrementRateLimit } from '../utils/financeCalc';
import { fehlertext } from '../utils/httpError';
import { alsAbrufFehler } from './abrufFehler';
import { mitVersion } from '../utils/setNummer';

const BASE = 'https://brickset.com/api/v3.asmx';

async function getApiKey() {
  return (await db.get("SELECT value FROM global_settings WHERE key='brickset_api_key'"))?.value || '';
}

function httpsGetOnce(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const attempt = (u: string) => {
      const req = https.get(u, { timeout:30000, family: 4, headers:{'User-Agent':'BrickInventory/2026.06.17'} }, res => {
        if (res.statusCode===301||res.statusCode===302) {
          res.resume();
          const ziel = res.headers.location;
          // Eine Umleitung OHNE Location-Kopfzeile ist nicht befolgbar, und
          // hier waere sie teuer: `attempt(undefined)` liefe in
          // https.get(undefined, …), das wirft — AUS EINEM ANTWORT-RUECKRUF
          // heraus, also nicht mehr im Promise-Rumpf. Damit waere es eine
          // uncaughtException, und der Handler in server.ts beendet den Worker
          // (Code 1, der Cluster forkt Ersatz). Also hier abweisen, wo es
          // entsteht. Zweiter Fundort desselben Musters — der erste war
          // clients/rebrickable.ts, dort fing ein `new URL()` in einem try
          // den Fall noch ab.
          if (!ziel) return reject(new Error(
            `Brickset: Umleitung ${res.statusCode} ohne Location-Kopfzeile`));
          return attempt(ziel);
        }
        let body=''; res.on('data',d=>body+=d); res.on('end',()=>resolve({status:res.statusCode ?? 0,body}));
      });
      // Netzwerkfehler (ECONNRESET, ETIMEDOUT, ENOTFOUND, socket hang up, …) sind
      // transient → markieren, damit sie NICHT als permanenter Fehler gelten.
      req.on('error', (err: any) => { err.isTransient = true; reject(err); });
      req.on('timeout', () => {
        req.destroy(); // Socket schliessen, sonst bleibt die Verbindung hängen
        const err: any = new Error('Brickset timeout');
        err.isTransient = true;
        reject(err);
      });
    };
    attempt(url);
  });
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
  try { data = JSON.parse(body); } catch(_) { throw new Error(`Brickset: invalid JSON response: ${body?.substring(0, 200)}`); }
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

const MAX_QUOTA_RETRIES = 30;

// Enqueue for next-day retry due to quota exhaustion
// Returns false if max retries exceeded (entry removed, use fallback)
/**
 * @param {string} setNumber
 * @param {string|null} errorMsg
 * @param {boolean} [soon] Heute erneut versuchen statt morgen. Für vorübergehende
 *        Fehler der Gegenseite (5xx) — die haben mit dem Tageskontingent nichts
 *        zu tun, und einen Tag zu warten ist dafür sinnlos lang.
 */
async function enqueueRetry(setNumber: string, errorMsg: string | null = null, soon = false) {
  const when = new Date();
  if (!soon) when.setDate(when.getDate() + 1);
  const retryDate = when.toISOString().slice(0, 10);

  const existing = await db.get(
    `SELECT attempts FROM brickset_retry_queue WHERE set_number = $1`, [setNumber]
  ).catch(() => null);
  const attempts = (existing?.attempts || 0) + 1;

  if (attempts > MAX_QUOTA_RETRIES) {
    await ausRetryWarteschlange(setNumber).catch(() => {});
    console.log(`[brickset] ${setNumber}: ${MAX_QUOTA_RETRIES} quota retries exceeded — removed from queue, using fallback`);
    return false;
  }

  await db.run(
    `INSERT INTO brickset_retry_queue (set_number, retry_after, attempts, last_error)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (set_number) DO UPDATE SET retry_after=$2, attempts=$3, last_error=$4`,
    [setNumber, retryDate, attempts, errorMsg || 'Quota exceeded']
  ).catch(() => {});
  console.log(`[brickset] ${setNumber} eingereiht für ${retryDate} (Versuch ${attempts}/${MAX_QUOTA_RETRIES}): ${errorMsg || 'Quota exceeded'}`);
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
  return db.run('DELETE FROM brickset_retry_queue WHERE set_number = $1', [setNumber]);
}

// Remove from queue when a non-quota error occurs — no point retrying
async function removeFromQueue(setNumber: string) {
  await ausRetryWarteschlange(setNumber).catch(() => {});
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
    await ausRetryWarteschlange(n).catch(() => {});
    return { name:s.name||null, year:s.year||null, theme:s.theme||null, pieces:s.pieces||null, minifigs:s.minifigs||null, image_url:s.image?.imageURL||s.image?.thumbnailURL||null };
  } catch (e) {
    const f = alsAbrufFehler(e);
    if (f.isQuota) {
      const errMsg = f.detail
        ? `HTTP ${f.detail.meta?.code ?? '429'}: ${JSON.stringify(f.detail)}`
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
      //
      // VORHER wurde JEDER Nicht-200-Status wie eine Kontingentüberschreitung
      // behandelt: ab in die Warteschlange, nächster Versuch MORGEN. Ein
      // "502 Bad Gateway" von Cloudflare — Brickset war für ein paar Sekunden
      // nicht erreichbar — blockierte damit einen Tag lang, und im Monitoring
      // stand eine Fehlermeldung, die nach einem dauerhaften Problem aussah.
      //
      // 5xx: heute erneut versuchen. 4xx (ausser den oben schon behandelten
      // 429): kein Wiederholversuch, direkt auf die Ersatzquelle — ein
      // "400 Bad Request" wird morgen nicht besser.
      const errMsg = `HTTP ${status}: ${body?.substring(0, 500)}`;
      console.log(`  Brickset getInstructions HTTP ${status} for ${n}: ${body?.substring(0, 200)}`);
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
        ? `HTTP ${f.detail.meta?.code ?? '429'}: ${JSON.stringify(f.detail)}`
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
    const detail = f.detail ? ` | response: ${JSON.stringify(f.detail)}` : '';
    console.log(`  Brickset getInstructions failed for ${n}: ${fehlertext(e)}${detail}`);
    return { instructions: [], usesFallback: true };
  }
}

/**
 * Set über eine freie Suchanfrage finden — EAN, Barcode oder Bestellnummer.
 *
 * Es gab diese Funktion zweimal (getSetByEan und getSetByBarcode), Zeichen für
 * Zeichen gleich bis auf die Beschriftung in der Logzeile: Brickset kennt für
 * beides keinen eigenen Parameter, beide schickten dieselbe Volltextsuche.
 * Jetzt eine Umsetzung mit einer Herkunftsangabe fürs Log; die beiden alten
 * Namen bleiben als dünne Hüllen erhalten, damit Aufrufer lesbar bleiben.
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

export { getSetInfo, getInstructions, getSetByEan, getSetByBarcode };
