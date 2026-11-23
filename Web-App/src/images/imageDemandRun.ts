import fs from 'node:fs';
import path from 'node:path';
import { reportError } from '../infra/error';
import { reasonFor, isKnownMissing, rememberMissing } from './imageMisses';
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { JobInterrupted, JobMove, type JobContext } from '../jobQueue';
import {
  BATCH,
  TICK_MS,
  NOTE_VALID_MS,
  rememberUsed,
  reportSetImageLoaded,
  writeBuffer,
  noteImageDemand,
  deleteExpired,
  setUpImageDemand,
  stopImageDemand,
  requestsPerMinute,
  takeImageRequests,
} from './imageDemand';
import { attempts } from '../infra/result';
import type { ImagesContext } from './context';

/** Store images requested via the proxy locally in the BACKGROUND, including
 * the preview — so that the request itself never waits for the CDN. */

/** Spacing between two work steps (see STAPEL in src/images/imageDemand.ts). */
const DELAY_MIN_MS = 500;
const DELAY_MAX_MS = 1000;

/** Cap per tick; the tick counts real work, otherwise it would run infinitely slowly over hundreds
 * of already existing images. */
const PASS_MAX_NOTES = 500;

const RUN_KEY = 'imgqueue_last_run';

/** Five minutes let a short limit expire; more important is that
 * there is a pause at all: stubbornly asking again extends the block. */
const THROTTLE_PAUSE_MS = 5 * 60 * 1000;

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function pause(): number {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));
}

/** Per set of services instead of per batch, so that the first step of a follow-up batch
 * also keeps its distance. There is no waiting before the VERY FIRST step. */
async function pauseBeforeWork(k: ImagesContext): Promise<void> {
  const tick = k.compartments.slot('image_demand:letzteArbeit', () => ({ am: 0 }));
  const expected = pause();
  if (tick.am) {
    const since = k.clock.now() - tick.am;
    if (since < expected) await wait(expected - since);
  }
  tick.am = k.clock.now();
}

/** A failure is remembered, otherwise every unreadable file would cost a futile run
 * on every pass. */
async function createPreview(k: ImagesContext, relPath: string, key: string): Promise<boolean> {
  if (isKnownMissing(k, 'thumb:' + key)) return false;
  // An error is remembered as well: the file would otherwise come back on every pass.
  const r = await attempts('bild-job:vorschauErzeugenAus', () => k.imageWorker.createPreview(relPath));
  const ok = r.ok && !!r.value;
  if (!ok) rememberMissing(k, 'thumb:' + key, 'Vorschau konnte nicht erzeugt werden');
  return ok;
}

/** Several counters instead of one number, so that the log shows which exit
 * was taken. */
export type StackResult = {
  fetched: number;
  preview: number;
  skipped: number;
  total: number;
  /** Every path through the loop increments a counter, so that the sum adds up. */
  notLoaded: number;
  noPreview: number;
  knownMissing: number;
  withoutNumber: number;
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
    fetched: 0,
    preview: 0,
    skipped: 0,
    total: 0,
    notLoaded: 0,
    noPreview: 0,
    knownMissing: 0,
    withoutNumber: 0,
    setAside: 0,
    work: 0,
  };
}

/** Only what is NOT zero — otherwise the one important number drowns in zeros. */
export function message(e: StackResult): string {
  const parts = [`${e.fetched} geladen`, `${e.preview} Vorschau erzeugt`, `${e.skipped} bereits vorhanden`];
  if (e.notLoaded) parts.push(`${e.notLoaded} Download fehlgeschlagen`);
  if (e.noPreview) parts.push(`${e.noPreview} Vorschau fehlgeschlagen`);
  if (e.knownMissing) parts.push(`${e.knownMissing} als fehlend bekannt`);
  if (e.withoutNumber) parts.push(`${e.withoutNumber} ohne Setnummer`);
  if (e.setAside) parts.push(`${e.setAside} zurückgelegt`);
  if (e.withoutEntry) parts.push(`${e.withoutEntry} ohne Katalogeintrag`);
  return `${e.total} bearbeitet: ${parts.join(', ')}`;
}

/** In the database too, because the tile reads in another process. */
export const lastRun: { time: number | null; result: StackResult | null } = { time: null, result: null };

