/** /api/v1/admin — jede Route über requireApiAdmin, damit kein Handler die
 * Prüfung vergessen kann. */
import { waechterFuer } from './middleware';
import { fehlerAntwort, sendeFehler } from '../../src/http/httpAntwort';
import { proxyHinweisStand } from '../../src/http/proxyHinweis';
import { bildProbe } from '../../src/verwaltung';
import { seiteAus } from '../../src/infra/seite';
import { vertragsRouter, type Anfrage, type Antwort } from '../../src/http/vertragsRouter';
import type { Dienste } from '../../src/dienste';

export function baueAdminRouter(d: Pick<Dienste, 'einstellungen' | 'auftraege' | 'konto' | 'katalog' | 'verwaltung'>) {
  const { requireApiAdmin } = waechterFuer(d.konto);
  const router = vertragsRouter({ grosseIds: true });

  router.get(
    '/admin/auftraege',
    requireApiAdmin,
    async (req: Anfrage<'GET /api/v1/admin/auftraege'>, res: Antwort<'GET /api/v1/admin/auftraege'>) => {
      res.json({
        success: true,
        ...(await d.verwaltung.auftragsUebersicht({ status: req.abfrage.status, art: req.abfrage.art })),
      });
    },
  );

  router.post(
    '/admin/auftraege/:id/abbrechen',
    requireApiAdmin,
    async (
      req: Anfrage<'POST /api/v1/admin/auftraege/:id/abbrechen'>,
      res: Antwort<'POST /api/v1/admin/auftraege/:id/abbrechen'>,
    ) => {
      res.json({ success: true, ...(await d.auftraege.auftragAbbrechen(String(req.pfad.id))) });
    },
  );

  router.post(
    '/admin/auftraege/:id/wiederholen',
    requireApiAdmin,
    async (
      req: Anfrage<'POST /api/v1/admin/auftraege/:id/wiederholen'>,
      res: Antwort<'POST /api/v1/admin/auftraege/:id/wiederholen'>,
    ) => {
      res.json({ success: true, ...(await d.auftraege.auftragWiederholen(String(req.pfad.id))) });
    },
  );

  router.post(
    '/admin/auftraege/art/:art/jetzt',
    requireApiAdmin,
    async (
      req: Anfrage<'POST /api/v1/admin/auftraege/art/:art/jetzt'>,
      res: Antwort<'POST /api/v1/admin/auftraege/art/:art/jetzt'>,
    ) => {
      res.json({ success: true, ...(await d.auftraege.auftragsArtJetzt(req.pfad.art)) });
    },
  );

  router.delete(
    '/admin/auftraege/art/:art',
    requireApiAdmin,
    async (
      req: Anfrage<'DELETE /api/v1/admin/auftraege/art/:art'>,
      res: Antwort<'DELETE /api/v1/admin/auftraege/art/:art'>,
    ) => {
      res.json({ success: true, ...(await d.verwaltung.auftragsArtLeeren(req.pfad.art)) });
    },
  );

  router.post(
    '/admin/trigger-csv-sync',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/trigger-csv-sync'>) => {
      // Läuft der Auftrag schon, bleibt es bei dem einen Lauf.
      await d.verwaltung.katalogAbgleichJetzt();
      res.json({ success: true, message: 'CSV-Sync wird gestartet…' });
    },
  );

  router.get(
    '/admin/protokoll',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/protokoll'>) => {
      res.json({ success: true, eintraege: await d.konto.verwaltungsProtokoll() });
    },
  );

  router.get(
    '/admin/cache-stats',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/cache-stats'>) => {
      res.json({ success: true, ...(await d.verwaltung.cacheStatistik()) });
    },
  );

  // Beantwortet die wiederkehrenden Fragen zu einer leeren Kachel in einer
  // Antwort: Datenbank, Platte, Proxy, Fehlanzeige.
  router.get(
    '/admin/image-diag/:setNumber',
    requireApiAdmin,
    async (
      req: Anfrage<'GET /api/v1/admin/image-diag/:setNumber'>,
      res: Antwort<'GET /api/v1/admin/image-diag/:setNumber'>,
    ) => {
      const sn = req.pfad.setNumber;

      res.json({ success: true, ...(await d.verwaltung.bildDiagnose(sn)) });
    },
  );

  // Eine Fehlanzeige sperrte ein Bild sieben Tage, ohne Weg zurück.
  router.post(
    '/admin/forget-image-misses',
    requireApiAdmin,
    async (
      req: Anfrage<'POST /api/v1/admin/forget-image-misses'>,
      res: Antwort<'POST /api/v1/admin/forget-image-misses'>,
    ) => {
      const sets = Array.isArray(req.eingabe.set_numbers) ? req.eingabe.set_numbers.map(String) : null;
      const entfernt = await d.verwaltung.bildFehlanzeigenVergessen(sets, req.eingabe.thumbs === true);
      // Die anderen Prozesse frischen den Merker im Fünf-Minuten-Takt aus der Tabelle auf.
      res.json({ success: true, entfernt, hinweis: 'Greift in allen Arbeitsprozessen binnen fünf Minuten.' });
    },
  );

  // Global (price_cache gilt für alle Konten), darum nur für Verwalter.
  router.post(
    '/admin/cache-clear',
    requireApiAdmin,
    async (req: Anfrage<'POST /api/v1/admin/cache-clear'>, res: Antwort<'POST /api/v1/admin/cache-clear'>) => {
      await d.verwaltung.cachesLeeren(!!req.eingabe.all);
      res.json({ success: true, message: req.eingabe.all ? 'Alle Caches geleert' : 'Preis-Cache geleert' });
    },
  );

  router.get(
    '/admin/cache-ttl',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/cache-ttl'>) => {
      const ttl = await d.einstellungen.getGlobalSetting('price_cache_ttl');
      res.json({ success: true, ttl: ttl || '24' });
    },
  );

  router.post(
    '/admin/cache-ttl',
    requireApiAdmin,
    async (req: Anfrage<'POST /api/v1/admin/cache-ttl'>, res: Antwort<'POST /api/v1/admin/cache-ttl'>) => {
      await d.einstellungen.setGlobalSetting('price_cache_ttl', req.eingabe.ttl);
      res.json({ success: true, ttl: req.eingabe.ttl });
    },
  );

  router.post(
    '/admin/default-condition',
    requireApiAdmin,
    async (
      req: Anfrage<'POST /api/v1/admin/default-condition'>,
      res: Antwort<'POST /api/v1/admin/default-condition'>,
    ) => {
      await d.einstellungen.setGlobalSetting('default_price_condition', req.eingabe.condition);
      res.json({ success: true, condition: req.eingabe.condition });
    },
  );

  router.get(
    '/admin/api-limits',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/api-limits'>) => {
      const [rb, bl, bs] = await Promise.all([
        d.katalog.getLimitForApi('rebrickable'),
        d.katalog.getLimitForApi('bricklink'),
        d.katalog.getLimitForApi('brickset'),
      ]);
      res.json({ success: true, limits: { rebrickable: rb, bricklink: bl, brickset: bs } });
    },
  );

  router.put(
    '/admin/api-limits',
    requireApiAdmin,
    async (req: Anfrage<'PUT /api/v1/admin/api-limits'>, res: Antwort<'PUT /api/v1/admin/api-limits'>) => {
      const { rebrickable, bricklink, brickset } = req.eingabe;
      if (rebrickable !== undefined) await d.einstellungen.setGlobalSetting('api_limit_rebrickable', rebrickable);
      if (bricklink !== undefined) await d.einstellungen.setGlobalSetting('api_limit_bricklink', bricklink);
      if (brickset !== undefined) {
        const oldLimit = parseInt((await d.einstellungen.getGlobalSetting('api_limit_brickset')) || '100', 10);
        await d.einstellungen.setGlobalSetting('api_limit_brickset', brickset);
        await d.verwaltung.bricksetLimitGesetzt(oldLimit, Number(brickset));
      }
      res.json({ success: true });
    },
  );

  router.post(
    '/admin/reimport-instructions',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/reimport-instructions'>) => {
      const enqueued = await d.verwaltung.anleitungenNeuEinreihen();
      if (!enqueued) return res.json({ success: true, enqueued: 0, message: 'Alle Sets haben bereits Anleitungen' });
      res.json({ success: true, enqueued });
    },
  );

  // Eine Adresse für Webapp und App; requireApiAdmin nimmt beide Ausweise.
  router.get(
    '/admin/job-status',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/job-status'>) => {
      res.json({ success: true, ...(await d.verwaltung.preisJobStand()) });
    },
  );

  router.post(
    '/admin/trigger-price-job',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/trigger-price-job'>) => {
      res.json({ success: true, started: await d.verwaltung.preisJobJetzt() });
    },
  );

  // Füllt den Bildbestand vorab, statt nur beim Blättern.
  router.post(
    '/admin/catalog-images',
    requireApiAdmin,
    async (req: Anfrage<'POST /api/v1/admin/catalog-images'>, res: Antwort<'POST /api/v1/admin/catalog-images'>) => {
      res.json({ success: true, ...(await d.verwaltung.katalogBilderEinreihen(req.eingabe.alle_erneut === true)) });
    },
  );

  // Bilder, die laut image_local da sind, deren Datei aber fehlt.
  router.post(
    '/admin/redownload-missing-images',
    requireApiAdmin,
    async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/redownload-missing-images'>) => {
      // Nicht abwarten: Das kann lange dauern; der Fortschritt erscheint in der
      // Überwachung unter „Bild-Download (CDN)".
      d.verwaltung.fehlendeBilderNachladen();
      res.json({ success: true, started: true });
    },
  );

  router.get(
    '/admin/logs',
    requireApiAdmin,
    async (req: Anfrage<'GET /api/v1/admin/logs'>, res: Antwort<'GET /api/v1/admin/logs'>) => {
      const minutes = Math.min(2880, Math.max(1, req.abfrage.minutes || 15));
      const rows = await d.verwaltung.serverProtokollSeit(minutes);
      res.json({ success: true, minutes, count: rows.length, logs: rows });
    },
  );

  router.get(
    '/admin/brickset-queue',
    requireApiAdmin,
    async (req: Anfrage<'GET /api/v1/admin/brickset-queue'>, res: Antwort<'GET /api/v1/admin/brickset-queue'>) => {
      const rows = await d.auftraege.bricksetListe();
      const { eintraege, ...seite } = seiteAus(rows, req.abfrage);
      res.json({ success: true, count: rows.length, entries: eintraege, ...seite });
    },
  );

  router.post(
    '/admin/brickset-queue/:setNumber/retry',
    requireApiAdmin,
    async (
      req: Anfrage<'POST /api/v1/admin/brickset-queue/:setNumber/retry'>,
      res: Antwort<'POST /api/v1/admin/brickset-queue/:setNumber/retry'>,
    ) => {
      const sn = req.pfad.setNumber;
      await d.verwaltung.bricksetWiederholen(sn);
      res.json({ success: true, set_number: sn });
    },
  );

  router.delete(
    '/admin/brickset-queue/:setNumber',
    requireApiAdmin,
    async (
      req: Anfrage<'DELETE /api/v1/admin/brickset-queue/:setNumber'>,
      res: Antwort<'DELETE /api/v1/admin/brickset-queue/:setNumber'>,
    ) => {
      const sn = req.pfad.setNumber;
      await d.verwaltung.bricksetEntfernen(sn);
      res.json({ success: true, set_number: sn });
    },
  );

  router.get('/admin/jobs', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'GET /api/v1/admin/jobs'>) => {
    res.json({ success: true, ...(await d.verwaltung.jobUebersicht()), proxy_hinweis: proxyHinweisStand(req.app) });
  });

  // Body: { name, time: "HH:MM" } für tägliche Jobs oder { name: 'priceJob',
  // minutes } für das Intervall. Greift sofort.
  router.post(
    '/admin/job-schedule',
    requireApiAdmin,
    async (req: Anfrage<'POST /api/v1/admin/job-schedule'>, res: Antwort<'POST /api/v1/admin/job-schedule'>) => {
      const { name, time, minutes } = req.eingabe || {};
      await d.verwaltung.jobZeitplanSetzen(name, time, minutes);
      res.json({ success: true });
    },
  );

  /** Fragt eine Bild-URL vom SERVER aus ab (mit, ohne Referer, ohne Kopfzeilen),
   * um „fehlt", „Hotlink-Schutz" und „nicht erreichbar" zu unterscheiden. POST,
   * weil eine fremde Seite ein GET samt Lax-Cookie per Link auslösen könnte. */
  router.post(
    '/admin/img-probe',
    requireApiAdmin,
    async (req: Anfrage<'POST /api/v1/admin/img-probe'>, res: Antwort<'POST /api/v1/admin/img-probe'>) => {
      res.json({ success: true, ...(await bildProbe(req.eingabe.url ?? '')) });
    },
  );
  /** Alles, was in die Marktpreis-Anzeige eines Sets einfliesst, auf Wunsch mit
   * der aktuellen BrickLink-Antwort; POST aus demselben Grund wie oben. */
  router.post(
    '/admin/price-probe',
    requireApiAdmin,
    async (req: Anfrage<'POST /api/v1/admin/price-probe'>, res: Antwort<'POST /api/v1/admin/price-probe'>) => {
      const setNumber = (req.eingabe.set ?? '').trim();
      if (!setNumber) return sendeFehler(req, res, 400, 'parameter_set_fehlt');
      res.json({
        success: true,
        ...(await d.verwaltung.preisProbe(req.apiUser.user_id, setNumber, req.eingabe.live ?? false)),
      });
    },
  );

  router.use(fehlerAntwort);
  return router;
}
