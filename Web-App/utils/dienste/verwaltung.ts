/**
 * Fachdienst Verwaltung: was die Überwachungsseite an Zahlen, Proben und
 * Hebeln braucht. Fremde Dienste und Jobs erreicht sie nur von hier aus.
 */
import fs from 'fs';
import https from 'https';
import * as verwaltung from '../verwaltung';
import { DATA_DIR, PDF_JOB_DIR, SET_IMAGES_DIR } from '../appPaths';
import { fehlertext, meldeUndWeiter, logAndContinue, meldeUndLiefere, ohneFehlendeDatei } from '../httpError';
import { fetchPrice } from '../financeCalc';
import { getRateLimitStatus, setzeKontingentZurueck } from '../apiKontingent';
import { katalogEintrag, ohneBricklinkPreis } from '../setNummer';
import { scrapeInstructionsFromFallback, loescheAnleitungen } from '../instructions';
import { imgProxyFailures } from '../imgProxyStats';
import { vergissFehlend } from '../imageMisses';
import { getGlobalSetting, getSetting, setGlobalSetting } from '../settings';
import { liesZustand, setzeAusloeser } from '../laufzustand';
import * as monitor from '../jobMonitor';
import * as pgNotify from '../pgNotify';
import { jobsteuerung, DAILY_JOBS } from '../jobsteuerung';
import { fehlerWerfen } from '../fehlerTexte';
import { clearCatalogCache, clearSubsetsCache, getPriceGuide, getCacheStats, pruefeBricklinkZugang } from '../../clients/bricklink';
import { ausRetryWarteschlange, pruefeBricksetZugang } from '../../clients/brickset';
import { pruefeRebrickableZugang } from '../../clients/rebrickable';

/**
 * Wie lange ein gemeldeter Betrieb ohne neues Lebenszeichen als laufend gilt.
 * Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#job-frisch-ms
 */
const JOB_FRISCH_MS = 3 * 60_000;

const QUELLEN: Record<string, () => Promise<void>> = {
  rebrickable: pruefeRebrickableZugang, brickset: pruefeBricksetZugang, bricklink: pruefeBricklinkZugang,
};

/** Den gespeicherten Zugang einer Quelle mit einem kleinen Abruf prüfen; wirft mit dem Grund. */
export async function quellePruefen(quelle: string) {
  const pruefe = Object.hasOwn(QUELLEN, quelle) ? QUELLEN[quelle] : undefined;
  if (!pruefe) fehlerWerfen('quelle_unbekannt', 400);
  try { await pruefe(); }
  catch (e) { fehlerWerfen('quelle_test_fehlgeschlagen', 400, { grund: fehlertext(e).slice(0, 200) }); }
}

/** Cache-Zahlen samt Kontingenten und Verbindungspool. */
export async function cacheStatistik() {
  const leer = { count: 0, limit: 0 };
  const [stats, stale, rlBL, rlRB, rlBS] = await Promise.all([
    getCacheStats().catch(meldeUndLiefere('verwaltung:getCacheStats', {})),
    verwaltung.veraltetePreise().catch(meldeUndLiefere('verwaltung:veraltetePreise', null)),
    getRateLimitStatus('bricklink').catch(meldeUndLiefere('verwaltung:kontingent', leer)),
    getRateLimitStatus('rebrickable').catch(meldeUndLiefere('verwaltung:kontingent', leer)),
    getRateLimitStatus('brickset').catch(meldeUndLiefere('verwaltung:kontingent', leer)),
  ]);
  return { success: true, ...stats, price_stale: parseInt(stale?.c || 0),
    rate_limits: { bricklink: rlBL, rebrickable: rlRB, brickset: rlBS }, db_pool: verwaltung.getPoolStats() };
}

/** Preis-Cache leeren; mit `alle` auch die Kataloge von BrickLink. */
export async function cachesLeeren(alle: boolean) {
  await verwaltung.leerePreisCache();
  if (alle) { await clearSubsetsCache(); await clearCatalogCache(); }
}

