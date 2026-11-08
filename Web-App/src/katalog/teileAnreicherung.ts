/** Füllt set_parts_catalog aus der Rebrickable-API, damit die Teileliste eines
 * Sets Namen und Bilder hat. Bilder werden im Hintergrund geladen; bis dahin
 * gilt die CDN-Adresse. */
import { cdnImageLimiter, rebrickableBackgroundLimiter as rebrickableLimiter, consumeRebrickableDaily } from './rateLimiter';
import { meldeFehler, fehlertext, einzeilig, logAndContinue, meldeUndLiefere, ohneFehlendeDatei } from '../infra/fehler';
import { neuestesInventar } from './rbInventar';
import { mitVersion } from '../infra/setNummer';
import { merkeBlNummer } from './blZuordnung';
import { merkeTeil, merkeTeilFarbe, merkeSetTeil, setzeTeilBildLokal, merkeFiguren, merkeSetFiguren, setzeFigurBildLokal } from './katalogPflege';
import { getRbKey, downloadFile, parseThrottleWait as ptw, rebrickableRoh, BILD_KOPFZEILEN } from './quellen';

/** Ohne Typparameter leitet TypeScript bei `new Promise` `unknown` ab. */
type JobHttpResult = { status: number; body: string };

// Teile- und Figurenbilder liegen in getrennten Ordnern; downloadImage()
// bekommt deshalb die Art mit.
import { bildEndung, dateiTeil, zielImOrdner, ladeBild } from './bilder/bildDatei';
import { ERLAUBTE_BILD_HOSTS, pfadSegment, nummernListe } from '../infra/fremdeAdressen';
import { setzeZustand } from '../auftraege/laufzustand';
import * as repo from './repository/teileAnreicherung';
import fs from 'fs';
import path from 'path';
import { pruefeAbbruch, type AuftragsLauf } from '../auftraege/auftraege';
import * as monitor from '../auftraege/jobMonitor';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { generateThumb } from './bilder/thumbs';
import { KEINE_FARBE } from '../infra/validate';



async function apiGet(url: string, rbKey: string) {
  let serverErrors = 0;
  while (true) {
    if (!await consumeRebrickableDaily()) return null;
    await rebrickableLimiter.waitForSlot();
    const result: JobHttpResult = await rebrickableRoh(url, rbKey);
    if (result.status === 429) {
      const wait = ptw(result.body);
      rebrickableLimiter.throttle(wait);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (result.status >= 500 || result.status === 0) {
      if (serverErrors++ === 0) { await new Promise(r => setTimeout(r, 10000)); continue; }
      return null;
    }
    if (result.status !== 200) return null;
    try { return JSON.parse(result.body); } catch(_) { return null; }
  }
}

/** @param kind Bestimmt Zielverzeichnis und Web-Pfad.
 * Ausführlich: docs/begruendungen/src/katalog/teileAnreicherung.ts.md#abschnitt */
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
  const nummer = dateiTeil(partNum), farbe = dateiTeil(colorId);
  if (!nummer || !farbe) return null;
  const file = `${nummer}_${farbe}.${bildEndung(imgUrl)}`;
  const dest = zielImOrdner(IMG_DIR, file);
  if (!dest) return null;
  const rel  = `${webBase}${file}`;
  if (fs.existsSync(dest)) return rel;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  if (!await ladeBild(imgUrl, dest, ERLAUBTE_BILD_HOSTS, BILD_KOPFZEILEN)) return null;
  try { await generateThumb(rel).catch(logAndContinue('teile-enrich:generateThumb')); } catch (e) { meldeFehler('teile-enrich:vorschau', e); }
  return rel;
}

