// Ein API-Client, kein Router: Deshalb liegt er nicht unter routes/.
import { KEINE_FARBE } from '../src/infra/validate';

import { pipeline } from 'stream/promises';
import { holeHttps, oeffneHttps, AbrufFehler } from '../src/infra/abruf';
import path from 'path';
import fs from 'fs';
import { fehlertext, meldeUndLiefere, meldeFehler } from '../src/infra/fehler';
import { mitVersion } from '../src/infra/setNummer';
import { zugang } from './zugang';
import {
  ERLAUBTE_DOWNLOAD_HOSTS,
  ERLAUBTE_API_HOSTS,
  ERLAUBTE_REBRICKABLE_HOSTS,
  hostErlaubt,
  pfadSegment,
} from '../src/infra/fremdeAdressen';

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
  return (await zugang().schluessel('rebrickable_api_key')) || null;
}

/** Im Zweifel durchlassen: Ein überschrittenes Tageskontingent kostet bloss
 * Aufrufe — umgekehrt als beim Login-Zähler, wo der Rückfall sperrt. */
async function tagesKontingentFrei(): Promise<boolean> {
  return zugang()
    .zaehle('rebrickable')
    .then(r => r.allowed, meldeUndLiefere('takt:checkAndIncrementRateLimit', true));
}

const rebrickableDailyStatus = () => zugang().kontingentStand('rebrickable');
const rebrickableLimiter = {
  waitForSlot: () => zugang().drossel.vordergrund.waitForSlot(),
  throttle: (ms: number) => zugang().drossel.vordergrund.throttle(ms),
};
const rebrickableBackgroundLimiter = { waitForSlot: () => zugang().drossel.hintergrund.waitForSlot() };

/** Antwort: {"detail": "… Expected available in 2 seconds."} */
export function parseThrottleWait(body: string) {
  try {
    const data = typeof body === 'string' ? JSON.parse(body) : body;
    const match = data?.detail?.match(/(\d+)\s*second/);
    if (match) return parseInt(match[1]) * 1000 + 500;
  } catch (e) {
    meldeFehler('kontingent:retry-after-lesen', e);
  }
  return 5000;
}

/**
 * Ein GET gegen die Rebrickable-API mit Tageskontingent und Drossel. Jeder
 * Fehlschlag (kein Schlüssel, Kontingent, Netz, Status) ist null: Die Aufrufer
 * suchen dann auf dem nächsten Weg weiter.
 */
async function rebrickableJson(pfad: string): Promise<any> {
  const key = await getRbKey();
  if (!key) return null;
  if (!(await tagesKontingentFrei())) {
    console.log(
      `[rebrickable] Tageslimit erreicht — ${pfad} übersprungen`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''),
    );
    return null;
  }
  await rebrickableLimiter.waitForSlot();
  const r = await httpsGetRobust(`${BASE}${pfad}`, { Authorization: `key ${key}` }, 8000).catch(
    meldeUndLiefere(`rebrickable:${pfad}`, null),
  );
  if (!r || r.status !== 200) return null;
  try {
    return JSON.parse(r.body);
  } catch (e) {
    return meldeUndLiefere(`rebrickable:${pfad}`, null)(e);
  }
}

