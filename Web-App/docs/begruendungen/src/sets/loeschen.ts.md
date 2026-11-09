# Begründungen zu `src/sets/loeschen.ts`

Die ausführlichen Kommentare aus `src/sets/loeschen.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="deletesetrows"></a>
## `deleteSetRows`

```text
Die Zeilen, die zu EINEM Set-Exemplar eines Kontos gehören.

Steht als eigene Funktion da, weil es zwei Anlässe gibt, sie loszuwerden:
das ausdrückliche Löschen (deleteSet) und das Wegfallen der letzten
Erfassung (routes/api_v1/acquisitions.ts). Zwei Listen von DELETEs wären
genau die Art Doppelung, an der in diesem Projekt schon mehrfach eine Regel
nur an einer der beiden Stellen nachgezogen wurde — hier hiesse das:
verwaiste Teile und Minifiguren ohne zugehöriges Set.

Erwartet eine offene Transaktion; die Aufrufer bringen ihre eigene mit.
```
