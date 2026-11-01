/** /api/v1/admin — jede Route über requireApiAdmin, damit kein Handler die
 * Prüfung vergessen kann. */
import fs from 'fs';
import path from 'path';
import * as verwaltung from '../../src/verwaltung/dienst';
import { fehlerAntwort, meldeUndLiefere, pfadParam } from '../../src/infra/httpError';
import { requireApiAdmin } from './middleware';
import { getLimitForApi } from '../../src/katalog/apiKontingent';
import { proxyCachePathFor } from '../../src/katalog/bilder/images';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from '../../src/infra/fremdeAdressen';
import { vergissFehlend } from '../../src/katalog/bilder/imageMisses';
import { SET_IMAGES_DIR } from '../../src/infra/appPaths';
import { setGlobalSetting } from '../../src/konto/settings';
import { getGlobalSetting } from '../../src/konto/settings';
import { sendeFehler } from '../../src/infra/fehlerTexte';
import { letzteEintraege } from '../../src/verwaltung/dienst';
import { cacheStatistik, cachesLeeren, bricksetLimitGesetzt, anleitungenNeuEinreihen, preisJobStand, preisJobJetzt,
         fehlendeBilderNachladen, bricksetWiederholen, bricksetEntfernen, jobZeitplanSetzen, jobUebersicht,
         bildProbe, preisProbe, katalogBilderEinreihen, katalogAbgleichJetzt, bricksetListe } from '../../src/verwaltung/dienst';
import { auftragsUebersicht, auftragAbbrechen, auftragWiederholen, auftragsArtJetzt, auftragsArtLeeren } from '../../src/auftraege/hintergrund';
import { urlOderNull } from '../../src/infra/validate';
import { vertragsRouter } from '../../src/infra/vertrag/pruefen';
import type { Antwort } from '../../src/infra/vertrag';
const router = vertragsRouter({ grosseIds: true });


router.get('/admin/auftraege', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'GET /api/v1/admin/auftraege'>) => {
  res.json(await auftragsUebersicht({ status: typeof req.query.status === 'string' ? req.query.status : undefined,
                                      art: typeof req.query.art === 'string' ? req.query.art : undefined }));
});

router.post('/admin/auftraege/:id/abbrechen', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/auftraege/:id/abbrechen'>) => {
  res.json(await auftragAbbrechen(pfadParam(req, 'id'))); 
});

router.post('/admin/auftraege/:id/wiederholen', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/auftraege/:id/wiederholen'>) => {
  res.json(await auftragWiederholen(pfadParam(req, 'id'))); 
});

router.post('/admin/auftraege/art/:art/jetzt', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/auftraege/art/:art/jetzt'>) => {
  res.json(await auftragsArtJetzt(pfadParam(req, 'art'))); 
});

