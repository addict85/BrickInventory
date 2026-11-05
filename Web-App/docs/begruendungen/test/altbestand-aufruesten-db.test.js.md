# Begründungen zu `test/altbestand-aufruesten-db.test.js`

Die ausführlichen Kommentare aus `test/altbestand-aufruesten-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine Datenbank von vor dem 28.10.2026 kommt beim Start ohne Zwischenschritt
auf den aktuellen Stand: Die früheren Startstufen laufen einmal nach, samt
ihrer Datenschritte, dann alle Migrationen. Das Ergebnis gleicht im Schema
einer frischen Installation, und die Daten des Kontos sind noch da.

Ausgangslage ist test/fixtures/altbestand-0046.sql (aus den echten alten
Ständen erzeugt): 0046, ohne parts_version_user — dieselbe Lage, an der ein
Server mit „Migration 0047 … parts_version_user does not exist“ stand.
```
