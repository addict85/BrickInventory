import fs from 'fs';
import * as pgNotify from '../db/pgNotify';
import { HAUSHALT_KANAL, leereHaushaltCache } from '../src/haushalt/haushalt';
import { meldeStartZustand } from '../src/infra/startZustand';
import { setzeZustand } from '../src/auftraege/laufzustand';
import { logAndContinue, meldeUndWeiter } from '../src/infra/httpError';
import { stelleAuftragEin } from '../src/auftraege/auftraege';
import { planeAlle, ziehePlanVor } from '../src/auftraege/zeitplan';
import { bildbedarfAnstossen, offenerBildbedarf } from '../src/katalog/bilder/bildbedarf';
import { planeKursabruf } from '../src/finanzen/wechselkurse';
import { starteAuftragsWorker, stoppeAuftragsWorker } from '../jobs/auftraegeStarten';
import { NACHLAEUFE, type Nachlauf } from '../jobs/startNachlaeufe';

/** Der Healthcheck des Dienstes `jobs` (compose.yaml) sieht auf das Alter dieser Datei. */
export const LEBENSZEICHEN_DATEI = '/tmp/brickinventory-jobs.lebt';
/** Die Verwaltung sieht am selben Stempel in laufzustand, ob ein Job-Prozess läuft. */
export const LEBENSZEICHEN_SCHLUESSEL = 'jobs_lebenszeichen';
const LEBENSZEICHEN_MS = 30_000;
let _lebenszeichen: NodeJS.Timeout | null = null;

function schreibeLebenszeichen(): void {
  fs.writeFile(LEBENSZEICHEN_DATEI, String(Date.now()), (e) => { if (e) meldeUndWeiter('jobs:lebenszeichen', e); });
  setzeZustand(LEBENSZEICHEN_SCHLUESSEL, new Date().toISOString()).catch(logAndContinue('jobs:lebenszeichen'));
}

/**
 * Die Hintergrundarbeit dieses Prozesses (ROLLE=jobs oder beides): Alles ist
 * ein Auftrag. Beim Start bekommt jede geplante Art ihren Termin, der
 * Katalogabgleich und die ersten Läufe werden vorgezogen, und die Nachläufe
 * kommen einmal je Start dazu. Ein zweiter Job-Prozess wäre unschädlich:
 * Aufträge belegt jeder nur mit SKIP LOCKED.
 */
export async function starteJobs(beides: boolean): Promise<void> {
  schreibeLebenszeichen();
  _lebenszeichen = setInterval(schreibeLebenszeichen, LEBENSZEICHEN_MS);
  _lebenszeichen.unref();
  // Nur ein getrennter Job-Prozess hält eigene Haushalt-Caches, die der Web-Prozess ändert.
  if (!beides) pgNotify.listen(HAUSHALT_KANAL, () => leereHaushaltCache());

  await meldeStartZustand({ ready: false, step: 'CSV wird geladen...', progress: 0, total: 6 });
  await planeAlle();
  await ziehePlanVor('csv_sync', 0, { beimStart: true });
  await ziehePlanVor('aufraeumen', 0);
  await ziehePlanVor('preise', 30);
  await ziehePlanVor('bild_nachlauf', 30);
  await ziehePlanVor('aufraeumen_taeglich', 60);
  for (const [schritt, { nachSekunden }] of Object.entries(NACHLAEUFE) as [Nachlauf, { nachSekunden: number }][])
    await stelleAuftragEin('nachlauf', { schritt }, { schluessel: `nachlauf:${schritt}`, nachSekunden, maxVersuche: 3 });
  if (await offenerBildbedarf()) await bildbedarfAnstossen();
  await planeKursabruf();
  starteAuftragsWorker();
}

/** Beim Herunterfahren: laufende Aufträge zu Ende führen oder zurückgeben. */
export async function stoppeJobs(): Promise<void> {
  if (_lebenszeichen) clearInterval(_lebenszeichen);
  _lebenszeichen = null;
  await stoppeAuftragsWorker().catch(logAndContinue('shutdown:auftraege'));
}