function rememberRun(k: ImagesContext, erg: StackResult): void {
  lastRun.time = k.clock.now();
  lastRun.result = erg;
}

/** Once per tick, not per batch: the tile reads minutes, and that spares an SD card. */
async function saveRun(k: ImagesContext, erg: StackResult): Promise<void> {
  // await: the next tick reads the state via ANOTHER process; without await the tile would report "not
  // run yet".
  await k.jobQueue
    // The keys are what run_state already holds; the job monitor reads `zeit` from there.
    .setState(RUN_KEY, JSON.stringify({ zeit: k.clock.now(), ergebnis: erg }))
    .catch(e => reportError('bild-job:setzeZustand', e));
}

/** A 404 from the CDN needs no attention, everything else does (somethingToDo). */
type StackStatus = { erg: StackResult; reasons: string[]; somethingToDo: boolean; work: number };

/** The file is there, at most the preview is missing. Do not touch known failures:
 * every webp image would otherwise cost a run on EVERY pass. */
async function onlyPreview(k: ImagesContext, setNumber: string, preview: string, st: StackStatus): Promise<void> {
  if (fs.existsSync(preview)) {
    st.erg.skipped++;
    return;
  }
  if (isKnownMissing(k, 'thumb:' + preview)) {
    st.erg.knownMissing++;
    return;
  }
  // Wait here too: a resize costs more than a download.
  await pauseBeforeWork(k);
  st.work++;
  if (await createPreview(k, `/images/sets/${setNumber}.jpg`, preview)) {
    st.erg.preview++;
    return;
  }
  st.erg.noPreview++;
  st.somethingToDo = true;
  st.reasons.push(`${setNumber}: Vorschau fehlgeschlagen`);
}

/** @returns true if the CDN throttles and the batch aborts */
async function afterFailure(
  k: ImagesContext,
  setNumber: string,
  info: { status?: number },
  st: StackStatus,
): Promise<boolean> {
  const status = info.status;
  // Throttling is NOT a negative result: the images exist, and stubbornly asking again extends the block.
  if (status === 403 || status === 429) {
    const bis = new Date(k.clock.now() + THROTTLE_PAUSE_MS);
    await k.jobQueue.pauseKind('image_demand', bis, `CDN drosselt (HTTP ${status})`);
    console.error(`[image-queue] CDN drosselt (HTTP ${status}) — Pause bis ${bis.toLocaleTimeString()}`);
    return true;
  }
  // ONLY a 404/410 means "the image does not exist"; timeouts and network dropouts must not
  // block an image permanently.
  const hardMissing = info.status === 404 || info.status === 410;
  if (hardMissing) rememberMissing(k, 'set:' + setNumber, `HTTP ${status} vom CDN`);
  else st.somethingToDo = true;
  st.erg.notLoaded++;
  st.reasons.push(
    `${setNumber}: Download fehlgeschlagen` +
      (status ? ` (HTTP ${status})` : ' (kein Statuscode — vorübergehend?)') +
      (hardMissing ? '' : ', wird erneut versucht'),
  );
  return false;
}

type ImageRequest = Awaited<ReturnType<typeof takeImageRequests>>[number];

/** One note of the batch; `stop`: the CDN throttles and the rest goes back. */
async function workRow(k: ImagesContext, r: ImageRequest, st: StackStatus): Promise<'next' | 'stop'> {
  const erg = st.erg;
  if (!r.set_number) {
    erg.withoutNumber++; // no storage location without a set number
    return 'next';
  }
  // The file check is here and not at queuing: 25,000 file accesses in one request would block
  // weak hardware.
  const file = path.join(SET_IMAGES_DIR, `${r.set_number}.jpg`);
  const preview = path.join(SET_IMAGES_DIR, `${r.set_number}_thumb.jpg`);
  if (fs.existsSync(file)) {
    // no second download
    await onlyPreview(k, r.set_number, preview, st);
    if (!(await reportSetImageLoaded(k, r.set_number, r.url))) erg.withoutEntry = (erg.withoutEntry ?? 0) + 1;
    return 'next';
  }
  // Do not fetch images known to be missing, just like the button "fetch catalog images".
  if (isKnownMissing(k, 'set:' + r.set_number)) {
    erg.knownMissing++;
    // Name it: without a set number there is no way to image-diag.
    const reason = reasonFor(k, 'set:' + r.set_number);
    st.reasons.push(`${r.set_number}: als fehlend bekannt` + (reason ? ` (${reason})` : ''));
    return 'next';
  }
  // The pause stands BETWEEN two requests to the CDN — not before the first and not for sets whose file
  // is already there.
  await pauseBeforeWork(k);
  st.work++;
  const info: { status?: number } = {};
  // An error counts like a futile fetch; afterFailure() decides about the retry.
  const fetch = await attempts('bild-job:setBildHerunterladen', k.imageWorker.loadSetImage(r.url, r.set_number, info));
  const local = fetch.ok ? fetch.value : null;
  if (!local) return (await afterFailure(k, r.set_number, info, st)) ? 'stop' : 'next';
  // The preview is NOT created in setBildHerunterladen(); without this call it would stay at the large
  // original file.
  await createPreview(k, local, preview);
  // Only the entry makes the UI load the file instead of the proxy.
  if (!(await reportSetImageLoaded(k, r.set_number, r.url))) erg.withoutEntry = (erg.withoutEntry ?? 0) + 1;
  erg.fetched++;
  return 'next';
}

