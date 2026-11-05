# Begründungen zu `test/set-teile-schlank-db.test.js`

Die ausführlichen Kommentare aus `test/set-teile-schlank-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Migration 0062: Die Setliste behält nur Set, Teil, Farbe, Menge und
Ersatzteil; Name, Kategorie, Farbe und Bild stehen in den Katalogen. Die View
set_parts_catalog zeigt den Lesestellen dieselben Spalten — und wie vorher
nur geprüfte Werte, keinen eingetippten Platzhalter eines Kontos.

Die Migration läuft hier auf einem Altbestand in einem eigenen Schema
(search_path), damit die echte Datenbank unberührt bleibt.
```
