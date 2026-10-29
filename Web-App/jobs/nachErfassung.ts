/**
 * Was nach dem Erfassen eines Sets nachgezogen wird. Es läuft als Auftrag
 * (utils/auftraege.ts) im Primär-Worker: Ein Neustart verliert nichts, und
 * scheitert der Import von Teilen oder Figuren, wiederholt der Worker ihn.
 * Die Anreicherungen danach sind Beiwerk mit eigenen Kontingenten; sie melden
 * ihren Fehler und lassen den Auftrag nicht scheitern.
 */
import { importiereTeile, fetchMissingBlIds } from '../utils/partsImport';
import { importiereFiguren } from '../utils/minifigsImport';
import { downloadSetInstructions } from '../utils/instructions';
import { logAndContinue } from '../utils/httpError';
import * as db from '../db/database';
import { getSetInfo as bricksetSetInfo } from '../clients/brickset';
import { enqueue, requestRun } from './instructionQueue';
import { refreshPriceForSet } from './priceJob';
import { enrichSetParts, enrichSetMinifigs, downloadSetImages } from './partsCatalogEnrich';

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
    await enqueue(setNumber).catch(melde('anleitung-einreihen'));
    await requestRun().catch(melde('anleitung-anstossen'));
  }
  await enrichSetParts(setNumber).catch(melde('teile-anreichern'));
  await enrichSetMinifigs(setNumber).catch(melde('figuren-anreichern'));
  if (art === 'csv') await bricksetMetadaten(setNumber).catch(melde('brickset'));
  await downloadSetImages(setNumber).catch(melde('bilder'));
}

/** Brickset füllt nur Lücken im Katalog; der CSV-Import fragt es beim Anlegen nicht. */
async function bricksetMetadaten(setNumber: string): Promise<void> {
  const bs = await bricksetSetInfo(setNumber);
  if (!bs) return;
  await db.run(
    `UPDATE set_catalog SET name=COALESCE(name,$1), year=COALESCE(year,$2), theme=COALESCE(theme,$3),
            pieces=COALESCE(pieces,$4), minifigs=COALESCE(minifigs,$5) WHERE set_number=$6`,
    [bs.name, bs.year, bs.theme, bs.pieces, bs.minifigs, setNumber]);
}

/** Die Bilder eines Sets, nachdem jemand seine Teileliste angesehen hat. */
async function ladeSetBilder(setNumber: string): Promise<void> {
  await downloadSetImages(setNumber);
  await enrichSetMinifigs(setNumber);
}

export { zieheNach, ladeSetBilder };