/** Antworten der Rebrickable-API sind seitenweise; 32 MB fasst jede Seite reichlich. */
const API_MAX_BYTES = 32 * 1024 * 1024;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Drei Anläufe bei 429 und Netzfehlern; 403 heisst bei Rebrickable „unbekannt". */
async function httpsGetRobust(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 60000,
): Promise<{ status: number; body: string; buffer: Buffer }> {
  const hosts = Object.keys(headers).some(k => k.toLowerCase() === 'authorization')
    ? ERLAUBTE_REBRICKABLE_HOSTS
    : ERLAUBTE_API_HOSTS;
  for (let versuch = 1; ; versuch++) {
    let r;
    try {
      r = await holeHttps(url, {
        hosts,
        maxBytes: API_MAX_BYTES,
        zeitlimitMs: timeoutMs,
        kopfzeilen: { 'User-Agent': BROWSER_UA, ...headers },
      });
    } catch (e) {
      if (e instanceof AbrufFehler && e.isTransient && versuch < 3) {
        await sleep(1500);
        continue;
      }
      throw e;
    }
    if (r.status === 429) {
      const wait = parseThrottleWait(r.koerper.toString('utf-8'));
      console.log(`[rebrickable] 429 throttled, waiting ${wait}ms...`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      rebrickableLimiter.throttle(wait);
      if (versuch < 3) {
        await sleep(wait);
        continue;
      }
      return { status: 429, body: '', buffer: Buffer.alloc(0) };
    }
    if (r.status === 403) return { status: 403, body: '', buffer: Buffer.alloc(0) };
    return { status: r.status, body: r.koerper.toString('utf-8'), buffer: r.koerper };
  }
}

/** Ein Abruf ohne eigene Wiederholung: Drossel und Tageskontingent führt der
 * Aufrufer (Hintergrundläufe). Ein Netzfehler ist Status 0, kein Wurf. */
export async function rebrickableRoh(url: string, rbKey: string): Promise<{ status: number; body: string }> {
  return holeHttps(url, {
    hosts: ERLAUBTE_REBRICKABLE_HOSTS,
    maxBytes: API_MAX_BYTES,
    zeitlimitMs: 30_000,
    kopfzeilen: { Authorization: `key ${rbKey}`, 'User-Agent': 'BrickInventory/1.0' },
  }).then(
    r => ({ status: r.status, body: r.koerper.toString('utf8') }),
    (e: unknown) => {
      meldeFehler('rebrickable:abruf', e);
      return { status: 0, body: '' };
    },
  );
}

async function rbGet(apiPath: string, params: Record<string, string | number> = {}) {
  const key = await getRbKey();
  if (!key) throw new Error('Rebrickable API Key nicht konfiguriert.');
  await rebrickableLimiter.waitForSlot();
  if (!(await tagesKontingentFrei())) {
    // Die Zahl aus dem gemeinsamen Zähler, damit der Text dem Limit folgt.
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
  try {
    const d = await rbGet(`/lego/themes/${pfadSegment(themeId)}/`);
    const name = d?.name || null;
    themeCache.set(themeId, name);
    return name;
  } catch (e) {
    return meldeUndLiefere('rebrickable:thema', null)(e);
  }
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
    if (!(await tagesKontingentFrei())) {
      console.error(
        `[rebrickable] Tageslimit (${(await rebrickableDailyStatus()).limit}/Tag) erreicht — ${n} übersprungen`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      break;
    }
    await rebrickableLimiter.waitForSlot();
    let status, body;
    try {
      ({ status, body } = await httpsGetRobust(url, { Authorization: `key ${key}` }, 60000));
    } catch (e) {
      console.error(`  Parts page ${pages} failed: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      break;
    }
    if (status === 403) {
      console.log(
        `  Parts HTTP 403 for ${n} — set not found or access denied, skipping`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
      return { teile: allParts, verweigert: true };
    }
    if (status === 404) break;
    if (status !== 200) {
      console.error(`  Parts HTTP ${status}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
      break;
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch (e) {
      meldeFehler('rebrickable:teile-seite', e);
      break;
    }
    allParts.push(...(data.results || []));
    // Ein fremdes `next` bekäme sonst den Schlüssel.
    url = data.next && hostErlaubt(String(data.next), ERLAUBTE_REBRICKABLE_HOSTS) ? data.next : null;
    if (data.next && !url)
      console.error(
        `  Parts page ${pages}: next zeigt auf einen fremden Host, ${n} bleibt unvollständig`
          .replace(/\r?\n/g, ' ⏎ ')
          .replace(/\n|\r/g, ''),
      );
    if (url) await sleep(500);
  }
  return { teile: allParts, verweigert: false };
}

async function scrapeInstructions(setNumber: string) {
  const n = mitVersion(setNumber);
  try {
    const { status, body } = await httpsGetRobust(
      `https://rebrickable.com/sets/${pfadSegment(n)}/`,
      { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
      8000,
    );
    if (status !== 200) return [];
    const found: any[] = [];
    for (const re of [
      /href="(https?:\/\/[^"]*lego\.com[^"]*\.pdf[^"]*)"/gi,
      /href="(https?:\/\/cdn\.rebrickable\.com\/media\/instructions[^"]+\.pdf[^"]*)"/gi,
      /href="(https?:\/\/assets\.lego\.com[^"]*\.pdf[^"]*)"/gi,
    ]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(body)) !== null) {
        // Als Konstante, weil der Rückruf `m` nicht als nicht-null kennt.
        const treffer = m[1];
        if (!found.find(f => f.url === treffer)) found.push({ url: treffer, description: `Anleitung ${n}` });
      }
    }
    return found;
  } catch (e) {
    return meldeUndLiefere('rebrickable:anleitungen', [])(e);
  }
}

/**
 * Obergrenze je Datei. Eine Bauanleitung hat selten über 150 MB; ohne Grenze
 * füllte ein Server, der endlos sendet, die Platte. Abgebrochen wird im Strom.
 */
export const DOWNLOAD_MAX_BYTES = 300 * 1024 * 1024;

/** `anfang`: Was die Datei einleiten muss (Anleitungen: `%PDF-`), sonst landet sie nicht im gemeinsamen Cache. */
async function downloadFile(url: string, destPath: string, maxBytes = DOWNLOAD_MAX_BYTES, anfang?: Buffer) {
  if (fs.existsSync(destPath)) return true;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  // Was hier landet, liefert der Server an jedes Konto aus: deshalb die
  // Hostliste bei jedem Sprung, nicht nur bei der ersten Adresse.
  let antwort;
  try {
    antwort = await oeffneHttps(url, {
      hosts: ERLAUBTE_DOWNLOAD_HOSTS,
      maxBytes,
      zeitlimitMs: 10 * 60_000,
      kopfzeilen: {
        'User-Agent': BROWSER_UA,
        Referer: 'https://rebrickable.com/',
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });
  } catch (e) {
    console.warn(`[download] ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    return false;
  }
  if (antwort.status !== 200) {
    antwort.verwerfen();
    return false;
  }
  try {
    await pipeline(antwort.strom(), fs.createWriteStream(destPath));
  } catch (e) {
    console.warn(`[download] Abgebrochen: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
    await fs.promises.rm(destPath, { force: true });
    return false;
  }
  if ((await fs.promises.stat(destPath)).size < 100) {
    await fs.promises.rm(destPath, { force: true });
    return false;
  }
  if (anfang && !(await beginntMit(destPath, anfang))) {
    console.warn(
      `[download] Anfang der Datei passt nicht, verworfen: ${url}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''),
    );
    await fs.promises.rm(destPath, { force: true });
    return false;
  }
  return true;
}

async function beginntMit(datei: string, anfang: Buffer): Promise<boolean> {
  const f = await fs.promises.open(datei, 'r');
  try {
    const kopf = Buffer.alloc(anfang.length);
    const { bytesRead } = await f.read(kopf, 0, anfang.length, 0);
    return bytesRead === anfang.length && kopf.equals(anfang);
  } finally {
    await f.close();
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Minifigs in a set ─────────────────────────────────────────────────────────
async function getSetMinifigs(setNumber: string) {
  const n = mitVersion(setNumber);
  try {
    const key = await getRbKey();
    if (!key) return [];
    await rebrickableBackgroundLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/sets/${pfadSegment(n)}/minifigs/?page_size=100`,
      { Authorization: `key ${key}` },
      30000,
    );
    if (status !== 200) return [];
    const data = JSON.parse(body);
    if (!data?.results) return [];
    return data.results.map(
      (m: { id: number; set_num?: string; quantity?: number; set_name?: string; set_img_url?: string | null }) => ({
        fig_number: m.set_num,
        fig_name: m.set_name,
        quantity: m.quantity || 1,
        image_url: m.set_img_url || null,
      }),
    );
  } catch (e) {
    console.log(`  Minifigs fetch failed for ${n}: ${fehlertext(e)}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, ''));
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
      fig_name: data.name || null,
      image_url: data.set_img_url || null,
    };
  } catch (e) {
    return meldeUndLiefere('rebrickable:figur', null)(e);
  }
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
      { Authorization: `key ${key}` },
      15000,
    );
    if (status !== 200) return [];
    const data = JSON.parse(body);
    _colorsCache = (data.results || []).map((c: { id: number; name?: string; rgb?: string | null }) => ({
      id: c.id,
      name: c.name,
      hex: c.rgb || null,
    }));
    return _colorsCache;
  } catch (e) {
    return meldeUndLiefere('rebrickable:farben', [])(e);
  }
}

/**
 * Die Teile einer Minifigur über die API; null, wenn es keine Antwort gibt
 * (kein Schlüssel, Tageslimit, Fehler) — das soll nicht gemerkt werden.
 */
async function holeFigurTeile(figNumber: string): Promise<any[] | null> {
  const key = await getRbKey();
  if (!key) return null;
  if (!(await tagesKontingentFrei())) {
    console.error(
      `[rebrickable] Tageslimit (${(await rebrickableDailyStatus()).limit}/Tag) erreicht — Minifig-Teile für ${figNumber} übersprungen`
        .replace(/\r?\n/g, ' ⏎ ')
        .replace(/\n|\r/g, ''),
    );
    return null;
  }
  try {
    await rebrickableLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `${BASE}/lego/minifigs/${pfadSegment(figNumber)}/parts/?page_size=200&inc_part_details=1`,
      { Authorization: `key ${key}` },
      30000,
    );
    if (status !== 200) return null;
    const data = JSON.parse(body);
    return (data.results || [])
      .map((r: RbSetTeil) => ({
        part_num: r.part?.part_num || null,
        color_id: r.color?.id ?? 0,
        quantity: r.quantity || 1,
        bl_part_num: r.part?.external_ids?.BrickLink?.[0] || null,
      }))
      .filter((p: { part_num?: string | null }) => p.part_num);
  } catch (e) {
    return meldeUndLiefere(`rebrickable:figurteile ${figNumber}`, null)(e);
  }
}

/** Ein Teil samt Bild in der gewählten Farbe; null, wenn Rebrickable nichts liefert. */
async function lookupPart(partNumber: string, colorId?: number | null) {
  const key = await getRbKey();
  if (!key) return null;
  try {
    await rebrickableBackgroundLimiter.waitForSlot();
    const { status, body } = await httpsGetRobust(
      `https://rebrickable.com/api/v3/lego/parts/?part_nums=${encodeURIComponent(partNumber)}&page_size=1`,
      { Authorization: `key ${key}` },
      15000,
    );
    if (status !== 200) return null;
    const d = JSON.parse(body);
    const part = d.results?.[0];
    if (!part) return null;
    let image_url = part.part_img_url || null;

    // Das Bild in der gewählten Farbe kommt nur über den Parts/Colors-Endpunkt.
    // Ausführlich: docs/begruendungen/clients/rebrickable.ts.md#lookuppart
    if (colorId !== null && colorId !== undefined && colorId !== KEINE_FARBE) {
      try {
        await rebrickableBackgroundLimiter.waitForSlot();
        const colorResp = await httpsGetRobust(
          `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(partNumber)}/colors/${colorId}/`,
          { Authorization: `key ${key}` },
          15000,
        );
        if (colorResp.status === 200) {
          const cd = JSON.parse(colorResp.body);
          if (cd?.part_img_url) image_url = cd.part_img_url;
        }
      } catch (e) {
        meldeFehler('rebrickable:farbbild', e);
      }
    }

    return {
      part_name: part.name || null,
      category_name: part.part_cat_id ? String(part.part_cat_id) : null,
      image_url,
    };
  } catch (e) {
    return meldeUndLiefere('rebrickable:teil', null)(e);
  }
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
  const liste: unknown[] = Array.isArray(roh)
    ? roh
    : Array.isArray((roh as { ext_ids?: unknown[] } | undefined)?.ext_ids)
      ? (roh as { ext_ids: unknown[] }).ext_ids
      : [];
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
  const gefiltert = await rbGet('/lego/parts/', { bricklink_id: blId, page_size: 20 }).catch(() => null);
  if (!gefiltert) return null;
  // Mehr als tausend Treffer fuer EINE Nummer kann der Filter nicht gemeint
  // haben — dann wurde er ignoriert.
  if (Number(gefiltert.count) > 1000) {
    filterWirkungslos = true;
    return null;
  }
  for (const t of gefiltert.results ?? []) {
    if (traegtBlNummer(t, blId)) return String(t.part_num);
  }
  return null;
}

/** Ob der Filter inzwischen als wirkungslos erkannt wurde — fuer den Bericht. */
function blFilterWirkungslos(): boolean {
  return filterWirkungslos;
}

/** Ein kleiner Abruf mit dem gespeicherten Schlüssel — für den Testknopf der Einrichtung. */
async function pruefeRebrickableZugang(): Promise<void> {
  await rbGet('/lego/themes/', { page_size: 1 });
}

export {
  rebrickableJson,
  pruefeRebrickableZugang,
  lookupPart,
  holeSet,
  holeSetTeile,
  holeFigurTeile,
  getThemeName,
  downloadFile,
  scrapeInstructions,
  getSetMinifigs,
  getMinifigInfo,
  getBrickColors,
  getRbKey,
  sleep,
  httpsGetRobust,
  blTeilZuRb,
  blFilterWirkungslos,
};
