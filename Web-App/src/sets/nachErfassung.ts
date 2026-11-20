/** Als Auftrag im Job-Prozess: Ein Neustart verliert nichts, und ein
 * gescheiterter Import von Teilen oder Figuren wird wiederholt. Die
 * Anreicherungen danach melden ihren Fehler, ohne den Auftrag scheitern zu lassen. */
import { checkAbort, type JobRun } from '../jobQueue';
import { versuche } from '../infra/ergebnis';
import { setSupplement, type ReworkKind } from './erfassen';
import { importMinifigs, importParts } from './setInhaltImport';
import type { SetsContext } from './kontext';

async function pullAfter(
  sk: SetsContext,
  setNumber: string,
  userId: number,
  kindWish: ReworkKind,
  lauf?: JobRun,
): Promise<void> {
  // Jede Art: setErfassen() holt nichts aus dem Netz, Katalog und geschätzter Preis kommen von hier.
  // Scheitert der Katalog, versucht es der Auftrag noch einmal.
  await setSupplement(sk, setNumber, userId, null, kindWish !== 'csv');
  checkAbort(lauf);
  const art = kindWish === 'ergaenzen' ? 'neu' : kindWish;
  // Ein gescheiterter Schritt hält die übrigen nicht auf, steht aber im Stand des Auftrags.
  const ohne: string[] = [];
  const schritt = async (name: string, work: () => Promise<unknown>) => {
    if (!(await versuche(`nacharbeit:${name} ${setNumber}`, work)).ok) ohne.push(name);
  };
  // Die Figuren in jedem Zweig: Der Import behält den Lagerort vorhandener
  // Figuren, und so holt ein Zweiterfassen nach, was beim ersten Mal scheiterte.
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
  // Brickset füllt nur Lücken; der CSV-Import fragt es beim Anlegen nicht.
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
