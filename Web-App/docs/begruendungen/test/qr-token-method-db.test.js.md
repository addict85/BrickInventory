# Begründungen zu `test/qr-token-method-db.test.js`

Die ausführlichen Kommentare aus `test/qr-token-method-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="stelle"></a>
## `{`

```text
── Und die MIGRATIONEN, nicht nur das Schema ───────────────────────────

Diese Datei loescht das Schema und baut es neu auf. Ohne die Migrationen
bleibt die Datenbank auf dem Stand von db/schema.sql stehen — also VOR
allen Migrationen —, und das ist nicht nur fuer sie selbst falsch,
sondern fuer jede Datei danach: Sie erbt eine halbe Datenbank.

GEMESSEN beim Umzug der Teilemengen (Migration 0038): db/schema.sql legt
`parts.quantity DEFAULT 1` an, die Katalogzeilen tragen die echte Zahl.
Die naechste Datei, die die Migrationen laufen liess, brach ab — „Bei 8
Set-Teilen weicht parts.quantity vom Katalog ab". Der Riegel hatte recht.
```
