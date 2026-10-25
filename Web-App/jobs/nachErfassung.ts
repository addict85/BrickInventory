/**
 * Was NACH dem Erfassen eines Sets im Hintergrund nachgezogen wird.
 * Ausführlich: docs/begruendungen/jobs/nachErfassung.ts.md#abschnitt
 */
import { importPartsForSet, fetchMissingBlIds } from '../utils/partsImport';
import { importMinifigsForSet } from '../utils/minifigsImport';
import { enqueue, requestRun } from './instructionQueue';
import { refreshPriceForSet } from './priceJob';
import { enrichSetParts, enrichSetMinifigs, downloadSetImages } from './partsCatalogEnrich';

/**
 * Teile, Minifiguren, Anleitungen und Bilder zu einem frisch erfassten Set
 * nachziehen — verzögert, damit die Antwort an den Client nicht wartet.
 *
 * Die Verzögerung ist bewusst zufällig gestreut: Beim Erfassen mehrerer Sets
 * kurz hintereinander liefen sonst alle Nachzüge gleichzeitig los und
 * erschöpften den Verbindungspool.
 */
function zieheNach(setNumber: string, userId: number): void {
  setTimeout(async () => {
    await importPartsForSet(setNumber, userId).catch(() => {});
    fetchMissingBlIds().catch(() => {});
    enqueue(setNumber).catch(() => {});
    requestRun().catch(() => {});
    await enrichSetParts(setNumber).catch(() => {});
    await enrichSetMinifigs(setNumber).catch(() => {});
    downloadSetImages(setNumber).catch(() => {});
  }, 2000 + Math.random() * 3000);
}

/**
 * Dasselbe für ein NEU angelegtes Set.
 * Ausführlich: docs/begruendungen/jobs/nachErfassung.ts.md#ziehenachneuanlage
 */
function zieheNachNeuanlage(setNumber: string, userId: number): void {
  setTimeout(async () => {
    await importMinifigsForSet(setNumber, userId).catch(() => {});
    await importPartsForSet(setNumber, userId).catch(() => {});
    // Kein Hinweis nötig: Läuft NACH recordAcquisition(), die Zeile existiert
    // bereits — conditionsNeededFor() findet den Zustand selbst.
    refreshPriceForSet(setNumber, userId).catch(() => {});
    await enrichSetParts(setNumber).catch(() => {});
    await enrichSetMinifigs(setNumber).catch(() => {});
    downloadSetImages(setNumber).catch(() => {});
  }, 2000 + Math.random() * 3000);
}

export { zieheNach, zieheNachNeuanlage };
