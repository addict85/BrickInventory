/** Fremde Dienste und Jobs erreicht die Überwachungsseite nur von hier aus,
 * damit die Routen keine Schichten überspringen. */
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import * as verwaltung from './repository/verwaltung';
import { naechsteUhrzeit, taeglicheUhrzeit } from '../auftraege/zeitplan';
import { DATA_DIR, PDF_JOB_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { fehlertext, meldeUndWeiter, logAndContinue, meldeUndLiefere, ohneFehlendeDatei } from '../infra/httpError';
import { fetchPrice } from '../finanzen/financeCalc';
import { getRateLimitStatus, setzeKontingentZurueck } from '../katalog/apiKontingent';
import { ohneBricklinkPreis } from '../sets/setNummer';
import { katalogEintrag, clearCatalogCache, clearSubsetsCache, getPriceGuide, getCacheStats } from '../katalog/bricklinkPreise';
import { loescheAnleitungen } from '../katalog/instructions';
import { imgProxyFailures } from '../katalog/bilder/imgProxyStats';
import { vergissFehlend } from '../katalog/bilder/imageMisses';
import { setGlobalSetting } from '../konto/settings';
import { getGlobalSetting } from '../konto/settings';
import { getSetting } from '../konto/settings';
import { liesZustand } from '../auftraege/laufzustand';
import * as monitor from '../auftraege/jobMonitor';
import { DAILY_JOBS, ziehePlanVor, zeitplanGeaendert } from '../auftraege/zeitplan';
import { zaehleArt } from '../auftraege/dienst';
import { stelleAuftragEin } from '../auftraege/dienst';
import { anleitungEinreihen } from '../auftraege/anleitungsAuftrag';
import { bricksetJetzt, bricksetZahlen } from '../auftraege/bricksetAuftrag';
import { anfragenJeMinute, bildbedarfAnstossen } from '../katalog/bilder/bildbedarf';
import { fehlerWerfen } from '../infra/fehlerTexte';
import { pruefeBricklinkZugang } from '../../clients/bricklink';
import { ausRetryWarteschlange, pruefeBricksetZugang } from '../../clients/brickset';
import { pruefeRebrickableZugang } from '../../clients/rebrickable';
import * as verwaltungRepo from './repository/verwaltung';

// Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#job-frisch-ms
const JOB_FRISCH_MS = 3 * 60_000;

const QUELLEN: Record<string, () => Promise<void>> = {
  rebrickable: pruefeRebrickableZugang, brickset: pruefeBricksetZugang, bricklink: pruefeBricklinkZugang,
};

/** Wirft mit dem Grund. */
export async function quellePruefen(quelle: string) {
  const pruefe = Object.hasOwn(QUELLEN, quelle) ? QUELLEN[quelle] : undefined;
  if (!pruefe) fehlerWerfen('quelle_unbekannt', 400);
  try { await pruefe(); }
  catch (e) { fehlerWerfen('quelle_test_fehlgeschlagen', 400, { grund: fehlertext(e).slice(0, 200) }); }
}

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

export async function cachesLeeren(alle: boolean) {
  await verwaltung.leerePreisCache();
  if (alle) { await clearSubsetsCache(); await clearCatalogCache(); }
}

/** Ist heute noch Kontingent da, gleich abarbeiten statt bis morgen zu warten. */
export async function bricksetLimitGesetzt(alt: number, neu: number) {
  if (!(neu > alt)) return;
  const rl = await getRateLimitStatus('brickset').catch(meldeUndLiefere('verwaltung:getRateLimitStatus', null));
  const rest = rl ? Math.max(0, neu - (rl.count || 0)) : 0;
  if (rest <= 0) return;
  console.log(`[brickset] Limit erhöht ${alt}→${neu}, ${rest} Abrufe frei — Warteschlange wird abgearbeitet`);
  await bricksetJetzt();
}

export async function anleitungenNeuEinreihen() {
  const fehlend = await verwaltung.setsOhneAnleitung();
  for (const { set_number } of fehlend) {
    await loescheAnleitungen(set_number).catch(logAndContinue('verwaltung:loescheAnleitungen'));
    await anleitungEinreihen(set_number);
  }
  return fehlend.length;
}

/** Im Format von früher, damit die Oberfläche unverändert bleibt. */
export async function preisJobStand() {
  const plan = await verwaltungRepo.letzterLaufDerArt();
  let letzter: Record<string, any> = {};
  try { letzter = JSON.parse(await liesZustand('preis_job_stand') ?? '{}'); } catch (e) { meldeUndWeiter('verwaltung:preis-stand', e); }
  const laeuft = plan?.status === 'laeuft';
  const job = {
    running: laeuft, lastRun: letzter.lastRun ?? null, lastDuration: letzter.lastDuration ?? null,
    lastUpdated: letzter.lastUpdated ?? 0, lastErrors: letzter.lastErrors ?? 0,
    nextRun: plan && !laeuft ? new Date(plan.faellig_ab).toISOString() : null,
    progress: laeuft && plan?.fortschritt ? { current: plan.fortschritt.erledigt ?? 0, total: plan.fortschritt.gesamt ?? 0,
                                              set: plan.fortschritt.text ?? null } : null,
    log: Array.isArray(letzter.log) ? letzter.log : [],
  };
  return { success: true, job, rate_limit: await getRateLimitStatus('bricklink') };
}

/** false, wenn er schon läuft. */
export const preisJobJetzt = () => ziehePlanVor('preise');
export const fehlendeBilderNachladen = () => {
  stelleAuftragEin('bilder_neu_laden', {}, { schluessel: 'bilder_neu_laden', maxVersuche: 2 })
    .catch(logAndContinue('verwaltung:bilder nachladen'));
};

export const katalogAbgleichJetzt = () => ziehePlanVor('csv_sync');

export { bricksetListe } from '../auftraege/bricksetAuftrag';

/** Auch über das Tageskontingent hinweg. */
export async function bricksetWiederholen(sn: string) {
  await setzeKontingentZurueck('brickset').catch(logAndContinue('brickset:kontingent zurücksetzen'));
  await bricksetJetzt(sn);
}

export async function bricksetEntfernen(sn: string) {
  await ausRetryWarteschlange(sn).catch(logAndContinue('verwaltung:ausRetryWarteschlange'));
  await anleitungEinreihen(sn, { nurAusweichquelle: true });
}

/** Der offene geplante Auftrag bekommt sofort den neuen Termin. */
export async function jobZeitplanSetzen(name: unknown, time: unknown, minutes: unknown) {
  const daily = DAILY_JOBS.find(j => j.monitorKey === name);
  if (daily) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
    if (!m || +(m[1] ?? '') > 23 || +(m[2] ?? '') > 59) fehlerWerfen('uhrzeit_ungueltig', 400);
    await setGlobalSetting(`job_time_${daily.name}`, `${String(+(m[1] ?? '')).padStart(2, '0')}:${String(+(m[2] ?? '')).padStart(2, '0')}`);
  } else if (name === 'priceJob') {
    await setGlobalSetting('price_job_interval_minutes', String(Math.max(5, parseInt(String(minutes)) || 60)));
  } else {
    fehlerWerfen('unbekannter_job', 400);
  }
  await zeitplanNeuPlanen();
}

