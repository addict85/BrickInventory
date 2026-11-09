/** Fremde Dienste und Jobs erreicht die Überwachungsseite nur von hier aus,
 * damit die Routen keine Schichten überspringen. */
import { proxyCacheSchluessel, proxyCachePathFor } from '../katalog/bilder/images';
import { ERLAUBTE_BILD_HOSTS, hostErlaubt } from '../infra/fremdeAdressen';
import { urlOderNull } from '../infra/validate';
import type { KontoBildzeile } from './repository/verwaltung';
import fs from 'fs';
import { AbrufFehler, type AbrufStrom } from '../infra/abruf';
import path from 'path';
import * as verwaltung from './repository/verwaltung';
import { naechsteUhrzeit, taeglicheUhrzeit, DAILY_JOBS, ziehePlanVor, zeitplanGeaendert } from '../auftraege/zeitplan';
import { DATA_DIR, PDF_JOB_DIR, SET_IMAGES_DIR } from '../infra/appPaths';
import { fehlertext, meldeFehler, logAndContinue, meldeUndLiefere, ohneFehlendeDatei } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import { fetchPrice } from '../finanzen/financeCalc';
import { getRateLimitStatus, setzeKontingentZurueck } from '../katalog/apiKontingent';
import { ohneBricklinkPreis } from '../infra/setNummer';
import { katalogEintrag, clearCatalogCache, clearSubsetsCache, getPriceGuide, getCacheStats } from '../katalog/bricklinkPreise';
import { loescheAnleitungen } from '../katalog/instructions';
import { imgProxyFailures } from '../katalog/bilder/imgProxyStats';
import { vergissFehlend } from '../katalog/bilder/imageMisses';
import { setGlobalSetting, getGlobalSetting, getSetting } from '../einstellungen/settings';
import { liesZustand } from '../auftraege/laufzustand';
import * as monitor from '../auftraege/jobMonitor';
import { zaehleArt, stelleAuftragEin } from '../auftraege/dienst';
import { anleitungEinreihen } from '../auftraege/anleitungsAuftrag';
import { bricksetJetzt, bricksetZahlen } from '../auftraege/bricksetAuftrag';
import { anfragenJeMinute, bildbedarfAnstossen } from '../katalog/bilder/bildbedarf';
import { fachfehler, type FehlerCode } from '../infra/fehlerTexte';
import { alsAbrufFehler, pruefeBricklinkZugang, ausRetryWarteschlange, pruefeBricksetZugang, pruefeRebrickableZugang, oeffneBild } from '../katalog/quellen';

// Eine Frist für beide Kacheln; drei Minuten bei einem Takt von zwanzig Sekunden.
// Ausführlich: docs/begruendungen/src/verwaltung/dienst.ts.md#job-frisch-ms
const JOB_FRISCH_MS = 3 * 60_000;

const QUELLEN: Record<string, () => Promise<void>> = {
  rebrickable: pruefeRebrickableZugang, brickset: pruefeBricksetZugang, bricklink: pruefeBricklinkZugang,
};

const QUELLEN_NAME: Record<string, string> = { rebrickable: 'Rebrickable', brickset: 'Brickset', bricklink: 'BrickLink' };

/** Der Assistent zeigt dem Verwalter, was zu tun ist; der rohe Text bleibt als `grund` für „Details“. */
function quellenAbsage(e: unknown): FehlerCode {
  const f = alsAbrufFehler(e), text = f.message;
  if (/nicht konfiguriert|nicht vollständig|not configured/i.test(text)) return 'quelle_ohne_schluessel';
  if (f.isTransient || (e instanceof AbrufFehler && (e.grund === 'netz' || e.grund === 'zeitlimit'))
      || /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up/i.test(text)) return 'quelle_nicht_erreichbar';
  if (/\b(401|403)\b|invalid|ungültig|unauthori[sz]ed/i.test(text)) return 'quelle_abgelehnt';
  return 'quelle_test_fehlgeschlagen';
}

