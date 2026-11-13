/** Füllt set_parts_catalog aus der Rebrickable-API, damit die Teileliste eines
 * Sets Namen und Bilder hat. Bilder werden im Hintergrund geladen; bis dahin
 * gilt die CDN-Adresse. */
import {
  cdnImageLimiter,
  rebrickableBackgroundLimiter as rebrickableLimiter,
  consumeRebrickableDaily,
} from './rateLimiter';
import { meldeFehler, fehlertext, logAndContinue, ohneFehlendeDatei } from '../infra/fehler';
import { neuestesInventar } from './rbInventar';
import { mitVersion } from '../infra/setNummer';
import { merkeBlNummer } from './blZuordnung';
import {
  merkeTeil,
  merkeTeilFarbe,
  merkeSetTeil,
  setzeTeilBildLokal,
  merkeFiguren,
  merkeSetFiguren,
  setzeFigurBildLokal,
} from './katalogPflege';
import { getRbKey, downloadFile, parseThrottleWait as ptw, rebrickableRoh, BILD_KOPFZEILEN } from './quellen';

/** Ohne Typparameter leitet TypeScript bei `new Promise` `unknown` ab. */
type JobHttpResult = { status: number; body: string };

// Teile- und Figurenbilder liegen in getrennten Ordnern; downloadImage()
// bekommt deshalb die Art mit.
import { bildEndung, dateiTeil, zielImOrdner, ladeBild } from './bilder/bildDatei';
import { ERLAUBTE_BILD_HOSTS, pfadSegment, nummernListe } from '../infra/fremdeAdressen';
import { pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import * as repo from './repository/teileAnreicherung';
import fs from 'node:fs';
import type { PoolClient } from 'pg';
import path from 'node:path';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { generateThumb } from './bilder/thumbs';
import { KEINE_FARBE } from '../infra/validate';
import { versuche } from '../infra/ergebnis';
import type { KatalogKontext } from './kontext';

async function apiGet(k: KatalogKontext, url: string, rbKey: string) {
  let serverErrors = 0;
  while (true) {
    if (!(await consumeRebrickableDaily(k))) return null;
    await rebrickableLimiter.waitForSlot();
    const result: JobHttpResult = await rebrickableRoh(url, rbKey);
    if (result.status === 429) {
      const wait = ptw(result.body);
      rebrickableLimiter.throttle(wait);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (result.status >= 500 || result.status === 0) {
      if (serverErrors++ === 0) {
        await new Promise(r => setTimeout(r, 10000));
        continue;
      }
      return null;
    }
    if (result.status !== 200) return null;
    try {
      return JSON.parse(result.body);
    } catch (_) {
      return null;
    }
  }
}

/** @param kind Bestimmt Zielverzeichnis und Web-Pfad. */
async function downloadImage(
  imgUrl: string | null | undefined,
  partNum: string,
  colorId: number,
  kind: 'part' | 'minifig',
): Promise<string | null> {
  if (!imgUrl) return null;
  const IMG_DIR = kind === 'minifig' ? MINIFIG_IMAGES_DIR : PART_IMAGES_DIR;
  const webBase = kind === 'minifig' ? '/images/minifigs/' : '/images/parts/';
  // Nummer und Adresse kommen bei manuellen Teilen vom Nutzer: Sie dürfen weder
  // einen Pfad bilden noch die Endung bestimmen.
  const nummer = dateiTeil(partNum),
    farbe = dateiTeil(colorId);
  if (!nummer || !farbe) return null;
  const file = `${nummer}_${farbe}.${bildEndung(imgUrl)}`;
  const dest = zielImOrdner(IMG_DIR, file);
  if (!dest) return null;
  const rel = `${webBase}${file}`;
  if (fs.existsSync(dest)) return rel;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  if (!(await ladeBild(imgUrl, dest, ERLAUBTE_BILD_HOSTS, BILD_KOPFZEILEN))) return null;
  try {
    await generateThumb(rel).catch(logAndContinue('teile-enrich:generateThumb'));
  } catch (e) {
    meldeFehler('teile-enrich:vorschau', e);
  }
  return rel;
}

async function enrichSetParts(k: KatalogKontext, setNumber: string) {
  const n = mitVersion(setNumber);

  const invId = await neuestesInventar(k, setNumber);
  if (!invId) return;

  const csvParts = await k.teileAnreicherung.teileDesInventars(invId);
  if (!csvParts.length) return;

  const catalogRows = await k.teileAnreicherung.setTeileKatalog(n);
  const catalogMap: Record<
    string,
    { image_url: string | null; image_local: string | null; bl_part_number?: string | null }
  > = {};
  for (const r of catalogRows) catalogMap[`${r.part_number}|${r.color_id}`] = r;

  // Die ZEILE in bl_zuordnung zählt, nicht ihr Wert: leer heisst „nachgesehen,
  // keine abweichende Nummer".
  const lookedUp = await k.teileAnreicherung.blZuordnungen(csvParts.map(p => p.part_num));
  const lookedUpSet = new Set(lookedUp.map((r: { rb_id: string }) => r.rb_id));

  // Nur Teile, die noch nie nachgesehen wurden — jeder Abruf kostet Kontingent.
  const missing = csvParts.filter(p => {
    const cat = catalogMap[`${p.part_num}|${p.color_id}`];
    if (!cat) return true; // not in catalog at all
    if (!cat.bl_part_number) return true; // in catalog but no BL ID
    if (!lookedUpSet.has(p.part_num)) return true; // never looked up via API
    return false; // has BL ID and was looked up → skip
  });

  if (!missing.length) return;

  const rbKey = await getRbKey();
  if (!rbKey) {
    console.log('[parts-enrich] No API key');
    return;
  }

  const apiParts = await holeApiTeile(k, n, rbKey);
  await ergaenzeBlNummern(k, apiParts, [...new Set(csvParts.map(p => p.part_num))], rbKey);
  await merkeTeileDesSets(k, n, csvParts, apiParts);
  await ergaenzeSetFiguren(k, n, rbKey);
}

type ApiTeil = {
  part_name: string;
  bl_part_num: string | null;
  image_url: string | null;
  color_name: string;
  color_hex: string;
  quantity: number;
};

/** Die Teile des Sets laut Rebrickable, je "part_num|color_id". */
async function holeApiTeile(k: KatalogKontext, n: string, rbKey: string): Promise<Record<string, ApiTeil>> {
  const apiParts: Record<string, ApiTeil> = {};
  let url = `https://rebrickable.com/api/v3/lego/sets/${pfadSegment(n)}/parts/?page_size=500&inc_part_details=1`;
  while (url) {
    const data = await apiGet(k, url, rbKey);
    if (!data) break;
    for (const item of data.results || []) {
      const p = item.part,
        c = item.color;
      if (!p || !c) continue;
      apiParts[`${p.part_num}|${c.id}`] = {
        part_name: p.name,
        bl_part_num: p.external_ids?.BrickLink?.[0] || null,
        image_url: p.part_img_url || null,
        color_name: c.name,
        color_hex: c.rgb,
        quantity: item.quantity,
      };
    }
    url = data.next || null;
  }
  return apiParts;
}

/** Alle Nummern aus der CSV, nicht nur aus der API-Antwort: Die kann
 * unvollständig sein. */
async function ergaenzeBlNummern(
  kx: KatalogKontext,
  apiParts: Record<string, ApiTeil>,
  missingBl: string[],
  rbKey: string,
): Promise<void> {
  const BATCH = 500;
  for (let i = 0; i < missingBl.length; i += BATCH) {
    const batch = missingBl.slice(i, i + BATCH);
    const blUrl = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${nummernListe(batch)}&page_size=500`;
    const blData = await apiGet(kx, blUrl, rbKey);
    if (!blData) continue;
    for (const part of blData.results || []) {
      const blId = part.external_ids?.BrickLink?.[0] || null;

      if (blId) {
        for (const colorId of Object.keys(apiParts)
          .filter(k => k.startsWith(part.part_num + '|'))
          .map(k => k.split('|')[1])) {
          const key = `${part.part_num}|${colorId}`;
          if (apiParts[key]) apiParts[key].bl_part_num = blId;
        }
        await merkeBlNummer(kx, 'part', part.part_num, blId).catch(logAndContinue('teile-enrich:merkeBlNummer'));
      }
    }
  }
}

async function merkeTeileDesSets(
  k: KatalogKontext,
  n: string,
  csvParts: Awaited<ReturnType<typeof repo.teileDesInventars>>,
  apiParts: Record<string, ApiTeil>,
): Promise<void> {
  const blMapRows = await k.teileAnreicherung.blZuordnungen(csvParts.map(p => p.part_num));
  const blMap: Record<string, string | null> = {};
  for (const r of blMapRows) blMap[r.rb_id] = r.bl_id;

  for (const p of csvParts) {
    const key = `${p.part_num}|${p.color_id}`;
    const info: Partial<ApiTeil> = apiParts[key] ?? {};
    const blPartNum = info.bl_part_num || blMap[p.part_num] || null;
    // In die ZUORDNUNG: Die Nummer hängt am Teil, nicht an Set, Teil und Farbe.
    if (blPartNum)
      await merkeBlNummer(k, 'part', p.part_num, blPartNum).catch(logAndContinue('teile-enrich:merkeBlNummer'));
    // Ohne Rebrickable-Antwort kein Name — die Teilenummer gehört nicht als geprüfter Name in den Katalog.
    const melde = logAndContinue('katalog:setteil');
    await merkeTeil(k, p.part_num, info.part_name).catch(melde);
    await merkeTeilFarbe(
      k,
      p.part_num,
      p.color_id ?? KEINE_FARBE,
      info.color_name,
      info.color_hex,
      info.image_url,
    ).catch(melde);
    await merkeSetTeil(k, n, p.part_num, p.color_id ?? KEINE_FARBE, p.quantity || 1, false).catch(melde);
  }
}

async function ergaenzeSetFiguren(k: KatalogKontext, n: string, rbKey: string): Promise<void> {
  const existingFigs = await k.teileAnreicherung.figurenImSetkatalog(n);

  if (!existingFigs) {
    const figsData = await apiGet(
      k,
      `https://rebrickable.com/api/v3/lego/sets/${pfadSegment(n)}/minifigs/?page_size=100`,
      rbKey,
    );
    if (figsData?.results?.length) {
      type RbFigur = { set_num: string; set_name?: string; quantity?: number; set_img_url?: string };
      const figs: RbFigur[] = figsData.results;
      await merkeFiguren(
        k,
        figs.map(f => ({ figNumber: f.set_num, figName: f.set_name || null, imageUrl: f.set_img_url || null })),
      ).catch(logAndContinue('teile-enrich:figuren merken'));
      await merkeSetFiguren(
        k,
        n,
        figs.map(f => ({ figNumber: f.set_num, quantity: f.quantity })),
      ).catch(logAndContinue('teile-enrich:setfiguren merken'));
    }
  }
}

/** Ein Bild vom CDN in den Teile-Ordner, dann in den Katalog. */
async function ladeTeilbild(k: KatalogKontext, p: repo.Bildwunsch): Promise<void> {
  const rawUrl = p.image_url || '';
  let cdnUrl = rawUrl;
  // Beide Schreibweisen: Altzeilen tragen noch /api/img-proxy.
  const m = rawUrl.match(/\/api\/(?:v1\/)?img-proxy\?url=(.+)/);
  if (m) cdnUrl = decodeURIComponent(m[1] ?? '');
  if (!cdnUrl.startsWith('http')) {
    console.warn(`[img-dl] skipping invalid URL for ${p.id}: ${rawUrl.substring(0, 80)}`);
    return;
  }

  const nummer = dateiTeil(p.id),
    farbe = dateiTeil(p.color_id);
  if (!nummer || (p.kind !== 'fig' && !farbe)) {
    console.warn(`[img-dl] skipping unsafe number ${String(p.id).substring(0, 40)}`);
    return;
  }
  const file = p.kind === 'fig' ? `${nummer}.${bildEndung(cdnUrl)}` : `${nummer}_${farbe}.${bildEndung(cdnUrl)}`;
  const dest = zielImOrdner(PART_IMAGES_DIR, file);
  if (!dest) return;
  const rel = `/images/parts/${file}`;

  if (!fs.existsSync(dest)) {
    await cdnImageLimiter.acquire();
    fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
    const ok = await ladeBild(cdnUrl, dest, ERLAUBTE_BILD_HOSTS, BILD_KOPFZEILEN, text =>
      console.warn(`[img-dl] ${p.id}: ${text}`.replace(/\r?\n/g, ' ⏎ ').replace(/\n|\r/g, '')),
    ).finally(() => cdnImageLimiter.release());
    if (!ok) return;
  }

  if (p.kind === 'fig') {
    await setzeFigurBildLokal(k, p.id, rel).catch(logAndContinue('teile-enrich:figurbild'));
  } else {
    await setzeTeilBildLokal(k, p.id, p.color_id, rel).catch(logAndContinue('katalog:teilbild'));
  }
}

/** Prozessübergreifend auf einer EIGENEN Verbindung: Ein Advisory-Lock hängt an
 * der Session, über den Pool würde er unzuverlässig freigegeben. waitIfBusy (PDF)
 * wartet auf den anderen Prozess, sonst fehlten Bilder im PDF. */
async function holeBildSperre(
  k: KatalogKontext,
  n: string,
  waitIfBusy: boolean,
): Promise<'belegt' | { lockClient: import('pg').PoolClient | null; haveXlock: boolean }> {
  let lockClient: import('pg').PoolClient | null = null,
    haveXlock = false;
  try {
    lockClient = await k.teileAnreicherung.sperrVerbindung();
  } catch (_) {
    lockClient = null;
  }
  if (!lockClient) return { lockClient, haveXlock };
  const deadline = Date.now() + 180000; // max. 3 Min auf anderen Worker warten
  while (true) {
    try {
      haveXlock = await repo.versucheBildSperre(lockClient, n);
    } catch (_) {
      haveXlock = false;
    }
    if (haveXlock) break;
    if (!waitIfBusy) {
      console.log(`[img-dl] ${n}: wird bereits von einem anderen Worker geladen — übersprungen`);
      lockClient.release();
      return 'belegt';
    }
    if (Date.now() > deadline) {
      console.warn(`[img-dl] ${n}: Wartezeit auf anderen Worker überschritten — fahre ohne Lock fort`);
      break; // best effort ohne Lock weitermachen
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return { lockClient, haveXlock };
}

// Je Set eine Sperre: Gleichzeitige Aufrufe für dasselbe Set warten auf den ersten.
const _downloadLocks = new Map();

async function downloadSetImages(k: KatalogKontext, setNumber: string, waitIfBusy = false) {
  const n = mitVersion(setNumber);

  if (_downloadLocks.has(n)) {
    await _downloadLocks.get(n);
    return;
  }
  // `!` ist beweisbar: Der Rumpf eines Promise-Konstruktors läuft synchron,
  // resolveLock ist also gesetzt.
  let resolveLock!: () => void;
  const lock = new Promise<void>(r => {
    resolveLock = r;
  });
  _downloadLocks.set(n, lock);

  const sperre = await holeBildSperre(k, n, waitIfBusy);
  if (sperre === 'belegt') {
    resolveLock();
    _downloadLocks.delete(n);
    return;
  }
  const { lockClient, haveXlock } = sperre;

  let _pendingAdded = 0; // Anteil dieses Batches am globalen imgDl-Zähler
  let _flushed = 0; // davon bereits an den Zähler gemeldet (Rest im finally)
  let _lastFlush = Date.now();
  try {
    const needsImg = await k.teileAnreicherung.bilderOhneDatei(n);
    if (!needsImg.length) return;

    console.log(`[img-dl] ${n}: lade ${needsImg.length} Bilder`);
    // Zum globalen Zähler ADDIEREN statt ihn zu überschreiben, sonst zeigte die
    // Überwachung nur den zuletzt gestarteten Stapel.
    _pendingAdded = needsImg.length;
    await k.auftraege.imgDlAdd(_pendingAdded).catch(logAndContinue('teile-enrich:imgDlAdd'));

    let done = 0;
    // Höchstens ein Schreibvorgang je Sekunde statt einer je Bild, das entlastet
    // den Pool. Der Zähler steigt VOR dem await, damit nichts doppelt meldet.
    const flushProgress = async (force?: boolean) => {
      const delta = done - _flushed;
      if (delta <= 0) return;
      if (!force && Date.now() - _lastFlush < 1000) return;
      _flushed += delta;
      _lastFlush = Date.now();
      await k.auftraege.imgDlAdd(-delta).catch(logAndContinue('teile-enrich:imgDlAdd'));
    };
    await Promise.all(
      needsImg.map(async p => {
        await ladeTeilbild(k, p);
        done++;
        await flushProgress(false);
      }),
    );
    await flushProgress(true);
    console.log(`[img-dl] ${n}: ${done}/${needsImg.length} Bilder geladen`);
  } finally {
    // Nur den noch nicht gemeldeten Rest verrechnen — deckt Abbruch ab, ohne im
    // Normalfall doppelt abzuziehen.
    const _rest = _pendingAdded - _flushed;
    if (_rest > 0) await k.auftraege.imgDlAdd(-_rest).catch(logAndContinue('teile-enrich:imgDlAdd'));
    if (lockClient) {
      if (haveXlock) await repo.gibBildSperreFrei(lockClient, n).catch(logAndContinue('teile-enrich:hashtext'));
      lockClient.release();
    }
    resolveLock();
    _downloadLocks.delete(n);
  }
}

async function enrichSetMinifigs(k: KatalogKontext, setNumber: string) {
  const n = mitVersion(setNumber);
  const rbKey = await getRbKey();
  if (!rbKey) return;

  const figs = await k.teileAnreicherung.figurenDesSets(n);
  if (!figs.length) return;

  const figNums = figs.map((f: { fig_number: string }) => f.fig_number);
  const invRows = await k.teileAnreicherung.inventareDerFiguren(figNums);

  // Je set_num die höchste Version (erste wegen ORDER BY DESC).
  const invMap: Record<string, number> = {};
  for (const r of invRows) {
    if (!invMap[r.set_num]) invMap[r.set_num] = r.id;
  }

  const allPartNums = new Set<string>();
  const figPartsMap: Record<string, { parts: repo.InventarTeil[]; figQty: number }> = {};

  for (const fig of figs) {
    const invId = invMap[fig.fig_number];
    if (!invId) continue;

    const parts = await k.teileAnreicherung.teileDesInventars(invId);

    figPartsMap[fig.fig_number] = { parts, figQty: fig.quantity };
    for (const p of parts) allPartNums.add(p.part_num);
  }

  if (!allPartNums.size) return;

  // bl_zuordnung: die Nummer, einmal je Teil.
  const rbBlRows = await k.teileAnreicherung.blZuordnungen([...allPartNums]);
  const rbBlMap: Record<string, string> = {};
  for (const r of rbBlRows) rbBlMap[r.rb_id] = r.bl_id ?? '';

  // Nur nie nachgesehene Nummern abfragen.
  const needsBl = [...allPartNums].filter(pn => !(String(pn) in rbBlMap));

  const apiBlMap: Record<string, string> = {};
  if (needsBl.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < needsBl.length; i += BATCH) {
      const batch = needsBl.slice(i, i + BATCH);
      const url = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${nummernListe(batch)}&page_size=500`;
      const data = await apiGet(k, url, rbKey);
      if (!data) continue;
      for (const p of data.results || []) {
        const blId = p.external_ids?.BrickLink?.[0] || null;
        const finalId = blId || p.part_num;
        apiBlMap[p.part_num] = finalId;

        await merkeBlNummer(k, 'part', p.part_num, finalId).catch(logAndContinue('teile-enrich:merkeBlNummer'));
      }
    }
  }

  // Vorrang: API > bl_zuordnung > eigene Nummer.
  const finalBlMap: Record<string, string> = {};
  for (const pn of allPartNums as Iterable<string>) {
    finalBlMap[pn] = apiBlMap[pn] || rbBlMap[pn] || pn;
  }

  for (const [figNum, { parts }] of Object.entries(figPartsMap)) {
    for (const p of parts) {
      // Ohne BrickLink-Nummer: Sie steht einmal je Teil in bl_zuordnung.
      await merkeSetTeil(k, figNum, p.part_num, p.color_id ?? KEINE_FARBE, p.quantity || 1, false).catch(
        logAndContinue('katalog:figurteil'),
      );
    }
  }
}

// „Fehlend" = image_local gesetzt, Datei fehlt. Nicht wiederherstellbare
// Einträge werden geleert, damit die Oberflächen auf die CDN-Adresse zurückfallen.
let _redlRunning = false;

// Für alle drei Bildarten; sonst verwarf der Nachlauf Set- und Figurenbilder.
function _fsPathFromLocal(imageLocal: string) {
  if (!imageLocal) return null;
  const bereiche: Array<[string, string]> = [
    ['/images/parts/', PART_IMAGES_DIR],
    ['/images/minifigs/', MINIFIG_IMAGES_DIR],
    ['/images/sets/', SET_IMAGES_DIR],
  ];
  for (const [prefix, dir] of bereiche) {
    if (!imageLocal.startsWith(prefix)) continue;
    const file = imageLocal.slice(prefix.length);
    // Pfadtrenner und .. bleiben verboten: Auch ein Wert aus der Datenbank ist
    // nicht per se vertrauenswürdig.
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    return path.join(dir, file);
  }
  return null;
}

// Mit await, sonst ginge der Endstand bei einem Neustart verloren.
async function _redlSetStatus(k: KatalogKontext, obj: Record<string, unknown>) {
  await k.auftraege.laufzustand
    .setzeZustand('imgredl_status', JSON.stringify({ ...obj, at: Date.now() }))
    .catch(logAndContinue('teile-enrich:setzeZustand'));
}

async function redownloadMissingImages(k: KatalogKontext, lauf?: AuftragsLauf) {
  if (_redlRunning) return { alreadyRunning: true };
  // Sperre auf EIGENER Verbindung: Advisory-Locks hängen an der Session.
  let lockClient: PoolClient;
  try {
    lockClient = await k.teileAnreicherung.sperrVerbindung();
  } catch (e) {
    return { error: fehlertext(e) || 'keine Verbindung' };
  }
  try {
    if (!(await repo.versucheNachlaufSperre(lockClient))) {
      lockClient.release();
      return { alreadyRunning: true };
    }
  } catch (e) {
    lockClient.release();
    return { error: fehlertext(e) || 'Sperre fehlgeschlagen' };
  }
  _redlRunning = true;
  try {
    return await _redownloadMissingImages(k, lauf);
  } finally {
    _redlRunning = false;
    await repo.gibNachlaufSperreFrei(lockClient).catch(logAndContinue('teile-enrich:pg_advisory_unlock'));
    lockClient.release();
  }
}

type FehlendesBild = { image_local: string; image_url: string | null; fp: string };

async function _redownloadMissingImages(k: KatalogKontext, lauf?: AuftragsLauf) {
  try {
    fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
    await _redlSetStatus(k, { running: true, phase: 'scanning', total: 0, done: 0, redownloaded: 0, cleared: 0 });
    const { missing, ohneVorschau } = await fehlendeDateienSuchen(k);
    const thumbsErzeugt = await vorschauenNachholen(k, ohneVorschau);
    const total = missing.length;
    await _redlSetStatus(k, { running: true, phase: 'downloading', total, done: 0, redownloaded: 0, cleared: 0 });
    if (!total) {
      await _redlSetStatus(k, {
        running: false,
        phase: 'done',
        total: 0,
        done: 0,
        redownloaded: 0,
        cleared: 0,
        thumbs: thumbsErzeugt,
      });
      return { total: 0, redownloaded: 0, cleared: 0, thumbs: thumbsErzeugt };
    }

    const { done, redownloaded, cleared } = await fehlendeNachladen(k, missing, lauf);
    pruefeAbbruch(lauf);

    await _redlSetStatus(k, {
      running: false,
      phase: 'done',
      total,
      done,
      redownloaded,
      cleared,
      thumbs: thumbsErzeugt,
    });
    console.log(
      `[img-redl] fertig: ${redownloaded} neu geladen, ${cleared} geleert (von ${total} fehlenden), ${thumbsErzeugt} Vorschauen erzeugt`,
    );
    return { total, redownloaded, cleared, thumbs: thumbsErzeugt };
  } catch (e) {
    await _redlSetStatus(k, { running: false, phase: 'error', error: fehlertext(e) });
    if (lauf?.signal?.aborted) throw e;
    console.error('[img-redl] Fehler:', fehlertext(e));
    return { error: fehlertext(e) };
  }
}

const gibtDatei = (fp: string) =>
  fs.promises
    .access(fp)
    .then(() => true)
    .catch(ohneFehlendeDatei('teile-enrich:access', false));

/** Auch fehlende Vorschauen: Sie entstehen sonst nur beim Erfassen und hätten
 * keinen zweiten Anlauf. */
async function fehlendeDateienSuchen(k: KatalogKontext) {
  const rows = await k.teileAnreicherung.lokaleBilderMitAdresse();
  const missing: FehlendesBild[] = [];
  const ohneVorschau: string[] = [];
  for (const r of rows) {
    const fp = _fsPathFromLocal(r.image_local);
    if (!fp) continue; // gebündelte /images/ o.ä. überspringen
    if (!(await gibtDatei(fp))) {
      missing.push({ image_local: r.image_local, image_url: r.image_url, fp });
      continue;
    }
    if (!(await gibtDatei(fp.replace(/(\.[^.]+)$/, '_thumb.jpg')))) ohneVorschau.push(r.image_local);
  }
  return { missing, ohneVorschau };
}

/** Vorschauen zuerst: Sie brauchen kein Netz und wirken sofort auf jede Kachelwand. */
async function vorschauenNachholen(k: KatalogKontext, ohneVorschau: string[]): Promise<number> {
  let thumbsErzeugt = 0;
  if (!ohneVorschau.length) return 0;
  await _redlSetStatus(k, {
    running: true,
    phase: 'thumbs',
    total: ohneVorschau.length,
    done: 0,
    redownloaded: 0,
    cleared: 0,
  });
  for (const web of ohneVorschau) {
    const r = await versuche('teile-enrich:vorschau', () => generateThumb(web));
    if (r.ok && r.wert) thumbsErzeugt++;
  }
  console.log(`[img-redl] ${thumbsErzeugt} fehlende Vorschauen erzeugt (von ${ohneVorschau.length})`);
  return thumbsErzeugt;
}

/** Neu laden, was eine Adresse hat; sonst den Verweis leeren, damit die Kachel nicht
 * auf eine Datei zeigt, die es nicht gibt. */
async function fehlendeNachladen(k: KatalogKontext, missing: FehlendesBild[], lauf?: AuftragsLauf) {
  const total = missing.length;
  let done = 0,
    redownloaded = 0,
    cleared = 0,
    _lastFlush = 0;
  const flush = async (force?: boolean) => {
    const now = Date.now();
    if (!force && now - _lastFlush < 1000) return;
    _lastFlush = now;
    await _redlSetStatus(k, { running: true, phase: 'downloading', total, done, redownloaded, cleared });
  };

  let idx = 0;
  const worker = async () => {
    while (idx < missing.length && !lauf?.signal?.aborted) {
      const m = missing[idx++];
      if (!m) break;
      if (await bildNachladen(m)) redownloaded++;
      else {
        // Die Liste MUSS zu den Tabellen passen, die die Spalte wirklich haben.
        for (const tbl of repo.KATALOGE_MIT_BILD) {
          await k.teileAnreicherung
            .vergissLokalesBild(tbl, m.image_local)
            .catch(logAndContinue(`img-redl:leeren ${tbl}`));
        }
        cleared++;
      }
      done++;
      await flush(false);
    }
  };
  const CONC = 2; // wie beim normalen Download; der CDN-Limiter drosselt ohnehin
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  return { done, redownloaded, cleared };
}

async function bildNachladen(m: FehlendesBild): Promise<boolean> {
  let ok = false;
  if (m.image_url) {
    await cdnImageLimiter.acquire().catch(logAndContinue('teile-enrich:acquire'));
    try {
      // Ein Fehler zählt wie ein vergeblicher Abruf; der Zähler nennt beide.
      const r = await versuche('teile-enrich:downloadFile', downloadFile(m.image_url, m.fp));
      ok = r.ok && r.wert === true;
    } finally {
      cdnImageLimiter.release();
    }
  }
  if (ok) await generateThumb(m.image_local).catch(logAndContinue('teile-enrich:generateThumb'));
  return ok;
}

export { enrichSetParts, downloadSetImages, enrichSetMinifigs, downloadImage, redownloadMissingImages };
