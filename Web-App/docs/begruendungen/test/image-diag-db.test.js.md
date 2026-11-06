# Begründungen zu `test/image-diag-db.test.js`

Die ausführlichen Kommentare aus `test/image-diag-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Bild-Diagnose: „Warum fehlt das Bild für Set X?" in EINER Antwort.

Die Fragen bei einer leeren Kachel (Adresse in der Datenbank? Datei,
Vorschau, Grösse, Proxy-Cache?) liegen an drei Orten; der Endpunkt
beantwortet sie in einer Antwort.

Geprüft wird VERHALTEN gegen echte Dateien und echte Datenbank, in den drei
Lagen, die im Betrieb tatsächlich vorkommen. Besonders wichtig ist der
Klartext-Hinweis: Er ist der eigentliche Nutzen — Zahlen allein hätte man
auch vorher zusammensuchen können.
```
