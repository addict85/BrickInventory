/** The monitoring page reaches foreign services and jobs only from here, without a layer jump in the routes. */
import fs from 'node:fs';
import { FetchError } from '../infra/fetch';
import { DAILY_JOBS } from './timesOfDay';
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { errorMessage, reportError, withoutMissingFile } from '../infra/error';
import { Degradations, attempts } from '../infra/result';
import { requestsJeMinute } from '../images';
import { asFetchError } from '../externalSources';
import { failDomain, type ErrorCode } from '../infra/errorTexts';
import type { ManagementContext } from './context';

const SOURCES: Record<string, (q: ManagementContext['externalSources']['quellen']) => Promise<void>> = {
  rebrickable: q => q.checkRebrickableAccess(),
  brickset: q => q.checkBricksetAccess(),
  bricklink: q => q.checkBricklinkAccess(),
};

const SOURCE_NAME: Record<string, string> = {
  rebrickable: 'Rebrickable',
  brickset: 'Brickset',
  bricklink: 'BrickLink',
};

/** The wizard shows the admin what to do; the raw text stays as `grund` for "details". */
function sourceRejection(e: unknown): ErrorCode {
  const f = asFetchError(e),
    text = f.message;
  if (/nicht konfiguriert|nicht vollständig|not configured/i.test(text)) return 'quelle_ohne_schluessel';
  if (
    f.isTransient ||
    (e instanceof FetchError && (e.grund === 'netz' || e.grund === 'zeitlimit')) ||
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up/i.test(text)
  )
    return 'quelle_nicht_erreichbar';
  if (/\b(401|403)\b|invalid|ungültig|unauthori[sz]ed/i.test(text)) return 'quelle_abgelehnt';
  return 'quelle_test_fehlgeschlagen';
}

/** null if the access answers; otherwise code, name and raw reason. Only throws for an unknown source. */
export async function checkSource(
  k: ManagementContext,
  source: string,
): Promise<{ code: ErrorCode; quelle: string; grund: string } | null> {
  const check = Object.hasOwn(SOURCES, source) ? SOURCES[source] : undefined;
  if (!check) failDomain('ungueltig', 'quelle_unbekannt');
  try {
    await check(k.externalSources.quellen);
    return null;
  } catch (e) {
    return { code: sourceRejection(e), quelle: SOURCE_NAME[source] ?? source, grund: errorMessage(e).slice(0, 200) };
  }
}

export async function cacheStats(k: ManagementContext) {
  const leer = { count: 0, limit: 0, remaining: 0 };
  const ab = new Degradations();
  const [stats, stale, rlBL, rlRB, rlBS] = await Promise.all([
    ab.orElse(
      'cache',
      Promise.all([k.catalog.cacheStand(), k.management.pricesInCache()]).then(([c, prices]) => ({ ...c, prices })),
      { prices: 0, subsets: 0, catalog: 0 },
    ),
    ab.orElse('veraltete_preise', k.management.stalePrices(), 0),
    ab.orElse('kontingent_bricklink', k.externalSources.quotaStatus('bricklink'), leer),
    ab.orElse('kontingent_rebrickable', k.externalSources.quotaStatus('rebrickable'), leer),
    ab.orElse('kontingent_brickset', k.externalSources.quotaStatus('brickset'), leer),
  ]);
  return {
    ...stats,
    price_stale: stale,
    rate_limits: { bricklink: rlBL, rebrickable: rlRB, brickset: rlBS },
    db_pool: k.db.getPoolStats(),
    ...ab.detail(),
  };
}

export async function clearCaches(k: ManagementContext, all: boolean) {
  await k.finances.emptyPriceCache();
  if (all) {
    await k.catalog.emptySubsetsCache();
    await k.catalog.emptyCatalogCache();
  }
}

/** If there is quota left today, process right away instead of waiting until tomorrow. */
export async function bricksetLimitSet(k: ManagementContext, alt: number, fresh: number) {
  if (!(fresh > alt)) return;
  // The new limit is saved; without a counter state the queue waits for the next run.
  const rl = await attempts('management:kontingentUebersicht', k.externalSources.quotaStatus('brickset'));
  if (!rl.ok) return;
  const rest = Math.max(0, fresh - (rl.wert.count || 0));
  if (rest <= 0) return;
  console.log(`[brickset] Limit erhöht ${alt}→${fresh}, ${rest} Abrufe frei — Warteschlange wird abgearbeitet`);
  await k.externalSources.brickset.now();
}

export async function requeueInstructions(k: ManagementContext) {
  const absent = await k.management.setsWithoutInstructions();
  for (const { set_number } of absent) {
    await k.catalog.deleteInstructions(set_number);
    await k.catalog.enqueueInstruction(set_number);
  }
  return absent.length;
}

/** In the old format, so that the UI stays unchanged. */
export async function priceJobStatus(k: ManagementContext) {
  const plan = await k.management.lastRunOfType();
  let last: {
    lastRun?: string | null;
    lastDuration?: number | null;
    lastUpdated?: number;
    lastErrors?: number;
    log?: unknown;
  } = {};
  try {
    last = JSON.parse((await k.jobQueue.readState('preis_job_stand')) ?? '{}');
  } catch (e) {
    reportError('management:preis-stand', e);
  }
  const running = plan?.status === 'laeuft';
  const job = {
    running: running,
    lastRun: last.lastRun ?? null,
    lastDuration: last.lastDuration ?? null,
    lastUpdated: last.lastUpdated ?? 0,
    lastErrors: last.lastErrors ?? 0,
    nextRun: plan && !running ? new Date(plan.due_at).toISOString() : null,
    progress:
      running && plan?.progress
        ? {
            current: plan.progress.erledigt ?? 0,
            total: plan.progress.gesamt ?? 0,
            set: plan.progress.text ?? null,
          }
        : null,
    log: Array.isArray(last.log) ? last.log : [],
  };
  return { job, rate_limit: await k.externalSources.quotaStatus('bricklink') };
}