/**
 * Nach einem höheren Brickset-Limit: Ist heute noch Kontingent da, gleich
 * die Warteschlange abarbeiten statt bis morgen zu warten.
 */
export async function bricksetLimitGesetzt(alt: number, neu: number) {
  if (!(neu > alt)) return;
  const rl = await getRateLimitStatus('brickset').catch(meldeUndLiefere('verwaltung:getRateLimitStatus', null));
  const rest = rl ? Math.max(0, neu - (rl.count || 0)) : 0;
  if (rest <= 0) return;
  console.log(`[brickset] Limit erhöht ${alt}→${neu}, ${rest} Abrufe frei — Warteschlange wird abgearbeitet`);
  setImmediate(() => { jobsteuerung().bricksetWarteschlange(true).catch(logAndContinue('verwaltung:processRetryQueue')); });
}

/** Alle Sets ohne Anleitung neu einreihen; die Arbeit macht der Primary. */
export async function anleitungenNeuEinreihen() {
  const fehlend = await verwaltung.setsOhneAnleitung();
  for (const { set_number } of fehlend) {
    await loescheAnleitungen(set_number).catch(logAndContinue('verwaltung:loescheAnleitungen'));
    await jobsteuerung().anleitungEinreihen(set_number).catch(logAndContinue('verwaltung:enqueue'));
  }
  if (fehlend.length) await jobsteuerung().anleitungenLaufAnfordern();
  return fehlend.length;
}

export async function preisJobStand() {
  return { success: true, job: jobsteuerung().preisJobStatus(), rate_limit: await getRateLimitStatus('bricklink') };
}

export const preisJobJetzt = () => jobsteuerung().preisJobJetzt();
export const fehlendeBilderNachladen = () => { jobsteuerung().fehlendeBilderNachladen().catch(logAndContinue('verwaltung:bilder nachladen')); };

/** Einen Brickset-Eintrag heute wiederholen, auch über das Tageskontingent hinweg. */
export async function bricksetWiederholen(sn: string) {
  await verwaltung.bricksetHeuteWiederholen(sn).catch(logAndContinue('verwaltung:bricksetHeuteWiederholen'));
  await setzeKontingentZurueck('brickset').catch(logAndContinue('brickset:kontingent zurücksetzen'));
  setImmediate(() => { jobsteuerung().bricksetWarteschlange(true).catch(logAndContinue('verwaltung:processRetryQueue')); });
}

/** Aus der Brickset-Warteschlange nehmen und gleich die anderen Quellen fragen. */
export async function bricksetEntfernen(sn: string) {
  await ausRetryWarteschlange(sn).catch(logAndContinue('verwaltung:ausRetryWarteschlange'));
  setImmediate(() => { scrapeInstructionsFromFallback(sn).catch(logAndContinue('verwaltung:scrapeInstructionsFromFallback')); });
}

/**
 * Uhrzeit eines täglichen Jobs oder Intervall des Preis-Jobs setzen und
 * sofort neu planen (Auslöser für den Primary, direkter Aufruf hier).
 */
export async function jobZeitplanSetzen(name: unknown, time: unknown, minutes: unknown) {
  const daily = DAILY_JOBS.find(j => j.monitorKey === name);
  if (daily) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
    if (!m || +(m[1] ?? '') > 23 || +(m[2] ?? '') > 59) fehlerWerfen('uhrzeit_ungueltig', 400);
    setGlobalSetting(`job_time_${daily.name}`, `${String(+(m[1] ?? '')).padStart(2, '0')}:${String(+(m[2] ?? '')).padStart(2, '0')}`);
  } else if (name === 'priceJob') {
    setGlobalSetting('price_job_interval_minutes', String(Math.max(5, parseInt(String(minutes)) || 60)));
  } else {
    fehlerWerfen('unbekannter_job', 400);
  }
  await zeitplanNeuPlanen();
}

