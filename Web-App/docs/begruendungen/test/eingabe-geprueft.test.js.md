# Begründungen zu `test/eingabe-geprueft.test.js`

Die ausführlichen Kommentare aus `test/eingabe-geprueft.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Route bekommt Rumpf und Abfrage so, wie der Vertrag sie geprüft hat
(req.eingabe, req.abfrage aus eingabePruefen): umgewandelt, ohne unbekannte
Felder. Eingaben und Abfragen sind geschlossen; ein unbekanntes Feld ist 400
mit dem Code feld_unbekannt. Die Abfrage steht in docs/openapi.json.

Geprüft an einem vertragsRouter mit echten Vertragsschlüsseln; der Handler
gibt zurück, was er sieht.
```
