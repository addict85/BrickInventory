import fs from 'node:fs';
import path from 'node:path';
import { reportError } from '../infra/error';
import { reasonFor, isKnownMissing, rememberMissing } from './imageMisses';
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { JobInterrupted, JobMove, type JobContext } from '../jobQueue';
import {
  STAPEL,
  TAKT_MS,
  NOTIZ_GILT_MS,
  rememberUsed,
  reportSetImageLoaded,
  schreibePuffer,
  noteImageDemand,
  deleteExpired,
  setUpImageDemand,
  stopImageDemand,
  requestsJeMinute,
  nimmBildwuensche,
} from './imageDemand';
import { versuche } from '../infra/result';
import type { ImagesContext } from './context';

/** Store images requested via the proxy locally in the BACKGROUND, including
 * the preview — so that the request itself never waits for the CDN. */

/** Spacing between two work steps (see STAPEL in src/images/imageDemand.ts). */
const DELAY_MIN_MS = 500;
const DELAY_MAX_MS = 1000;

/** Cap per tick; the tick counts real work, otherwise it would run infinitely slowly over hundreds
 * of already existing images. */
const DURCHGANG_MAX_NOTIZEN = 500;

const RUN_KEY = 'imgqueue_last_run';

/** Five minutes let a short limit expire; more important is that
 * there is a pause at all: stubbornly asking again extends the block. */
const THROTTLE_PAUSE_MS = 5 * 60 * 1000;