/** null, wenn der Zugang antwortet; sonst Code, Name und roher Grund. Wirft nur bei unbekannter Quelle. */
export async function quellePruefen(quelle: string): Promise<{ code: FehlerCode; quelle: string; grund: string } | null> {
  const pruefe = Object.hasOwn(QUELLEN, quelle) ? QUELLEN[quelle] : undefined;
  if (!pruefe) fachfehler('ungueltig', 'quelle_unbekannt');
  try { await pruefe(); return null; }
  catch (e) { return { code: quellenAbsage(e), quelle: QUELLEN_NAME[quelle] ?? quelle, grund: fehlertext(e).slice(0, 200) }; }
}

export async function cacheStatistik() {
  const leer = { count: 0, limit: 0, remaining: 0 };
  const ab = new Abstriche();
  const [stats, stale, rlBL, rlRB, rlBS] = await Promise.all([
    ab.oder('cache', getCacheStats(), { prices: 0, subsets: 0, catalog: 0 }),
    ab.oder('veraltete_preise', verwaltung.veraltetePreise(), 0),
    ab.oder('kontingent_bricklink', getRateLimitStatus('bricklink'), leer),
    ab.oder('kontingent_rebrickable', getRateLimitStatus('rebrickable'), leer),
    ab.oder('kontingent_brickset', getRateLimitStatus('brickset'), leer),
  ]);
  return { success: true, ...stats, price_stale: stale,
    rate_limits: { bricklink: rlBL, rebrickable: rlRB, brickset: rlBS }, db_pool: verwaltung.getPoolStats(), ...ab.angabe() };
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
  const plan = await verwaltung.letzterLaufDerArt();
  let letzter: Record<string, any> = {};
  try { letzter = JSON.parse(await liesZustand('preis_job_stand') ?? '{}'); } catch (e) { meldeFehler('verwaltung:preis-stand', e); }
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
  void stelleAuftragEin('bilder_neu_laden', {}, { schluessel: 'bilder_neu_laden', maxVersuche: 2 })
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
    if (!m || +(m[1] ?? '') > 23 || +(m[2] ?? '') > 59) fachfehler('ungueltig', 'uhrzeit_ungueltig');
    await setGlobalSetting(`job_time_${daily.name}`, `${String(+(m[1] ?? '')).padStart(2, '0')}:${String(+(m[2] ?? '')).padStart(2, '0')}`);
  } else if (name === 'priceJob') {
    await setGlobalSetting('price_job_interval_minutes', String(Math.max(5, parseInt(String(minutes)) || 60)));
  } else {
    fachfehler('ungueltig', 'unbekannter_job');
  }
  await zeitplanNeuPlanen();
}

export async function zeitplanNeuPlanen() {
  await zeitplanGeaendert('csv_sync');
  await zeitplanGeaendert('preise');
  const bis = naechsteUhrzeit(await taeglicheUhrzeit('brickset_retry'));
  await verwaltung.bricksetTermineVorziehen(bis);
}

type Kachel = Record<string, unknown>;
/** Der Untertitel als Codes: Die Kachel entsteht ohne Anfrage, die Oberfläche übersetzt. `sub` bleibt für die App. */
type SubTeil = { code: string; werte?: Record<string, number | string>; vor?: 'bestand' };
const teil = (code: string, werte?: Record<string, number | string>): SubTeil => (werte ? { code, werte } : { code });
type Kacheln = Record<string, Kachel>;
const zahl = (ab: Abstriche, p: Promise<number>, ort: string) => ab.oder(ort, p, 0);

/** Ein JSON-Stand aus laufzustand; ein beschädigter zählt wie keiner. */
async function liesStand<T>(ab: Abstriche, schluessel: string): Promise<T | null> {
  const roh = await ab.oder(schluessel, liesZustand(schluessel), null);
  try { return roh ? JSON.parse(roh) as T : null; } catch { return null; }
}

