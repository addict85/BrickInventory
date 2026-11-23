/**
 * Typprobe der Kontobedingung (db/accounts.ts), geprüft von `npm run typecheck`, nie ausgeführt:
 * Jede Zeile unter `@ts-expect-error` muss ein Übersetzungsfehler bleiben.
 *
 * Gegenprobe (15.11.2026): `type AccountFilter = string` in db/accounts.ts → rot (TS2578, unbenutzte
 * Markierung an beiden Zeilen).
 */
import { setHoldings } from '../../db/inventoryView';
import { setQuantityJoin } from '../../db/stockQuantity';

setHoldings('= ANY($1)');
setQuantityJoin('s', 'sm', '= $2');

// @ts-expect-error Ein Wert im Text statt eines Platzhalters.
setHoldings('= 1 OR TRUE');

// @ts-expect-error Auch angehängt an einen Platzhalter.
setQuantityJoin('s', 'sm', '= ANY($1) OR TRUE');
