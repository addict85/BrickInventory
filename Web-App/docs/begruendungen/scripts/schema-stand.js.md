# Begründungen zu `scripts/schema-stand.js`

Die ausführlichen Kommentare aus `scripts/schema-stand.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="fs-stelle"></a>
## `const fs = require('fs');`

```text
Das vollständige Schema an einer Stelle: db/schema-stand.sql.

Das Schema entsteht aus db/basis.sql und den Migrationen; keine der
beiden Quellen zeigt das Ergebnis lesbar. Dieses Skript baut
eine frische Datenbank wie beim ersten Start und schreibt aus dem Katalog,
was dabei herauskommt: Tabellen mit Spalten, Schranken, Indizes, Trigger,
Funktionen. Die Datei ist zum Lesen da, nicht zum Einspielen.

Aufruf (nach `npm run build`): npm run schema:stand
test/schema-frisch-db.test.js vergleicht die Datei mit einer frischen
Datenbank; weicht sie ab, ist sie neu zu erzeugen.
```
