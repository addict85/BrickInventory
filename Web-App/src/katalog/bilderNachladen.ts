/** Fehlende Bilddateien nachladen: Verweise ohne Datei finden, laden oder leeren. */
import { cdnImageLimiter } from './rateLimiter';
import { fehlertext, logAndContinue, ohneFehlendeDatei } from '../infra/fehler';
import { downloadFile } from './quellen';

import { pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import * as repo from './repository/teileAnreicherung';
import fs from 'node:fs';
import type { PoolClient } from 'pg';
import path from 'node:path';
import { PART_IMAGES_DIR, MINIFIG_IMAGES_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { generateThumb } from './bilder/thumbs';
import { versuche } from '../infra/ergebnis';
import type { KatalogKontext } from './kontext';

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
  await k.auftraege
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

export { redownloadMissingImages };