/** Auslöser für den Primary setzen, wecken und hier selbst neu planen. */
export async function zeitplanNeuPlanen() {
  await setzeAusloeser('job_reschedule_trigger').catch(logAndContinue('verwaltung:setzeAusloeser'));
  await pgNotify.notify('job_reschedule_trigger');
  await jobsteuerung().zeitplanNeu().catch((e: unknown) => meldeUndWeiter('verwaltung:zeitplan-neu-planen', e));
}

/**
 * Die Job-Karten der Überwachung: Stand aus jobMonitor, ergänzt um Zahlen,
 * die nur die Datenbank kennt (Anleitungen, Zuordnungen, Bilder, PDF-Aufträge).
 */
export async function jobUebersicht() {
    const jobs = await monitor.all(); // reads from PostgreSQL — shared across all cluster workers

  // Enrich with live DB counts
  const [pending, done, failed] = await Promise.all([
    jobsteuerung().anleitungenOffen().catch(meldeUndLiefere('verwaltung:offeneAuftraege', 0)),
    verwaltung.anleitungenErledigt().catch(meldeUndLiefere('verwaltung:anleitungenErledigt', null)),
    verwaltung.anleitungenGescheitert().catch(meldeUndLiefere('verwaltung:anleitungenGescheitert', null)),
  ]);
  const blMapped = await verwaltung.zugeordneteTeile().catch(meldeUndLiefere('verwaltung:zugeordneteTeile', null));
  const blTotal  = await verwaltung.bricklinkTeile().catch(meldeUndLiefere('verwaltung:bricklinkTeile', null));
  const rbParts  = await verwaltung.rbTeile().catch(meldeUndLiefere('verwaltung:rbTeile', null));
  const rbInvParts = await verwaltung.rbInventarTeile().catch(meldeUndLiefere('verwaltung:rbInventarTeile', null));
  const lastSync = await liesZustand('rb_csv_last_sync');

  // Enrich blIds job with live DB counts
  const mappedC = parseInt(blMapped?.c||0);
  const totalBl = parseInt(blTotal?.c||0);
  if (totalBl > 0) {
    jobs.blIds = {
      ...jobs.blIds,
      status:   mappedC < totalBl ? (jobs.blIds.status === 'running' ? 'running' : 'idle') : 'done',
      progress: mappedC,
      total:    totalBl,
      sub:      mappedC < totalBl ? `${mappedC} / ${totalBl} gemappt` : `Alle ${totalBl} gemappt`
    };
  }

  // Enrich instrQueue job with live DB counts
  const pendingC = pending ?? 0;
  const doneC    = parseInt(done?.c||0);
  const failedC  = parseInt(failed?.c||0);
  const totalC   = pendingC + doneC + failedC;
  if (totalC > 0) {
    const enriched = {
      ...jobs.instrQueue,
      status:   pendingC > 0 ? 'running' : 'done',
      progress: doneC,
      total:    totalC,
      sub:      pendingC > 0 ? `${pendingC} ausstehend` : 'Alle erledigt'
    };
    jobs.instrQueue = enriched;
  }

  // Brickset retry queue
  const bsRetry = await verwaltung.bricksetWartend().catch(meldeUndLiefere('verwaltung:bricksetWartend', null));
  const bsRetryC = parseInt(bsRetry?.c || 0);
  const bsRetryDue = await verwaltung.bricksetFaellig().catch(meldeUndLiefere('verwaltung:bricksetFaellig', null));
  const bsRetryDueC = parseInt(bsRetryDue?.c || 0);
  jobs.bricksetRetry = {
    label:    'Brickset Retry Queue',
    status:   bsRetryC === 0 ? 'done' : bsRetryDueC > 0 ? 'idle' : 'idle',
    progress: 0,
    total:    bsRetryC,
    sub:      bsRetryC === 0
      ? 'Keine ausstehenden Einträge'
      : bsRetryDueC > 0
        ? `${bsRetryDueC} Sets bereit zum Retry, ${bsRetryC - bsRetryDueC} warten`
        : `${bsRetryC} Sets warten auf morgen`,
    lastRun: null,
  };

  // img-dl: active download locks and pending images count
  const [imgDlPending, imgDlDone, imgDlPendingFigs, imgDlPendingOwnFigs] = await Promise.all([
    verwaltung.teilbilderOffen().catch(meldeUndLiefere('verwaltung:teilbilderOffen', null)),
    verwaltung.teilbilderFertig().catch(meldeUndLiefere('verwaltung:teilbilderFertig', null)),
    verwaltung.setFigurenbilderOffen().catch(meldeUndLiefere('verwaltung:setFigurenbilderOffen', null)),
    // Minifiguren des Bestands legt der img-dl-Hintergrundlauf ebenfalls lokal
    // ab; sie gehören deshalb in die offene Menge.
    verwaltung.bestandsFigurenbilderOffen().catch(meldeUndLiefere('verwaltung:bestandsFigurenbilderOffen', null)),
  ]);
  const imgPending = parseInt(imgDlPending?.c||0) + parseInt(imgDlPendingFigs?.c||0)
                   + parseInt(imgDlPendingOwnFigs?.c||0);
  const imgDone    = parseInt(imgDlDone?.c||0);
  // Aktiv laufende Downloads: über ALLE Batches/Worker summierter Zähler
  // (imgDlAdd/-Sub in downloadSetImages) — nicht mehr der zuletzt gestartete
  // Batch. Deckelung auf imgPending (real noch nicht gecachte Bilder) heilt
  // einen evtl. verwaisten Zähler nach einem Worker-Crash selbst; bei 0 offenen
  // Bildern wird der Zähler zurückgesetzt.
  const imgDlJob   = await monitor.get('imgDl').catch(meldeUndLiefere('verwaltung:get', null));
  let imgActive    = await monitor.imgDlPending().catch(meldeUndLiefere('verwaltung:imgDlPending', 0));
  if (imgPending === 0 && imgActive > 0) { await monitor.imgDlReset().catch(logAndContinue('verwaltung:imgDlReset')); imgActive = 0; }
  imgActive = Math.min(imgActive, imgPending);
  const imgRunning = imgActive > 0;
  // Manueller Re-Download fehlender Bilder (image_local gesetzt, Datei fehlt) —
  // Status liegt in laufzustand.imgredl_status.
  let reDl: any = null;
  try {
    const roh = await liesZustand('imgredl_status');
    if (roh) reDl = JSON.parse(roh);
  } catch (_) { reDl = null; }
  // „laeuft" heisst auch hier: hat KUERZLICH etwas getan
  // Der Zeitstempel dafuer wird laengst mitgeschrieben: _redlSetStatus() in
  // jobs/partsCatalogEnrich.ts haengt an JEDEN Stand ein `at`. Gelesen wurde
  // er nie.
  // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-jobs-seitredl
  const seitReDl = typeof reDl?.at === 'number' ? Date.now() - reDl.at : null;
  const reDlRunning = reDl?.running === true
    && (seitReDl === null || seitReDl < JOB_FRISCH_MS);
  const reDlSub = reDlRunning
    ? (reDl.phase === 'scanning'
        ? '↻ suche fehlende Bilder…'
        : `↻ ${reDl.done || 0}/${reDl.total || 0} fehlende neu geladen`)
    : null;
  // Katalog-Bilder gehören in DIESE Kachel
  // Er hat recht: Die Kachel zählte ausschliesslich Bilder des eigenen
  // BESTANDES und meldete „Alle 62 170 Bilder gecacht", während der
  // Hintergrund-Job gerade hunderte Katalogbilder nachlud. Der Titel verspricht …
  // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-jobs-katalogoffen
  const katalogOffen = (await verwaltung.katalogBilderOffen().catch(meldeUndLiefere('verwaltung:katalogBilderOffen', null)))?.c ?? 0;
  // „läuft" heisst: hat kürzlich etwas getan
  // Die Kachel meldete „läuft", sobald die Warteschlange nicht leer war
  // . Das ist keine Aussage über TÄTIGKEIT: Eine
  // steckengebliebene Warteschlange sah genauso aus wie eine, die abgearbeitet …
  // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-jobs-letzterlauf
  let letzterLauf: { zeit?: number } | null = null;
  try {
    const roh = await liesZustand('imgqueue_last_run');
    if (roh) letzterLauf = JSON.parse(roh);
  } catch (_) { letzterLauf = null; }
  const seitLauf = letzterLauf?.zeit ? Date.now() - letzterLauf.zeit : null;
  const jobLaeuft = seitLauf !== null && seitLauf < JOB_FRISCH_MS;
  const katalogSub = katalogOffen > 0
    ? `${katalogOffen} Katalog-Bilder in Warteschlange` +
      (jobLaeuft ? '' : seitLauf === null ? ' · Job noch nicht gelaufen'
                                          : ` · seit ${Math.round(seitLauf / 60_000)} min kein Durchgang`)
    : null;

  const bestandSub = imgRunning ? `${imgActive} Bilder werden geladen`
              : imgPending > 0 ? `${imgPending} Bilder noch nicht gecacht`
              : `Alle ${imgDone} Bilder gecacht`;
  // „Bestand" ausdrücklich benennen, sobald daneben Katalogzahlen stehen —
  // sonst lässt sich nicht sagen, worauf sich welche Zahl bezieht.
  const imgBaseSub = katalogSub ? `Bestand: ${bestandSub} · ${katalogSub}` : bestandSub;
  jobs.imgDl = {
    label:    '📥 Bild-Download (CDN)',
    // Läuft auch dann, wenn nur der Katalog-Job arbeitet — sonst stünde die
    // Kachel auf „fertig", während sie gerade lädt.
    status:   (imgRunning || reDlRunning || (katalogOffen > 0 && jobLaeuft)) ? 'running'
              : (imgPending > 0 || katalogOffen > 0) ? 'idle' : 'done',
    sub:      reDlSub ? `${imgBaseSub} · ${reDlSub}` : imgBaseSub,
    // Der Balken bezieht die Warteschlange mit ein: Sonst stünde er auf 100 %,
    // während noch hunderte Bilder ausstehen.
    progress: imgDone,
    total:    imgDone + imgPending + katalogOffen,
    queue:    katalogOffen,
    queueLastRun: letzterLauf?.zeit || null,
    lastRun:  imgDlJob?.lastRun || null,
    canRedownload: true,
  };

  // PDF jobs: count from filesystem
  let pdfRunning = 0, pdfDone = 0;
  try {
    const _fs2 = require('fs'), _path2 = require('path');
    const pdfFiles = _fs2.readdirSync(PDF_JOB_DIR).filter((f: string) => f.endsWith('.json'));
    for (const f of pdfFiles) {
      try {
        const j = JSON.parse(_fs2.readFileSync(_path2.join(PDF_JOB_DIR, f), 'utf8'));
        if (j.status === 'running') pdfRunning++;
        else if (j.status === 'done') pdfDone++;
      } catch (e) { meldeUndWeiter('admin:pdf-auftrag-lesen', e); }
    }
  } catch (e) { meldeUndWeiter('admin:auftragsordner-lesen', e); }
  jobs.pdfJobs = {
    label:   '📄 PDF-Jobs',
    status:  pdfRunning > 0 ? 'running' : pdfDone > 0 ? 'idle' : 'done',
    sub:     pdfRunning > 0 ? `${pdfRunning} PDF(s) werden erstellt`
             : pdfDone > 0 ? `${pdfDone} PDF(s) bereit zum Download`
             : 'Keine aktiven Jobs',
    progress: 0,
    total:    0,
    lastRun:  null,
  };

  // Konfigurierte Zeitpläne für die Monitoring-UI:
  // tägliche Jobs (HH:MM) + Preis-Job (Intervall in Minuten).
  const schedules: any = {};
  for (const dj of DAILY_JOBS) {
    const zeit = await getGlobalSetting(`job_time_${dj.name}`);
    schedules[dj.monitorKey] = { type: 'daily', time: zeit || dj.default };
  }
  const priceInt = await getGlobalSetting('price_job_interval_minutes');
  schedules.priceJob = { type: 'interval', minutes: parseInt(priceInt || '60') };

  return {
    success: true,
    jobs,
    schedules,
    db: {
      instrQueue: { pending: pendingC, done: doneC, failed: failedC },
      blMapping:  { mapped: parseInt(blMapped?.c||0), total: parseInt(blTotal?.c||0) },
      csvCache:   { parts: parseInt(rbParts?.c||0), inventoryParts: parseInt(rbInvParts?.c||0), lastSync: lastSync || null },
    }
  };
}

