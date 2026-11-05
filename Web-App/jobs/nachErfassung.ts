/** Als Auftrag im Job-Prozess: Ein Neustart verliert nichts, und ein
 * gescheiterter Import von Teilen oder Figuren wird wiederholt. Die
 * Anreicherungen danach melden ihren Fehler, ohne den Auftrag scheitern zu lassen. */
import { importiereTeile, fetchMissingBlIds } from '../src/katalog/partsImport';
import { importiereFiguren } from '../src/katalog/minifigsImport';
import { downloadSetInstructions } from '../src/katalog/instructions';
import { logAndContinue } from '../src/infra/fehler';
import { fuelleAusBrickset } from '../src/katalog/bildlage';
import { anleitungEinreihen } from '../src/auftraege/anleitungsAuftrag';
import { refreshPriceForSet } from './priceJob';
import { enrichSetParts, enrichSetMinifigs, downloadSetImages } from '../src/katalog/teileAnreicherung';

/** zweit: ein vorhandenes Set noch einmal erfasst; neu: angelegt; csv: aus dem CSV-Import. */
export type NacharbeitArt = 'zweit' | 'neu' | 'csv';

async function zieheNach(setNumber: string, userId: number, art: NacharbeitArt): Promise<void> {
  const melde = (schritt: string) => logAndContinue(`nacharbeit:${schritt} ${setNumber}`);
  // Die Figuren in jedem Zweig: Der Import behält den Lagerort vorhandener
  // Figuren, und so holt ein Zweiterfassen nach, was beim ersten Mal scheiterte.
  await importiereFiguren(setNumber, userId);
  await importiereTeile(setNumber, userId);

  if (art === 'zweit') fetchMissingBlIds().catch(melde('bl-nummern'));
  if (art === 'neu') {
    await refreshPriceForSet(setNumber, userId).catch(melde('preis'));
    await downloadSetInstructions(setNumber).catch(melde('anleitung'));
  } else {
    await anleitungEinreihen(setNumber).catch(melde('anleitung-einreihen'));
  }
  await enrichSetParts(setNumber).catch(melde('teile-anreichern'));
  await enrichSetMinifigs(setNumber).catch(melde('figuren-anreichern'));
  // Brickset füllt nur Lücken; der CSV-Import fragt es beim Anlegen nicht.
  if (art === 'csv') await fuelleAusBrickset(setNumber).catch(melde('brickset'));
  await downloadSetImages(setNumber).catch(melde('bilder'));
}

async function ladeSetBilder(setNumber: string): Promise<void> {
  await downloadSetImages(setNumber);
  await enrichSetMinifigs(setNumber);
}

export { zieheNach, ladeSetBilder };