function warte(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function pause(): number {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
}

/** Per set of services instead of per batch, so that the first step of a follow-up batch
 * also keeps its distance. There is no waiting before the VERY FIRST step. */
async function pauseBeforeWork(k: ImagesContext): Promise<void> {
  const takt = k.faecher.fach('bildbedarf:letzteArbeit', () => ({ am: 0 }));
  const soll = pause();
  if (takt.am) {
    const seit = k.uhr.jetzt() - takt.am;
    if (seit < soll) await warte(soll - seit);
  }
  takt.am = k.uhr.jetzt();
}

/** A failure is remembered, otherwise every unreadable file would cost a futile run
 * on every pass. */
async function createPreview(k: ImagesContext, relPath: string, schluessel: string): Promise<boolean> {
  if (isKnownMissing(k, 'thumb:' + schluessel)) return false;
  // An error is remembered as well: the file would otherwise come back on every pass.
  const r = await versuche('bild-job:vorschauErzeugenAus', () => k.bildwerk.createPreview(relPath));
  const ok = r.ok && !!r.wert;
  if (!ok) rememberMissing(k, 'thumb:' + schluessel, 'Vorschau konnte nicht erzeugt werden');
  return ok;
}

/** Several counters instead of one number, so that the log shows which exit
 * was taken. */
export type StackResult = {
  geholt: number;
  vorschau: number;
  uebersprungen: number;
  gesamt: number;
  /** Every path through the loop increments a counter, so that the sum adds up. */
  notLoaded: number;
  noPreview: number;
  knownMissing: number;
  ohneNummer: number;
  setAside: number;
  /** The image is there, the entry in the catalog failed: the UI keeps going via the proxy. */
  withoutEntry?: number;
  /** Downloads and resizes, NOT touched notes: the tick
   * uses this to decide whether it catches up on another batch. */
  work: number;
};

/** One place, so that no counter is forgotten when extending. */
function emptyResult(): StackResult {
  return {
    geholt: 0,
    vorschau: 0,
    uebersprungen: 0,
    gesamt: 0,
    notLoaded: 0,
    noPreview: 0,
    knownMissing: 0,
    ohneNummer: 0,
    setAside: 0,
    work: 0,
  };
}

/** Only what is NOT zero — otherwise the one important number drowns in zeros. */
export function meldung(e: StackResult): string {
  const teile = [`${e.geholt} geladen`, `${e.vorschau} Vorschau erzeugt`, `${e.uebersprungen} bereits vorhanden`];
  if (e.notLoaded) teile.push(`${e.notLoaded} Download fehlgeschlagen`);
  if (e.noPreview) teile.push(`${e.noPreview} Vorschau fehlgeschlagen`);
  if (e.knownMissing) teile.push(`${e.knownMissing} als fehlend bekannt`);
  if (e.ohneNummer) teile.push(`${e.ohneNummer} ohne Setnummer`);
  if (e.setAside) teile.push(`${e.setAside} zurückgelegt`);
  if (e.withoutEntry) teile.push(`${e.withoutEntry} ohne Katalogeintrag`);
  return `${e.gesamt} bearbeitet: ${teile.join(', ')}`;
}

/** In the database too, because the tile reads in another process. */
export const letzterLauf: { zeit: number | null; ergebnis: StackResult | null } = { zeit: null, ergebnis: null };

function rememberRun(k: ImagesContext, erg: StackResult): void {
  letzterLauf.zeit = k.uhr.jetzt();
  letzterLauf.ergebnis = erg;
}

/** Once per tick, not per batch: the tile reads minutes, and that spares an SD card. */
async function saveRun(k: ImagesContext, erg: StackResult): Promise<void> {
  // await: the next tick reads the state via ANOTHER process; without await the tile would report "not
  // run yet".
  await k.jobQueue
    .setzeZustand(RUN_KEY, JSON.stringify({ zeit: k.uhr.jetzt(), ergebnis: erg }))
    .catch(e => reportError('bild-job:setzeZustand', e));
}

/** A 404 from the CDN needs no attention, everything else does (somethingToDo). */
type StackStatus = { erg: StackResult; reasons: string[]; somethingToDo: boolean; work: number };

/** The file is there, at most the preview is missing. Do not touch known failures:
 * every webp image would otherwise cost a run on EVERY pass. */
async function onlyPreview(k: ImagesContext, setNummer: string, vorschau: string, st: StackStatus): Promise<void> {
  if (fs.existsSync(vorschau)) {
    st.erg.uebersprungen++;
    return;
  }
  if (isKnownMissing(k, 'thumb:' + vorschau)) {
    st.erg.knownMissing++;
    return;
  }
  // Wait here too: a resize costs more than a download.
  await pauseBeforeWork(k);
  st.work++;
  if (await createPreview(k, `/images/sets/${setNummer}.jpg`, vorschau)) {
    st.erg.vorschau++;
    return;
  }
  st.erg.noPreview++;
  st.somethingToDo = true;
  st.reasons.push(`${setNummer}: Vorschau fehlgeschlagen`);
}

/** @returns true if the CDN throttles and the batch aborts */
async function afterFailure(
  k: ImagesContext,
  setNummer: string,
  info: { status?: number },
  st: StackStatus,
): Promise<boolean> {
  const status = info.status;
  // Throttling is NOT a negative result: the images exist, and stubbornly asking again extends the block.
  if (status === 403 || status === 429) {
    const bis = new Date(k.uhr.jetzt() + THROTTLE_PAUSE_MS);
    await k.jobQueue.pauseKind('bildbedarf', bis, `CDN drosselt (HTTP ${status})`);
    console.error(`[image-queue] CDN drosselt (HTTP ${status}) — Pause bis ${bis.toLocaleTimeString()}`);
    return true;
  }
  // ONLY a 404/410 means "the image does not exist"; timeouts and network dropouts must not
  // block an image permanently.
  const hartMissing = info.status === 404 || info.status === 410;
  if (hartMissing) rememberMissing(k, 'set:' + setNummer, `HTTP ${status} vom CDN`);
  else st.somethingToDo = true;
  st.erg.notLoaded++;
  st.reasons.push(
    `${setNummer}: Download fehlgeschlagen` +
      (status ? ` (HTTP ${status})` : ' (kein Statuscode — vorübergehend?)') +
      (hartMissing ? '' : ', wird erneut versucht'),
  );
  return false;
}

async function workStack(k: ImagesContext): Promise<StackResult> {
  const erg = emptyResult();
  const pause = await k.jobQueue.liesPause('bildbedarf');
  if (pause && new Date(pause.until_at).getTime() > k.uhr.jetzt()) return erg; // CDN has throttled, see below
  const rows = await nimmBildwuensche(k, NOTIZ_GILT_MS, STAPEL);
  if (!rows.length) {
    rememberRun(k, erg);
    return erg;
  }

  const st: StackStatus = { erg, reasons: [], somethingToDo: false, work: 0 };
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx]!;
    if (!r.set_number) {
      erg.ohneNummer++;
      continue;
    } // no storage location without a set number

    // The file check is here and not at queuing: 25,000 file accesses in one request would block
    // weak hardware.
    const datei = path.join(SET_IMAGES_DIR, `${r.set_number}.jpg`);
    const vorschau = path.join(SET_IMAGES_DIR, `${r.set_number}_thumb.jpg`);
    if (fs.existsSync(datei)) {
      // no second download
      await onlyPreview(k, r.set_number, vorschau, st);
      if (!(await reportSetImageLoaded(k, r.set_number, r.url))) erg.withoutEntry = (erg.withoutEntry ?? 0) + 1;
      continue;
    }

    // Do not fetch images known to be missing, just like the button "fetch catalog images".
    if (isKnownMissing(k, 'set:' + r.set_number)) {
      erg.knownMissing++;
      // Name it: without a set number there is no way to image-diag.
      st.reasons.push(
        `${r.set_number}: als fehlend bekannt` +
          (reasonFor(k, 'set:' + r.set_number) ? ` (${reasonFor(k, 'set:' + r.set_number)})` : ''),
      );
      continue;
    }

    // The pause stands BETWEEN two requests to the CDN — not before the first and not for sets whose file
    // is already there.
    await pauseBeforeWork(k);
    st.work++;

    const info: { status?: number } = {};
    // An error counts like a futile fetch; afterFailure() decides about the retry.
    const abruf = await versuche('bild-job:setBildHerunterladen', k.bildwerk.setBildLaden(r.url, r.set_number, info));
    const lokal = abruf.ok ? abruf.wert : null;
    if (!lokal) {
      if (await afterFailure(k, r.set_number, info, st)) {
        // Put back ALL unprocessed notes: the batch came via DELETE … RETURNING, the rest would otherwise
        // be lost silently.
        const rest = rows.slice(idx);
        await noteImageDemand(
          k,
          rest.map(x => x.url),
          rest.map(x => x.set_number),
        ); // If putting back fails, it throws: the job fails visibly instead of silently losing notes.
        erg.setAside = rest.length;
        break;
      }
      continue;
    }
    // The preview is NOT created in setBildHerunterladen(); without this call it would stay at the large
    // original file.
    await createPreview(k, lokal, vorschau);
    // Only the entry makes the UI load the file instead of the proxy.
    if (!(await reportSetImageLoaded(k, r.set_number, r.url))) erg.withoutEntry = (erg.withoutEntry ?? 0) + 1;
    erg.geholt++;
  }
  // Rows put back are NOT processed.
  erg.gesamt = rows.length - erg.setAside;
  erg.work = st.work;
  const { reasons, somethingToDo } = st;
  // With few cases by name: with the set number, GET /api/v1/admin/image-diag/:setNumber answers the
  // question in one response.
  if (reasons.length && reasons.length <= 5) {
    (somethingToDo ? console.error : console.warn)(`[image-queue] ${reasons.join(' · ')}`);
  }
  // Record it here: whoever executes the batch has worked, no matter where it was called from. Only the tick
  // writes to the database.
  rememberRun(k, erg);
  return erg;
}

