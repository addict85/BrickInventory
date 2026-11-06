# Begründungen zu `test/set-move-db.test.js`

Die ausführlichen Kommentare aus `test/set-move-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Set zwischen Konten verschieben — gegen echte Datenbank.

── Warum Verhalten und nicht Quelltext ─────────────────────────────────────
Der gemeldete Fehler war eine pg-Warnung:
  „Calling client.query() when the client is already executing a query is
   deprecated and will be removed in pg@9.0"
Ursache: drei Prüfungen liefen per `Promise.all` auf DERSELBEN
Transaktionsverbindung.

Ein erster Anlauf prüfte das am Quelltext („kein Promise.all mit mehreren
tx.-Aufrufen"). Diese Regel hätte den echten Fehler NICHT gefunden: Die
Abfragen standen hinter einem Helfer namens has(), nicht als tx.get() im
Promise.all. Deshalb hier der Weg, der zählt — der Lauf wird ausgeführt und
die Warnungen von Node werden mitgeschrieben.

Voraussetzung: Test-DB (Inhalt wird geleert!) via TEST_DATABASE_URL.
Ohne DB: skip.
```

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
