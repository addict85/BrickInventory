/** Fremde Dienste und Jobs erreicht die Überwachungsseite nur von hier aus, ohne Schichtsprung in den Routen. */
import fs from 'node:fs';
import { AbrufFehler } from '../infra/abruf';
import { DAILY_JOBS } from './timesOfDay';
import { SET_IMAGES_DIR } from '../infra/appPaths';
import { fehlertext, reportError, withoutMissingFile } from '../infra/fehler';
import { Degradations, versuche } from '../infra/ergebnis';
import { requestsJeMinute } from '../bilder';
import { asFetchError } from '../fremdquellen';
import { fachfehler, type ErrorCode } from '../infra/fehlerTexte';
import type { ManagementContext } from './context';

const SOURCES: Record<string, (q: ManagementContext['fremdquellen']['quellen']) => Promise<void>> = {
  rebrickable: q => q.checkRebrickableAccess(),
  brickset: q => q.checkBricksetAccess(),
  bricklink: q => q.checkBricklinkAccess(),
};

const SOURCE_NAME: Record<string, string> = {
  rebrickable: 'Rebrickable',
  brickset: 'Brickset',
  bricklink: 'BrickLink',
};

/** Der Assistent zeigt dem Verwalter, was zu tun ist; der rohe Text bleibt als `grund` für „Details“. */
function sourceRejection(e: unknown): ErrorCode {
  const f = asFetchError(e),
    text = f.message;
  if (/nicht konfiguriert|nicht vollständig|not configured/i.test(text)) return 'quelle_ohne_schluessel';
  if (
    f.isTransient ||
    (e instanceof AbrufFehler && (e.grund === 'netz' || e.grund === 'zeitlimit')) ||
    /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up/i.test(text)
  )
    return 'quelle_nicht_erreichbar';
  if (/\b(401|403)\b|invalid|ungültig|unauthori[sz]ed/i.test(text)) return 'quelle_abgelehnt';
  return 'quelle_test_fehlgeschlagen';
}

/** null, wenn der Zugang antwortet; sonst Code, Name und roher Grund. Wirft nur bei unbekannter Quelle. */
export async function checkSource(
  k: ManagementContext,
  quelle: string,
): Promise<{ code: ErrorCode; quelle: string; grund: string } | null> {
  const pruefe = Object.hasOwn(SOURCES, quelle) ? SOURCES[quelle] : undefined;
  if (!pruefe) fachfehler('ungueltig', 'quelle_unbekannt');
  try {
    await pruefe(k.fremdquellen.quellen);
    return null;
  } catch (e) {
    return { code: sourceRejection(e), quelle: SOURCE_NAME[quelle] ?? quelle, grund: fehlertext(e).slice(0, 200) };
  }
}

export async function cacheStats(k: ManagementContext) {
  const leer = { count: 0, limit: 0, remaining: 0 };
  const ab = new Degradations();
  const [stats, stale, rlBL, rlRB, rlBS] = await Promise.all([
    ab.oder(
      'cache',
      Promise.all([k.katalog.cacheStand(), k.management.pricesInCache()]).then(([c, prices]) => ({ ...c, prices })),
      { prices: 0, subsets: 0, catalog: 0 },
    ),
    ab.oder('veraltete_preise', k.management.stalePrices(), 0),
    ab.oder('kontingent_bricklink', k.fremdquellen.quotaStatus('bricklink'), leer),
    ab.oder('kontingent_rebrickable', k.fremdquellen.quotaStatus('rebrickable'), leer),
    ab.oder('kontingent_brickset', k.fremdquellen.quotaStatus('brickset'), leer),
  ]);
  return {
    ...stats,
    price_stale: stale,
    rate_limits: { bricklink: rlBL, rebrickable: rlRB, brickset: rlBS },
    db_pool: k.db.getPoolStats(),
    ...ab.angabe(),
  };
}

