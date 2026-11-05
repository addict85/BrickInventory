# Begründungen zu `core-ui/ui/screens/CsvImportBanner.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/screens/CsvImportBanner.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="if"></a>
## `if`

```text
In der KOPFzeile, nicht im aufgeklappten Teil: Wer
abbrechen will, soll nicht erst herausfinden muessen,
dass der Balken sich aufklappen laesst. In der Webapp
steht der Knopf ebenfalls dauerhaft da.

Kein Bestaetigungsdialog: Abbrechen nimmt nichts zurueck,
es hoert nur auf. Schon angelegte Sets bleiben.
```
