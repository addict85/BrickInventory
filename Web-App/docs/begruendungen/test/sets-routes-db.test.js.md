# Begründungen zu `test/sets-routes-db.test.js`

Die ausführlichen Kommentare aus `test/sets-routes-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
routes/sets.ts gegen eine ECHTE Datenbank.

── Warum diese Suite (Nachtrag 154) ────────────────────────────────────────
`npm run coverage` wies für routes/sets.ts 18 % ausgeführte Zeilen bei 522
aus — der niedrigste Wert unter den grossen Modulen, und zugleich der
Anlege- und Verschiebeweg für Sets. Was es an Prüfungen gab, las
überwiegend Quelltext: Das fängt eine gelöschte Zeile, sagt aber nichts
darüber, ob die Abfragen tun, was sie sollen.

Ausgesucht ist nach SCHADENSHÖHE, nicht nach Zeilenzahl. Geprüft werden die
Wege, bei denen ein stiller Ausfall am teuersten ist:

 1. Fremde Anleitungen löschen — ginge das, verlöre ein anderes Konto Daten,
    ohne dass irgendwo ein Fehler erscheint.
 2. Die geteilte Datei beim Löschen — beim Verschieben eines Sets wird die
    Anleitungs-Zeile KOPIERT und der Pfad wörtlich übernommen. Löscht das
    eine Konto seine Zeile, darf die Datei nicht verschwinden, solange die
    andere noch darauf zeigt. Genau das war einmal falsch herum.
 3. Die Endung beim Hochladen — sie muss aus dem MIME-Typ kommen, nie aus
    dem Dateinamen. Vorher liess sich "image/png" mit Namen "x.html"
    hochladen; ausgeliefert wurde das als text/html vom eigenen Origin.

Alle drei schreiben oder löschen still das Falsche. Ein Test, der Zeilen
berührt, ohne etwas zu behaupten, stünde hier nicht.
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