async function enrichSetParts(setNumber: string) {
  const n = mitVersion(setNumber);

  const invId = await neuestesInventar(setNumber).catch(meldeUndLiefere('teile-enrich:neuestesInventar', null));
  if (!invId) return;

  const csvParts = await repo.teileDesInventars(invId);
  if (!csvParts.length) return;

  const catalogRows = await repo.setTeileKatalog(n);
  const catalogMap: Record<string, { image_url: string | null; image_local: string | null; bl_part_number?: string | null }> = {};
  for (const r of catalogRows) catalogMap[`${r.part_number}|${r.color_id}`] = r;

  // Die ZEILE in bl_zuordnung zählt, nicht ihr Wert: leer heisst „nachgesehen,
  // keine abweichende Nummer".
  const lookedUp = await repo.blZuordnungen(csvParts.map(p => p.part_num))
    .catch(meldeUndLiefere('teile-enrich:lookedUp', []));
  const lookedUpSet = new Set(lookedUp.map((r: { rb_id: string }) => r.rb_id));

  // Nur Teile, die noch nie nachgesehen wurden — jeder Abruf kostet Kontingent.
  const missing = csvParts.filter(p => {
    const cat = catalogMap[`${p.part_num}|${p.color_id}`];
    if (!cat) return true;                    // not in catalog at all
    if (!cat.bl_part_number) return true;     // in catalog but no BL ID
    if (!lookedUpSet.has(p.part_num)) return true; // never looked up via API
    return false;                             // has BL ID and was looked up → skip
  });

  if (!missing.length) return;

  const rbKey = await getRbKey();
  if (!rbKey) { console.log('[parts-enrich] No API key'); return; }

  const apiParts = await holeApiTeile(n, rbKey);
  await ergaenzeBlNummern(apiParts, [...new Set(csvParts.map(p => p.part_num))], rbKey);
  await merkeTeileDesSets(n, csvParts, apiParts);
  await ergaenzeSetFiguren(n, rbKey);
}

type ApiTeil = { part_name: string; bl_part_num: string | null; image_url: string | null; color_name: string; color_hex: string; quantity: number };

/** Die Teile des Sets laut Rebrickable, je "part_num|color_id". */
async function holeApiTeile(n: string, rbKey: string): Promise<Record<string, ApiTeil>> {
    const apiParts: Record<string, ApiTeil> = {};
    let url = `https://rebrickable.com/api/v3/lego/sets/${pfadSegment(n)}/parts/?page_size=500&inc_part_details=1`;
    while (url) {
      const data = await apiGet(url, rbKey);
      if (!data) break;
      for (const item of (data.results || [])) {
        const p = item.part, c = item.color;
        if (!p || !c) continue;
        apiParts[`${p.part_num}|${c.id}`] = {
          part_name:    p.name,
          bl_part_num:  p.external_ids?.BrickLink?.[0] || null,
          image_url:    p.part_img_url || null,
          color_name:   c.name,
          color_hex:    c.rgb,
          quantity:     item.quantity
        };
      }
      url = data.next || null;
    }
    return apiParts;
}

/** Alle Nummern aus der CSV, nicht nur aus der API-Antwort: Die kann
 * unvollständig sein. */
