/** /api/v1/admin — jede Route über requireApiAdmin, damit kein Handler die
 * Prüfung vergessen kann. */
import { meldeUndLiefere } from '../../src/infra/fehler';
import { fehlerAntwort } from '../../src/http/httpAntwort';
import { requireApiAdmin } from './middleware';
import { getLimitForApi } from '../../src/katalog/apiKontingent';
import { vergissFehlend } from '../../src/katalog/bilder/imageMisses';
import { setGlobalSetting, getGlobalSetting } from '../../src/einstellungen/settings';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { cacheStatistik, cachesLeeren, bricksetLimitGesetzt, anleitungenNeuEinreihen, preisJobStand, preisJobJetzt,
         fehlendeBilderNachladen, bricksetWiederholen, bricksetEntfernen, jobZeitplanSetzen, jobUebersicht,
         bildProbe, preisProbe, katalogBilderEinreihen, katalogAbgleichJetzt, bricksetListe,
         letzteEintraege, bildDiagnose, protokollSeit, setFehlanzeigen, vorschauFehlanzeigen } from '../../src/verwaltung/dienst';
import { auftragsUebersicht, auftragAbbrechen, auftragWiederholen, auftragsArtJetzt, auftragsArtLeeren } from '../../src/verwaltung/hintergrund';
import { vertragsRouter } from '../../src/vertrag/pruefen';
import { seiteAus } from '../../src/infra/seite';
import type { Anfrage, Antwort } from '../../src/vertrag';
const router = vertragsRouter({ grosseIds: true });


router.get('/admin/auftraege', requireApiAdmin, async (req: Anfrage<'GET /api/v1/admin/auftraege'>, res: Antwort<'GET /api/v1/admin/auftraege'>) => {
  res.json(await auftragsUebersicht({ status: req.abfrage.status, art: req.abfrage.art }));
});

router.post('/admin/auftraege/:id/abbrechen', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/auftraege/:id/abbrechen'>, res: Antwort<'POST /api/v1/admin/auftraege/:id/abbrechen'>) => {
  res.json(await auftragAbbrechen(String(req.pfad.id))); 
});

router.post('/admin/auftraege/:id/wiederholen', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/auftraege/:id/wiederholen'>, res: Antwort<'POST /api/v1/admin/auftraege/:id/wiederholen'>) => {
  res.json(await auftragWiederholen(String(req.pfad.id))); 
});

router.post('/admin/auftraege/art/:art/jetzt', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/auftraege/art/:art/jetzt'>, res: Antwort<'POST /api/v1/admin/auftraege/art/:art/jetzt'>) => {
  res.json(await auftragsArtJetzt(req.pfad.art)); 
});

router.delete('/admin/auftraege/art/:art', requireApiAdmin, async (req: Anfrage<'DELETE /api/v1/admin/auftraege/art/:art'>, res: Antwort<'DELETE /api/v1/admin/auftraege/art/:art'>) => {
  res.json(await auftragsArtLeeren(req.pfad.art)); 
});

router.post('/admin/trigger-csv-sync', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/trigger-csv-sync'>) => {
  // Läuft der Auftrag schon, bleibt es bei dem einen Lauf.
  await katalogAbgleichJetzt();
  res.json({ success: true, message: 'CSV-Sync wird gestartet…' });
});

router.get('/admin/protokoll', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/protokoll'>) => {
  res.json({ success: true, eintraege: await letzteEintraege() });
});

router.get('/admin/cache-stats', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/cache-stats'>) => {
  res.json(await cacheStatistik()); 
});

// Beantwortet die wiederkehrenden Fragen zu einer leeren Kachel in einer
// Antwort: Datenbank, Platte, Proxy, Fehlanzeige.
// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-image-diag-setnumber
router.get('/admin/image-diag/:setNumber', requireApiAdmin, async (req: Anfrage<'GET /api/v1/admin/image-diag/:setNumber'>, res: Antwort<'GET /api/v1/admin/image-diag/:setNumber'>) => {
  const sn = req.pfad.setNumber;

  res.json(await bildDiagnose(sn));
});

