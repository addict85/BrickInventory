/** Die Kacheln der Überwachungsseite: Stand je Hintergrundauftrag und Zeitplan. */
import fs from 'node:fs';
import path from 'node:path';
import { DAILY_JOBS } from './timesOfDay';
import { imgDlPending, imgDlReset, tile, tiles } from './tiles';
import { PDF_JOB_DIR } from '../infra/appPaths';
import { meldeFehler } from '../infra/fehler';
import { Abstriche } from '../infra/ergebnis';
import type { ManagementContext } from './context';

// Eine Frist für beide Kacheln; drei Minuten bei einem Takt von zwanzig Sekunden.
const JOB_FRISCH_MS = 3 * 60_000;

type Tile = Record<string, unknown>;

/** Der Untertitel als Codes: Die Kachel entsteht ohne Anfrage, die Oberfläche übersetzt. `sub` bleibt für die App. */
type SubPart = { code: string; werte?: Record<string, number | string>; vor?: 'bestand' };

const part = (code: string, werte?: Record<string, number | string>): SubPart => (werte ? { code, werte } : { code });

type Tiles = Record<string, Tile>;

const count = (ab: Abstriche, p: Promise<number>, ort: string) => ab.oder(ort, p, 0);

/** Ein JSON-Stand aus laufzustand; ein beschädigter zählt wie keiner. */
async function readState<T>(k: ManagementContext, ab: Abstriche, schluessel: string): Promise<T | null> {
  const roh = await ab.oder(schluessel, k.auftraege.liesZustand(schluessel), null);
  try {
    return roh ? (JSON.parse(roh) as T) : null;
  } catch {
    return null;
  }
}

function blIdsTile(alt: Tile, gemappt: number, gesamt: number): Tile | null {
  if (gesamt <= 0) return null;
  return {
    ...alt,
    status: gemappt < gesamt ? (alt.status === 'running' ? 'running' : 'idle') : 'done',
    progress: gemappt,
    total: gesamt,
    sub: gemappt < gesamt ? `${gemappt} / ${gesamt} gemappt` : `Alle ${gesamt} gemappt`,
    sub_teile: [gemappt < gesamt ? part('teil_gemappt', { n: gemappt, gesamt }) : part('all_mapped', { n: gesamt })],
  };
}

/** Einmal gezählt: offen, erledigt und gescheitert aus derselben Abfrage. */
async function instructionJobs(k: ManagementContext, ab: Abstriche) {
  const z = await ab.oder('anleitungen', k.auftraege.zaehleArt('anleitung'), null);
  return { offen: z ? z.offen + z.laeuft : 0, erledigt: z?.erledigt ?? 0, fehler: z?.fehler ?? 0 };
}

function instructionsTile(alt: Tile, a: { offen: number; erledigt: number; fehler: number }): Tile | null {
  const gesamt = a.offen + a.erledigt + a.fehler;
  if (gesamt <= 0) return null;
  return {
    ...alt,
    status: a.offen > 0 ? 'running' : 'done',
    progress: a.erledigt,
    total: gesamt,
    sub: a.offen > 0 ? `${a.offen} ausstehend` : 'Alle erledigt',
    sub_teile: [a.offen > 0 ? part('ausstehend', { n: a.offen }) : part('all_done')],
  };
}

async function bricksetTile(k: ManagementContext, ab: Abstriche): Promise<Tile> {
  const { wartend, faellig } = await ab.oder('brickset', k.fremdquellen.brickset.zahlen(), { wartend: 0, faellig: 0 });
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
        ? part('keine_ausstehenden')
        : faellig > 0
          ? part('retry_ready', { n: faellig, w: wartend - faellig })
          : part('warten_morgen', { n: wartend }),
    ],
  };
}

/** „läuft" heisst: hat KÜRZLICH etwas getan (Zeitstempel des Standes). */
const isFresh = (k: ManagementContext, zeit: unknown) =>
  typeof zeit === 'number' && k.uhr.jetzt() - zeit < JOB_FRISCH_MS;

/** Bestand, Neuladen und Katalog in EINER Kachel, sonst meldete sie „alle gecacht",
 * während der Hintergrund-Job nachlädt. */
/** Gedeckelt auf die wirklich offenen Bilder: Das heilt einen verwaisten Zähler nach einem Absturz. */
async function imagesInProgress(k: ManagementContext, ab: Abstriche, offen: number): Promise<number> {
  const aktiv = await ab.oder('bilder', imgDlPending(k), 0);
  if (offen === 0 && aktiv > 0) {
    await imgDlReset(k);
    return 0;
  }
  return Math.min(aktiv, offen);
}

async function redownloadState(k: ManagementContext, ab: Abstriche) {
  const reDl = await readState<{ running?: boolean; at?: number; phase?: string; done?: number; total?: number }>(
    k,
    ab,
    'imgredl_status',
  );
  const laeuft = reDl?.running === true && (typeof reDl.at !== 'number' || isFresh(k, reDl.at));
  const sub = !laeuft
    ? null
    : reDl?.phase === 'scanning'
      ? '↻ suche fehlende Bilder…'
      : `↻ ${reDl?.done || 0}/${reDl?.total || 0} fehlende neu geladen`;
  return { reDl, laeuft, sub };
}

