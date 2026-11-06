# Begründungen zu `test/migration-pruefsumme-db.test.js`

Die ausführlichen Kommentare aus `test/migration-pruefsumme-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
schema_migrations trägt je Migration eine Prüfsumme; ist eine schon
angewandte Datei danach geändert worden, bricht runMigrations() mit einer
Meldung ab, die die Datei nennt. Eine fehlende Summe (vor der Prüfung
angewandt) wird nachgetragen.

Die Änderung wird an der gespeicherten Summe nachgestellt, nicht an der
Datei: dist/ teilen sich alle Testdateien, auch parallel laufende.
```
