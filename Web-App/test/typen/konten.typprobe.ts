/**
 * Typprobe der Kontobedingung (db/konten.ts), geprüft von `npm run typecheck`, nie ausgeführt:
 * Jede Zeile unter `@ts-expect-error` muss ein Übersetzungsfehler bleiben.
 *
 * Gegenprobe (15.11.2026): `type Konten = string` in db/konten.ts → rot (TS2578, unbenutzte
 * Markierung an beiden Zeilen).
 */
import { setBestand } from '../../db/bestandSicht';
import { mengeJoin } from '../../db/bestandsmenge';

setBestand('= ANY($1)');
mengeJoin('s', 'sm', '= $2');

// @ts-expect-error Ein Wert im Text statt eines Platzhalters.
setBestand('= 1 OR TRUE');

// @ts-expect-error Auch angehängt an einen Platzhalter.
mengeJoin('s', 'sm', '= ANY($1) OR TRUE');
