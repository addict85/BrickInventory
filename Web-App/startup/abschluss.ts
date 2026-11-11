/** Was beim Herunterfahren vor dem Schliessen des Pools endet, für Web- und
 * Job-Rolle gleich: Puffer im Speicher brauchen zum Schreiben noch eine
 * Verbindung. Das Protokoll zuletzt, damit es die Meldungen davor noch schreibt. */
import * as pgNotify from '../db/pgNotify';
import { stoppeBildbedarf } from '../src/katalog/bilder/bildbedarfLauf';
import { stoppeFehlanzeige } from '../src/katalog/bilder/imageMisses';
import { stoppeProtokoll } from '../src/infra/protokoll';
import { logAndContinue } from '../src/infra/fehler';

export async function schliessePufferUndTakte(): Promise<void> {
  await stoppeBildbedarf().catch(logAndContinue('shutdown:bildbedarf'));
  await stoppeFehlanzeige().catch(logAndContinue('shutdown:bild-fehlanzeige'));
  await pgNotify.close().catch(logAndContinue('server:close'));
  await stoppeProtokoll();
}
