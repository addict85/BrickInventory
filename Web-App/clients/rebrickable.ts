// Ein API-Client, kein Router: Deshalb liegt er nicht unter routes/.
import { rebrickableLimiter, consumeRebrickableDaily, rebrickableDailyStatus, parseThrottleWait, rebrickableBackgroundLimiter } from '../src/katalog/rateLimiter';
import { KEINE_FARBE } from '../src/infra/validate';

import { pipeline } from 'stream/promises';
import { holeHttps, oeffneHttps, AbrufFehler } from '../src/infra/abruf';
import path from 'path';
import fs from 'fs';
import { fehlertext, meldeUndLiefere } from '../src/infra/fehler';
import { mitVersion } from '../src/sets/setNummer';
import { getGlobalSetting } from '../src/konto/settings';
import { ERLAUBTE_DOWNLOAD_HOSTS, ERLAUBTE_API_HOSTS, pfadSegment } from '../src/infra/fremdeAdressen';

const BASE = 'https://rebrickable.com/api/v3';


/**
 * Eine Teilezeile, wie sie /lego/sets/{id}/parts liefert.
 * Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#rbsetteil
 */
export type RbSetTeil = {
  part: {
    part_num: string;
    name?: string | null;
    part_img_url?: string | null;
    part_cat_id?: number | null;
    external_ids?: { BrickLink?: string[] };
  };
  color: { id: number; name?: string | null; rgb?: string | null };
  quantity: number;
  is_spare?: boolean;
};

/**
 * Der Rebrickable-Schluessel — aus der zentralen Einstellungs-Lesung.
 * Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#getrbkey
 */
async function getRbKey(): Promise<string | null> {
  return await getGlobalSetting('rebrickable_api_key') || null;
}

/**
 * Ein GET gegen die Rebrickable-API mit Tageskontingent und Drossel. Jeder
 * Fehlschlag (kein Schlüssel, Kontingent, Netz, Status) ist null: Die Aufrufer
 * suchen dann auf dem nächsten Weg weiter.
 */
async function rebrickableJson(pfad: string): Promise<any> {
  const key = await getRbKey();
  if (!key) return null;
  if (!await consumeRebrickableDaily()) {
    console.log(`[rebrickable] Tageslimit erreicht — ${pfad} übersprungen`);
    return null;
  }
  await rebrickableLimiter.waitForSlot();
  const r = await httpsGetRobust(`${BASE}${pfad}`, { Authorization: `key ${key}` }, 8000)
    .catch(meldeUndLiefere(`rebrickable:${pfad}`, null));
  if (!r || r.status !== 200) return null;
  try { return JSON.parse(r.body); } catch (e) { return meldeUndLiefere(`rebrickable:${pfad}`, null)(e); }
}

/** Antworten der Rebrickable-API sind seitenweise; 32 MB fasst jede Seite reichlich. */
const API_MAX_BYTES = 32 * 1024 * 1024;
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Drei Anläufe bei 429 und Netzfehlern; 403 heisst bei Rebrickable „unbekannt". */
async function httpsGetRobust(url: string, headers: Record<string, string> = {}, timeoutMs = 60000): Promise<{ status: number; body: string; buffer: Buffer }> {
  for (let versuch = 1; ; versuch++) {
    let r;
    try {
      r = await holeHttps(url, { hosts: ERLAUBTE_API_HOSTS, maxBytes: API_MAX_BYTES, zeitlimitMs: timeoutMs,
        kopfzeilen: { 'User-Agent': BROWSER_UA, ...headers } });
    } catch (e) {
      if (e instanceof AbrufFehler && e.isTransient && versuch < 3) { await sleep(1500); continue; }
      throw e;
    }
    if (r.status === 429) {
      const wait = parseThrottleWait(r.koerper.toString('utf-8'));
      console.log(`[rebrickable] 429 throttled, waiting ${wait}ms...`);
      rebrickableLimiter.throttle(wait);
      if (versuch < 3) { await sleep(wait); continue; }
      return { status: 429, body: '', buffer: Buffer.alloc(0) };
    }
    if (r.status === 403) return { status: 403, body: '', buffer: Buffer.alloc(0) };
    return { status: r.status, body: r.koerper.toString('utf-8'), buffer: r.koerper };
  }
}