async function ergaenzeBlNummern(apiParts: Record<string, ApiTeil>, missingBl: string[], rbKey: string): Promise<void> {
      const BATCH = 500;
      for (let i = 0; i < missingBl.length; i += BATCH) {
        const batch = missingBl.slice(i, i + BATCH);
        const blUrl = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${nummernListe(batch)}&page_size=500`;
        const blData = await apiGet(blUrl, rbKey);
        if (!blData) continue;
        for (const part of (blData.results || [])) {
          const blId = part.external_ids?.BrickLink?.[0] || null;

          if (blId) {
            for (const colorId of Object.keys(apiParts)
              .filter(k => k.startsWith(part.part_num + '|'))
              .map(k => k.split('|')[1])) {
              const key = `${part.part_num}|${colorId}`;
              if (apiParts[key]) apiParts[key].bl_part_num = blId;
            }
            await merkeBlNummer('part', part.part_num, blId).catch(logAndContinue('teile-enrich:merkeBlNummer'));
          }
        }
      }
}

async function merkeTeileDesSets(n: string, csvParts: Awaited<ReturnType<typeof repo.teileDesInventars>>,
                                 apiParts: Record<string, ApiTeil>): Promise<void> {
    const blMapRows = await repo.blZuordnungen(csvParts.map(p => p.part_num))
      .catch(meldeUndLiefere('teile-enrich:blMapRows', []));
    const blMap: Record<string, string | null> = {};
    for (const r of blMapRows) blMap[r.rb_id] = r.bl_id;

    for (const p of csvParts) {
      const key  = `${p.part_num}|${p.color_id}`;
      const info: Partial<ApiTeil> = apiParts[key] ?? {};
      const blPartNum = info.bl_part_num || blMap[p.part_num] || null;
      // In die ZUORDNUNG: Die Nummer hängt am Teil, nicht an Set, Teil und Farbe.
      if (blPartNum) await merkeBlNummer('part', p.part_num, blPartNum).catch(logAndContinue('teile-enrich:merkeBlNummer'));
      // Ohne Rebrickable-Antwort kein Name — die Teilenummer gehört nicht als geprüfter Name in den Katalog.
      const melde = logAndContinue('katalog:setteil');
      await merkeTeil(p.part_num, info.part_name).catch(melde);
      await merkeTeilFarbe(p.part_num, p.color_id ?? KEINE_FARBE, info.color_name, info.color_hex, info.image_url).catch(melde);
      await merkeSetTeil(n, p.part_num, p.color_id ?? KEINE_FARBE, p.quantity||1, false).catch(melde);
    }
}

async function ergaenzeSetFiguren(n: string, rbKey: string): Promise<void> {
  const existingFigs = await repo.figurenImSetkatalog(n).catch(meldeUndLiefere('teile-enrich:existingFigs', 0));

  if (!existingFigs) {
    const figsData = await apiGet(
      `https://rebrickable.com/api/v3/lego/sets/${pfadSegment(n)}/minifigs/?page_size=100`,
      rbKey
    );
    if (figsData?.results?.length) {
      type RbFigur = { set_num: string; set_name?: string; quantity?: number; set_img_url?: string };
      const figs: RbFigur[] = figsData.results;
      await merkeFiguren(figs.map(f => ({ figNumber: f.set_num, figName: f.set_name || null, imageUrl: f.set_img_url || null })))
        .catch(logAndContinue('teile-enrich:figuren merken'));
      await merkeSetFiguren(n, figs.map(f => ({ figNumber: f.set_num, quantity: f.quantity })))
        .catch(logAndContinue('teile-enrich:setfiguren merken'));
    }
  }
}

/** Ein Bild vom CDN in den Teile-Ordner, dann in den Katalog. */
async function ladeTeilbild(p: repo.Bildwunsch): Promise<void> {
    const rawUrl = p.image_url || '';
    let cdnUrl = rawUrl;
    // Beide Schreibweisen: Altzeilen tragen noch /api/img-proxy.
    const m = rawUrl.match(/\/api\/(?:v1\/)?img-proxy\?url=(.+)/);
    if (m) cdnUrl = decodeURIComponent((m[1] ?? ''));
    if (!cdnUrl.startsWith('http')) {
      console.warn(`[img-dl] skipping invalid URL for ${p.id}: ${rawUrl.substring(0, 80)}`);
      return;
    }

    const nummer = dateiTeil(p.id), farbe = dateiTeil(p.color_id);
    if (!nummer || (p.kind !== 'fig' && !farbe)) {
      console.warn(`[img-dl] skipping unsafe number ${String(p.id).substring(0, 40)}`);
      return;
    }
    const file = p.kind === 'fig'
      ? `${nummer}.${bildEndung(cdnUrl)}`
      : `${nummer}_${farbe}.${bildEndung(cdnUrl)}`;
    const dest = zielImOrdner(PART_IMAGES_DIR, file);
    if (!dest) return;
    const rel  = `/images/parts/${file}`;

    if (!fs.existsSync(dest)) {
      await cdnImageLimiter.acquire();
      fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
      const ok = await ladeBild(cdnUrl, dest, ERLAUBTE_BILD_HOSTS, BILD_KOPFZEILEN,
        (text) => console.warn(einzeilig(`[img-dl] ${p.id}: ${text}`)))
        .finally(() => cdnImageLimiter.release());
      if (!ok) return;
    }

    if (p.kind === 'fig') {
      await setzeFigurBildLokal(p.id, rel).catch(logAndContinue('teile-enrich:figurbild'));
    } else {
      await setzeTeilBildLokal(p.id, p.color_id, rel).catch(logAndContinue('katalog:teilbild'));
    }
  }

/** Prozessübergreifend auf einer EIGENEN Verbindung: Ein Advisory-Lock hängt an
 * der Session, über den Pool würde er unzuverlässig freigegeben. waitIfBusy (PDF)
 * wartet auf den anderen Prozess, sonst fehlten Bilder im PDF. */
