# Begründungen zu `test/app-flowrow-in-row.test.js`

Die ausführlichen Kommentare aus `test/app-flowrow-in-row.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine FlowRow gehört nicht in eine Row.

── Marcos Befund vom 25.09. ────────────────────────────────────────────────

  „Der Monitoring Bereich in der Android App hat beim Cache vorher und
   nachher einen grossen leeren Abstand."

── Was dort stand ──────────────────────────────────────────────────────────

Eine Row um vier Blöcke, die untereinander gehören: Vorschau-Ablage,
Vorwärm-Netze, Hinweis und Designwahl. Eine Row legt ihre Kinder
NEBENEINANDER — die vier teilten sich die Bildschirmbreite, und für jedes
blieben ein paar Punkte.

Sichtbar wurde es an den beiden FlowRows darin: Eine FlowRow bricht um,
sobald der Platz nicht reicht. Auf ein paar Punkte gedrückt, bricht sie
JEDEN Chip auf eine eigene Zeile und wird dadurch sehr hoch. Das
`Alignment.CenterVertically` der Row setzte die eine sichtbare Zeile in die
Mitte dieser Höhe — genau der leere Abstand davor und danach, den Marco
gesehen hat. Die übrigen Blöcke standen zusammengedrückt am rechten Rand.

── Warum eine Regel und kein Bildschirmvergleich ───────────────────────────

Der Fehler ist am Bild leicht zu sehen und am Quelltext schwer: Zwischen der
öffnenden Row und der FlowRow lagen 50 Zeilen Erklärtext. Ein
Schnappschuss-Test würde ihn ebenfalls finden, aber erst nach einem
Emulatorlauf — und er sagte „das Bild hat sich geändert", nicht warum.

Diese Prüfung sagt es: Eine FlowRow, deren nächster Elternteil waagerecht
ordnet, hat keinen Platz zum Umbrechen. Sie gehört in eine Column.

── Ihre Grenze, ausdrücklich ───────────────────────────────────────────────

Sie liest die EINRÜCKUNG, nicht den Syntaxbaum. Das genügt für diesen Baum
(durchgehend vier Leerzeichen, der Aufruf steht auf der Höhe des Elements),
und es ist die einzige Fassung, die ohne Kotlin-Übersetzer auskommt — den
gibt es in dieser Umgebung nicht, die Action ist der einzige Compiler.
Wer den Baum anders einrückt, macht diese Regel blind, nicht falsch.
```