async function rbGet(apiPath: string, params: Record<string, string | number> = {}) {
  const key = await getRbKey();
  if (!key) throw new Error('Rebrickable API Key nicht konfiguriert.');
  await rebrickableLimiter.waitForSlot();
  // Daily cap: 100/day
  if (!await consumeRebrickableDaily()) {
    // Zahl aus dem gemeinsamen Zähler statt hartkodiert — der Text sagte
    // "100/Tag", während das tatsächliche Limit längst bei 4000 lag.
    const { limit } = await rebrickableDailyStatus();
    throw new Error(`Rebrickable Tageslimit erreicht (${limit}/Tag). Versuche es morgen wieder.`);
  }
  const qs = new URLSearchParams({ page_size: '500', ...params }).toString();
  const { status, body } = await httpsGetRobust(`${BASE}${apiPath}?${qs}`, { Authorization: `key ${key}` }, 45000);
  if (status === 404) return null;
  if (status !== 200) throw new Error(`Rebrickable ${status}: ${body.substring(0, 150)}`);
  return JSON.parse(body);
}

const themeCache = new Map();
async function getThemeName(themeId: number | string) {
  if (!themeId) return null;
  if (themeCache.has(themeId)) return themeCache.get(themeId);
  try { const d = await rbGet(`/lego/themes/${pfadSegment(themeId)}/`); const name = d?.name||null; themeCache.set(themeId, name); return name; }
  catch (_) { return null; }
}

/** Die Stammdaten eines Sets; null, wenn Rebrickable es nicht kennt. */
async function holeSet(nummer: string): Promise<any> {
  return rbGet(`/lego/sets/${pfadSegment(nummer)}/`);
}

/**
 * Die Teileliste eines Sets über die API, seitenweise. `verweigert`: Rebrickable
 * antwortete 403 (Set unbekannt oder kein Zugriff) — das soll der Aufrufer merken.
 */
async function holeSetTeile(n: string): Promise<{ teile: any[]; verweigert: boolean }> {
  const key = await getRbKey();
  if (!key) throw new Error('Rebrickable API Key nicht konfiguriert.');
  const allParts: any[] = [];
  let url: string | null = `${BASE}/lego/sets/${pfadSegment(n)}/parts/?page_size=500&inc_part_details=1`;
  let pages = 0;
  while (url && pages++ < 40) {
    if (!await consumeRebrickableDaily()) {
      console.error(`[rebrickable] Tageslimit (${(await rebrickableDailyStatus()).limit}/Tag) erreicht — ${n} übersprungen`);
      break;
    }
    await rebrickableLimiter.waitForSlot();
    let status, body;
    try { ({ status, body } = await httpsGetRobust(url, { Authorization: `key ${key}` }, 60000)); }
    catch (e) { console.error(`  Parts page ${pages} failed: ${fehlertext(e)}`); break; }
    if (status === 403) {
      console.log(`  Parts HTTP 403 for ${n} — set not found or access denied, skipping`);
      return { teile: allParts, verweigert: true };
    }
    if (status === 404) break;
    if (status !== 200) { console.error(`  Parts HTTP ${status}`); break; }
    let data; try { data = JSON.parse(body); } catch (e) { break; }
    allParts.push(...(data.results || []));
    url = data.next || null;
    if (url) await sleep(500);
  }
  return { teile: allParts, verweigert: false };
}