async function workStack(k: ImagesContext): Promise<StackResult> {
  const erg = emptyResult();
  const pause = await k.jobQueue.readPause('image_demand');
  if (pause && new Date(pause.until_at).getTime() > k.clock.now()) return erg; // CDN has throttled, see below
  const rows = await takeImageRequests(k, NOTE_VALID_MS, BATCH);
  if (!rows.length) {
    rememberRun(k, erg);
    return erg;
  }

  const st: StackStatus = { erg, reasons: [], somethingToDo: false, work: 0 };
  for (let idx = 0; idx < rows.length; idx++) {
    if ((await workRow(k, rows[idx]!, st)) === 'next') continue;
    // Put back ALL unprocessed notes: the batch came via DELETE … RETURNING, the rest would otherwise
    // be lost silently. If putting back fails, it throws: the job fails visibly instead of silently losing notes.
    const rest = rows.slice(idx);
    await noteImageDemand(
      k,
      rest.map(x => x.url),
      rest.map(x => x.set_number),
    );
    erg.setAside = rest.length;
    break;
  }
  // Rows put back are NOT processed.
  erg.total = rows.length - erg.setAside;
  erg.work = st.work;
  const { reasons, somethingToDo } = st;
  // With few cases by name: with the set number, GET /api/v2/admin/image-diag/:setNumber answers the
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
  const sum = emptyResult();
  while (sum.total < PASS_MAX_NOTES && sum.work < BATCH) {
    const e = await workStack(k);
    sum.fetched += e.fetched;
    sum.preview += e.preview;
    sum.skipped += e.skipped;
    sum.total += e.total;
    sum.work += e.work;
    sum.notLoaded += e.notLoaded;
    sum.noPreview += e.noPreview;
    sum.knownMissing += e.knownMissing;
    sum.withoutNumber += e.withoutNumber;
    sum.setAside += e.setAside;
    if (e.withoutEntry) sum.withoutEntry = (sum.withoutEntry ?? 0) + e.withoutEntry;
    if (!e.total) break;
  }
  // Even a tick that found nothing is a sign of life for the tile.
  await saveRun(k, sum);
  return sum;
}

/** If the CDN throttles, the job goes back into the table until the end of the pause. */
export async function processImageDemand(kx: ImagesContext, k: JobContext): Promise<void> {
  await writeBuffer(kx);
  for (;;) {
    if (k.ended) throw new JobInterrupted();
    const e = await tickPass(kx);
    if (e.total || e.setAside) console.log(`[image-queue] ${message(e)}`);
    const pause = await kx.jobQueue.readPause('image_demand');
    if (pause && new Date(pause.until_at).getTime() > kx.clock.now())
      throw new JobMove(new Date(pause.until_at), pause.reason ?? 'CDN drosselt');
    if (!e.total) return;
    if (!(await k.progress({ text: message(e) }))) return; // aborted
    await wait(TICK_MS);
  }
}

export { rememberUsed, setUpImageDemand, stopImageDemand, requestsPerMinute, BATCH, TICK_MS, PASS_MAX_NOTES };

export { workStack as _workStack, tickPass as _tickPass, deleteExpired as _deleteExpired, writeBuffer as _writeBuffer };
