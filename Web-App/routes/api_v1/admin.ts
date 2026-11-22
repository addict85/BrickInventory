/** /api/v2/admin — every route through requireApiAdmin, so no handler can
 * forget the check. */
import { guardFor } from './middleware';
import { proxyHintStatus } from '../../src/http/proxyHint';
import { pageFrom } from '../../src/infra/page';
import { contractRouter } from '../../src/http/contractRouter';
import type { Services } from '../../src/services';
import { failDomain } from '../../src/infra/errorTexts';

export function buildAdminRouter(
  d: Pick<Services, 'settings' | 'jobQueue' | 'catalog' | 'account' | 'externalSources' | 'management'>,
) {
  const { requireApiAdmin } = guardFor(d.account);
  const router = contractRouter('/api/v2', { largeIds: true });

  router.endpoint('GET /api/v2/admin/job-queue', requireApiAdmin, async req => {
    return { ...(await d.management.jobsOverview({ status: req.queryArgs.status, kind: req.queryArgs.kind })) };
  });

  router.endpoint('POST /api/v2/admin/job-queue/:id/cancel', requireApiAdmin, async req => {
    return { ...(await d.jobQueue.cancelJob(req.pathArgs.id)) };
  });

  router.endpoint('POST /api/v2/admin/job-queue/:id/retry', requireApiAdmin, async req => {
    return { ...(await d.jobQueue.retryJob(req.pathArgs.id)) };
  });

  router.endpoint('POST /api/v2/admin/job-queue/kind/:kind/now', requireApiAdmin, async req => {
    return { ...(await d.jobQueue.jobKindNow(req.pathArgs.kind)) };
  });

  router.endpoint('DELETE /api/v2/admin/job-queue/kind/:kind', requireApiAdmin, async req => {
    return { ...(await d.management.clearJobType(req.pathArgs.kind)) };
  });

  router.endpoint('POST /api/v2/admin/trigger-csv-sync', requireApiAdmin, async _req => {
    // If the job is already running, it stays at that one run.
    await d.management.runCatalogSyncNow();
    return { message: 'CSV-Sync wird gestartet…' };
  });

  router.endpoint('GET /api/v2/admin/audit-log', requireApiAdmin, async _req => {
    return { entries: await d.account.verwalter.managementLog() };
  });

  router.endpoint('GET /api/v2/admin/cache-stats', requireApiAdmin, async _req => {
    return { ...(await d.management.cacheStats()) };
  });

  // Answers the recurring questions about an empty tile in one
  // response: database, disk, proxy, missing marker.
  router.endpoint('GET /api/v2/admin/image-diag/:setNumber', requireApiAdmin, async req => {
    const sn = req.pathArgs.setNumber;

    return { ...(await d.management.imageDiagnostics(sn)) };
  });

  // A missing marker blocked an image for seven days, with no way back.
  router.endpoint('POST /api/v2/admin/forget-image-misses', requireApiAdmin, async req => {
    const sets = Array.isArray(req.input.set_numbers) ? req.input.set_numbers.map(String) : null;
    const removed = await d.management.forgetImageMisses(sets, req.input.thumbs === true);
    // The other processes refresh the marker from the table every five minutes.
    return { removed, hint: 'Greift in allen Arbeitsprozessen binnen fünf Minuten.' };
  });

  // Global (price_cache applies to all accounts), hence only for administrators.
  router.endpoint('POST /api/v2/admin/cache-clear', requireApiAdmin, async req => {
    await d.management.clearCaches(!!req.input.all);
    return { message: req.input.all ? 'Alle Caches geleert' : 'Preis-Cache geleert' };
  });

  router.endpoint('GET /api/v2/admin/cache-ttl', requireApiAdmin, async _req => {
    const ttl = await d.settings.globalValue('price_cache_ttl');
    return { ttl: ttl || '24' };
  });

  router.endpoint('POST /api/v2/admin/cache-ttl', requireApiAdmin, async req => {
    await d.settings.setGlobalValue('price_cache_ttl', req.input.ttl);
    return { ttl: req.input.ttl };
  });

  router.endpoint('POST /api/v2/admin/default-condition', requireApiAdmin, async req => {
    await d.settings.setGlobalValue('default_price_condition', req.input.condition);
    return { condition: req.input.condition };
  });

  router.endpoint('GET /api/v2/admin/api-limits', requireApiAdmin, async _req => {
    const [rb, bl, bs] = await Promise.all([
      d.externalSources.quotaLimit('rebrickable'),
      d.externalSources.quotaLimit('bricklink'),
      d.externalSources.quotaLimit('brickset'),
    ]);
    return { limits: { rebrickable: rb, bricklink: bl, brickset: bs } };
  });

  router.endpoint('PUT /api/v2/admin/api-limits', requireApiAdmin, async req => {
    const { rebrickable, bricklink, brickset } = req.input;
    if (rebrickable !== undefined) await d.settings.setGlobalValue('api_limit_rebrickable', rebrickable);
    if (bricklink !== undefined) await d.settings.setGlobalValue('api_limit_bricklink', bricklink);
    if (brickset !== undefined) {
      const oldLimit = parseInt((await d.settings.globalValue('api_limit_brickset')) || '100', 10);
      await d.settings.setGlobalValue('api_limit_brickset', brickset);
      await d.management.bricksetLimitSet(oldLimit, Number(brickset));
    }
    return {};
  });

  router.endpoint('POST /api/v2/admin/reimport-instructions', requireApiAdmin, async _req => {
    const enqueued = await d.management.requeueInstructions();
    if (!enqueued) return { enqueued: 0, message: 'Alle Sets haben bereits Anleitungen' };
    return { enqueued };
  });

  // One address for webapp and app; requireApiAdmin accepts both credentials.
  router.endpoint('GET /api/v2/admin/job-status', requireApiAdmin, async _req => {
    return { ...(await d.management.priceJobStatus()) };
  });

  router.endpoint('POST /api/v2/admin/trigger-price-job', requireApiAdmin, async _req => {
    return { started: await d.management.runPriceJobNow() };
  });

  // Fills the image stock in advance instead of only while browsing.
  router.endpoint('POST /api/v2/admin/catalog-images', requireApiAdmin, async req => {
    return { ...(await d.management.queueCatalogImages(req.input.all_again === true)) };
  });

  // Images that exist according to image_local, but whose file is missing.
  router.endpoint('POST /api/v2/admin/redownload-missing-images', requireApiAdmin, async _req => {
    // Only the enqueueing is awaited; the progress appears in the
    // monitoring under "Image download (CDN)".
    await d.management.reloadMissingImages();
    return { started: true };
  });

  router.endpoint('GET /api/v2/admin/logs', requireApiAdmin, async req => {
    const minutes = Math.min(2880, Math.max(1, req.queryArgs.minutes || 15));
    const rows = await d.management.serverLogSince(minutes);
    return { minutes, count: rows.length, logs: rows };
  });

  router.endpoint('GET /api/v2/admin/brickset-queue', requireApiAdmin, async req => {
    const rows = await d.catalog.bricksetList();
    const { entries, ...page } = pageFrom(rows, req.queryArgs);
    return { count: rows.length, entries: entries, ...page };
  });

  router.endpoint('POST /api/v2/admin/brickset-queue/:setNumber/retry', requireApiAdmin, async req => {
    const sn = req.pathArgs.setNumber;
    await d.management.retryBrickset(sn);
    return { set_number: sn };
  });

  router.endpoint('DELETE /api/v2/admin/brickset-queue/:setNumber', requireApiAdmin, async req => {
    const sn = req.pathArgs.setNumber;
    await d.management.removeBrickset(sn);
    return { set_number: sn };
  });

  router.endpoint('GET /api/v2/admin/jobs', requireApiAdmin, async req => {
    return { ...(await d.management.jobMonitor()), proxy_hint: proxyHintStatus(req.app) };
  });

  // Body: { name, time: "HH:MM" } for daily jobs or { name: 'priceJob',
  // minutes } for the interval. Takes effect immediately.
  router.endpoint('POST /api/v2/admin/job-schedule', requireApiAdmin, async req => {
    const { name, time, minutes } = req.input || {};
    await d.management.setJobSchedule(name, time, minutes);
    return {};
  });

  /** Requests an image URL from the SERVER (with, without referer, without headers)
   * to distinguish "missing", "hotlink protection" and "unreachable". POST,
   * because a foreign page could trigger a GET with a Lax cookie via a link. */
  router.endpoint('POST /api/v2/admin/img-probe', requireApiAdmin, async req => {
    return { ...(await d.management.imageProbe(req.input.url ?? '')) };
  });
  /** Everything that flows into the market price display of a set, optionally with
   * the current BrickLink response; POST for the same reason as above. */
  router.endpoint('POST /api/v2/admin/price-probe', requireApiAdmin, async req => {
    const setNumber = (req.input.set ?? '').trim();
    if (!setNumber) failDomain('ungueltig', 'set_parameter_missing');
    return { ...(await d.management.priceProbe(req.apiUser.user_id, setNumber, req.input.live ?? false)) };
  });
  return router;
}
