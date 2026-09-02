/**
 * Was NACH dem Erfassen eines Sets im Hintergrund nachgezogen wird.
 *
 * ── Warum das ein eigenes Modul ist ─────────────────────────────────────────
 *
 * Der Block stand als anonyme Funktion in einem `setTimeout` mitten in
 * addSet() (utils/setService.ts) — sieben Schritte, jeder mit
 * `.catch(() => {})`, und der ganze Aufruf mit einer Zufallsverzögerung von
 * zwei bis fünf Sekunden.
 *
 * Aus demselben Grund wie bei jobs/startNachlaeufe.ts herausgezogen: Was kein
 * Modul ist, lässt sich in Tests nicht abfangen. Jeder Test, der ein Set
 * erfasst, löste diese sieben Schritte WIRKLICH aus — und weil er üblicherweise
 * in weniger als zwei Sekunden fertig ist und seinen Verbindungspool schliesst,
 * liefen sie danach ins Leere:
 *
 *     [weiter-trotz-fehler] instr-queue:trigger:
 *         Cannot use a pool after calling end on the pool
 *
 * Sichtbar war nur dieser eine Schritt, weil nur er protokolliert. Die anderen
 * sechs schluckten ihren Fehler — sie liefen also genauso ins Leere, nur
 * lautlos.
 *
 * Der Rumpf ist WORTGLEICH übernommen: dieselbe Reihenfolge, dieselben
 * `.catch`, dieselbe Verzögerung. Es ändert sich nur, wo er steht.
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
 *
 * ── Die beiden Zweige tun Verschiedenes, und das steht jetzt nebeneinander ──
 *
 * Vier Schritte teilen sie sich (importPartsForSet, enrichSetParts,
 * enrichSetMinifigs, downloadSetImages). Sechs unterscheiden sich:
 *
 *   importMinifigsForSet   nur Neuanlage    beim Zweiterfassen sind die
 *                                           Minifiguren schon da
 *   refreshPriceForSet     nur Neuanlage    der Zweiterfassungs-Zweig holt den
 *                                           Marktpreis schon vorher selbst
 *                                           (getCurrentMarketPrice), synchron
 *   fetchMissingBlIds      nur Zweiterfassung
 *   enqueue + requestRun   nur Zweiterfassung — die Neuanlage lädt die
 *                                           Anleitung stattdessen sofort
 *                                           (downloadSetInstructions, direkt
 *                                           über diesem Aufruf in addSet)
 *
 * NICHT angeglichen: Beide Fassungen sind so gewachsen, und ohne einen
 * gemeldeten Fehler ist jede Vereinheitlichung geraten. Der Punkt dieses
 * Moduls ist, dass der Unterschied ab jetzt an EINER Stelle sichtbar ist,
 * statt in zwei anonymen Bloecken vierzig Zeilen auseinander.
 *
 * Auffaellig bleibt einer: importPartsForSet laeuft in BEIDEN Zweigen, aber
 * importMinifigsForSet nur in einem. Wenn der erste Import der Minifiguren
 * scheitert, holt das Zweiterfassen die Teile nach — die Minifiguren nie.
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