export async function zeitplanNeuPlanen() {
  await zeitplanGeaendert('csv_sync');
  await zeitplanGeaendert('preise');
  const bis = naechsteUhrzeit(await taeglicheUhrzeit('brickset_retry'));
  await verwaltungRepo.bricksetTermineVorziehen(bis);
}

/** Ergänzt um Zahlen, die nur die Datenbank kennt. */
export async function jobUebersicht() {
    const jobs = await monitor.all(); // aus laufzustand: der Job-Prozess schreibt, hier wird gelesen

  const [pending, done, failed] = await Promise.all([
    zaehleArt('anleitung').then(z => z.offen + z.laeuft).catch(meldeUndLiefere('verwaltung:offeneAuftraege', 0)),
    zaehleArt('anleitung').then(z => ({ c: z.erledigt })).catch(meldeUndLiefere('verwaltung:anleitungenErledigt', null)),
    zaehleArt('anleitung').then(z => ({ c: z.fehler })).catch(meldeUndLiefere('verwaltung:anleitungenGescheitert', null)),
  ]);
  const blMapped = await verwaltung.zugeordneteTeile().catch(meldeUndLiefere('verwaltung:zugeordneteTeile', null));
  const blTotal  = await verwaltung.bricklinkTeile().catch(meldeUndLiefere('verwaltung:bricklinkTeile', null));
  const rbParts  = await verwaltung.rbTeile().catch(meldeUndLiefere('verwaltung:rbTeile', null));
  const rbInvParts = await verwaltung.rbInventarTeile().catch(meldeUndLiefere('verwaltung:rbInventarTeile', null));
  const lastSync = await liesZustand('rb_csv_last_sync');

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

  const pendingC = pending ?? 0;
  const doneC    = done?.c ?? 0;
  const failedC  = failed?.c ?? 0;
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

  const bs = await bricksetZahlen().catch(meldeUndLiefere('verwaltung:bricksetZahlen', { wartend: 0, faellig: 0 }));
  const bsRetryC = bs.wartend, bsRetryDueC = bs.faellig;
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

  const [imgDlPending, imgDlDone, imgDlPendingFigs, imgDlPendingOwnFigs] = await Promise.all([
    verwaltung.teilbilderOffen().catch(meldeUndLiefere('verwaltung:teilbilderOffen', null)),
    verwaltung.teilbilderFertig().catch(meldeUndLiefere('verwaltung:teilbilderFertig', null)),
    verwaltung.setFigurenbilderOffen().catch(meldeUndLiefere('verwaltung:setFigurenbilderOffen', null)),
    // Figuren des Bestands legt derselbe Lauf lokal ab; sie gehören in die offene Menge.
    verwaltung.bestandsFigurenbilderOffen().catch(meldeUndLiefere('verwaltung:bestandsFigurenbilderOffen', null)),
  ]);
  const imgPending = parseInt(imgDlPending?.c||0) + parseInt(imgDlPendingFigs?.c||0)
                   + parseInt(imgDlPendingOwnFigs?.c||0);
  const imgDone    = parseInt(imgDlDone?.c||0);
  // Über alle Stapel summiert, gedeckelt auf die wirklich offenen Bilder: Das
  // heilt einen verwaisten Zähler nach einem Absturz.
  const imgDlJob   = await monitor.get('imgDl').catch(meldeUndLiefere('verwaltung:get', null));
  let imgActive    = await monitor.imgDlPending().catch(meldeUndLiefere('verwaltung:imgDlPending', 0));
  if (imgPending === 0 && imgActive > 0) { await monitor.imgDlReset().catch(logAndContinue('verwaltung:imgDlReset')); imgActive = 0; }
  imgActive = Math.min(imgActive, imgPending);
  const imgRunning = imgActive > 0;
  let reDl: any = null;
  try {
    const roh = await liesZustand('imgredl_status');
    if (roh) reDl = JSON.parse(roh);
  } catch (_) { reDl = null; }
  // „läuft" heisst: hat KÜRZLICH etwas getan (Zeitstempel `at` des Standes).
  const seitReDl = typeof reDl?.at === 'number' ? Date.now() - reDl.at : null;
  const reDlRunning = reDl?.running === true
    && (seitReDl === null || seitReDl < JOB_FRISCH_MS);
  const reDlSub = reDlRunning
    ? (reDl.phase === 'scanning'
        ? '↻ suche fehlende Bilder…'
        : `↻ ${reDl.done || 0}/${reDl.total || 0} fehlende neu geladen`)
    : null;
  // Katalogbilder gehören in DIESE Kachel, sonst meldete sie „alle gecacht",
  // während der Hintergrund-Job nachlädt.
  // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#get-admin-jobs-katalogoffen
  const katalogOffen = (await verwaltung.katalogBilderOffen().catch(meldeUndLiefere('verwaltung:katalogBilderOffen', null)))?.c ?? 0;
  // „läuft" heisst: hat kürzlich etwas getan — eine steckengebliebene
  // Warteschlange sähe sonst aus wie eine arbeitende.
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
  // „Bestand" benennen, sobald Katalogzahlen daneben stehen.
  const imgBaseSub = katalogSub ? `Bestand: ${bestandSub} · ${katalogSub}` : bestandSub;
  jobs.imgDl = {
    label:    '📥 Bild-Download (CDN)',
    // Auch wenn nur der Katalog-Job arbeitet, sonst stünde die Kachel auf „fertig".
    status:   (imgRunning || reDlRunning || (katalogOffen > 0 && jobLaeuft)) ? 'running'
              : (imgPending > 0 || katalogOffen > 0) ? 'idle' : 'done',
    sub:      reDlSub ? `${imgBaseSub} · ${reDlSub}` : imgBaseSub,
    // Mit Warteschlange, sonst stünde der Balken auf 100 %, während Bilder ausstehen.
    progress: imgDone,
    total:    imgDone + imgPending + katalogOffen,
    queue:    katalogOffen,
    queueLastRun: letzterLauf?.zeit || null,
    lastRun:  imgDlJob?.lastRun || null,
    canRedownload: true,
  };

  let pdfRunning = 0, pdfDone = 0;
  try {
    const pdfFiles = fs.readdirSync(PDF_JOB_DIR).filter((f: string) => f.endsWith('.json'));
    for (const f of pdfFiles) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(PDF_JOB_DIR, f), 'utf8'));
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

