# Begründungen zu `src/teile/repository/teileListe.ts`

Die ausführlichen Kommentare aus `src/teile/repository/teileListe.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="getparts-joinclause"></a>
## `joinClause`

```text
Ohne set_number-Filter haengt die Set-Menge mit dran (der Faktor in
qtyExpr). Mit Filter nicht: Dort geht es um die Teile EINES Sets.

Hier stand ein LEFT JOIN auf `sets` — er diente allein der Spalte
s.quantity, und die ist mit Migration 0036 weg.
blJoin() ist in BEIDEN Zweigen dabei, auch bei set_number: Der
Gruppierungsschluessel unten ist die BrickLink-Nummer, und die kommt
seit Migration 0037 aus bl_zuordnung. Ohne den Join gaebe es den Alias
blz nicht — ein harter Fehler, keine stille 500.
```