router.delete('/admin/auftraege/art/:art', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/admin/auftraege/art/:art'>) => {
  res.json(await auftragsArtLeeren(pfadParam(req, 'art'))); 
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
router.get('/admin/image-diag/:setNumber', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'GET /api/v1/admin/image-diag/:setNumber'>) => {
  const sn = String(req.params.setNumber);

  const zeilen: verwaltung.KontoBildzeile[] = await verwaltung.bildZeilenDerKonten(sn).catch(meldeUndLiefere('verwaltung:bildZeilenDerKonten', []));
  const katalog = await verwaltung.katalogBild(sn).catch(meldeUndLiefere('verwaltung:katalogBild', null));

  const safe = sn.replace(/[^a-z0-9-]/gi, '_');
  const datei = (p: string) => {
    const st = fs.statSync(p, { throwIfNoEntry: false });
    return st ? { vorhanden: true, bytes: st.size, geaendert: st.mtime } : { vorhanden: false, bytes: 0, geaendert: null };
  };
  const original = datei(path.join(SET_IMAGES_DIR, `${safe}.jpg`));
  const vorschau = datei(path.join(SET_IMAGES_DIR, `${safe}_thumb.jpg`));

  const cdnUrl = zeilen.find(r => r.image_url)?.image_url || katalog?.image_url || null;
  let proxy: any = { adresse: cdnUrl, gecacht: false };
  if (cdnUrl) {
    const cf = proxyCachePathFor ? proxyCachePathFor(cdnUrl) : null;
    if (cf) {
      proxy = { adresse: cdnUrl, gecacht: datei(cf).vorhanden,
                cache: datei(cf), vorschau: datei(cf + '_thumb.jpg') };
    }
  }

  // Eine Fehlanzeige verhindert jeden Abruf und macht die übrigen Auskünfte
  // gegenstandslos.
  const merker = await verwaltung.fehlanzeigeDesSets(sn).catch(meldeUndLiefere('verwaltung:fehlanzeigeDesSets', null));
  const vorschauMerker = await verwaltung.fehlanzeigeDerVorschau(safe).catch(meldeUndLiefere('verwaltung:fehlanzeigeDerVorschau', null));

  const hinweise: string[] = [];
  if (!zeilen.length) hinweise.push('Kein Konto führt dieses Set.');
  if (zeilen.length && !zeilen.some(r => r.image_local) && !cdnUrl)
    hinweise.push('Weder lokale Datei noch CDN-Adresse bekannt — die Clients können nichts anzeigen.');
  if (zeilen.some(r => r.image_local) && !original.vorhanden)
    hinweise.push('image_local ist gesetzt, die Datei fehlt aber — die Bildroute weicht auf den Proxy aus.');
  if (original.vorhanden && !vorschau.vorhanden)
    hinweise.push('Original da, Vorschau fehlt — sie entsteht beim nächsten Abruf oder über den Bilder-Nachlauf.');
  if (vorschau.vorhanden && vorschau.bytes < 200)
    hinweise.push('Die Vorschau ist unbrauchbar klein und wird beim Ausliefern verworfen.');
  if (merker) hinweise.push(
    `Gilt seit ${new Date(merker.checked_at).toLocaleString()} als fehlend` +
    (merker.reason ? ` (${merker.reason})` : ' (Grund nicht vermerkt — Altbestand)') +
    '. Solange der Eintrag steht, wird das Bild NICHT geholt. ' +
    'Zurücknehmen: POST /api/v1/admin/forget-image-misses');
  if (vorschauMerker) hinweise.push(
    'Für die Vorschau ist ein Fehlschlag vermerkt — sie wird nicht erneut versucht.');
  if (!hinweise.length) hinweise.push('Alles vorhanden: Original und Vorschau liegen bereit.');

  res.json({ success: true, set_number: sn,
    datenbank: { zeilen, katalog_bild: katalog?.image_url || null },
    lokal: { original, vorschau },
    merker: merker ? { seit: merker.checked_at, grund: merker.reason || null } : null,
    proxy, hinweise });
});

// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-forget-image-misses
router.post('/admin/forget-image-misses', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/forget-image-misses'>) => {
  const sets = Array.isArray(req.body?.set_numbers) ? req.body.set_numbers.map(String) : null;
  let entfernt = 0;
  if (sets?.length) {
    entfernt = await vergissFehlend(sets.map((sn: string) => 'set:' + sn));
  } else {
    // Nicht die ganze Tabelle: Die Vorschau-Vermerke haben einen anderen Zweck
    // und sollen nicht nebenbei mitverschwinden.
    const rows = await verwaltung.setFehlanzeigen().catch(meldeUndLiefere('verwaltung:setFehlanzeigen', []));
    if (rows.length) entfernt = await vergissFehlend(rows.map(r => r.cache_key));
  }
  if (req.body?.thumbs === true) {
    const rows = await verwaltung.vorschauFehlanzeigen().catch(meldeUndLiefere('verwaltung:vorschauFehlanzeigen', []));
    if (rows.length) entfernt += await vergissFehlend(rows.map(r => r.cache_key));
  }
  // Die anderen Prozesse frischen den Merker im Fünf-Minuten-Takt aus der Tabelle auf.
  res.json({ success: true, entfernt, hinweis: 'Greift in allen Arbeitsprozessen binnen fünf Minuten.' });
});

// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-cache-clear
router.post('/admin/cache-clear', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/cache-clear'>) => {
  await cachesLeeren(!!req.body?.all);
  res.json({ success: true, message: req.body?.all ? 'Alle Caches geleert' : 'Preis-Cache geleert' });
});

router.get('/admin/cache-ttl', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/cache-ttl'>) => {
  const ttl = await getGlobalSetting('price_cache_ttl');
  res.json({ success:true, ttl: ttl || '24' });
});

router.post('/admin/cache-ttl', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/cache-ttl'>) => {
  const ttl = String(req.body?.ttl || '24');
  if (!['12','24','168'].includes(ttl)) return sendeFehler(req, res, 400, 'wert_ungueltig');
  setGlobalSetting('price_cache_ttl', ttl);
  res.json({ success:true, ttl });
});

router.post('/admin/default-condition', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/default-condition'>) => {
  const condition = String(req.body?.condition || 'N');
  if (!['N','U'].includes(condition)) return sendeFehler(req, res, 400, 'zustand_n_oder_u');
  setGlobalSetting('default_price_condition', condition);
  res.json({ success: true, condition });
});

router.get('/admin/api-limits', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/api-limits'>) => {
  const [rb, bl, bs] = await Promise.all([
    getLimitForApi('rebrickable'), getLimitForApi('bricklink'), getLimitForApi('brickset')
  ]);
  res.json({ success:true, limits: { rebrickable: rb, bricklink: bl, brickset: bs } });
});

router.put('/admin/api-limits', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'PUT /api/v1/admin/api-limits'>) => {
  const { rebrickable, bricklink, brickset } = req.body;
  if (rebrickable) {
    // Ungeprüft landete "NaN" in global_settings und liess jeden Aufruf scheitern.
    const n = parseInt(rebrickable, 10);
    if (!Number.isFinite(n) || n < 1 || n > 100000)
      return sendeFehler(req, res, 400, 'tageslimit_bereich');
    setGlobalSetting('api_limit_rebrickable', String(n));
  }
  if (bricklink) {
    setGlobalSetting('api_limit_bricklink', String(parseInt(bricklink)));
  }
  if (brickset) {
    const newLimit = parseInt(brickset);
    const oldLimit = parseInt(await getGlobalSetting('api_limit_brickset') || '100');
    setGlobalSetting('api_limit_brickset', String(newLimit));
    await bricksetLimitGesetzt(oldLimit, newLimit);
  }
  res.json({ success:true });
});

router.post('/admin/reimport-instructions', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/reimport-instructions'>) => {
  const enqueued = await anleitungenNeuEinreihen();
  if (!enqueued) return res.json({ success: true, enqueued: 0, message: 'Alle Sets haben bereits Anleitungen' });
  res.json({ success: true, enqueued });
});

// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-job-status
router.get('/admin/job-status', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/job-status'>) => {
  res.json(await preisJobStand()); 
});

router.post('/admin/trigger-price-job', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/trigger-price-job'>) => {
  res.json({ success: true, started: await preisJobJetzt() }); 
});

// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-catalog-images
router.post('/admin/catalog-images', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/catalog-images'>) => {
  res.json(await katalogBilderEinreihen(req.body?.alle_erneut === true));
});

// Bilder, die laut image_local da sind, deren Datei aber fehlt.
router.post('/admin/redownload-missing-images', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'POST /api/v1/admin/redownload-missing-images'>) => {
  // Nicht abwarten: Das kann lange dauern; der Fortschritt erscheint in der
  // Überwachung unter „Bild-Download (CDN)".
  fehlendeBilderNachladen(); res.json({ success: true, started: true }); 
});

