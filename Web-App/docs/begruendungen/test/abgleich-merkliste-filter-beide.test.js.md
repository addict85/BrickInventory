# Begründungen zu `test/merkliste-filter-beide.test.js`

Die ausführlichen Kommentare aus `test/merkliste-filter-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Filter der Merkliste steht in BEIDEN Oberflächen — und beide bieten
dieselben Sortierungen an wie der Server.

── Marcos Vorgaben vom 24.09. ──────────────────────────────────────────────

  „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
   Inhaber."

  „Den Filter in der Merkliste sowohl in der Webapp als auch in der Android
   App einbauen."

Die zweite ist der Grund für diese Datei. Das Muster, das diesen Baum
durchzieht: Eine Änderung landet in einer der beiden Oberflächen, die andere
bleibt zurück. Diese Prüfung liest beide Quellbäume und verlangt dasselbe
von beiden.

── Was sie zusätzlich prüft, und warum ─────────────────────────────────────

Die Liste der SORTIERWERTE steht dreimal: in MERK_SORTS am Server, im
<select> der Webapp und in der Chip-Auswahl der App. Ein Wert, den eine
Oberfläche anbietet und der Server nicht kennt, fällt still auf die Vorgabe
zurück — die Auswahl täte dann nichts, ohne eine Fehlermeldung. Genau diese
Art von stiller Wirkungslosigkeit ist in diesem Baum schon mehrfach
vorgekommen, deshalb werden die drei Listen hier gegeneinander gehalten.

Gelesen wird OHNE Kommentarzeilen: Sonst genügte ein Absatz, der einen Wert
ERKLÄRT, und die Regel hielte ihn für vorhanden.
```
