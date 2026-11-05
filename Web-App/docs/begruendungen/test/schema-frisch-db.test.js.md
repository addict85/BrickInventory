# Begründungen zu `test/schema-frisch-db.test.js`

Die ausführlichen Kommentare aus `test/schema-frisch-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Eine frische Datenbank, aufgebaut wie beim ersten Start: Jede Kontospalte
hat einen Fremdschlüssel auf users, ein Konto lässt sich samt allem löschen,
und ein zweiter Start ändert am Schema nichts.

Das Schema entsteht aus schema.sql, den Schritten in db/database.ts und den
Migrationen. Sieben Tabellen hatten so keinen Fremdschlüssel; beim Löschen
eines Kontos blieben ihre Zeilen stehen, bei den Erfassungen samt Kaufpreisen.
```
