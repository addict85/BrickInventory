/** As a job in the job process: a restart loses nothing, and a
 * failed import of parts or figures is retried. The
 * enrichments afterwards report their error without making the job fail. */
import { checkAbort, type JobRun } from '../jobQueue';
import { versuche } from '../infra/result';
import { setSupplement, type ReworkKind } from './addSet';
import { importMinifigs, importParts } from './setContentImport';
import type { SetsContext } from './context';

async function pullAfter(
  sk: SetsContext,
  setNumber: string,
  userId: number,
  kindWish: ReworkKind,
  lauf?: JobRun,
): Promise<void> {
  // Every kind: setErfassen() fetches nothing from the network, catalog and estimated price come from here.
  // If the catalog fails, the job tries again.
  await setSupplement(sk, setNumber, userId, null, kindWish !== 'csv');
  checkAbort(lauf);
  const art = kindWish === 'ergaenzen' ? 'neu' : kindWish;
  // A failed step does not hold up the others, but it is recorded in the job's state.
  const ohne: string[] = [];
  const schritt = async (name: string, work: () => Promise<unknown>) => {
    if (!(await versuche(`nacharbeit:${name} ${setNumber}`, work)).ok) ohne.push(name);
  };
  // The figures in every branch: the import keeps the storage location of existing
  // figures, and that way a second capture catches up on what failed the first time.
  await importMinifigs(sk, setNumber, userId);
  await importParts(sk, setNumber, userId);
  checkAbort(lauf);

  if (art === 'zweit') await schritt('bl-nummern', () => sk.catalog.reloadBlNumbers(lauf));
  if (art === 'neu') {
    await schritt('preis', () => sk.finances.preisFuerSetHolen(setNumber, userId));
    await schritt('anleitung', () => sk.catalog.loadSetInstructions(setNumber));
  } else {
    await schritt('anleitung-einreihen', () => sk.catalog.anleitungEinreihen(setNumber));
  }
  checkAbort(lauf);
  await schritt('teile-anreichern', () => sk.catalog.enrichSetPartsAn(setNumber));
  await schritt('figuren-anreichern', () => sk.catalog.enrichSetMinifigsAn(setNumber));
  // Brickset only fills gaps; the CSV import does not ask it when creating.
  if (art === 'csv') await schritt('brickset', () => sk.catalog.fillFromBrickset(setNumber));
  checkAbort(lauf);
  await schritt('bilder', () => sk.catalog.loadSetImages(setNumber));
  if (ohne.length) await lauf?.fortschritt?.({ text: `ohne ${ohne.join(', ')}`, ohne });
}

async function loadSetImages(k: SetsContext, setNumber: string, lauf?: JobRun): Promise<void> {
  await k.catalog.loadSetImages(setNumber);
  checkAbort(lauf);
  await k.catalog.enrichSetMinifigsAn(setNumber);
}

export { pullAfter, loadSetImages };
