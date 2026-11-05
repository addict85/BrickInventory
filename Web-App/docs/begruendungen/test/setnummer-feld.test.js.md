# Begründungen zu `test/setnummer-feld.test.js`

Die ausführlichen Kommentare aus `test/setnummer-feld.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Dialog „Set hinzufügen“ prüft die Set-Nummer vor dem Absenden und
meldet einen Fehler direkt am Feld — „abc“ wurde vorher als Set „abc-1“
angelegt, mit Erfolgsmeldung. Geprüft am echten Bündel in jsdom: Was das
Feld abweist, erreicht den Server nicht. Angenommen werden muss jede
Nummer, die der gemeinsame Korpus (shared/setnummer-korpus.json) als
Setnummer erwartet, dazu Buchstaben-Präfixe echter Nummern.
```
