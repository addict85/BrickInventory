# Begründungen zu `test/wegweiser-oberflaeche.test.js`

Die ausführlichen Kommentare aus `test/wegweiser-oberflaeche.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Wegweiser in Texten („Menü → Haushalt“) führen dorthin, wo die Oberfläche
die Sache tatsächlich zeigt. Die Ziele werden aus der gerenderten Oberfläche
gelesen (Benutzermenü, Abschnitte der Einstellungen), nicht aus einer Liste
im Test: Benennt jemand einen Menüpunkt um, wird jeder alte Wegweiser rot.
Ein Ziel ohne Pfad („unter Einstellungen“) ist verboten — die Einstellungen
sind eine Verwalterseite, Konto, Haushalt usw. liegen im Menü.
```
