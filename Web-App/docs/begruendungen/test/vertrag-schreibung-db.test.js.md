# Begründungen zu `test/vertrag-schreibung-db.test.js`

Die ausführlichen Kommentare aus `test/vertrag-schreibung-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jede Route aus dem API-Vertrag, anders geschrieben: ganz in Grossbuchstaben,
mit grossem Anfangsbuchstaben nach /api/v1 und mit angehängtem „/“. Am
echten Server mit Idempotency-Key. Eine andere Schreibung ist eine andere
Route (404) und hinterlässt nichts in `idempotenz`; der Schrägstrich am Ende
findet denselben Vertragseintrag, und die Antwort einer geheimen oder
bestätigten Route wird auch dann weder gespeichert noch wiederholt.
```