async function imageTile(k: ManagementContext, ab: Abstriche): Promise<Tile> {
  const [teileOffen, fertig, setFiguren, bestandsFiguren, katalogOffen] = await Promise.all([
    count(ab, k.management.partImagesOpen(), 'bilder'),
    count(ab, k.management.partImagesDone(), 'bilder'),
    count(ab, k.management.setMinifigImagesOpen(), 'bilder'),
    // Figuren des Bestands legt derselbe Lauf lokal ab; sie gehören in die offene Menge.
    count(ab, k.management.holdingMinifigImagesOpen(), 'bilder'),
    count(ab, k.management.catalogImagesOpen(), 'bilder'),
  ]);
  const offen = teileOffen + setFiguren + bestandsFiguren;
  const job = await ab.oder('bilder', tile(k, 'imgDl'), null);
  const aktiv = await imagesInProgress(k, ab, offen);
  const { reDl, laeuft: reDlLaeuft, sub: reDlSub } = await redownloadState(k, ab);
  // „läuft“ heisst: hat kürzlich etwas getan, laut Datenbank.
  const letzterLauf = await readState<{ zeit?: number }>(k, ab, 'imgqueue_last_run');
  const seitLauf = letzterLauf?.zeit ? k.uhr.jetzt() - letzterLauf.zeit : null;
  const jobLaeuft = isFresh(k, letzterLauf?.zeit);
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
  const teile: SubPart[] = [
    {
      ...(aktiv > 0
        ? part('bilder_laden', { n: aktiv })
        : offen > 0
          ? part('bilder_offen', { n: offen })
          : part('imgs_cached', { n: fertig })),
      ...(katalogOffen > 0 ? { vor: 'bestand' as const } : {}),
    },
  ];
  if (katalogOffen > 0) {
    teile.push(part('katalog_warteschlange', { n: katalogOffen }));
    if (!jobLaeuft)
      teile.push(seitLauf === null ? part('job_nie') : part('kein_durchgang', { min: Math.round(seitLauf / 60_000) }));
  }
  if (reDlLaeuft)
    teile.push(
      reDl?.phase === 'scanning'
        ? part('neu_suche')
        : part('neu_geladen', { n: reDl?.done || 0, gesamt: reDl?.total || 0 }),
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

function pdfTile(): Tile {
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
        ? part('pdf_laufend', { n: laufend })
        : fertig > 0
          ? part('pdf_bereit', { n: fertig })
          : part('no_active'),
    ],
  };
}

async function zeitplaene(
  k: ManagementContext,
): Promise<Record<string, { type: string; time?: string; minutes?: number }>> {
  const aus: Record<string, { type: string; time?: string; minutes?: number }> = {};
  for (const dj of DAILY_JOBS)
    aus[dj.monitorKey] = {
      type: 'daily',
      time: (await k.settings.globalValue(`job_time_${dj.name}`)) || dj.default,
    };
  aus.priceJob = {
    type: 'interval',
    minutes: parseInt((await k.settings.globalValue('price_job_interval_minutes')) || '60', 10),
  };
  return aus;
}

/** Ergänzt um Zahlen, die nur die Datenbank kennt; je Kachel eine Funktion. */
export async function jobMonitor(k: ManagementContext) {
  const jobs: Tiles = await tiles(k); // aus laufzustand: der Job-Prozess schreibt, hier wird gelesen
  const ab = new Abstriche();
  const [anleitungen, gemappt, blGesamt, rbParts, rbInventory, lastSync] = await Promise.all([
    instructionJobs(k, ab),
    count(ab, k.management.mappedParts(), 'bl_mapping'),
    count(ab, k.management.bricklinkParts(), 'bl_mapping'),
    count(ab, k.management.rbParts(), 'katalog'),
    count(ab, k.management.rbInventoryParts(), 'katalog'),
    k.auftraege.liesZustand('rb_csv_last_sync'),
  ]);
  const blIds = blIdsTile(jobs.blIds ?? {}, gemappt, blGesamt);
  if (blIds) jobs.blIds = blIds;
  const anleitung = instructionsTile(jobs.instrQueue ?? {}, anleitungen);
  if (anleitung) jobs.instrQueue = anleitung;
  [jobs.bricksetRetry, jobs.imgDl] = await Promise.all([bricksetTile(k, ab), imageTile(k, ab)]);
  jobs.pdfJobs = pdfTile();
  return {
    jobs,
    schedules: await zeitplaene(k),
    db: {
      instrQueue: { pending: anleitungen.offen, done: anleitungen.erledigt, failed: anleitungen.fehler },
      blMapping: { mapped: gemappt, total: blGesamt },
      csvCache: { parts: rbParts, inventoryParts: rbInventory, lastSync: lastSync || null },
    },
    ...ab.angabe(),
  };
}
