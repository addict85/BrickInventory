/** As a job in the job process: a restart loses nothing, and a
 * failed import of parts or figures is retried. The
 * enrichments afterwards report their error without making the job fail. */
import { checkAbort, type JobRun } from '../jobQueue';
import { attempts } from '../infra/result';
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
  const kind = kindWish === 'ergaenzen' ? 'neu' : kindWish;
  // A failed step does not hold up the others, but it is recorded in the job's state.
  const ohne: string[] = [];
  const step = async (name: string, work: () => Promise<unknown>) => {
    if (!(await attempts(`rework:${name} ${setNumber}`, work)).ok) ohne.push(name);
  };
  // The figures in every branch: the import keeps the storage location of existing
  // figures, and that way a second capture catches up on what failed the first time.
  await importMinifigs(sk, setNumber, userId);
  await importParts(sk, setNumber, userId);
  checkAbort(lauf);

  if (kind === 'zweit') await step('bl-nummern', () => sk.catalog.reloadBlNumbers(lauf));
  if (kind === 'neu') {
    await step('preis', () => sk.finances.fetchPriceForSet(setNumber, userId));
    await step('anleitung', () => sk.catalog.loadSetInstructions(setNumber));
  } else {
    await step('anleitung-einreihen', () => sk.catalog.enqueueInstruction(setNumber));
  }
  checkAbort(lauf);
  await step('teile-anreichern', () => sk.catalog.enrichSetParts(setNumber));
  await step('figuren-anreichern', () => sk.catalog.enrichSetMinifigs(setNumber));
  // Brickset only fills gaps; the CSV import does not ask it when creating.
  if (kind === 'csv') await step('brickset', () => sk.catalog.fillFromBrickset(setNumber));
  checkAbort(lauf);
  await step('bilder', () => sk.catalog.loadSetImages(setNumber));
  if (ohne.length) await lauf?.progress?.({ text: `ohne ${ohne.join(', ')}`, ohne });
}

async function loadSetImages(k: SetsContext, setNumber: string, lauf?: JobRun): Promise<void> {
  await k.catalog.loadSetImages(setNumber);
  checkAbort(lauf);
  await k.catalog.enrichSetMinifigs(setNumber);
}

export { pullAfter, loadSetImages };