async function holeBildSperre(n: string, waitIfBusy: boolean):
    Promise<'belegt' | { lockClient: import('pg').PoolClient | null; haveXlock: boolean }> {
  let lockClient: import('pg').PoolClient | null = null, haveXlock = false;
  try { lockClient = await repo.sperrVerbindung(); } catch (_) { lockClient = null; }
  if (!lockClient) return { lockClient, haveXlock };
  const deadline = Date.now() + 180000; // max. 3 Min auf anderen Worker warten
  while (true) {
    try {
      haveXlock = await repo.versucheBildSperre(lockClient, n);
    } catch (_) { haveXlock = false; }
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

async function downloadSetImages(setNumber: string, waitIfBusy = false) {
  const n   = mitVersion(setNumber);

  if (_downloadLocks.has(n)) {
    await _downloadLocks.get(n);
    return;
  }
  // `!` ist beweisbar: Der Rumpf eines Promise-Konstruktors läuft synchron,
  // resolveLock ist also gesetzt.
  let resolveLock!: () => void;
  const lock = new Promise<void>(r => { resolveLock = r; });
  _downloadLocks.set(n, lock);

  const sperre = await holeBildSperre(n, waitIfBusy);
  if (sperre === 'belegt') { resolveLock(); _downloadLocks.delete(n); return; }
  const { lockClient, haveXlock } = sperre;

  let _pendingAdded = 0;  // Anteil dieses Batches am globalen imgDl-Zähler
  let _flushed      = 0;  // davon bereits an den Zähler gemeldet (Rest im finally)
  let _lastFlush    = Date.now();
  try {
    const needsImg = await repo.bilderOhneDatei(n);
    if (!needsImg.length) return;

    console.log(`[img-dl] ${n}: lade ${needsImg.length} Bilder`);
    // Zum globalen Zähler ADDIEREN statt ihn zu überschreiben, sonst zeigte die
    // Überwachung nur den zuletzt gestarteten Stapel.
    _pendingAdded = needsImg.length;
    await monitor.imgDlAdd(_pendingAdded).catch(logAndContinue('teile-enrich:imgDlAdd'));

    let done = 0;
    // Höchstens ein Schreibvorgang je Sekunde statt einer je Bild, das entlastet
    // den Pool. Der Zähler steigt VOR dem await, damit nichts doppelt meldet.
    const flushProgress = async (force?: boolean) => {
      const delta = done - _flushed;
      if (delta <= 0) return;
      if (!force && Date.now() - _lastFlush < 1000) return;
      _flushed  += delta;
      _lastFlush = Date.now();
      await monitor.imgDlAdd(-delta).catch(logAndContinue('teile-enrich:imgDlAdd'));
    };
    await Promise.all(needsImg.map(async p => {
      await ladeTeilbild(p);
      done++;
      await flushProgress(false);
    }));
    await flushProgress(true);
    console.log(`[img-dl] ${n}: ${done}/${needsImg.length} Bilder geladen`);

  } finally {
    // Nur den noch nicht gemeldeten Rest verrechnen — deckt Abbruch ab, ohne im
    // Normalfall doppelt abzuziehen.
    const _rest = _pendingAdded - _flushed;
    if (_rest > 0) await monitor.imgDlAdd(-_rest).catch(logAndContinue('teile-enrich:imgDlAdd'));
    if (lockClient) {
      if (haveXlock) await repo.gibBildSperreFrei(lockClient, n).catch(logAndContinue('teile-enrich:hashtext'));
      lockClient.release();
    }
    resolveLock();
    _downloadLocks.delete(n);
  }
}

async function enrichSetMinifigs(setNumber: string) {
  const n   = mitVersion(setNumber);
  const rbKey = await getRbKey();
  if (!rbKey) return;

  const figs = await repo.figurenDesSets(n).catch(meldeUndLiefere('teile-enrich:figs', []));
  if (!figs.length) return;

  const figNums = figs.map((f: { fig_number: string }) => f.fig_number);
  const invRows = await repo.inventareDerFiguren(figNums).catch(meldeUndLiefere('teile-enrich:invRows', []));

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

    const parts = await repo.teileDesInventars(invId).catch(meldeUndLiefere('teile-enrich:parts', []));

    figPartsMap[fig.fig_number] = { parts, figQty: fig.quantity };
    parts.forEach((p: { part_num: string }) => allPartNums.add(p.part_num));
  }

  if (!allPartNums.size) return;

  // bl_zuordnung: die Nummer, einmal je Teil.
  const rbBlRows = await repo.blZuordnungen([...allPartNums]).catch(meldeUndLiefere('teile-enrich:rbBlRows', []));
  const rbBlMap: Record<string, string> = {};
  for (const r of rbBlRows) rbBlMap[r.rb_id] = r.bl_id ?? '';

  // Nur nie nachgesehene Nummern abfragen.
  const needsBl = [...allPartNums].filter((pn) => !(String(pn) in rbBlMap));

  let apiBlMap: Record<string, string> = {};
  if (needsBl.length > 0) {

    const BATCH = 500;
    for (let i = 0; i < needsBl.length; i += BATCH) {
      const batch = needsBl.slice(i, i + BATCH);
      const url = `https://rebrickable.com/api/v3/lego/parts/?part_nums=${nummernListe(batch)}&page_size=500`;
      const data = await apiGet(url, rbKey);
      if (!data) continue;
      for (const p of (data.results || [])) {
        const blId = p.external_ids?.BrickLink?.[0] || null;
        const finalId = blId || p.part_num;
        apiBlMap[p.part_num] = finalId;

        await merkeBlNummer('part', p.part_num, finalId).catch(logAndContinue('teile-enrich:merkeBlNummer'));
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
      await merkeSetTeil(figNum, p.part_num, p.color_id ?? KEINE_FARBE, p.quantity||1, false).catch(logAndContinue('katalog:figurteil'));
    }
  }

}

// „Fehlend" = image_local gesetzt, Datei fehlt. Nicht wiederherstellbare
// Einträge werden geleert, damit die Oberflächen auf die CDN-Adresse zurückfallen.
// Ausführlich: docs/begruendungen/src/katalog/teileAnreicherung.ts.md#abschnitt-2
let _redlRunning = false;

// Für alle drei Bildarten; sonst verwarf der Nachlauf Set- und Figurenbilder.
// Ausführlich: docs/begruendungen/src/katalog/teileAnreicherung.ts.md#fspathfromlocal
function _fsPathFromLocal(imageLocal: string) {
  if (!imageLocal) return null;
  const bereiche: Array<[string, string]> = [
    ['/images/parts/',    PART_IMAGES_DIR],
    ['/images/minifigs/', MINIFIG_IMAGES_DIR],
    ['/images/sets/',     SET_IMAGES_DIR],
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
// Ausführlich: docs/begruendungen/src/katalog/teileAnreicherung.ts.md#redlsetstatus
async function _redlSetStatus(obj: Record<string, unknown>) {
  await setzeZustand('imgredl_status', JSON.stringify({ ...obj, at: Date.now() }))
    .catch(logAndContinue('teile-enrich:setzeZustand'));
}

async function redownloadMissingImages(lauf?: AuftragsLauf) {
  if (_redlRunning) return { alreadyRunning: true };
  // Sperre auf EIGENER Verbindung: Advisory-Locks hängen an der Session.
  let lockClient;
  try { lockClient = await repo.sperrVerbindung(); }
  catch (e) { return { error: fehlertext(e) || 'keine Verbindung' }; }
  try {
    if (!(await repo.versucheNachlaufSperre(lockClient))) { lockClient.release(); return { alreadyRunning: true }; }
  } catch (e) { lockClient.release(); return { error: fehlertext(e) || 'Sperre fehlgeschlagen' }; }
  _redlRunning = true;
  try {
    return await _redownloadMissingImages(lauf);
  } finally {
    _redlRunning = false;
    await repo.gibNachlaufSperreFrei(lockClient).catch(logAndContinue('teile-enrich:pg_advisory_unlock'));
    lockClient.release();
  }
}

async function _redownloadMissingImages(lauf?: AuftragsLauf) {
  try {
    fs.mkdirSync(PART_IMAGES_DIR, { recursive: true });
    await _redlSetStatus({ running: true, phase: 'scanning', total: 0, done: 0, redownloaded: 0, cleared: 0 });
    const rows = await repo.lokaleBilderMitAdresse().catch(meldeUndLiefere('teile-enrich:bildpfade lesen', []));
    // Auch fehlende Vorschauen: Sie entstehen sonst nur beim Erfassen und hätten
    // keinen zweiten Anlauf.
    const missing: { image_local: string; image_url: string | null; fp: string }[] = [];
    const ohneVorschau: string[] = [];
    for (const r of rows) {
      const fp = _fsPathFromLocal(r.image_local);
      if (!fp) continue; // gebündelte /images/ o.ä. überspringen
      const exists = await fs.promises.access(fp).then(() => true).catch(ohneFehlendeDatei('teile-enrich:access', false));
      if (!exists) { missing.push({ image_local: r.image_local, image_url: r.image_url, fp }); continue; }
      const thumbFp = fp.replace(/(\.[^.]+)$/, '_thumb.jpg');
      const hatThumb = await fs.promises.access(thumbFp).then(() => true).catch(ohneFehlendeDatei('teile-enrich:access', false));
      if (!hatThumb) ohneVorschau.push(r.image_local);
    }

    // Vorschauen zuerst: Sie brauchen kein Netz und wirken sofort auf jede Kachelwand.
    let thumbsErzeugt = 0;
    if (ohneVorschau.length) {
      await _redlSetStatus({ running: true, phase: 'thumbs', total: ohneVorschau.length, done: 0, redownloaded: 0, cleared: 0 });
      for (const web of ohneVorschau) {
        if (await generateThumb(web).catch(meldeUndLiefere('teile-enrich:vorschau', null))) thumbsErzeugt++;
      }
      console.log(`[img-redl] ${thumbsErzeugt} fehlende Vorschauen erzeugt (von ${ohneVorschau.length})`);
    }
    const total = missing.length;
    await _redlSetStatus({ running: true, phase: 'downloading', total, done: 0, redownloaded: 0, cleared: 0 });
    if (!total) {
      await _redlSetStatus({ running: false, phase: 'done', total: 0, done: 0, redownloaded: 0, cleared: 0, thumbs: thumbsErzeugt });
      return { total: 0, redownloaded: 0, cleared: 0, thumbs: thumbsErzeugt };
    }

    let done = 0, redownloaded = 0, cleared = 0, _lastFlush = 0;
    const flush = async (force?: boolean) => {
      const now = Date.now();
      if (!force && now - _lastFlush < 1000) return;
      _lastFlush = now;
      await _redlSetStatus({ running: true, phase: 'downloading', total, done, redownloaded, cleared });
    };

    let idx = 0;
    const worker = async () => {
      while (idx < missing.length && !lauf?.signal?.aborted) {
        const m = missing[idx++];
        if (!m) break;
        let ok = false;
        if (m.image_url) {
          await cdnImageLimiter.acquire().catch(logAndContinue('teile-enrich:acquire'));
          try {
            ok = (await downloadFile(m.image_url, m.fp).catch(meldeUndLiefere('teile-enrich:downloadFile', false))) === true;
          } finally {
            cdnImageLimiter.release();
          }
        }
        if (ok) {
          await generateThumb(m.image_local).catch(logAndContinue('teile-enrich:generateThumb'));
          redownloaded++;
        } else {
          // Die Liste MUSS zu den Tabellen passen, die die Spalte wirklich haben.
          // Ausführlich: docs/begruendungen/src/katalog/teileAnreicherung.ts.md#redownloadmissingimages
          for (const tbl of repo.KATALOGE_MIT_BILD) {
            await repo.vergissLokalesBild(tbl, m.image_local)
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
    pruefeAbbruch(lauf);

    await _redlSetStatus({ running: false, phase: 'done', total, done, redownloaded, cleared, thumbs: thumbsErzeugt });
    console.log(`[img-redl] fertig: ${redownloaded} neu geladen, ${cleared} geleert (von ${total} fehlenden), ${thumbsErzeugt} Vorschauen erzeugt`);
    return { total, redownloaded, cleared, thumbs: thumbsErzeugt };
  } catch (e) {
    await _redlSetStatus({ running: false, phase: 'error', error: fehlertext(e) });
    if (lauf?.signal?.aborted) throw e;
    console.error('[img-redl] Fehler:', fehlertext(e));
    return { error: fehlertext(e) };
  }
}

export { enrichSetParts, downloadSetImages, enrichSetMinifigs, downloadImage, redownloadMissingImages };
