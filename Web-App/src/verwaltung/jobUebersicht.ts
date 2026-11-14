/** Die Kacheln der Überwachungsseite: Stand je Hintergrundauftrag und Zeitplan. */
import fs from 'node:fs';
import path from 'node:path';
import { DAILY_JOBS } from '../auftraege';
import { PDF_JOB_DIR } from '../infra/appPaths';
import { meldeFehler, logAndContinue } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import type { VerwaltungKontext } from './kontext';

// Eine Frist für beide Kacheln; drei Minuten bei einem Takt von zwanzig Sekunden.
const JOB_FRISCH_MS = 3 * 60_000;

type Kachel = Record<string, unknown>;

/** Der Untertitel als Codes: Die Kachel entsteht ohne Anfrage, die Oberfläche übersetzt. `sub` bleibt für die App. */
type SubTeil = { code: string; werte?: Record<string, number | string>; vor?: 'bestand' };

const teil = (code: string, werte?: Record<string, number | string>): SubTeil => (werte ? { code, werte } : { code });

type Kacheln = Record<string, Kachel>;

const zahl = (ab: Abstriche, p: Promise<number>, ort: string) => ab.oder(ort, p, 0);

/** Ein JSON-Stand aus laufzustand; ein beschädigter zählt wie keiner. */
async function liesStand<T>(k: VerwaltungKontext, ab: Abstriche, schluessel: string): Promise<T | null> {
  const roh = await ab.oder(schluessel, k.auftraege.liesZustand(schluessel), null);
  try {
    return roh ? (JSON.parse(roh) as T) : null;
  } catch {
    return null;
  }
}

function blIdsKachel(alt: Kachel, gemappt: number, gesamt: number): Kachel | null {
  if (gesamt <= 0) return null;
  return {
    ...alt,
    status: gemappt < gesamt ? (alt.status === 'running' ? 'running' : 'idle') : 'done',
    progress: gemappt,
    total: gesamt,
    sub: gemappt < gesamt ? `${gemappt} / ${gesamt} gemappt` : `Alle ${gesamt} gemappt`,
    sub_teile: [gemappt < gesamt ? teil('teil_gemappt', { n: gemappt, gesamt }) : teil('all_mapped', { n: gesamt })],
  };
}

/** Einmal gezählt: offen, erledigt und gescheitert aus derselben Abfrage. */
async function anleitungsAuftraege(k: VerwaltungKontext, ab: Abstriche) {
  const z = await ab.oder('anleitungen', k.auftraege.zaehleArt('anleitung'), null);
  return { offen: z ? z.offen + z.laeuft : 0, erledigt: z?.erledigt ?? 0, fehler: z?.fehler ?? 0 };
}

function anleitungsKachel(alt: Kachel, a: { offen: number; erledigt: number; fehler: number }): Kachel | null {
  const gesamt = a.offen + a.erledigt + a.fehler;
  if (gesamt <= 0) return null;
  return {
    ...alt,
    status: a.offen > 0 ? 'running' : 'done',
    progress: a.erledigt,
    total: gesamt,
    sub: a.offen > 0 ? `${a.offen} ausstehend` : 'Alle erledigt',
    sub_teile: [a.offen > 0 ? teil('ausstehend', { n: a.offen }) : teil('all_done')],
  };
}

async function bricksetKachel(k: VerwaltungKontext, ab: Abstriche): Promise<Kachel> {
  const { wartend, faellig } = await ab.oder('brickset', k.auftraege.bricksetZahlen(), { wartend: 0, faellig: 0 });
  return {
    label: 'Brickset Retry Queue',
    status: wartend === 0 ? 'done' : 'idle',
    progress: 0,
    total: wartend,
    lastRun: null,
    sub:
      wartend === 0
        ? 'Keine ausstehenden Einträge'
        : faellig > 0
          ? `${faellig} Sets bereit zum Retry, ${wartend - faellig} warten`
          : `${wartend} Sets warten auf morgen`,
    sub_teile: [
      wartend === 0
        ? teil('keine_ausstehenden')
        : faellig > 0
          ? teil('retry_ready', { n: faellig, w: wartend - faellig })
          : teil('warten_morgen', { n: wartend }),
    ],
  };
}

