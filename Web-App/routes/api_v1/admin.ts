/**
 * /api/v1/admin — Monitoring, Cache-/Limit-Verwaltung, Nutzerverwaltung.
 * ALLE Routen laufen über requireApiAdmin (Token/Session + is_admin) —
 * der Check liegt in der Middleware statt in jedem Handler.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import * as verwaltung from '../../utils/verwaltung';
import { handleRouteError, meldeUndLiefere, pfadParam } from '../../utils/httpError';
import { requireApiAdmin } from './middleware';
import { getLimitForApi } from '../../utils/apiKontingent';
import { proxyCachePathFor } from '../../utils/images';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from '../../utils/fremdeAdressen';
import { vergissFehlend } from '../../utils/imageMisses';
import { SET_IMAGES_DIR } from '../../utils/appPaths';
import { getGlobalSetting, setGlobalSetting } from '../../utils/settings';
import { sendeFehler } from '../../utils/fehlerTexte';
import { setzeAusloeser } from '../../utils/laufzustand';
import * as pgNotify from '../../utils/pgNotify';
import { letzteEintraege } from '../../utils/verwaltungsprotokoll';
import { cacheStatistik, cachesLeeren, bricksetLimitGesetzt, anleitungenNeuEinreihen, preisJobStand, preisJobJetzt,
         fehlendeBilderNachladen, bricksetWiederholen, bricksetEntfernen, jobZeitplanSetzen, jobUebersicht,
         bildProbe, preisProbe, katalogBilderEinreihen } from '../../utils/dienste/verwaltung';
const router = express.Router();


// ── POST /api/v1/admin/trigger-csv-sync — manually trigger CSV sync ──────────
router.post('/admin/trigger-csv-sync', requireApiAdmin, async (_req: AuthedRequest, res) => {
  // Signal primary worker via DB flag (same pattern as instruction queue trigger)
  try {
    await setzeAusloeser('csv_sync_trigger');
    // Weckt den Primary-Worker sofort. Der Eintrag oben bleibt die belastbare
    // Quelle — ohne Signal liefe er erst beim nächsten Verbindungsaufbau an.
    await pgNotify.notify('csv_sync_trigger');
    res.json({ success: true, message: 'CSV-Sync wird gestartet…' });
  } catch (e) { handleRouteError(res, e, undefined, _req); }
});

// ── GET /api/v1/admin/cache-stats ─────────────────────────────────────────────
router.get('/admin/protokoll', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    res.json({ success: true, eintraege: await letzteEintraege() });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/admin/cache-stats', requireApiAdmin, async (req: AuthedRequest, res) => {
  try { res.json(await cacheStatistik()); }
  catch (e) { handleRouteError(res, e, undefined, req); }
});

// GET /api/v1/admin/image-diag/:setNumber
// Dieser Endpunkt ist die Lehre aus einer Fehlersuche, die fünf Anläufe
// gebraucht hat. Dasselbe Symptom („Kachel bleibt leer") hatte nacheinander
// fünf verschiedene Ursachen, und jede Runde begann damit, dieselben Fragen …
// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-image-diag-setnumber
router.get('/admin/image-diag/:setNumber', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    const sn = String(req.params.setNumber);

    // 1. Was weiss die Datenbank — eigene Zeile UND gemeinsamer Katalog?
    // Die Liste beantwortet „welche Konten fuehren dieses Set?" — genau das
    // braucht die Einschaetzung unten.
    const zeilen: verwaltung.KontoBildzeile[] = await verwaltung.bildZeilenDerKonten(sn).catch(meldeUndLiefere('verwaltung:bildZeilenDerKonten', []));
    const katalog = await verwaltung.katalogBild(sn).catch(meldeUndLiefere('verwaltung:katalogBild', null));

    // 2. Was liegt auf der Platte?
    const safe = sn.replace(/[^a-z0-9-]/gi, '_');
    const datei = (p: string) => {
      try { const st = fs.statSync(p); return { vorhanden: true, bytes: st.size, geaendert: st.mtime }; }
      catch { return { vorhanden: false, bytes: 0, geaendert: null }; }
    };
    const original = datei(path.join(SET_IMAGES_DIR, `${safe}.jpg`));
    const vorschau = datei(path.join(SET_IMAGES_DIR, `${safe}_thumb.jpg`));

    // 3. Kennt der Bild-Proxy das CDN-Bild schon?
    const cdnUrl = zeilen.find(r => r.image_url)?.image_url || katalog?.image_url || null;
    let proxy: any = { adresse: cdnUrl, gecacht: false };
    if (cdnUrl) {
      const cf = proxyCachePathFor ? proxyCachePathFor(cdnUrl) : null;
      if (cf) {
        proxy = { adresse: cdnUrl, gecacht: datei(cf).vorhanden,
                  cache: datei(cf), vorschau: datei(cf + '_thumb.jpg') };
      }
    }

    // 3b. Gilt das Bild als fehlend? Ein Eintrag dort verhindert jeden Abruf
    // und macht die übrigen Auskünfte gegenstandslos.
    const merker = await verwaltung.fehlanzeigeDesSets(sn).catch(meldeUndLiefere('verwaltung:fehlanzeigeDesSets', null));
    const vorschauMerker = await verwaltung.fehlanzeigeDerVorschau(safe).catch(meldeUndLiefere('verwaltung:fehlanzeigeDerVorschau', null));

    // 4. Eine Einschätzung im Klartext — das, was man sonst aus den Zahlen
    //    selbst ableiten müsste.
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
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// POST /api/v1/admin/forget-image-misses
// Fehlanzeigen zurücknehmen, damit die betroffenen Bilder wieder geholt werden.
// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-forget-image-misses
router.post('/admin/forget-image-misses', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    const sets = Array.isArray(req.body?.set_numbers) ? req.body.set_numbers.map(String) : null;
    let entfernt = 0;
    if (sets?.length) {
      entfernt = await vergissFehlend(sets.map((sn: string) => 'set:' + sn));
    } else {
      // Nicht die ganze Tabelle: Die Vorschau-Vermerke haben einen anderen
      // Zweck (eine Verkleinerung, die nie gelingen kann) und sollen nicht
      // nebenbei mitverschwinden.
      const rows = await verwaltung.setFehlanzeigen().catch(meldeUndLiefere('verwaltung:setFehlanzeigen', []));
      if (rows.length) entfernt = await vergissFehlend(rows.map(r => r.cache_key));
    }
    if (req.body?.thumbs === true) {
      const rows = await verwaltung.vorschauFehlanzeigen().catch(meldeUndLiefere('verwaltung:vorschauFehlanzeigen', []));
      if (rows.length) entfernt += await vergissFehlend(rows.map(r => r.cache_key));
    }
    // Die anderen Arbeitsprozesse halten den Merker im Speicher und frischen
    // ihn im Fünf-Minuten-Takt vollständig aus der Tabelle auf — länger dauert
    // es dort also nicht.
    res.json({ success: true, entfernt, hinweis: 'Greift in allen Arbeitsprozessen binnen fünf Minuten.' });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * POST /api/v1/admin/cache-clear — Preis-Cache leeren, optional alle Caches.
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-cache-clear
 */
