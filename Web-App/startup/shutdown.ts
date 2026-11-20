/** Was beim Herunterfahren vor dem Schliessen des Pools endet, für Web- und
 * Job-Rolle gleich: Puffer im Speicher brauchen zum Schreiben noch eine
 * Verbindung. Das Protokoll zuletzt, damit es die Meldungen davor noch schreibt. */
import type { Db } from '../db/database';
import type { Dienste } from './wiring';
import { stopLog } from '../src/infra/log';
import { logAndContinue } from '../src/infra/error';

export async function closeBufferAndTicks(zugang: Db, d: Dienste): Promise<void> {
  // Beide fangen ihre Schreibfehler selbst.
  await d.images.stopImageDemand();
  await d.images.stopNone();
  await zugang.notification.close().catch(logAndContinue('server:close'));
  await stopLog();
}
