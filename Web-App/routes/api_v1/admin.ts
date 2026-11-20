/** /api/v1/admin — jede Route über requireApiAdmin, damit kein Handler die
 * Prüfung vergessen kann. */
import { guardFor } from './middleware';
import { proxyHintStatus } from '../../src/http/proxyHinweis';
import { pageFrom } from '../../src/infra/seite';
import { vertragsRouter } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';
import { fachfehler } from '../../src/infra/fehlerTexte';

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
    // Läuft der Auftrag schon, bleibt es bei dem einen Lauf.
    await d.management.runCatalogSyncNow();
    return { message: 'CSV-Sync wird gestartet…' };
  });

  router.endpunkt('GET /api/v1/admin/protokoll', requireApiAdmin, async _req => {
    return { eintraege: await d.account.verwalter.managementLog() };
  });

  router.endpunkt('GET /api/v1/admin/cache-stats', requireApiAdmin, async _req => {
    return { ...(await d.management.cacheStats()) };
  });

  // Beantwortet die wiederkehrenden Fragen zu einer leeren Kachel in einer
  // Antwort: Datenbank, Platte, Proxy, Fehlanzeige.
  router.endpunkt('GET /api/v1/admin/image-diag/:setNumber', requireApiAdmin, async req => {
    const sn = req.pfad.setNumber;

    return { ...(await d.management.imageDiagnostics(sn)) };
  });

  // Eine Fehlanzeige sperrte ein Bild sieben Tage, ohne Weg zurück.
  router.endpunkt('POST /api/v1/admin/forget-image-misses', requireApiAdmin, async req => {
    const sets = Array.isArray(req.eingabe.set_numbers) ? req.eingabe.set_numbers.map(String) : null;
    const entfernt = await d.management.forgetImageMisses(sets, req.eingabe.thumbs === true);
    // Die anderen Prozesse frischen den Merker im Fünf-Minuten-Takt aus der Tabelle auf.
    return { entfernt, hinweis: 'Greift in allen Arbeitsprozessen binnen fünf Minuten.' };
  });

  // Global (price_cache gilt für alle Konten), darum nur für Verwalter.
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

  // Eine Adresse für Webapp und App; requireApiAdmin nimmt beide Ausweise.
  router.endpunkt('GET /api/v1/admin/job-status', requireApiAdmin, async _req => {
    return { ...(await d.management.priceJobStatus()) };
  });

  router.endpunkt('POST /api/v1/admin/trigger-price-job', requireApiAdmin, async _req => {
    return { started: await d.management.runPriceJobNow() };
  });

  // Füllt den Bildbestand vorab, statt nur beim Blättern.
  router.endpunkt('POST /api/v1/admin/catalog-images', requireApiAdmin, async req => {
    return { ...(await d.management.queueCatalogImages(req.eingabe.alle_erneut === true)) };
  });

  // Bilder, die laut image_local da sind, deren Datei aber fehlt.
  router.endpunkt('POST /api/v1/admin/redownload-missing-images', requireApiAdmin, async _req => {
    // Nur das Einstellen wird abgewartet; der Fortschritt erscheint in der
    // Überwachung unter „Bild-Download (CDN)".
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

  // Body: { name, time: "HH:MM" } für tägliche Jobs oder { name: 'priceJob',
  // minutes } für das Intervall. Greift sofort.
  router.endpunkt('POST /api/v1/admin/job-schedule', requireApiAdmin, async req => {
    const { name, time, minutes } = req.eingabe || {};
    await d.management.setJobSchedule(name, time, minutes);
    return {};
  });

  /** Fragt eine Bild-URL vom SERVER aus ab (mit, ohne Referer, ohne Kopfzeilen),
   * um „fehlt", „Hotlink-Schutz" und „nicht erreichbar" zu unterscheiden. POST,
   * weil eine fremde Seite ein GET samt Lax-Cookie per Link auslösen könnte. */
  router.endpunkt('POST /api/v1/admin/img-probe', requireApiAdmin, async req => {
    return { ...(await d.management.imageProbe(req.eingabe.url ?? '')) };
  });
  /** Alles, was in die Marktpreis-Anzeige eines Sets einfliesst, auf Wunsch mit
   * der aktuellen BrickLink-Antwort; POST aus demselben Grund wie oben. */
  router.endpunkt('POST /api/v1/admin/price-probe', requireApiAdmin, async req => {
    const setNumber = (req.eingabe.set ?? '').trim();
    if (!setNumber) fachfehler('ungueltig', 'parameter_set_fehlt');
    return { ...(await d.management.priceProbe(req.apiUser.user_id, setNumber, req.eingabe.live ?? false)) };
  });
  return router;
}