router.post('/admin/cache-clear', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    await cachesLeeren(!!req.body?.all);
    res.json({ success: true, message: req.body?.all ? 'Alle Caches geleert' : 'Preis-Cache geleert' });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── GET /api/v1/admin/cache-ttl ───────────────────────────────────────────────
router.get('/admin/cache-ttl', requireApiAdmin, async (_req: AuthedRequest, res) => {
  try {
    const ttl = await getGlobalSetting('price_cache_ttl');
    res.json({ success:true, ttl: ttl || '24' });
  } catch (e) { handleRouteError(res, e, undefined, _req); }
});

// POST /api/v1/admin/cache-ttl
router.post('/admin/cache-ttl', requireApiAdmin, async (req: AuthedRequest, res) => {
  const ttl = String(req.body?.ttl || '24');
  if (!['12','24','168'].includes(ttl)) return sendeFehler(req, res, 400, 'wert_ungueltig');
  try {
    setGlobalSetting('price_cache_ttl', ttl);
    res.json({ success:true, ttl });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// POST /api/v1/admin/default-condition — Standard-Zustand setzen (nur Admin)
router.post('/admin/default-condition', requireApiAdmin, async (req: AuthedRequest, res) => {
  const condition = String(req.body?.condition || 'N');
  if (!['N','U'].includes(condition)) return sendeFehler(req, res, 400, 'zustand_n_oder_u');
  try {
    setGlobalSetting('default_price_condition', condition);
    res.json({ success: true, condition });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// GET /api/v1/admin/api-limits — get current limits
router.get('/admin/api-limits', requireApiAdmin, async (_req: AuthedRequest, res) => {
  const [rb, bl, bs] = await Promise.all([
    getLimitForApi('rebrickable'), getLimitForApi('bricklink'), getLimitForApi('brickset')
  ]);
  res.json({ success:true, limits: { rebrickable: rb, bricklink: bl, brickset: bs } });
});

// PUT /api/v1/admin/api-limits — update limits
router.put('/admin/api-limits', requireApiAdmin, async (req: AuthedRequest, res) => {
  const { rebrickable, bricklink, brickset } = req.body;
  try {
    if (rebrickable) {
      // Vorher ungeprüft: bei "abc" landete der String "NaN" in global_settings
      // und der Vergleich gegen NaN liess jeden Aufruf scheitern.
      const n = parseInt(rebrickable, 10);
      if (!Number.isFinite(n) || n < 1 || n > 100000)
        return sendeFehler(req, res, 400, 'tageslimit_bereich');
      setGlobalSetting('api_limit_rebrickable', String(n));
      // Kein setMax() mehr nötig: Der Zähler liegt in der Datenbank und liest
      // die Grenze bei jedem Aufruf (getLimitForApi). Der Wert galt vorher nur
      // im Worker, der diese Anfrage bearbeitet hat — die übrigen liefen bis
      // zum Neustart mit dem alten weiter.
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
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// Admin: job monitoring
// ── GET /api/v1/admin/brickset-queue — list retry queue entries ───────────────
// ── POST /api/v1/admin/reimport-instructions — enqueue all sets missing instructions ─
router.post('/admin/reimport-instructions', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    const enqueued = await anleitungenNeuEinreihen();
    if (!enqueued) return res.json({ success: true, enqueued: 0, message: 'Alle Sets haben bereits Anleitungen' });
    res.json({ success: true, enqueued });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * GET /api/v1/admin/job-status — Stand des Preis-Jobs samt Kontingent.
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-job-status
 */
router.get('/admin/job-status', requireApiAdmin, async (req: AuthedRequest, res) => {
  try { res.json(await preisJobStand()); }
  catch (e) { handleRouteError(res, e, undefined, req); }
});

router.post('/admin/trigger-price-job', requireApiAdmin, async (req: AuthedRequest, res) => {
  try { res.json({ success: true, started: await preisJobJetzt() }); }
  catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * POST /api/v1/admin/catalog-images — alle fehlenden Katalogbilder einreihen.
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-catalog-images
 */
router.post('/admin/catalog-images', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    res.json(await katalogBilderEinreihen(req.body?.alle_erneut === true));
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/admin/redownload-missing-images ──────────────────────────────
// Lädt Bilder neu, die laut DB (image_local) heruntergeladen sind, deren Datei
// aber physisch fehlt. Läuft im Hintergrund; Fortschritt erscheint im Monitoring
// unter „Bild-Download (CDN)".
router.post('/admin/redownload-missing-images', requireApiAdmin, async (req: AuthedRequest, res) => {
  // Nicht abwarten: Das kann je nach Katalog lange dauern; der Fortschritt
  // erscheint in der Überwachung unter „Bild-Download (CDN)“.
  try { fehlendeBilderNachladen(); res.json({ success: true, started: true }); }
  catch (e) { handleRouteError(res, e, undefined, req); }
});

// Nutzerverwaltung: NUR unter /api/v1/auth/users
// Schwerer als das Totliegen wog die Doppelung: Adminrechte liessen sich hier
// mit dem Feld `is_admin` und dort mit `role` umschalten — zwei Schreibweisen
// fuer dieselbe Umschaltung, jede mit eigener Pruefung. Bei Rechten ist genau …
// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-logs

// ── GET /api/v1/admin/logs?minutes=15 — return recent log entries ─────────────
router.get('/admin/logs', requireApiAdmin, async (req: AuthedRequest, res) => {
  const minutes = Math.min(2880, Math.max(1, parseInt(String(req.query.minutes || '15'))));
  try {
    const rows = await verwaltung.protokollSeit(minutes);
    res.json({ success: true, minutes, count: rows.length, logs: rows });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

router.get('/admin/brickset-queue', requireApiAdmin, async (_req: AuthedRequest, res) => {
  const rows = await verwaltung.bricksetWarteschlange().catch(meldeUndLiefere('verwaltung:bricksetWarteschlange', []));
  res.json({ success: true, count: rows.length, entries: rows });
});

// ── POST /api/v1/admin/brickset-queue/:setNumber/retry — retry single entry now ─
router.post('/admin/brickset-queue/:setNumber/retry', requireApiAdmin, async (req: AuthedRequest, res) => {
  const sn = pfadParam(req, 'setNumber');
  await bricksetWiederholen(sn);
  res.json({ success: true, set_number: sn });
});

// ── DELETE /api/v1/admin/brickset-queue/:setNumber — remove + trigger fallback ─
router.delete('/admin/brickset-queue/:setNumber', requireApiAdmin, async (req: AuthedRequest, res) => {
  const sn = pfadParam(req, 'setNumber');
  await bricksetEntfernen(sn);
  res.json({ success: true, set_number: sn });
});

router.get('/admin/jobs', requireApiAdmin, async (req: AuthedRequest, res) => {
  try { res.json(await jobUebersicht()); }
  catch (e) { handleRouteError(res, e, undefined, req); }
});

// ── POST /api/v1/admin/job-schedule — Zeitplan eines Jobs ändern ──────────────
// Body: { name: <monitorKey>, time: "HH:MM" }  (für tägliche Jobs)
//   oder { name: 'priceJob', minutes: <n> }    (für den Preis-Job, Intervall)
// Die Änderung greift SOFORT (Reschedule-Trigger + direkter Aufruf).
router.post('/admin/job-schedule', requireApiAdmin, async (req: AuthedRequest, res) => {
  try {
    const { name, time, minutes } = req.body || {};
    await jobZeitplanSetzen(name, time, minutes);
    res.json({ success: true });
  } catch (e) { handleRouteError(res, e, undefined, req); }
});

/**
 * GET /api/v1/admin/img-probe?url=…
 * Fragt eine Bild-URL vom SERVER aus ab und meldet, was das CDN antwortet —
 * mit Referer, ohne Referer und ganz ohne Kopfzeilen. Damit lässt sich der
 * Unterschied zwischen „Bild fehlt", „Hotlink-Schutz" und „Server kommt gar …
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-img-probe
 */
router.get('/admin/img-probe', requireApiAdmin, async (req: AuthedRequest, res) => {
  const url = String(req.query.url || '');
  if (!/^https:\/\//.test(url)) return sendeFehler(req, res, 400, 'url_fehlt_https');

  // Dieselbe Host-Allowlist wie der Bild-Proxy.
  // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-img-probe-2
  try {
    if (!hostErlaubt(url, ERLAUBTE_BILD_HOSTS)) {
      return sendeFehler(req, res, 403, 'host_nicht_erlaubt', { host: new URL(url).hostname });
    }
  } catch (_) {
    return sendeFehler(req, res, 400, 'url_ungueltig');
  }

  // Dieselben Hosts wie der Bild-Proxy: Der Abruf läuft aus dem internen
  // Netz; jede Adresse zuzulassen wäre Server-Side Request Forgery.
  const ALLOWED_PROBE_HOSTS = ['cdn.rebrickable.com', 'rebrickable.com', 'images.brickset.com', 'www.bricklink.com', 'img.bricklink.com'];
  try {
    const host = new URL(url).hostname;
    if (!ALLOWED_PROBE_HOSTS.some(h => host === h || host.endsWith('.' + h))) {
      return sendeFehler(req, res, 403, 'host_nicht_erlaubt', { host });
    }
  } catch (_) {
    return sendeFehler(req, res, 400, 'url_ungueltig');
  }

  res.json(await bildProbe(url));
});
/**
 * GET /api/v1/admin/price-probe?set=10290-1
 * Zeigt für ein Set alles, was in die Marktpreis-Anzeige einfliesst:
 * Erfassungen, gespeicherter Zustand, sämtliche price_cache-Zeilen und — auf
 * Wunsch — was BrickLink gerade antwortet.
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-price-probe
 */
router.get('/admin/price-probe', requireApiAdmin, async (req: AuthedRequest, res) => {
  const setNumber = String(req.query.set || '').trim();
  if (!setNumber) return sendeFehler(req, res, 400, 'parameter_set_fehlt');
  const uid = req.apiUser.user_id;

  res.json(await preisProbe(uid, setNumber, req.query.live === '1'));
});

export default router;
