/** /api/v1/admin — every route through requireApiAdmin, so no handler can
 * forget the check. */
import { guardFor } from './middleware';
import { proxyHintStatus } from '../../src/http/proxyHint';
import { pageFrom } from '../../src/infra/page';
import { vertragsRouter } from '../../src/http/contractRouter';
import type { Dienste } from '../../src/services';
import { fachfehler } from '../../src/infra/errorTexts';

export function buildAdminRouter(
  d: Pick<Dienste, 'settings' | 'jobQueue' | 'catalog' | 'account' | 'externalSources' | 'management'>,
) {
  const { requireApiAdmin } = guardFor(d.account);
  const router = vertragsRouter('/api/v1', { largeIds: true });

  router.endpunkt('GET /api/v1/admin/auftraege', requireApiAdmin, async req => {
    return { ...(await d.management.jobsOverview({ status: req.abfrage.status, art: req.abfrage.art })) };
  });

  router.endpunkt('POST /api/v1/admin/auftraege/:id/abbrechen', requireApiAdmin, async req => {
    return { ...(await d.jobQueue.auftragAbbrechen(req.pfad.id)) };
  });

  router.endpunkt('POST /api/v1/admin/auftraege/:id/wiederholen', requireApiAdmin, async req => {
    return { ...(await d.jobQueue.retryJob(req.pfad.id)) };
  });

  router.endpunkt('POST /api/v1/admin/auftraege/art/:art/jetzt', requireApiAdmin, async req => {
    return { ...(await d.jobQueue.auftragsArtJetzt(req.pfad.art)) };
  });

  router.endpunkt('DELETE /api/v1/admin/auftraege/art/:art', requireApiAdmin, async req => {
    return { ...(await d.management.clearJobType(req.pfad.art)) };
  });

  router.endpunkt('POST /api/v1/admin/trigger-csv-sync', requireApiAdmin, async _req => {
    // If the job is already running, it stays at that one run.
    await d.management.runCatalogSyncNow();
    return { message: 'CSV-Sync wird gestartet…' };
  });

  router.endpunkt('GET /api/v1/admin/protokoll', requireApiAdmin, async _req => {
    return { eintraege: await d.account.verwalter.managementLog() };
  });

  router.endpunkt('GET /api/v1/admin/cache-stats', requireApiAdmin, async _req => {
    return { ...(await d.management.cacheStats()) };
  });

  // Answers the recurring questions about an empty tile in one
  // response: database, disk, proxy, missing marker.
  router.endpunkt('GET /api/v1/admin/image-diag/:setNumber', requireApiAdmin, async req => {
    const sn = req.pfad.setNumber;

    return { ...(await d.management.imageDiagnostics(sn)) };
  });

  // A missing marker blocked an image for seven days, with no way back.
  router.endpunkt('POST /api/v1/admin/forget-image-misses', requireApiAdmin, async req => {
    const sets = Array.isArray(req.eingabe.set_numbers) ? req.eingabe.set_numbers.map(String) : null;
    const entfernt = await d.management.forgetImageMisses(sets, req.eingabe.thumbs === true);
    // The other processes refresh the marker from the table every five minutes.
    return { entfernt, hinweis: 'Greift in allen Arbeitsprozessen binnen fünf Minuten.' };
  });

  // Global (price_cache applies to all accounts), hence only for administrators.
  router.endpunkt('POST /api/v1/admin/cache-clear', requireApiAdmin, async req => {
    await d.management.clearCaches(!!req.eingabe.all);
    return { message: req.eingabe.all ? 'Alle Caches geleert' : 'Preis-Cache geleert' };
  });

  router.endpunkt('GET /api/v1/admin/cache-ttl', requireApiAdmin, async _req => {
    const ttl = await d.settings.globalValue('price_cache_ttl');
    return { ttl: ttl || '24' };
  });

  router.endpunkt('POST /api/v1/admin/cache-ttl', requireApiAdmin, async req => {
    await d.settings.setGlobalValue('price_cache_ttl', req.eingabe.ttl);
    return { ttl: req.eingabe.ttl };
  });

  router.endpunkt('POST /api/v1/admin/default-condition', requireApiAdmin, async req => {
    await d.settings.setGlobalValue('default_price_condition', req.eingabe.condition);
    return { condition: req.eingabe.condition };
  });

  router.endpunkt('GET /api/v1/admin/api-limits', requireApiAdmin, async _req => {
    const [rb, bl, bs] = await Promise.all([
      d.externalSources.quotaLimit('rebrickable'),
      d.externalSources.quotaLimit('bricklink'),
      d.externalSources.quotaLimit('brickset'),
    ]);
    return { limits: { rebrickable: rb, bricklink: bl, brickset: bs } };
  });

  router.endpunkt('PUT /api/v1/admin/api-limits', requireApiAdmin, async req => {
    const { rebrickable, bricklink, brickset } = req.eingabe;
    if (rebrickable !== undefined) await d.settings.setGlobalValue('api_limit_rebrickable', rebrickable);
    if (bricklink !== undefined) await d.settings.setGlobalValue('api_limit_bricklink', bricklink);
    if (brickset !== undefined) {
      const oldLimit = parseInt((await d.settings.globalValue('api_limit_brickset')) || '100', 10);
      await d.settings.setGlobalValue('api_limit_brickset', brickset);
      await d.management.bricksetLimitSet(oldLimit, Number(brickset));
    }
    return {};
  });

  router.endpunkt('POST /api/v1/admin/reimport-instructions', requireApiAdmin, async _req => {
    const enqueued = await d.management.requeueInstructions();
    if (!enqueued) return { enqueued: 0, message: 'Alle Sets haben bereits Anleitungen' };
    return { enqueued };
  });

  // One address for webapp and app; requireApiAdmin accepts both credentials.
  router.endpunkt('GET /api/v1/admin/job-status', requireApiAdmin, async _req => {
    return { ...(await d.management.priceJobStatus()) };
  });

  router.endpunkt('POST /api/v1/admin/trigger-price-job', requireApiAdmin, async _req => {
    return { started: await d.management.runPriceJobNow() };
  });

  // Fills the image stock in advance instead of only while browsing.
  router.endpunkt('POST /api/v1/admin/catalog-images', requireApiAdmin, async req => {
    return { ...(await d.management.queueCatalogImages(req.eingabe.alle_erneut === true)) };
  });

  // Images that exist according to image_local, but whose file is missing.
  router.endpunkt('POST /api/v1/admin/redownload-missing-images', requireApiAdmin, async _req => {
    // Only the enqueueing is awaited; the progress appears in the
    // monitoring under "Image download (CDN)".
    await d.management.reloadMissingImages();
    return { started: true };
  });

  router.endpunkt('GET /api/v1/admin/logs', requireApiAdmin, async req => {
    const minutes = Math.min(2880, Math.max(1, req.abfrage.minutes || 15));
    const rows = await d.management.serverLogSince(minutes);
    return { minutes, count: rows.length, logs: rows };
  });

  router.endpunkt('GET /api/v1/admin/brickset-queue', requireApiAdmin, async req => {
    const rows = await d.catalog.bricksetList();
    const { eintraege, ...seite } = pageFrom(rows, req.abfrage);
    return { count: rows.length, entries: eintraege, ...seite };
  });

  router.endpunkt('POST /api/v1/admin/brickset-queue/:setNumber/retry', requireApiAdmin, async req => {
    const sn = req.pfad.setNumber;
    await d.management.retryBrickset(sn);
    return { set_number: sn };
  });

  router.endpunkt('DELETE /api/v1/admin/brickset-queue/:setNumber', requireApiAdmin, async req => {
    const sn = req.pfad.setNumber;
    await d.management.removeBrickset(sn);
    return { set_number: sn };
  });

  router.endpunkt('GET /api/v1/admin/jobs', requireApiAdmin, async req => {
    return { ...(await d.management.jobMonitor()), proxy_hinweis: proxyHintStatus(req.app) };
  });

  // Body: { name, time: "HH:MM" } for daily jobs or { name: 'priceJob',
  // minutes } for the interval. Takes effect immediately.
  router.endpunkt('POST /api/v1/admin/job-schedule', requireApiAdmin, async req => {
    const { name, time, minutes } = req.eingabe || {};
    await d.management.setJobSchedule(name, time, minutes);
    return {};
  });

  /** Requests an image URL from the SERVER (with, without referer, without headers)
   * to distinguish "missing", "hotlink protection" and "unreachable". POST,
   * because a foreign page could trigger a GET with a Lax cookie via a link. */
  router.endpunkt('POST /api/v1/admin/img-probe', requireApiAdmin, async req => {
    return { ...(await d.management.imageProbe(req.eingabe.url ?? '')) };
  });
  /** Everything that flows into the market price display of a set, optionally with
   * the current BrickLink response; POST for the same reason as above. */
  router.endpunkt('POST /api/v1/admin/price-probe', requireApiAdmin, async req => {
    const setNumber = (req.eingabe.set ?? '').trim();
    if (!setNumber) fachfehler('ungueltig', 'parameter_set_fehlt');
    return { ...(await d.management.priceProbe(req.apiUser.user_id, setNumber, req.eingabe.live ?? false)) };
  });
  return router;
}