/** Meldet, was der Proxy davon ausliefern würde — mit und ohne Referer. */
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
                                 // Komprimiert geliefert muss der Proxy die Kopfzeile weiterreichen, sonst hält
                                 // der Browser die Bytes für ein JPEG.
                                 content_encoding: r.headers['content-encoding'] || null,
                                 transfer_encoding: r.headers['transfer-encoding'] || null,
                                 bytes, server: r.headers['server'] || null, cf_ray: r.headers['cf-ray'] || null }));
      r.on('close', () => done({ status: r.statusCode, content_type: r.headers['content-type'] || null, bytes, truncated: true }));
    });
    rq.on('error', (e: NodeJS.ErrnoException) => done({ error: e.message, code: e.code }));
    // Ein Diagnosewert, keine Meldung an den Nutzer.
    rq.setTimeout(10000, () => { rq.destroy(); done({ error: 'timeout' }); });
  });

  const results: any[] = [];
  for (const v of variants) results.push(await probe(v));

  const fsp = fs.promises, pathm = path;
  const key = crypto.createHash('sha1').update(url).digest('hex');
  const dir = pathm.join(DATA_DIR, 'img_proxy_cache');
  const cached = await fsp.stat(pathm.join(dir, key)).then((st: any) => ({ bytes: st.size })).catch(ohneFehlendeDatei('verwaltung:stat', null));
  const thumb  = await fsp.stat(pathm.join(dir, key + '_thumb.jpg')).then((st: any) => ({ bytes: st.size })).catch(ohneFehlendeDatei('verwaltung:stat', null));

  // Zeigt auf einen Blick, woran Abrufe scheitern, ohne im Log zu suchen.
  const failures = imgProxyFailures;
  // Durch dieselbe Kette wie der Proxy, aber die ersten Bytes kommen als Hex hierher.
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