async function scrapeInstructions(setNumber: string) {
  const n = mitVersion(setNumber);
  try {
    const { status, body } = await httpsGetRobust(`https://rebrickable.com/sets/${pfadSegment(n)}/`, { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' }, 8000);
    if (status !== 200) return [];
    const found: any[] = [];
    for (const re of [/href="(https?:\/\/[^"]*lego\.com[^"]*\.pdf[^"]*)"/gi, /href="(https?:\/\/cdn\.rebrickable\.com\/media\/instructions[^"]+\.pdf[^"]*)"/gi, /href="(https?:\/\/assets\.lego\.com[^"]*\.pdf[^"]*)"/gi]) {
      // Der Typ muss hier stehen: Ohne ihn ist `let m` implizit any und der
      // Zugriff m[1] unten ungeprueft (TS7034/TS7005).
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        // Der Treffer wird in eine Konstante gezogen: Innerhalb des
        // find()-Rueckrufs kann der Uebersetzer `m` nicht mehr als
        // nicht-null fuehren — ein Rueckruf koennte grundsaetzlich spaeter
        // laufen, wenn m schon weitergerueckt ist.
        const treffer = m[1];
        if (!found.find(f => f.url === treffer)) found.push({ url: treffer, description: `Anleitung ${n}` });
      }
    }
    return found;
  } catch (_) { return []; }
}

/**
 * Obergrenze je Datei. Eine Bauanleitung hat selten über 150 MB; ohne Grenze
 * füllte ein Server, der endlos sendet, die Platte. Abgebrochen wird im Strom.
 */
export const DOWNLOAD_MAX_BYTES = 300 * 1024 * 1024;