/**
 * Fragt eine (geprüfte) Bildadresse vom Server aus ab — mit und ohne Referer
 * und ohne Kopfzeilen — und meldet, was der Proxy davon ausliefern würde.
 */
export async function bildProbe(url: string) {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const variants = [
    { name: 'mit Referer',  headers: { 'User-Agent': UA, 'Referer': 'https://rebrickable.com/', 'Accept': 'image/*,*/*;q=0.8' } },
    { name: 'ohne Referer', headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8' } },
    { name: 'nackt',        headers: {} },
  ];

  const probe = (v: any) => new Promise(resolve => {
    const t0 = Date.now();
    let settled = false;
    const done = (o: any) => { if (!settled) { settled = true; resolve({ variant: v.name, ms: Date.now() - t0, ...o }); } };
    const rq = https.get(url, { family: 4, headers: v.headers }, (r) => {
      let bytes = 0;
      r.on('data', (c: Buffer) => { bytes += c.length; if (bytes > 65536) rq.destroy(); });
      r.on('end',   () => done({ status: r.statusCode, content_type: r.headers['content-type'] || null,
                                 content_length: r.headers['content-length'] || null,
                                 // Liefert das CDN komprimiert, muss der Proxy die Kopfzeile
                                 // weiterreichen — sonst hält der Browser die Bytes für ein JPEG.
                                 content_encoding: r.headers['content-encoding'] || null,
                                 transfer_encoding: r.headers['transfer-encoding'] || null,
                                 bytes, server: r.headers['server'] || null, cf_ray: r.headers['cf-ray'] || null }));
      r.on('close', () => done({ status: r.statusCode, content_type: r.headers['content-type'] || null, bytes, truncated: true }));
    });
    rq.on('error', (e: NodeJS.ErrnoException) => done({ error: e.message, code: e.code }));
    // Ein Diagnosewert wie ein HTTP-Status, keine Meldung an den Nutzer: Die
    // Monitoring-Ansicht zeigt ihn als Befund der Erreichbarkeitsprobe.
    rq.setTimeout(10000, () => { rq.destroy(); done({ error: 'timeout' }); });
  });

  const results: any[] = [];
  for (const v of variants) results.push(await probe(v));

  // Liegt das Bild bereits im Plattencache?
  const crypto = require('crypto'), fsp = fs.promises, pathm = require('path');
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const dir = pathm.join(DATA_DIR, 'img_proxy_cache');
  const cached = await fsp.stat(pathm.join(dir, key)).then((st: any) => ({ bytes: st.size })).catch(ohneFehlendeDatei('verwaltung:stat', null));
  const thumb  = await fsp.stat(pathm.join(dir, key + '_thumb.jpg')).then((st: any) => ({ bytes: st.size })).catch(ohneFehlendeDatei('verwaltung:stat', null));

  // Fehlerzähler des Proxys mitliefern — zeigt auf einen Blick, ob und woran
  // Abrufe scheitern, ohne im Server-Log suchen zu müssen.
  const failures = imgProxyFailures;
  // Was würde der Proxy AUSLIEFERN? Ein Abruf durch dieselbe Kette wie im
  // Bild-Proxy, aber statt zum Client gehen die ersten Bytes hierher — als Hex.
  // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-img-probe-head
  const head = await new Promise(resolve => {
    const rq = https.get(url, { family: 4, headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8',
                                            'Accept-Encoding': 'identity' } }, (r: any) => {
      const chunks: Buffer[] = []; let n = 0;
      r.on('data', (c: Buffer) => { chunks.push(c); n += c.length; if (n >= 32) rq.destroy(); });
      const fin = () => resolve({
        status: r.statusCode,
        content_encoding: r.headers['content-encoding'] || null,
        first_bytes_hex: Buffer.concat(chunks).slice(0, 16).toString('hex').replace(/(..)/g, '$1 ').trim(),
        looks_like: (() => {
          const b = Buffer.concat(chunks);
          if (b[0] === 0xFF && b[1] === 0xD8) return 'JPEG';
          if (b[0] === 0x89 && b[1] === 0x50) return 'PNG';
          if (b[0] === 0x1F && b[1] === 0x8B) return 'gzip (komprimiert!)';
          if (b.slice(0, 5).toString().toLowerCase().startsWith('<')) return 'HTML/XML statt Bild';
          return 'unbekannt';
        })(),
      });
      r.on('end', fin); r.on('close', fin);
    });
    rq.on('error', (e: Error) => resolve({ error: e.message }));
    rq.setTimeout(10000, () => { rq.destroy(); resolve({ error: 'timeout' }); });
  });

  return { success: true, url, cache: { original: cached, thumb }, probes: results,
           proxy_failures: failures, body_check: head };
}