export async function clearCaches(k: ManagementContext, alle: boolean) {
  await k.finanzen.emptyPriceCache();
  if (alle) {
    await k.katalog.emptySubsetsCache();
    await k.katalog.emptyCatalogCache();
  }
}

/** Ist heute noch Kontingent da, gleich abarbeiten statt bis morgen zu warten. */
export async function bricksetLimitSet(k: ManagementContext, alt: number, neu: number) {
  if (!(neu > alt)) return;
  // Das neue Limit ist gespeichert; ohne Zählerstand wartet die Schlange auf den nächsten Lauf.
  const rl = await versuche('management:kontingentUebersicht', k.fremdquellen.quotaStatus('brickset'));
  if (!rl.ok) return;
  const rest = Math.max(0, neu - (rl.wert.count || 0));
  if (rest <= 0) return;
  console.log(`[brickset] Limit erhöht ${alt}→${neu}, ${rest} Abrufe frei — Warteschlange wird abgearbeitet`);
  await k.fremdquellen.brickset.jetzt();
}

export async function requeueInstructions(k: ManagementContext) {
  const fehlend = await k.management.setsWithoutInstructions();
  for (const { set_number } of fehlend) {
    await k.katalog.deleteInstructions(set_number);
    await k.katalog.anleitungEinreihen(set_number);
  }
  return fehlend.length;
}

/** Im Format von früher, damit die Oberfläche unverändert bleibt. */
export async function priceJobStatus(k: ManagementContext) {
  const plan = await k.management.lastRunOfType();
  let letzter: {
    lastRun?: string | null;
    lastDuration?: number | null;
    lastUpdated?: number;
    lastErrors?: number;
    log?: unknown;
  } = {};
  try {
    letzter = JSON.parse((await k.auftraege.liesZustand('preis_job_stand')) ?? '{}');
  } catch (e) {
    reportError('management:preis-stand', e);
  }
  const laeuft = plan?.status === 'laeuft';
  const job = {
    running: laeuft,
    lastRun: letzter.lastRun ?? null,
    lastDuration: letzter.lastDuration ?? null,
    lastUpdated: letzter.lastUpdated ?? 0,
    lastErrors: letzter.lastErrors ?? 0,
    nextRun: plan && !laeuft ? new Date(plan.due_at).toISOString() : null,
    progress:
      laeuft && plan?.progress
        ? {
            current: plan.progress.erledigt ?? 0,
            total: plan.progress.gesamt ?? 0,
            set: plan.progress.text ?? null,
          }
        : null,
    log: Array.isArray(letzter.log) ? letzter.log : [],
  };
  return { job, rate_limit: await k.fremdquellen.quotaStatus('bricklink') };
}

/** false, wenn er schon läuft. */
export const runPriceJobNow = (k: ManagementContext) => k.auftraege.pullPlanBefore('preise');
/** Stellt nur den Auftrag ein; scheitert das, erfährt es der Verwalter statt des Protokolls. */
export async function reloadMissingImages(k: ManagementContext): Promise<void> {
  await k.auftraege.placeJobOne('bilder_neu_laden', {}, { schluessel: 'bilder_neu_laden', maxAttempts: 2 });
}

export const runCatalogSyncNow = (k: ManagementContext) => k.auftraege.pullPlanBefore('csv_sync');

/** Auch über das Tageskontingent hinweg. */
export async function retryBrickset(k: ManagementContext, sn: string) {
  await k.fremdquellen.setQuotaBack('brickset');
  await k.fremdquellen.brickset.jetzt(sn);
}

export async function removeBrickset(k: ManagementContext, sn: string) {
  await k.fremdquellen.quellen.fromRetryQueue(sn);
  await k.katalog.anleitungEinreihen(sn, { nurAusweichquelle: true });
}

/** Der offene geplante Auftrag bekommt sofort den neuen Termin. */
export async function setJobSchedule(
  k: ManagementContext,
  name: string,
  time: string | null | undefined,
  minutes: number | string | null | undefined,
) {
  const daily = DAILY_JOBS.find(j => j.monitorKey === name);
  if (daily) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
    if (!m || +(m[1] ?? '') > 23 || +(m[2] ?? '') > 59) fachfehler('ungueltig', 'uhrzeit_ungueltig');
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
    fachfehler('ungueltig', 'unbekannter_job');
  }
  await rescheduleJobs(k);
}

