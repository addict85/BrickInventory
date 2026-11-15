/** Was beim Herunterfahren vor dem Schliessen des Pools endet, für Web- und
 * Job-Rolle gleich: Puffer im Speicher brauchen zum Schreiben noch eine
 * Verbindung. Das Protokoll zuletzt, damit es die Meldungen davor noch schreibt. */
import type { Db } from '../db/database';
import type { Dienste } from './verdrahtung';
import { stoppeProtokoll } from '../src/infra/protokoll';
import { logAndContinue } from '../src/infra/fehler';

export async function schliessePufferUndTakte(zugang: Db, d: Dienste): Promise<void> {
  // Beide fangen ihre Schreibfehler selbst.
  await d.bilder.stoppeBildbedarf();
  await d.bilder.stoppeFehlanzeige();
  await zugang.benachrichtigung.close().catch(logAndContinue('server:close'));
  await stoppeProtokoll();
}