/** Alles, was in die Marktpreis-Anzeige eines Sets einfliesst; mit `live` auch die Antwort von BrickLink. */
export async function preisProbe(uid: number, setNumber: string, live: boolean) {
  const [setRow, acqs, cacheRows, histRows, currRow, ttlRow] = await Promise.all([
    verwaltung.probeSet(uid, setNumber),
    verwaltung.probeErfassungen(uid, setNumber),
    verwaltung.probePreisCache(setNumber),
    verwaltung.probePreisVerlauf(setNumber),
    verwaltung.probeWaehrung(uid).catch(meldeUndLiefere('verwaltung:probeWaehrung', null)),
    getGlobalSetting('price_cache_ttl'),
  ]);

  // Welchen Zustand würde die Bewertung wählen? Dieselbe Regel wie
  // conditionFromAcquisitions() in utils/handlers/shared.ts: Eine gebrauchte
  // Erfassung genügt, sonst Neu.
  // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-price-probe-anyused
  const anyUsed = acqs.some(a => a.condition === 'U');
  const chosen = anyUsed ? 'U' : 'N';

  const out: any = {
    success: true,
    set: setRow || null,
    acquisitions: acqs,
    condition_logic: {
      any_acquisition_used: anyUsed,
      chosen_for_price: chosen,
      hinweis: 'Eine gebrauchte Erfassung macht das Set gebraucht, sonst ist es neu. '
             + 'Der Zustand steht seit Migration 0032 nur in den Erfassungen; das Feld '
             + 'mit dem gespeicherten Wert, das hier vorher stand, ist weggefallen. '
             + 'Weicht "chosen_for_price" von der Anzeige ab, liegt der Fehler dort.',
    },
    currency: currRow?.value || 'EUR',
    ttl_hours: parseInt(ttlRow || '24'),
    price_cache: cacheRows,
    price_history_last5: histRows,
  };

  // Dieselbe Währung wie die Bewertung (getSetting fällt auf die globale
  // Vorgabe zurück, user_settings allein nicht) — sonst zeigte die Probe
  // andere Cache-Zeilen als die, die Finanzen liest.
  out.currency = await getSetting(uid, 'currency', 'EUR');
  // „BrickLink kennt das Set nicht": Steht sie, liefert fetchPrice still 0.
  const katalog = await katalogEintrag(setNumber);
  out.katalog = katalog ? { ...katalog, gilt_als_unbekannt: ohneBricklinkPreis(katalog) } : null;
  // Was Finanzen für den gewählten Zustand bekommt — genau dieser Aufruf.
  try { out.finanzen_preis = await fetchPrice(setNumber, chosen, 'sold', out.currency, out.ttl_hours); }
  catch (e) { out.finanzen_preis = { error: fehlertext(e) }; }

  if (live) {
    const cur = out.currency;
    out.live = {};
    for (const cond of ['N', 'U']) {
      try {
        const g = await getPriceGuide(setNumber, cond, 'sold', cur);
        out.live[cond] = { avg_price: g?.avg_price, qty_avg_price: g?.qty_avg_price,
                           guide_used: g?.guide_used, guide_fallback: g?.guide_fallback || false };
      } catch (e) { out.live[cond] = { error: fehlertext(e) }; }
    }
  }

  return out;
}