function blIdsKachel(alt: Kachel, gemappt: number, gesamt: number): Kachel | null {
  if (gesamt <= 0) return null;
  return { ...alt, status: gemappt < gesamt ? (alt.status === 'running' ? 'running' : 'idle') : 'done',
    progress: gemappt, total: gesamt, sub: gemappt < gesamt ? `${gemappt} / ${gesamt} gemappt` : `Alle ${gesamt} gemappt`,
    sub_teile: [gemappt < gesamt ? teil('teil_gemappt', { n: gemappt, gesamt }) : teil('all_mapped', { n: gesamt })] };
}

/** Einmal gezählt: offen, erledigt und gescheitert aus derselben Abfrage. */
async function anleitungsAuftraege(ab: Abstriche) {
  const z = await ab.oder('anleitungen', zaehleArt('anleitung'), null);
  return { offen: z ? z.offen + z.laeuft : 0, erledigt: z?.erledigt ?? 0, fehler: z?.fehler ?? 0 };
}

function anleitungsKachel(alt: Kachel, a: { offen: number; erledigt: number; fehler: number }): Kachel | null {
  const gesamt = a.offen + a.erledigt + a.fehler;
  if (gesamt <= 0) return null;
  return { ...alt, status: a.offen > 0 ? 'running' : 'done', progress: a.erledigt, total: gesamt,
    sub: a.offen > 0 ? `${a.offen} ausstehend` : 'Alle erledigt',
    sub_teile: [a.offen > 0 ? teil('ausstehend', { n: a.offen }) : teil('all_done')] };
}

async function bricksetKachel(ab: Abstriche): Promise<Kachel> {
  const { wartend, faellig } = await ab.oder('brickset', bricksetZahlen(), { wartend: 0, faellig: 0 });
  return { label: 'Brickset Retry Queue', status: wartend === 0 ? 'done' : 'idle', progress: 0, total: wartend, lastRun: null,
    sub: wartend === 0 ? 'Keine ausstehenden Einträge'
      : faellig > 0 ? `${faellig} Sets bereit zum Retry, ${wartend - faellig} warten` : `${wartend} Sets warten auf morgen`,
    sub_teile: [wartend === 0 ? teil('keine_ausstehenden') : faellig > 0 ? teil('retry_ready', { n: faellig, w: wartend - faellig })
      : teil('warten_morgen', { n: wartend })] };
}

/** „läuft" heisst: hat KÜRZLICH etwas getan (Zeitstempel des Standes). */
const frisch = (zeit: unknown) => typeof zeit === 'number' && Date.now() - zeit < JOB_FRISCH_MS;

/** Bestand, Neuladen und Katalog in EINER Kachel, sonst meldete sie „alle gecacht",
 * während der Hintergrund-Job nachlädt.
 * Ausführlich: docs/begruendungen/src/verwaltung/dienst.ts.md#get-admin-jobs-katalogoffen */