// Eine Fehlanzeige sperrte ein Bild sieben Tage, ohne Weg zurück.
// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-forget-image-misses
router.post('/admin/forget-image-misses', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/forget-image-misses'>, res: Antwort<'POST /api/v1/admin/forget-image-misses'>) => {
  const sets = Array.isArray(req.eingabe.set_numbers) ? req.eingabe.set_numbers.map(String) : null;
  let entfernt = 0;
  if (sets?.length) {
    entfernt = await vergissFehlend(sets.map((sn: string) => 'set:' + sn));
  } else {
    // Nicht die ganze Tabelle: Die Vorschau-Vermerke haben einen anderen Zweck
    // und sollen nicht nebenbei mitverschwinden.
    const rows = await setFehlanzeigen().catch(meldeUndLiefere('verwaltung:setFehlanzeigen', []));
    if (rows.length) entfernt = await vergissFehlend(rows.map(r => r.cache_key));
  }
  if (req.eingabe.thumbs === true) {
    const rows = await vorschauFehlanzeigen().catch(meldeUndLiefere('verwaltung:vorschauFehlanzeigen', []));
    if (rows.length) entfernt += await vergissFehlend(rows.map(r => r.cache_key));
  }
  // Die anderen Prozesse frischen den Merker im Fünf-Minuten-Takt aus der Tabelle auf.
  res.json({ success: true, entfernt, hinweis: 'Greift in allen Arbeitsprozessen binnen fünf Minuten.' });
});

// Global (price_cache gilt für alle Konten), darum nur für Verwalter.
// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-cache-clear
router.post('/admin/cache-clear', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/cache-clear'>, res: Antwort<'POST /api/v1/admin/cache-clear'>) => {
  await cachesLeeren(!!req.eingabe.all);
  res.json({ success: true, message: req.eingabe.all ? 'Alle Caches geleert' : 'Preis-Cache geleert' });
});

router.get('/admin/cache-ttl', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/cache-ttl'>) => {
  const ttl = await getGlobalSetting('price_cache_ttl');
  res.json({ success:true, ttl: ttl || '24' });
});

router.post('/admin/cache-ttl', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/cache-ttl'>, res: Antwort<'POST /api/v1/admin/cache-ttl'>) => {
  await setGlobalSetting('price_cache_ttl', req.eingabe.ttl);
  res.json({ success: true, ttl: req.eingabe.ttl });
});

router.post('/admin/default-condition', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/default-condition'>, res: Antwort<'POST /api/v1/admin/default-condition'>) => {
  await setGlobalSetting('default_price_condition', req.eingabe.condition);
  res.json({ success: true, condition: req.eingabe.condition });
});

router.get('/admin/api-limits', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/api-limits'>) => {
  const [rb, bl, bs] = await Promise.all([
    getLimitForApi('rebrickable'), getLimitForApi('bricklink'), getLimitForApi('brickset')
  ]);
  res.json({ success:true, limits: { rebrickable: rb, bricklink: bl, brickset: bs } });
});

router.put('/admin/api-limits', requireApiAdmin, async (req: Anfrage<'PUT /api/v1/admin/api-limits'>, res: Antwort<'PUT /api/v1/admin/api-limits'>) => {
  const { rebrickable, bricklink, brickset } = req.eingabe;
  if (rebrickable !== undefined) await setGlobalSetting('api_limit_rebrickable', rebrickable);
  if (bricklink !== undefined) await setGlobalSetting('api_limit_bricklink', bricklink);
  if (brickset !== undefined) {
    const oldLimit = parseInt(await getGlobalSetting('api_limit_brickset') || '100');
    await setGlobalSetting('api_limit_brickset', brickset);
    await bricksetLimitGesetzt(oldLimit, Number(brickset));
  }
  res.json({ success: true });
});

router.post('/admin/reimport-instructions', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/reimport-instructions'>) => {
  const enqueued = await anleitungenNeuEinreihen();
  if (!enqueued) return res.json({ success: true, enqueued: 0, message: 'Alle Sets haben bereits Anleitungen' });
  res.json({ success: true, enqueued });
});

// Eine Adresse für Webapp und App; requireApiAdmin nimmt beide Ausweise.
// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-job-status
router.get('/admin/job-status', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/job-status'>) => {
  res.json(await preisJobStand()); 
});

router.post('/admin/trigger-price-job', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/trigger-price-job'>) => {
  res.json({ success: true, started: await preisJobJetzt() }); 
});