/** The abort depends on real work, not on touched notes. */
async function tickPass(k: ImagesContext): Promise<StackResult> {
  const summe = emptyResult();
  while (summe.gesamt < DURCHGANG_MAX_NOTIZEN && summe.work < STAPEL) {
    const e = await workStack(k);
    summe.geholt += e.geholt;
    summe.vorschau += e.vorschau;
    summe.uebersprungen += e.uebersprungen;
    summe.gesamt += e.gesamt;
    summe.work += e.work;
    summe.notLoaded += e.notLoaded;
    summe.noPreview += e.noPreview;
    summe.knownMissing += e.knownMissing;
    summe.ohneNummer += e.ohneNummer;
    summe.setAside += e.setAside;
    if (e.withoutEntry) summe.withoutEntry = (summe.withoutEntry ?? 0) + e.withoutEntry;
    if (!e.gesamt) break;
  }
  // Even a tick that found nothing is a sign of life for the tile.
  await saveRun(k, summe);
  return summe;
}

/** If the CDN throttles, the job goes back into the table until the end of the pause. */
export async function processImageDemand(kx: ImagesContext, k: JobContext): Promise<void> {
  await schreibePuffer(kx);
  for (;;) {
    if (k.beendet) throw new JobInterrupted();
    const e = await tickPass(kx);
    if (e.gesamt || e.setAside) console.log(`[image-queue] ${meldung(e)}`);
    const pause = await kx.jobQueue.liesPause('bildbedarf');
    if (pause && new Date(pause.until_at).getTime() > kx.uhr.jetzt())
      throw new JobMove(new Date(pause.until_at), pause.reason ?? 'CDN drosselt');
    if (!e.gesamt) return;
    if (!(await k.fortschritt({ text: meldung(e) }))) return; // aborted
    await warte(TAKT_MS);
  }
}

export { rememberUsed, setUpImageDemand, stopImageDemand, requestsJeMinute, STAPEL, TAKT_MS, DURCHGANG_MAX_NOTIZEN };

export {
  workStack as _workStack,
  tickPass as _tickPass,
  deleteExpired as _deleteExpired,
  schreibePuffer as _writeBuffer,
};
