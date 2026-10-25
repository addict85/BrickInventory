# Begründungen zu `utils/finance/abfragen.ts`

Die ausführlichen Kommentare aus `utils/finance/abfragen.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Lesezugriffe, die MEHR ALS EINE Schicht des Finanzteils braucht.

── Warum es diese Datei gibt (Nachtrag 171) ────────────────────────────────

Die Kauferfassungen eines Blickfelds werden an zwei Stellen gebraucht: von
der Bewertung (welcher Zustand gilt) und von der Gewinnrechnung (was wurde
bezahlt). Die Abfrage stand deshalb ZWEIMAL — wortgleich, mit denselben
Spalten und derselben Sortierung.

Aufgefallen ist das erst beim Trennen von utils/financeCalc.ts: Solange
beide in derselben Datei standen, sah sql-kerne.test.js nichts — die Regel
dort meldet eine Abfrage, die in mehr als einer DATEI steht. Innerhalb einer
Datei war die Dopplung unsichtbar.

Die Sortierung ist dabei kein Zierrat: Beide Seiten rechnen den gewichteten
Kaufpreis in der Reihenfolge der Erfassung. Liefe eine anders, kaeme bei
gleichem Bestand ein anderer Gewinn heraus.
```