/** „läuft" heisst: hat KÜRZLICH etwas getan (Zeitstempel des Standes). */
const frisch = (zeit: unknown) => typeof zeit === 'number' && Date.now() - zeit < JOB_FRISCH_MS;

/** Bestand, Neuladen und Katalog in EINER Kachel, sonst meldete sie „alle gecacht",
 * während der Hintergrund-Job nachlädt. */
async function bildKachel(k: VerwaltungKontext, ab: Abstriche): Promise<Kachel> {
  const [teileOffen, fertig, setFiguren, bestandsFiguren, katalogOffen] = await Promise.all([
    zahl(ab, k.verwaltung.teilbilderOffen(), 'bilder'),
    zahl(ab, k.verwaltung.teilbilderFertig(), 'bilder'),
    zahl(ab, k.verwaltung.setFigurenbilderOffen(), 'bilder'),
    // Figuren des Bestands legt derselbe Lauf lokal ab; sie gehören in die offene Menge.
    zahl(ab, k.verwaltung.bestandsFigurenbilderOffen(), 'bilder'),
    zahl(ab, k.verwaltung.katalogBilderOffen(), 'bilder'),
  ]);
  const offen = teileOffen + setFiguren + bestandsFiguren;
  const job = await ab.oder('bilder', k.auftraege.kachel('imgDl'), null);
  // Gedeckelt auf die wirklich offenen Bilder: Das heilt einen verwaisten Zähler nach einem Absturz.
  let aktiv = await ab.oder('bilder', k.auftraege.imgDlPending(), 0);
  if (offen === 0 && aktiv > 0) {
    await k.auftraege.imgDlReset().catch(logAndContinue('verwaltung:imgDlReset'));
    aktiv = 0;
  }
  aktiv = Math.min(aktiv, offen);
  const reDl = await liesStand<{ running?: boolean; at?: number; phase?: string; done?: number; total?: number }>(
    k,
    ab,
    'imgredl_status',
  );
  const reDlLaeuft = reDl?.running === true && (typeof reDl.at !== 'number' || frisch(reDl.at));
  const reDlSub = !reDlLaeuft
    ? null
    : reDl?.phase === 'scanning'
      ? '↻ suche fehlende Bilder…'
      : `↻ ${reDl?.done || 0}/${reDl?.total || 0} fehlende neu geladen`;
  // „läuft“ heisst: hat kürzlich etwas getan, laut Datenbank.
  const letzterLauf = await liesStand<{ zeit?: number }>(k, ab, 'imgqueue_last_run');
  const seitLauf = letzterLauf?.zeit ? Date.now() - letzterLauf.zeit : null;
  const jobLaeuft = frisch(letzterLauf?.zeit);
  const katalogSub =
    katalogOffen > 0
      ? `${katalogOffen} Katalog-Bilder in Warteschlange` +
        (jobLaeuft
          ? ''
          : seitLauf === null
            ? ' · Job noch nicht gelaufen'
            : ` · seit ${Math.round(seitLauf / 60_000)} min kein Durchgang`)
      : null;
  const bestandSub =
    aktiv > 0
      ? `${aktiv} Bilder werden geladen`
      : offen > 0
        ? `${offen} Bilder noch nicht gecacht`
        : `Alle ${fertig} Bilder gecacht`;
  const basisSub = katalogSub ? `Bestand: ${bestandSub} · ${katalogSub}` : bestandSub;
  const teile: SubTeil[] = [
    {
      ...(aktiv > 0
        ? teil('bilder_laden', { n: aktiv })
        : offen > 0
          ? teil('bilder_offen', { n: offen })
          : teil('imgs_cached', { n: fertig })),
      ...(katalogOffen > 0 ? { vor: 'bestand' as const } : {}),
    },
  ];
  if (katalogOffen > 0) {
    teile.push(teil('katalog_warteschlange', { n: katalogOffen }));
    if (!jobLaeuft)
      teile.push(seitLauf === null ? teil('job_nie') : teil('kein_durchgang', { min: Math.round(seitLauf / 60_000) }));
  }
  if (reDlLaeuft)
    teile.push(
      reDl?.phase === 'scanning'
        ? teil('neu_suche')
        : teil('neu_geladen', { n: reDl?.done || 0, gesamt: reDl?.total || 0 }),
    );
  return {
    label: '📥 Bild-Download (CDN)',
    status:
      aktiv > 0 || reDlLaeuft || (katalogOffen > 0 && jobLaeuft)
        ? 'running'
        : offen > 0 || katalogOffen > 0
          ? 'idle'
          : 'done',
    sub: reDlSub ? `${basisSub} · ${reDlSub}` : basisSub,
    sub_teile: teile,
    // Mit Warteschlange, sonst stünde der Balken auf 100 %, während Bilder ausstehen.
    progress: fertig,
    total: fertig + offen + katalogOffen,
    queue: katalogOffen,
    queueLastRun: letzterLauf?.zeit || null,
    lastRun: job?.lastRun || null,
    canRedownload: true,
  };
}