/** false if it is already running. */
export const runPriceJobNow = (k: ManagementContext) => k.jobQueue.pullPlanBefore('preise');
/** Only queues the job; if that fails, the admin learns about it instead of the log. */
export async function reloadMissingImages(k: ManagementContext): Promise<void> {
  await k.jobQueue.placeJobOne('bilder_neu_laden', {}, { schluessel: 'bilder_neu_laden', maxAttempts: 2 });
}

export const runCatalogSyncNow = (k: ManagementContext) => k.jobQueue.pullPlanBefore('csv_sync');

/** Even beyond the daily quota. */
export async function retryBrickset(k: ManagementContext, sn: string) {
  await k.externalSources.setQuotaBack('brickset');
  await k.externalSources.brickset.now(sn);
}

export async function removeBrickset(k: ManagementContext, sn: string) {
  await k.externalSources.quellen.fromRetryQueue(sn);
  await k.catalog.enqueueInstruction(sn, { nurAusweichquelle: true });
}

/** The open scheduled job gets the new appointment immediately. */
export async function setJobSchedule(
  k: ManagementContext,
  name: string,
  time: string | null | undefined,
  minutes: number | string | null | undefined,
) {
  const daily = DAILY_JOBS.find(j => j.monitorKey === name);
  if (daily) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
    if (!m || +(m[1] ?? '') > 23 || +(m[2] ?? '') > 59) failDomain('ungueltig', 'uhrzeit_ungueltig');
    await k.settings.setGlobalValue(
      `job_time_${daily.name}`,
      `${String(+(m[1] ?? '')).padStart(2, '0')}:${String(+(m[2] ?? '')).padStart(2, '0')}`,
    );
  } else if (name === 'priceJob') {
    await k.settings.setGlobalValue(
      'price_job_interval_minutes',
      String(Math.max(5, parseInt(String(minutes), 10) || 60)),
    );
  } else {
    failDomain('ungueltig', 'unbekannter_job');
  }
  await rescheduleJobs(k);
}

export async function rescheduleJobs(k: ManagementContext) {
  await k.jobQueue.scheduleChanged('csv_sync');
  await k.jobQueue.scheduleChanged('preise');
  await k.externalSources.brickset.prefer(await k.externalSources.brickset.dueFrom(false));
}

/** A set is finished with original AND preview; withdrawn negative results
 * are counted as well. */
export async function queueCatalogImages(kx: ManagementContext, allAgain: boolean) {
  const toForgotten = await (allAgain ? kx.management.setImageMisses() : kx.management.setImageMissesWithout404());
  const verworfen = toForgotten.length ? await kx.images.forgetMissing(toForgotten.map(r => r.cache_key)) : 0;
  // What is already finished is not queued again.
  const present: Set<string> = new Set();
  try {
    const names = new Set<string>(fs.readdirSync(SET_IMAGES_DIR));
    // If the preview is missing, the set stays in the queue; the job then does not
    // load again.
    for (const n of names) {
      if (!n.endsWith('_thumb.jpg')) continue;
      const basis = n.slice(0, -'_thumb.jpg'.length);
      if (names.has(`${basis}.jpg`)) present.add(basis);
    }
  } catch (e) {
    // Without a folder nothing is finished yet; every other read error goes into the log.
    withoutMissingFile('management:vorschauen lesen')(e);
  }

  const candidates = await kx.management.catalogImageCandidates();

  // The same naming rule as setBildHerunterladen(), otherwise the comparison would find nothing.
  const fileName = (sn: string) => String(sn).replace(/[^a-z0-9-]/gi, '_');
  const openSets: string[] = [];
  const openUrls: string[] = [];
  for (const k of candidates) {
    if (present.has(fileName(k.set_num))) continue;
    openSets.push(k.set_num);
    openUrls.push(k.set_img_url);
  }

  let newEnqueued = 0;
  if (openUrls.length) {
    newEnqueued = await kx.images.catalogImagesReserve(openUrls, openSets);
    await kx.images.imageDemandKick();
  }
  const open = await kx.management.openImageJobs();
  // "Hours or days?" is the first question; the rate comes from the job itself.
  const proMinute = requestsJeMinute();
  return {
    queued: newEnqueued,
    pending: open?.n ?? 0,
    skipped: candidates.length - openUrls.length,
    // Without the number it would stay unclear why images considered missing are pending again.
    verworfen,
    dauer_minuten: Math.ceil((open?.n ?? 0) / proMinute),
  };
}
/** Without a set list not the whole table: the preview notes have a
 * different purpose and only disappear on request (`vorschauen`). */
export async function forgetImageMisses(
  k: ManagementContext,
  sets: string[] | null,
  previews: boolean,
): Promise<number> {
  const v = k.management;
  const key = sets?.length ? sets.map(sn => `set:${sn}`) : (await v.setImageMisses()).map(r => r.cache_key);
  if (previews) key.push(...(await v.thumbnailImageMisses()).map(r => r.cache_key));
  return key.length ? k.images.forgetMissing(key) : 0;
}

export function serverLogSince(k: ManagementContext, minutes: number) {
  return k.management.logSince(minutes);
}

export { AccountImageRow } from './repository/management';