async function downloadFile(url: string, destPath: string, maxBytes = DOWNLOAD_MAX_BYTES) {
  if (fs.existsSync(destPath)) return true;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  // Was hier landet, liefert der Server an jedes Konto aus: deshalb die
  // Hostliste bei jedem Sprung, nicht nur bei der ersten Adresse.
  let antwort;
  try {
    antwort = await oeffneHttps(url, { hosts: ERLAUBTE_DOWNLOAD_HOSTS, maxBytes, zeitlimitMs: 10 * 60_000,
      kopfzeilen: { 'User-Agent': BROWSER_UA, 'Referer': 'https://rebrickable.com/',
                    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
  } catch (e) {
    console.warn(`[download] ${fehlertext(e)}`);
    return false;
  }
  if (antwort.status !== 200) { antwort.verwerfen(); return false; }
  try {
    await pipeline(antwort.strom(), fs.createWriteStream(destPath));
  } catch (e) {
    console.warn(`[download] Abgebrochen: ${fehlertext(e)}`);
    await fs.promises.rm(destPath, { force: true });
    return false;
  }
  if ((await fs.promises.stat(destPath)).size < 100) { await fs.promises.rm(destPath, { force: true }); return false; }
  return true;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }


// ── Minifigs in a set ─────────────────────────────────────────────────────────
async function getSetMinifigs(setNumber: string) {
  const n = mitVersion(setNumber);
  try {
    const key = await getRbKey();
    if (!key) return [];
    // Use background limiter — this is called from background jobs
    await rebrickableBackgroundLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/sets/${pfadSegment(n)}/minifigs/?page_size=100`,
      { Authorization: `key ${key}` }, 30000
    );
    if (status !== 200) return [];
    const data = JSON.parse(body);
    if (!data?.results) return [];
    return data.results.map((m: { id: number; set_num?: string; quantity?: number;
                                 set_name?: string; set_img_url?: string | null }) => ({
      fig_number: m.set_num,
      fig_name:   m.set_name,
      quantity:   m.quantity || 1,
      image_url:  m.set_img_url || null,
    }));
  } catch (e) {
    console.log(`  Minifigs fetch failed for ${n}: ${fehlertext(e)}`);
    return [];
  }
}

// ── Single minifig lookup ─────────────────────────────────────────────────────
async function getMinifigInfo(figNumber: string) {
  try {
    const data = await rbGet(`/lego/minifigs/${pfadSegment(figNumber)}/`);
    if (!data) return null;
    return {
      fig_number: data.set_num || figNumber,
      fig_name:   data.name || null,
      image_url:  data.set_img_url || null,
    };
  } catch (_) { return null; }
}

// ── Get color list ──────────────────────────────────────────────────────
let _colorsCache: any = null;
async function getBrickColors() {
  if (_colorsCache) return _colorsCache;
  try {
    const key = await getRbKey();
    if (!key) return [];
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/colors/?page_size=500`,
      { Authorization: `key ${key}` }, 15000
    );
    if (status !== 200) return [];
    const data = JSON.parse(body);
    _colorsCache = (data.results || []).map((c: { id: number; name?: string;
                                                 rgb?: string | null }) => ({
      id:   c.id,
      name: c.name,
      hex:  c.rgb || null,
    }));
    return _colorsCache;
  } catch (_) { return []; }
}

/**
 * Die Teile einer Minifigur über die API; null, wenn es keine Antwort gibt
 * (kein Schlüssel, Tageslimit, Fehler) — das soll nicht gemerkt werden.
 */
async function holeFigurTeile(figNumber: string): Promise<any[] | null> {
  const key = await getRbKey();
  if (!key) return null;
  if (!await consumeRebrickableDaily()) {
    console.error(`[rebrickable] Tageslimit (${(await rebrickableDailyStatus()).limit}/Tag) erreicht — Minifig-Teile für ${figNumber} übersprungen`);
    return null;
  }
  try {
    await rebrickableLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/minifigs/${pfadSegment(figNumber)}/parts/?page_size=200&inc_part_details=1`,
      { Authorization: `key ${key}` }, 30000
    );
    if (status !== 200) return null;
    const data = JSON.parse(body);
    return (data.results || []).map((r: RbSetTeil) => ({
      part_num:  r.part?.part_num || null,
      color_id:  r.color?.id ?? 0,
      quantity:  r.quantity || 1,
      bl_part_num: r.part?.external_ids?.BrickLink?.[0] || null,
    })).filter((p: { part_num?: string | null }) => p.part_num);
  } catch (e) { return meldeUndLiefere(`rebrickable:figurteile ${figNumber}`, null)(e); }
}


/**
 * ── Warum lookupPart hier steht und nicht mehr in routes/parts.ts ───────────
 * Es ist eine reine Rebrickable-Abfrage: getRbKey(), httpsGetRobust() und die
 * Hintergrunddrossel — alles aus dieser Datei bzw. src/katalog/rateLimiter, nichts
 * aus der Route. Es lag dort, weil die HTTP-Route dort steht, die es ausloest;
 * gebraucht wurde es aber auch von jobs/purchasePriceBackfill.ts, und der
 * musste dafuer aus einer ROUTE importieren.
 */
async function lookupPart(partNumber: string, colorId?: number | null) {
  const key = await getRbKey();
  if (!key) return null;
  try {
    // Use batch endpoint ?part_nums= instead of single /parts/{num}/
    await rebrickableBackgroundLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `https://rebrickable.com/api/v3/lego/parts/?part_nums=${encodeURIComponent(partNumber)}&page_size=1`,
      { Authorization: `key ${key}` }, 15000
    );
    if (status !== 200) return null;
    const d = JSON.parse(body);
    const part = d.results?.[0];
    if (!part) return null;
    let image_url = part.part_img_url || null;

    // Bild soll den Stein immer in der gewählten Farbe zeigen: Rebrickable
    // liefert dafür ein eigenes Farb-Bild über den Parts/Colors-Endpoint.
    // (Der lokale set_parts_catalog-Cache ist meist leer, da er nur Farben
    // enthält, die bereits über ein importiertes Set gesehen wurden.) …
    // Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#lookuppart
    if (colorId !== null && colorId !== undefined && colorId !== KEINE_FARBE) {
      try {
        await rebrickableBackgroundLimiter.waitForSlot();
        const colorResp = await httpsGetRobust(
          `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(partNumber)}/colors/${colorId}/`,
          { Authorization: `key ${key}` }, 15000
        );
        if (colorResp.status === 200) {
          const cd = JSON.parse(colorResp.body);
          if (cd?.part_img_url) image_url = cd.part_img_url;
        }
      } catch (_) { /* fall back to generic part image */ }
    }

    return {
      part_name:     part.name || null,
      category_name: part.part_cat_id ? String(part.part_cat_id) : null,
      image_url,
    };
  } catch (_) { return null; }
}


// BrickLink-Nummer → Rebrickable-Nummer
// Fuer den Import von BrickLink-Wanted-Listen. Die
// Richtung ist die UNGEWOHNTE: Der ganze uebrige Baum geht von Rebrickable
// nach BrickLink (external_ids), weil Rebrickable die Heimatnummer fuehrt.
// Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#abschnitt

/**
 * Traegt dieses Rebrickable-Teil die gesuchte BrickLink-Nummer?
 * Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#traegtblnummer
 */
function traegtBlNummer(teil: unknown, blId: string): boolean {
  const ext = (teil as { external_ids?: Record<string, unknown> } | null)?.external_ids;
  const roh = ext?.['BrickLink'];
  const liste: unknown[] = Array.isArray(roh) ? roh
    : Array.isArray((roh as { ext_ids?: unknown[] } | undefined)?.ext_ids)
      ? (roh as { ext_ids: unknown[] }).ext_ids : [];
  return liste.some(x => String(x).toLowerCase() === blId.toLowerCase());
}

/**
 * Wurde der Filter schon einmal als wirkungslos erkannt?
 *
 * Modulweit und nicht je Aufruf: Die Antwort gilt fuer den Dienst, nicht fuer
 * die Nummer. Zuruecksetzen braucht es nicht — ein Neustart tut es, und bis
 * dahin waere jeder weitere Versuch dieselbe verbrannte Abfrage.
 */
let filterWirkungslos = false;

/**
 * Eine BrickLink-Teilenummer auf eine Rebrickable-Nummer abbilden.
 *
 * @returns die Rebrickable-Nummer, oder null wenn sich keine BELEGEN liess.
 */
async function blTeilZuRb(blId: string): Promise<string | null> {
  // ── Weg 1: die Nummer auf sich selbst pruefen ────────────────────────────
  //
  // Bei den meisten Teilen benutzen beide Dienste dieselbe Nummer. Dann
  // liefert /lego/parts/{nr}/ den Treffer, und external_ids bestaetigt ihn —
  // aus einer VERMUTUNG („die Nummern sind wohl gleich") wird eine Abbildung.
  const direkt = await rbGet(`/lego/parts/${pfadSegment(blId)}/`).catch(() => null);
  if (direkt && traegtBlNummer(direkt, blId)) return String(direkt.part_num);

  // ── Weg 2: der Filter, mit Gegenpruefung ────────────────────────────────
  if (filterWirkungslos) return null;
  const gefiltert = await rbGet('/lego/parts/', { bricklink_id: blId, page_size: 20 })
    .catch(() => null);
  if (!gefiltert) return null;
  // Mehr als tausend Treffer fuer EINE Nummer kann der Filter nicht gemeint
  // haben — dann wurde er ignoriert.
  if (Number(gefiltert.count) > 1000) { filterWirkungslos = true; return null; }
  for (const t of gefiltert.results ?? []) {
    if (traegtBlNummer(t, blId)) return String(t.part_num);
  }
  return null;
}

/** Ob der Filter inzwischen als wirkungslos erkannt wurde — fuer den Bericht. */
function blFilterWirkungslos(): boolean { return filterWirkungslos; }

/** Ein kleiner Abruf mit dem gespeicherten Schlüssel — für den Testknopf der Einrichtung. */
async function pruefeRebrickableZugang(): Promise<void> {
  await rbGet('/lego/themes/', { page_size: 1 });
}

export { rebrickableJson, pruefeRebrickableZugang, lookupPart, holeSet, holeSetTeile, holeFigurTeile, getThemeName, downloadFile, scrapeInstructions,
  getSetMinifigs, getMinifigInfo, getBrickColors, getRbKey, sleep, httpsGetRobust,
  blTeilZuRb, blFilterWirkungslos };