function pdfKachel(): Kachel {
  let laufend = 0,
    fertig = 0;
  try {
    for (const f of fs.readdirSync(PDF_JOB_DIR).filter((f: string) => f.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(PDF_JOB_DIR, f), 'utf8')) as { status?: string };
        if (j.status === 'running') laufend++;
        else if (j.status === 'done') fertig++;
      } catch (e) {
        meldeFehler('admin:pdf-auftrag-lesen', e);
      }
    }
  } catch (e) {
    meldeFehler('admin:auftragsordner-lesen', e);
  }
  return {
    label: '📄 PDF-Jobs',
    status: laufend > 0 ? 'running' : fertig > 0 ? 'idle' : 'done',
    progress: 0,
    total: 0,
    lastRun: null,
    sub:
      laufend > 0
        ? `${laufend} PDF(s) werden erstellt`
        : fertig > 0
          ? `${fertig} PDF(s) bereit zum Download`
          : 'Keine aktiven Jobs',
    sub_teile: [
      laufend > 0
        ? teil('pdf_laufend', { n: laufend })
        : fertig > 0
          ? teil('pdf_bereit', { n: fertig })
          : teil('no_active'),
    ],
  };
}

async function zeitplaene(
  k: VerwaltungKontext,
): Promise<Record<string, { type: string; time?: string; minutes?: number }>> {
  const aus: Record<string, { type: string; time?: string; minutes?: number }> = {};
  for (const dj of DAILY_JOBS)
    aus[dj.monitorKey] = {
      type: 'daily',
      time: (await k.einstellungen.getGlobalSetting(`job_time_${dj.name}`)) || dj.default,
    };
  aus.priceJob = {
    type: 'interval',
    minutes: parseInt((await k.einstellungen.getGlobalSetting('price_job_interval_minutes')) || '60', 10),
  };
  return aus;
}

/** Ergänzt um Zahlen, die nur die Datenbank kennt; je Kachel eine Funktion. */
export async function jobUebersicht(k: VerwaltungKontext) {
  const jobs: Kacheln = await k.auftraege.kacheln(); // aus laufzustand: der Job-Prozess schreibt, hier wird gelesen
  const ab = new Abstriche();
  const [anleitungen, gemappt, blGesamt, rbTeile, rbInventar, lastSync] = await Promise.all([
    anleitungsAuftraege(k, ab),
    zahl(ab, k.verwaltung.zugeordneteTeile(), 'bl_zuordnung'),
    zahl(ab, k.verwaltung.bricklinkTeile(), 'bl_zuordnung'),
    zahl(ab, k.verwaltung.rbTeile(), 'katalog'),
    zahl(ab, k.verwaltung.rbInventarTeile(), 'katalog'),
    k.auftraege.liesZustand('rb_csv_last_sync'),
  ]);
  const blIds = blIdsKachel(jobs.blIds ?? {}, gemappt, blGesamt);
  if (blIds) jobs.blIds = blIds;
  const anleitung = anleitungsKachel(jobs.instrQueue ?? {}, anleitungen);
  if (anleitung) jobs.instrQueue = anleitung;
  [jobs.bricksetRetry, jobs.imgDl] = await Promise.all([bricksetKachel(k, ab), bildKachel(k, ab)]);
  jobs.pdfJobs = pdfKachel();
  return {
    jobs,
    schedules: await zeitplaene(k),
    db: {
      instrQueue: { pending: anleitungen.offen, done: anleitungen.erledigt, failed: anleitungen.fehler },
      blMapping: { mapped: gemappt, total: blGesamt },
      csvCache: { parts: rbTeile, inventoryParts: rbInventar, lastSync: lastSync || null },
    },
    ...ab.angabe(),
  };
}