router.get('/admin/logs', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'GET /api/v1/admin/logs'>) => {
  const minutes = Math.min(2880, Math.max(1, parseInt(String(req.query.minutes || '15'))));
  const rows = await verwaltung.protokollSeit(minutes);
  res.json({ success: true, minutes, count: rows.length, logs: rows });
});

router.get('/admin/brickset-queue', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/brickset-queue'>) => {
  const rows = await bricksetListe().catch(meldeUndLiefere('verwaltung:bricksetWarteschlange', []));
  res.json({ success: true, count: rows.length, entries: rows });
});

router.post('/admin/brickset-queue/:setNumber/retry', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/brickset-queue/:setNumber/retry'>) => {
  const sn = pfadParam(req, 'setNumber');
  await bricksetWiederholen(sn);
  res.json({ success: true, set_number: sn });
});

router.delete('/admin/brickset-queue/:setNumber', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'DELETE /api/v1/admin/brickset-queue/:setNumber'>) => {
  const sn = pfadParam(req, 'setNumber');
  await bricksetEntfernen(sn);
  res.json({ success: true, set_number: sn });
});

router.get('/admin/jobs', requireApiAdmin, async (_req: AuthedRequest, res: Antwort<'GET /api/v1/admin/jobs'>) => {
  res.json(await jobUebersicht()); 
});

// Body: { name, time: "HH:MM" } für tägliche Jobs oder { name: 'priceJob',
// minutes } für das Intervall. Greift sofort.
router.post('/admin/job-schedule', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'POST /api/v1/admin/job-schedule'>) => {
  const { name, time, minutes } = req.body || {};
  await jobZeitplanSetzen(name, time, minutes);
  res.json({ success: true });
});

/** Fragt eine Bild-URL vom SERVER aus ab (mit, ohne Referer, ohne Kopfzeilen),
 * um „fehlt", „Hotlink-Schutz" und „nicht erreichbar" zu unterscheiden.
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-img-probe */
router.get('/admin/img-probe', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'GET /api/v1/admin/img-probe'>) => {
  const url = String(req.query.url || '');
  if (!/^https:\/\//.test(url)) return sendeFehler(req, res, 400, 'url_fehlt_https');

  const adresse = urlOderNull(url);
  if (!adresse) return sendeFehler(req, res, 400, 'url_ungueltig');
  if (!hostErlaubt(url, ERLAUBTE_BILD_HOSTS))
    return sendeFehler(req, res, 403, 'host_nicht_erlaubt', { host: adresse.hostname });

  // Dieselben Hosts wie der Bild-Proxy: Der Abruf läuft aus dem internen
  // Netz; jede Adresse zuzulassen wäre Server-Side Request Forgery.
  const ALLOWED_PROBE_HOSTS = ['cdn.rebrickable.com', 'rebrickable.com', 'images.brickset.com', 'www.bricklink.com', 'img.bricklink.com'];
  const host = adresse.hostname;
  if (!ALLOWED_PROBE_HOSTS.some(h => host === h || host.endsWith('.' + h)))
    return sendeFehler(req, res, 403, 'host_nicht_erlaubt', { host });

  res.json(await bildProbe(url));
});
/** Alles, was in die Marktpreis-Anzeige eines Sets einfliesst, auf Wunsch mit
 * der aktuellen BrickLink-Antwort.
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-price-probe */
router.get('/admin/price-probe', requireApiAdmin, async (req: AuthedRequest, res: Antwort<'GET /api/v1/admin/price-probe'>) => {
  const setNumber = String(req.query.set || '').trim();
  if (!setNumber) return sendeFehler(req, res, 400, 'parameter_set_fehlt');
  const uid = req.apiUser.user_id;

  res.json(await preisProbe(uid, setNumber, req.query.live === '1'));
});

router.use(fehlerAntwort);

export default router;
