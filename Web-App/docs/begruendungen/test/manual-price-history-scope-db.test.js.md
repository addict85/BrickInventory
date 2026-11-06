# Begründungen zu `test/manual-price-history-scope-db.test.js`

Die ausführlichen Kommentare aus `test/manual-price-history-scope-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Preisverlauf im Haushalt — Set, manuelles Teil UND manuelle Minifigur.

── Woher dieser Test kommt ─────────────────────────────────────────────────
Der Set-Verlauf bekam sein Blickfeld in Nachtrag 33, das manuelle Teil in
Nachtrag 96/97. Die Minifigur fiel durch: Beide Routen (Webapp und v1)
reichten die nackte Betrachter-ID an getMinifigPriceHistory() durch.
conditionRows() filtert die Erfassungen mit `user_id = ANY(...)` — mit nur
der eigenen ID fand es für eine Minifigur des Unterkontos keine, und ohne
Erfassung entsteht überhaupt keine Zeile: Marktpreis, Kaufpreis und
Prozentangabe blieben im Detail leer, `accounts=` wirkte dort gar nicht.

Weil BEIDE Routen denselben Stand hatten, war die Paritätsprüfung grün —
sie vergleicht die Clients miteinander, nicht gegen die Regel. Deshalb
dieser Verhaltenstest, und deshalb über alle drei Arten statt nur über die
eine reparierte: Genau diese Familie ist in dieser Reihe schon dreimal
einzeln aufgefallen.
```