async function bildKachel(ab: Abstriche): Promise<Kachel> {
  const [teileOffen, fertig, setFiguren, bestandsFiguren, katalogOffen] = await Promise.all([
    zahl(ab, verwaltung.teilbilderOffen(), 'bilder'), zahl(ab, verwaltung.teilbilderFertig(), 'bilder'),
    zahl(ab, verwaltung.setFigurenbilderOffen(), 'bilder'),
    // Figuren des Bestands legt derselbe Lauf lokal ab; sie gehören in die offene Menge.
    zahl(ab, verwaltung.bestandsFigurenbilderOffen(), 'bilder'),
    zahl(ab, verwaltung.katalogBilderOffen(), 'bilder'),
  ]);
  const offen = teileOffen + setFiguren + bestandsFiguren;
  const job = await ab.oder('bilder', monitor.get('imgDl'), null);
  // Gedeckelt auf die wirklich offenen Bilder: Das heilt einen verwaisten Zähler nach einem Absturz.
  let aktiv = await ab.oder('bilder', monitor.imgDlPending(), 0);
  if (offen === 0 && aktiv > 0) { await monitor.imgDlReset().catch(logAndContinue('verwaltung:imgDlReset')); aktiv = 0; }
  aktiv = Math.min(aktiv, offen);
  const reDl = await liesStand<{ running?: boolean; at?: number; phase?: string; done?: number; total?: number }>(ab, 'imgredl_status');
  const reDlLaeuft = reDl?.running === true && (typeof reDl.at !== 'number' || frisch(reDl.at));
  const reDlSub = !reDlLaeuft ? null : reDl?.phase === 'scanning' ? '↻ suche fehlende Bilder…'
    : `↻ ${reDl?.done || 0}/${reDl?.total || 0} fehlende neu geladen`;
  // „läuft“ heisst: hat kürzlich etwas getan, laut Datenbank.
  // Ausführlich: docs/begruendungen/src/verwaltung/dienst.ts.md#get-admin-jobs-letzterlauf
  const letzterLauf = await liesStand<{ zeit?: number }>(ab, 'imgqueue_last_run');
  const seitLauf = letzterLauf?.zeit ? Date.now() - letzterLauf.zeit : null;
  const jobLaeuft = frisch(letzterLauf?.zeit);
  const katalogSub = katalogOffen > 0
    ? `${katalogOffen} Katalog-Bilder in Warteschlange` + (jobLaeuft ? '' : seitLauf === null ? ' · Job noch nicht gelaufen'
      : ` · seit ${Math.round(seitLauf / 60_000)} min kein Durchgang`)
    : null;
  const bestandSub = aktiv > 0 ? `${aktiv} Bilder werden geladen`
    : offen > 0 ? `${offen} Bilder noch nicht gecacht` : `Alle ${fertig} Bilder gecacht`;
  const basisSub = katalogSub ? `Bestand: ${bestandSub} · ${katalogSub}` : bestandSub;
  const teile: SubTeil[] = [{ ...(aktiv > 0 ? teil('bilder_laden', { n: aktiv }) : offen > 0 ? teil('bilder_offen', { n: offen })
    : teil('imgs_cached', { n: fertig })), ...(katalogOffen > 0 ? { vor: 'bestand' as const } : {}) }];
  if (katalogOffen > 0) {
    teile.push(teil('katalog_warteschlange', { n: katalogOffen }));
    if (!jobLaeuft) teile.push(seitLauf === null ? teil('job_nie') : teil('kein_durchgang', { min: Math.round(seitLauf / 60_000) }));
  }
  if (reDlLaeuft) teile.push(reDl?.phase === 'scanning' ? teil('neu_suche') : teil('neu_geladen', { n: reDl?.done || 0, gesamt: reDl?.total || 0 }));
  return {
    label: '📥 Bild-Download (CDN)',
    status: (aktiv > 0 || reDlLaeuft || (katalogOffen > 0 && jobLaeuft)) ? 'running' : (offen > 0 || katalogOffen > 0) ? 'idle' : 'done',
    sub: reDlSub ? `${basisSub} · ${reDlSub}` : basisSub, sub_teile: teile,
    // Mit Warteschlange, sonst stünde der Balken auf 100 %, während Bilder ausstehen.
    progress: fertig, total: fertig + offen + katalogOffen, queue: katalogOffen,
    queueLastRun: letzterLauf?.zeit || null, lastRun: job?.lastRun || null, canRedownload: true,
  };
}

