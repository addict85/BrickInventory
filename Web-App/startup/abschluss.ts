/** Was beim Herunterfahren vor dem Schliessen des Pools endet, für Web- und
 * Job-Rolle gleich: Puffer im Speicher brauchen zum Schreiben noch eine
 * Verbindung. Das Protokoll zuletzt, damit es die Meldungen davor noch schreibt. */
import type { Db } from '../db/database';
import { stoppeBildbedarf, stoppeFehlanzeige } from '../src/katalog';
import { stoppeProtokoll } from '../src/infra/protokoll';
import { logAndContinue } from '../src/infra/fehler';

export async function schliessePufferUndTakte(zugang: Db): Promise<void> {
  // Beide fangen ihre Schreibfehler selbst.
  await stoppeBildbedarf();
  await stoppeFehlanzeige();
  await zugang.benachrichtigung.close().catch(logAndContinue('server:close'));
  await stoppeProtokoll();
}
