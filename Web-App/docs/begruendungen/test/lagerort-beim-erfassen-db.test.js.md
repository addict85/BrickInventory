# Begründungen zu `test/lagerort-beim-erfassen-db.test.js`

Die ausführlichen Kommentare aus `test/lagerort-beim-erfassen-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Der Lagerort lässt sich beim ERFASSEN setzen — nicht erst danach.

── Marcos Befund vom 24.09. ────────────────────────────────────────────────

  „Wenn ich aus dem Katalog etwas in die Galerie aufnehme, kann ich den
   Lagerort nicht setzen. Wenn ich etwas aus der Merkliste in die Galerie
   aufnehme, kann ich den Lagerort nicht setzen. Wenn ich ein Set in der
   Galerie hinzufügen will, kann ich den Lagerort nicht wählen. […] Bei den
   manuell erfassten Teilen kann ich beim Erfassen keinen Lagerort setzen.
   Bei manuelle erfassten Minifiguren kann ich beim Erfassen keinen
   Lagerort setzen."

── Warum das mehr war als sechs fehlende Eingabefelder ─────────────────────

Die Spalte liess sich ausschliesslich NACH dem Erfassen füllen, über
PUT …/storage aus dem Detaildialog. addSet(), addManualPart(),
addManualFig() und uebernimm() kannten kein `storage`. Bei Minifiguren gab
es die Spalte überhaupt nicht (Migration 0024).

── Warum gegen eine echte Datenbank ────────────────────────────────────────

Die Aussage ist „nach dem Erfassen steht der Ort in der Zeile UND im
Vorrat". Beides sind Aussagen über Zeilen. Eine Quelltext-Regel könnte
prüfen, dass irgendwo `storage` steht — und wäre mit einem durchgereichten
Parameter zufrieden, der nirgends ankommt.
```