/**
 * Alle fehlenden Katalogbilder einreihen. Fertig ist ein Set mit Original UND
 * Vorschau; zurückgenommene Fehlanzeigen werden mitgezählt.
 */
export async function katalogBilderEinreihen(alleErneut: boolean) {
    const zuVergessen = await (alleErneut
      ? verwaltung.setFehlanzeigen()
      : verwaltung.setFehlanzeigenOhne404()
    ).catch(meldeUndLiefere('verwaltung:zuVergessen', []));
    const verworfen = zuVergessen.length
      ? await vergissFehlend(zuVergessen.map(r => r.cache_key))
      : 0;
    // Was schon fertig ist, wird nicht wieder eingereiht
    // Er hatte recht, und die Begründung, die ich früher dafür notiert
    // habe, war zu kurz gedacht: Ich wollte 25 000 einzelne Dateizugriffe in
    // einer Anfrage vermeiden — richtig — und habe daraus geschlossen, gar …
    // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-catalog-images-fs
        let vorhanden: Set<string> = new Set();
    try {
      const namen = new Set<string>(fs.readdirSync(SET_IMAGES_DIR));
      // FERTIG heisst: Original UND Vorschau. Fehlt die Vorschau, gehört das
      // Set weiter in die Warteschlange — der Job holt sie dann nach, ohne
      // erneut zu laden.
      for (const n of namen) {
        if (!n.endsWith('_thumb.jpg')) continue;
        const basis = n.slice(0, -'_thumb.jpg'.length);
        if (namen.has(`${basis}.jpg`)) vorhanden.add(basis);
      }
    } catch (_) { /* Ordner noch leer — dann ist nichts fertig */ }

    const kandidaten = await verwaltung.katalogBildKandidaten();

    // Dieselbe Namensregel wie in downloadSetImage() — sonst verglichen wir
    // Setnummern mit Dateinamen und fänden nie eine Übereinstimmung.
    const dateiname = (sn: string) => String(sn).replace(/[^a-z0-9-]/gi, '_');
    const offenSets: string[] = [];
    const offenUrls: string[] = [];
    for (const k of kandidaten) {
      if (vorhanden.has(dateiname(k.set_num))) continue;
      offenSets.push(k.set_num);
      offenUrls.push(k.set_img_url);
    }

    let neuEingereiht = 0;
    if (offenUrls.length) {
      const r = await verwaltung.reiheKatalogBilderEin(offenUrls, offenSets);
      neuEingereiht = r?.n ?? 0;
    }
    const offen = await verwaltung.offeneBildauftraege();
    // Wie lange das dauert — die Zahl der Aufträge allein sagt es nicht, und
    // „Stunden oder Tage?" ist die erste Frage, die sich stellt. Die Rate kommt
    // aus dem Job selbst, damit sie nicht an zwei Stellen gepflegt wird.
    const proMinute = jobsteuerung().bilderJeMinute() || 30;
    return {
      success: true,
      queued:  neuEingereiht,
      pending: offen?.n ?? 0,
      // Für die Rückmeldung: So viele waren schon fertig und blieben aussen vor.
      skipped: kandidaten.length - offenUrls.length,
      // Zurückgenommene Fehlanzeigen — ohne die Zahl bliebe unklar, warum
      // plötzlich wieder Bilder anstehen, die zuletzt als fehlend galten.
      verworfen,
      dauer_minuten: Math.ceil((offen?.n ?? 0) / proMinute),
    };
}