export async function rescheduleJobs(k: ManagementContext) {
  await k.auftraege.scheduleChanged('csv_sync');
  await k.auftraege.scheduleChanged('preise');
  await k.fremdquellen.brickset.prefer(await k.fremdquellen.brickset.dueAb(false));
}

/** Fertig ist ein Set mit Original UND Vorschau; zurückgenommene Fehlanzeigen
 * werden mitgezählt. */
export async function queueCatalogImages(kx: ManagementContext, allAgain: boolean) {
  const toForgotten = await (allAgain ? kx.management.setImageMisses() : kx.management.setImageMissesWithout404());
  const verworfen = toForgotten.length ? await kx.bilder.forgetMissing(toForgotten.map(r => r.cache_key)) : 0;
  // Was schon fertig ist, wird nicht wieder eingereiht.
  const vorhanden: Set<string> = new Set();
  try {
    const namen = new Set<string>(fs.readdirSync(SET_IMAGES_DIR));
    // Fehlt die Vorschau, bleibt das Set in der Warteschlange; der Job lädt dann
    // nicht erneut.
    for (const n of namen) {
      if (!n.endsWith('_thumb.jpg')) continue;
      const basis = n.slice(0, -'_thumb.jpg'.length);
      if (namen.has(`${basis}.jpg`)) vorhanden.add(basis);
    }
  } catch (e) {
    // Ohne Ordner ist noch nichts fertig; jeder andere Lesefehler kommt ins Protokoll.
    withoutMissingFile('management:vorschauen lesen')(e);
  }

  const kandidaten = await kx.management.catalogImageCandidates();

  // Dieselbe Namensregel wie setBildHerunterladen(), sonst fände der Vergleich nichts.
  const fileName = (sn: string) => String(sn).replace(/[^a-z0-9-]/gi, '_');
  const openSets: string[] = [];
  const openUrls: string[] = [];
  for (const k of kandidaten) {
    if (vorhanden.has(fileName(k.set_num))) continue;
    openSets.push(k.set_num);
    openUrls.push(k.set_img_url);
  }

  let newEnqueued = 0;
  if (openUrls.length) {
    newEnqueued = await kx.bilder.catalogImagesReserve(openUrls, openSets);
    await kx.bilder.imageDemandKick();
  }
  const offen = await kx.management.openImageJobs();
  // „Stunden oder Tage?" ist die erste Frage; die Rate kommt aus dem Job selbst.
  const proMinute = requestsJeMinute();
  return {
    queued: newEnqueued,
    pending: offen?.n ?? 0,
    skipped: kandidaten.length - openUrls.length,
    // Ohne die Zahl bliebe unklar, warum als fehlend geltende Bilder wieder anstehen.
    verworfen,
    dauer_minuten: Math.ceil((offen?.n ?? 0) / proMinute),
  };
}
/** Ohne Setliste nicht die ganze Tabelle: Die Vorschau-Vermerke haben einen
 * anderen Zweck und verschwinden nur auf Wunsch (`vorschauen`). */
export async function forgetImageMisses(
  k: ManagementContext,
  sets: string[] | null,
  vorschauen: boolean,
): Promise<number> {
  const v = k.management;
  const schluessel = sets?.length ? sets.map(sn => `set:${sn}`) : (await v.setImageMisses()).map(r => r.cache_key);
  if (vorschauen) schluessel.push(...(await v.thumbnailImageMisses()).map(r => r.cache_key));
  return schluessel.length ? k.bilder.forgetMissing(schluessel) : 0;
}

export function serverLogSince(k: ManagementContext, minuten: number) {
  return k.management.logSince(minuten);
}

export { AccountImageRow } from './repository/management';
