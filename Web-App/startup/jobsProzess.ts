import fs from 'node:fs';
import { logAndContinue, meldeFehler } from '../src/infra/fehler';
import { starteAuftragsWorker } from '../jobs/auftraegeStarten';
import { NACHLAEUFE, type Nachlauf } from '../src/verwaltung';
import type { Dienste } from './verdrahtung';

/** Der Healthcheck des Dienstes `jobs` (compose.yaml) sieht auf das Alter dieser Datei. */
export const LEBENSZEICHEN_DATEI = '/tmp/brickinventory-jobs.lebt';
/** Die Verwaltung sieht am selben Stempel in laufzustand, ob ein Job-Prozess läuft. */
export const LEBENSZEICHEN_SCHLUESSEL = 'jobs_lebenszeichen';
const LEBENSZEICHEN_MS = 30_000;
/** Dreht der Worker so lange keine Runde mehr, bleibt das Lebenszeichen aus. */
const STILL_HOECHSTENS_MS = 2 * LEBENSZEICHEN_MS;

/** Was starteJobs startet und stoppeJobs wieder beendet; der Einstieg hält es. */
export interface JobsLauf {
  worker: { letzteRunde(): number; stoppe(): Promise<void> } | null;
  lebenszeichen: NodeJS.Timeout | null;
}

/** Nur ein Worker, der seine Runden dreht, gilt als lebendig: Ein Intervall
 * allein meldete auch einen Prozess, dessen Start gescheitert ist. Das Ergebnis
 * endet mit dem Schreiben in die Datenbank, damit ein Test darauf warten kann. */
export function erneuereLebenszeichen(d: Dienste, worker: JobsLauf['worker']): Promise<void> {
  if (!worker || Date.now() - worker.letzteRunde() > STILL_HOECHSTENS_MS) return Promise.resolve();
  fs.writeFile(LEBENSZEICHEN_DATEI, String(Date.now()), { mode: 0o600 }, e => {
    if (e) meldeFehler('jobs:lebenszeichen', e);
  });
  return d.auftraege
    .setzeZustand(LEBENSZEICHEN_SCHLUESSEL, new Date().toISOString())
    .catch(logAndContinue('jobs:lebenszeichen'));
}

/**
 * Die Hintergrundarbeit dieses Prozesses (ROLLE=jobs oder beides): Alles ist
 * ein Auftrag. Beim Start bekommt jede geplante Art ihren Termin, der
 * Katalogabgleich und die ersten Läufe werden vorgezogen, und die Nachläufe
 * kommen einmal je Start dazu. Ein zweiter Job-Prozess wäre unschädlich:
 * Aufträge belegt jeder nur mit SKIP LOCKED.
 */
export async function starteJobs(d: Dienste): Promise<JobsLauf> {
  const uebernommen = await d.auftraege.meldeProzessAn();
  if (uebernommen) console.log(`[auftraege] ${uebernommen} Aufträge eines beendeten Prozesses übernommen`);
  await d.auftraege.meldeStartZustand({ ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 });
  await d.auftraege.planeAlle();
  await d.auftraege.ziehePlanVor('csv_sync', 0, { beimStart: true });
  await d.auftraege.ziehePlanVor('aufraeumen', 0);
  await d.auftraege.ziehePlanVor('preise', 30);
  await d.auftraege.ziehePlanVor('bild_nachlauf', 30);
  await d.auftraege.ziehePlanVor('aufraeumen_taeglich', 60);
  for (const [schritt, { nachSekunden }] of Object.entries(NACHLAEUFE) as [Nachlauf, { nachSekunden: number }][])
    await d.auftraege.stelleAuftragEin(
      'nachlauf',
      { schritt },
      { schluessel: `nachlauf:${schritt}`, nachSekunden, maxVersuche: 3 },
    );
  if (await d.bilder.offenerBildbedarf()) await d.bilder.bildbedarfAnstossen();
  await d.finanzen.planeKursabruf();
  const worker = starteAuftragsWorker(d);
  void erneuereLebenszeichen(d, worker);
  const lebenszeichen = setInterval(() => erneuereLebenszeichen(d, worker), LEBENSZEICHEN_MS);
  lebenszeichen.unref();
  return { worker, lebenszeichen };
}

/** Beim Herunterfahren: laufende Aufträge zu Ende führen oder zurückgeben. */
export async function stoppeJobs(d: Dienste, lauf: JobsLauf): Promise<void> {
  if (lauf.lebenszeichen) clearInterval(lauf.lebenszeichen);
  lauf.lebenszeichen = null;
  const worker = lauf.worker;
  lauf.worker = null;
  await worker?.stoppe().catch(logAndContinue('shutdown:auftraege'));
  d.auftraege.meldeProzessAb();
}
