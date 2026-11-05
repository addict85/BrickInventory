# Begründungen zu `feature-sammlung/ui/dialogs/SetPruefungDialog.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/ui/dialogs/SetPruefungDialog.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="setpruefungroute"></a>
## `SetPruefungRoute`

```text
„Wird geprüft“ — die Anzeige zwischen Scan und Zwischendialog. Ein Dialog statt
einer Snackbar, weil eine Snackbar:

  1. nach ein paar Sekunden verschwindet, während die Prüfung weiterläuft — der Bildschirm sähe untätig aus;
  2. nichts anhält: Der Scanner ist schon geschlossen (nav/ToolsGraph.kt ruft `popBackStack()` vor der Auflösung), man könnte das nächste Set scannen, während das vorige noch geprüft wird;
  3. beim Texterkennungs-Weg nichts nennt.

Der Dialog bleibt, solange die Frage offen ist, legt sich über den Weg zurück
zum Scanner und nennt die Nummer.

Das Erfassen selbst zeigt er nicht: Es läuft im Hintergrund. Sobald die
Bestandsfrage beantwortet ist, ist er weg; Teile, Anleitungen und Preise lädt
der Server ohnehin nach.
```