// Füllt den Bildbestand vorab, statt nur beim Blättern.
// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-catalog-images
router.post('/admin/catalog-images', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/catalog-images'>, res: Antwort<'POST /api/v1/admin/catalog-images'>) => {
  res.json(await katalogBilderEinreihen(req.eingabe.alle_erneut === true));
});

// Bilder, die laut image_local da sind, deren Datei aber fehlt.
router.post('/admin/redownload-missing-images', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/redownload-missing-images'>) => {
  // Nicht abwarten: Das kann lange dauern; der Fortschritt erscheint in der
  // Überwachung unter „Bild-Download (CDN)".
  fehlendeBilderNachladen(); res.json({ success: true, started: true }); 
});

router.get('/admin/logs', requireApiAdmin, async (req: Anfrage<'GET /api/v1/admin/logs'>, res: Antwort<'GET /api/v1/admin/logs'>) => {
  const minutes = Math.min(2880, Math.max(1, req.abfrage.minutes || 15));
  const rows = await protokollSeit(minutes);
  res.json({ success: true, minutes, count: rows.length, logs: rows });
});

router.get('/admin/brickset-queue', requireApiAdmin, async (req: Anfrage<'GET /api/v1/admin/brickset-queue'>, res: Antwort<'GET /api/v1/admin/brickset-queue'>) => {
  const rows = await bricksetListe().catch(meldeUndLiefere('verwaltung:bricksetWarteschlange', []));
  const { eintraege, ...seite } = seiteAus(rows, req.abfrage);
  res.json({ success: true, count: rows.length, entries: eintraege, ...seite });
});

router.post('/admin/brickset-queue/:setNumber/retry', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/brickset-queue/:setNumber/retry'>, res: Antwort<'POST /api/v1/admin/brickset-queue/:setNumber/retry'>) => {
  const sn = req.pfad.setNumber;
  await bricksetWiederholen(sn);
  res.json({ success: true, set_number: sn });
});

router.delete('/admin/brickset-queue/:setNumber', requireApiAdmin, async (req: Anfrage<'DELETE /api/v1/admin/brickset-queue/:setNumber'>, res: Antwort<'DELETE /api/v1/admin/brickset-queue/:setNumber'>) => {
  const sn = req.pfad.setNumber;
  await bricksetEntfernen(sn);
  res.json({ success: true, set_number: sn });
});

router.get('/admin/jobs', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/jobs'>) => {
  res.json(await jobUebersicht()); 
});

// Body: { name, time: "HH:MM" } für tägliche Jobs oder { name: 'priceJob',
// minutes } für das Intervall. Greift sofort.
router.post('/admin/job-schedule', requireApiAdmin, async (req: Anfrage<'POST /api/v1/admin/job-schedule'>, res: Antwort<'POST /api/v1/admin/job-schedule'>) => {
  const { name, time, minutes } = req.eingabe || {};
  await jobZeitplanSetzen(name, time, minutes);
  res.json({ success: true });
});

/** Fragt eine Bild-URL vom SERVER aus ab (mit, ohne Referer, ohne Kopfzeilen),
 * um „fehlt", „Hotlink-Schutz" und „nicht erreichbar" zu unterscheiden.
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-img-probe */
router.get('/admin/img-probe', requireApiAdmin, async (req: Anfrage<'GET /api/v1/admin/img-probe'>, res: Antwort<'GET /api/v1/admin/img-probe'>) => {
  const url = req.abfrage.url ?? '';
  res.json(await bildProbe(url));
});
/** Alles, was in die Marktpreis-Anzeige eines Sets einfliesst, auf Wunsch mit
 * der aktuellen BrickLink-Antwort. Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-price-probe */
router.get('/admin/price-probe', requireApiAdmin, async (req: Anfrage<'GET /api/v1/admin/price-probe'>, res: Antwort<'GET /api/v1/admin/price-probe'>) => {
  const setNumber = (req.abfrage.set ?? '').trim();
  if (!setNumber) return sendeFehler(req, res, 400, 'parameter_set_fehlt');
  const uid = req.apiUser.user_id;

  res.json(await preisProbe(uid, setNumber, req.abfrage.live ?? false));
});

router.use(fehlerAntwort);

export default router;