function pdfKachel(): Kachel {
  let laufend = 0, fertig = 0;
  try {
    for (const f of fs.readdirSync(PDF_JOB_DIR).filter((f: string) => f.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(PDF_JOB_DIR, f), 'utf8')) as { status?: string };
        if (j.status === 'running') laufend++; else if (j.status === 'done') fertig++;
      } catch (e) { meldeFehler('admin:pdf-auftrag-lesen', e); }
    }
  } catch (e) { meldeFehler('admin:auftragsordner-lesen', e); }
  return { label: '📄 PDF-Jobs', status: laufend > 0 ? 'running' : fertig > 0 ? 'idle' : 'done', progress: 0, total: 0, lastRun: null,
    sub: laufend > 0 ? `${laufend} PDF(s) werden erstellt` : fertig > 0 ? `${fertig} PDF(s) bereit zum Download` : 'Keine aktiven Jobs',
    sub_teile: [laufend > 0 ? teil('pdf_laufend', { n: laufend }) : fertig > 0 ? teil('pdf_bereit', { n: fertig }) : teil('no_active')] };
}

async function zeitplaene(): Promise<Record<string, { type: string; time?: string; minutes?: number }>> {
  const aus: Record<string, { type: string; time?: string; minutes?: number }> = {};
  for (const dj of DAILY_JOBS)
    aus[dj.monitorKey] = { type: 'daily', time: await getGlobalSetting(`job_time_${dj.name}`) || dj.default };
  aus.priceJob = { type: 'interval', minutes: parseInt(await getGlobalSetting('price_job_interval_minutes') || '60') };
  return aus;
}

/** Ergänzt um Zahlen, die nur die Datenbank kennt; je Kachel eine Funktion. */
export async function jobUebersicht() {
  const jobs: Kacheln = await monitor.all(); // aus laufzustand: der Job-Prozess schreibt, hier wird gelesen
  const ab = new Abstriche();
  const [anleitungen, gemappt, blGesamt, rbTeile, rbInventar, lastSync] = await Promise.all([
    anleitungsAuftraege(ab),
    zahl(ab, verwaltung.zugeordneteTeile(), 'bl_zuordnung'), zahl(ab, verwaltung.bricklinkTeile(), 'bl_zuordnung'),
    zahl(ab, verwaltung.rbTeile(), 'katalog'), zahl(ab, verwaltung.rbInventarTeile(), 'katalog'),
    liesZustand('rb_csv_last_sync'),
  ]);
  const blIds = blIdsKachel(jobs.blIds ?? {}, gemappt, blGesamt);
  if (blIds) jobs.blIds = blIds;
  const anleitung = anleitungsKachel(jobs.instrQueue ?? {}, anleitungen);
  if (anleitung) jobs.instrQueue = anleitung;
  [jobs.bricksetRetry, jobs.imgDl] = await Promise.all([bricksetKachel(ab), bildKachel(ab)]);
  jobs.pdfJobs = pdfKachel();
  return {
    success: true, jobs, schedules: await zeitplaene(),
    db: {
      instrQueue: { pending: anleitungen.offen, done: anleitungen.erledigt, failed: anleitungen.fehler },
      blMapping:  { mapped: gemappt, total: blGesamt },
      csvCache:   { parts: rbTeile, inventoryParts: rbInventar, lastSync: lastSync || null },
    },
    ...ab.angabe(),
  };
}