/** Mit `live` auch die Antwort von BrickLink. */
export async function preisProbe(uid: number, setNumber: string, live: boolean) {
  const [setRow, acqs, cacheRows, histRows, currRow, ttlRow] = await Promise.all([
    verwaltung.probeSet(uid, setNumber),
    verwaltung.probeErfassungen(uid, setNumber),
    verwaltung.probePreisCache(setNumber),
    verwaltung.probePreisVerlauf(setNumber),
    verwaltung.probeWaehrung(uid).catch(meldeUndLiefere('verwaltung:probeWaehrung', null)),
    getGlobalSetting('price_cache_ttl'),
  ]);

  // Dieselbe Regel wie conditionFromAcquisitions(): Eine gebrauchte Erfassung genügt.
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

  // Dieselbe Währung wie die Bewertung, sonst zeigte die Probe andere Cache-Zeilen.
  out.currency = await getSetting(uid, 'currency', 'EUR');
  // „BrickLink kennt das Set nicht": Steht sie, liefert fetchPrice still 0.
  const katalog = await katalogEintrag(setNumber);
  out.katalog = katalog ? { ...katalog, gilt_als_unbekannt: ohneBricklinkPreis(katalog) } : null;
  // Genau der Aufruf, den Finanzen macht.
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

/** Fertig ist ein Set mit Original UND Vorschau; zurückgenommene Fehlanzeigen
 * werden mitgezählt. */
export async function katalogBilderEinreihen(alleErneut: boolean) {
    const zuVergessen = await (alleErneut
      ? verwaltung.setFehlanzeigen()
      : verwaltung.setFehlanzeigenOhne404()
    ).catch(meldeUndLiefere('verwaltung:zuVergessen', []));
    const verworfen = zuVergessen.length
      ? await vergissFehlend(zuVergessen.map(r => r.cache_key))
      : 0;
    // Was schon fertig ist, wird nicht wieder eingereiht.
    // Ausführlich: docs/begruendungen/routes/api_v1/admin.ts.md#post-admin-catalog-images-fs
        let vorhanden: Set<string> = new Set();
    try {
      const namen = new Set<string>(fs.readdirSync(SET_IMAGES_DIR));
      // Fehlt die Vorschau, bleibt das Set in der Warteschlange; der Job lädt dann
      // nicht erneut.
      for (const n of namen) {
        if (!n.endsWith('_thumb.jpg')) continue;
        const basis = n.slice(0, -'_thumb.jpg'.length);
        if (namen.has(`${basis}.jpg`)) vorhanden.add(basis);
      }
    } catch (_) { /* Ordner noch leer — dann ist nichts fertig */ }

    const kandidaten = await verwaltung.katalogBildKandidaten();

    // Dieselbe Namensregel wie downloadSetImage(), sonst fände der Vergleich nichts.
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
      await bildbedarfAnstossen();
    }
    const offen = await verwaltung.offeneBildauftraege();
    // „Stunden oder Tage?" ist die erste Frage; die Rate kommt aus dem Job selbst.
    const proMinute = anfragenJeMinute();
    return {
      success: true,
      queued:  neuEingereiht,
      pending: offen?.n ?? 0,
      skipped: kandidaten.length - offenUrls.length,
      // Ohne die Zahl bliebe unklar, warum als fehlend geltende Bilder wieder anstehen.
      verworfen,
      dauer_minuten: Math.ceil((offen?.n ?? 0) / proMinute),
    };
}
export { KontoBildzeile, bildZeilenDerKonten, fehlanzeigeDerVorschau, fehlanzeigeDesSets, katalogBild, protokollSeit, setFehlanzeigen, vorschauFehlanzeigen } from './repository/verwaltung';
export { letzteEintraege, protokolliere } from './repository/protokoll';