/** Meldet, was der Proxy davon ausliefern würde — mit und ohne Referer. */
export async function bildProbe(url: string) {
  if (!/^https:\/\//.test(url)) fachfehler('ungueltig', 'url_fehlt_https');
  const adresse = urlOderNull(url);
  if (!adresse) fachfehler('ungueltig', 'url_ungueltig');
  // Dieselben Hosts wie der Bild-Proxy: Der Abruf läuft aus dem internen Netz;
  // jede Adresse zuzulassen wäre Server-Side Request Forgery.
  if (!hostErlaubt(url, ERLAUBTE_BILD_HOSTS)) fachfehler('verboten', 'host_nicht_erlaubt', { host: adresse.hostname });
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const variants = [
    { name: 'mit Referer',  headers: { 'User-Agent': UA, 'Referer': 'https://rebrickable.com/', 'Accept': 'image/*,*/*;q=0.8' } },
    { name: 'ohne Referer', headers: { 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8' } },
    { name: 'nackt',        headers: {} },
  ];

  // Ohne Umleitungen: Die Probe soll den rohen Status des CDN zeigen.
  const offen = (kopfzeilen: Record<string, string>) => oeffneBild(url,
    { maxBytes: 65536, zeitlimitMs: 10_000, umleitungen: 0, kopfzeilen });
  const lies = (a: AbrufStrom, genug = Infinity) => new Promise<{ teile: Buffer[]; bytes: number; truncated: boolean }>(fertig => {
    const teile: Buffer[] = []; let bytes = 0;
    const s = a.strom();
    s.on('data', (c: Buffer) => { teile.push(c); bytes += c.length; if (bytes >= genug) { s.destroy(); fertig({ teile, bytes, truncated: false }); } });
    s.on('end', () => fertig({ teile, bytes, truncated: false }));
    s.on('error', () => fertig({ teile, bytes, truncated: true }));
  });
  const probe = async (v: { name: string; headers: Record<string, string> }) => {
    const t0 = Date.now();
    try {
      const a = await offen(v.headers);
      const { bytes, truncated } = await lies(a);
      const k = a.kopf;
      return { variant: v.name, ms: Date.now() - t0, status: a.status, content_type: k['content-type'] || null,
               content_length: k['content-length'] || null,
               // Komprimiert geliefert muss der Proxy die Kopfzeile weiterreichen, sonst hält
               // der Browser die Bytes für ein JPEG.
               content_encoding: k['content-encoding'] || null, transfer_encoding: k['transfer-encoding'] || null,
               bytes, server: k['server'] || null, cf_ray: k['cf-ray'] || null, ...(truncated ? { truncated } : {}) };
    } catch (e) {
      return { variant: v.name, ms: Date.now() - t0, error: fehlertext(e), code: e instanceof AbrufFehler ? e.grund : undefined };
    }
  };

  const results: Awaited<ReturnType<typeof probe>>[] = [];
  for (const v of variants) results.push(await probe(v));

  const fsp = fs.promises, pathm = path;
  const key = proxyCacheSchluessel(url);
  const dir = pathm.join(DATA_DIR, 'img_proxy_cache');
  const cached = await fsp.stat(pathm.join(dir, key)).then(st => ({ bytes: st.size })).catch(ohneFehlendeDatei('verwaltung:stat', null));
  const thumb  = await fsp.stat(pathm.join(dir, key + '_thumb.jpg')).then(st => ({ bytes: st.size })).catch(ohneFehlendeDatei('verwaltung:stat', null));

  // Zeigt auf einen Blick, woran Abrufe scheitern, ohne im Log zu suchen.
  const failures = imgProxyFailures;
  // Durch dieselbe Kette wie der Proxy, aber die ersten Bytes kommen als Hex hierher.
  const head = await offen({ 'User-Agent': UA, 'Accept': 'image/*,*/*;q=0.8', 'Accept-Encoding': 'identity' })
    .then(async a => {
      const b = Buffer.concat((await lies(a, 32)).teile);
      return {
        status: a.status,
        content_encoding: a.kopf['content-encoding'] || null,
        first_bytes_hex: b.slice(0, 16).toString('hex').replace(/(..)/g, '$1 ').trim(),
        looks_like: b[0] === 0xFF && b[1] === 0xD8 ? 'JPEG'
          : b[0] === 0x89 && b[1] === 0x50 ? 'PNG'
          : b[0] === 0x1F && b[1] === 0x8B ? 'gzip (komprimiert!)'
          : b.slice(0, 5).toString().toLowerCase().startsWith('<') ? 'HTML/XML statt Bild' : 'unbekannt',
      };
    }, (e: unknown) => ({ error: fehlertext(e) }));

  return { success: true, url, cache: { original: cached, thumb }, probes: results,
           proxy_failures: failures, body_check: head };
}

/** Mit `live` auch die Antwort von BrickLink. */
export async function preisProbe(uid: number, setNumber: string, live: boolean) {
  const ab = new Abstriche();
  const [setRow, acqs, cacheRows, histRows, currRow, ttlRow] = await Promise.all([
    verwaltung.probeSet(uid, setNumber),
    verwaltung.probeErfassungen(uid, setNumber),
    verwaltung.probePreisCache(setNumber),
    verwaltung.probePreisVerlauf(setNumber),
    ab.oder('waehrung', verwaltung.probeWaehrung(uid), null),
    getGlobalSetting('price_cache_ttl'),
  ]);

  // Dieselbe Regel wie conditionFromAcquisitions(): Eine gebrauchte Erfassung genügt.
  const anyUsed = acqs.some(a => a.condition === 'U');
  const chosen = anyUsed ? 'U' : 'N';

  const out: any = {
    success: true, ...ab.angabe(),
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
    // Ausführlich: docs/begruendungen/src/verwaltung/dienst.ts.md#post-admin-catalog-images-fs
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
export { letzteEintraege, protokolliere, raeumeProtokollAuf } from '../konto/verwalterProtokoll';

/** Die wiederkehrenden Fragen zu einer leeren Kachel in einer Antwort: Datenbank, Platte, Proxy, Fehlanzeige. */
export async function bildDiagnose(sn: string) {
  const ab = new Abstriche();
  const konten: KontoBildzeile = await ab.oder('konten', verwaltung.bildZeilenDerKonten(sn), { anzahl_konten: 0, image_local: null, image_url: null });
  const katalog = await ab.oder('katalog', verwaltung.katalogBild(sn), null);

  const safe = sn.replace(/[^a-z0-9-]/gi, '_');
  const datei = async (p: string) => {
    const st = await fs.promises.stat(p).catch(ohneFehlendeDatei('verwaltung:bilddatei', null));
    return st ? { vorhanden: true, bytes: st.size, geaendert: st.mtime } : { vorhanden: false, bytes: 0, geaendert: null };
  };
  const original = await datei(path.join(SET_IMAGES_DIR, `${safe}.jpg`));
  const vorschau = await datei(path.join(SET_IMAGES_DIR, `${safe}_thumb.jpg`));

  const cdnUrl = konten.image_url || katalog?.image_url || null;
  let proxy: { gecacht: boolean; [k: string]: unknown } = { adresse: cdnUrl, gecacht: false };
  if (cdnUrl) {
    const cf = proxyCachePathFor ? proxyCachePathFor(cdnUrl) : null;
    if (cf) {
      const cache = await datei(cf);
      proxy = { adresse: cdnUrl, gecacht: cache.vorhanden, cache, vorschau: await datei(cf + '_thumb.jpg') };
    }
  }

  const merker = await ab.oder('fehlanzeige', verwaltung.fehlanzeigeDesSets(sn), null);
  const vorschauMerker = await ab.oder('fehlanzeige', verwaltung.fehlanzeigeDerVorschau(safe), null);

  // Eine Diagnose aus Ersatzwerten führte in die Irre: zuerst sagen, was nicht lesbar war.
  const hinweise: string[] = ab.teile.length ? [`Nicht lesbar, dort stehen Ersatzwerte: ${ab.teile.join(', ')}.`] : [];
  if (!konten.anzahl_konten) hinweise.push('Kein Konto führt dieses Set.');
  if (konten.anzahl_konten && !konten.image_local && !cdnUrl)
    hinweise.push('Weder lokale Datei noch CDN-Adresse bekannt — die Clients können nichts anzeigen.');
  if (konten.image_local && !original.vorhanden)
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

  return { success: true as const, set_number: sn,
    datenbank: { ...konten, katalog_bild: katalog?.image_url || null },
    lokal: { original, vorschau },
    merker: merker ? { seit: merker.checked_at, grund: merker.reason || null } : null,
    proxy, hinweise };
}
