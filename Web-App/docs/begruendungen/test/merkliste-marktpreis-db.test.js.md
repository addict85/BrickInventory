# Begründungen zu `test/merkliste-marktpreis-db.test.js`

Die ausführlichen Kommentare aus `test/merkliste-marktpreis-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Die Merkliste zeigt den Marktpreis — und zwar den des richtigen Zustands.

── Marcos Vorgabe vom 24.09. ───────────────────────────────────────────────

  „Bitte in der Tabelle der Merkliste der Button In die Galerie aufnehme
   entfernen und dafuer den Marktpreis anzeigen. Dies ebenfalls in der
   Android und Webapp Umsetzen."

── Warum aus dem Cache und nicht frisch geholt ─────────────────────────────

Ein Abruf je Zeile wären bei zwei Dutzend Merkposten ein Dutzend
BrickLink-Anfragen beim Öffnen des Reiters, und die Liste wartete darauf.
jobs/priceJob.ts frischt die Preise der Merkposten ohnehin täglich auf — die
Begründung steht dort ausdrücklich. Ein LEFT JOIN kostet nichts.

── Warum gegen eine echte Datenbank ────────────────────────────────────────

Die eigentliche Aussage ist „der Preis gehört zum ZUSTAND dieser Zeile".
Ohne die Bedingung stünde beim gebrauchten Merkposten der Neupreis — und das
sieht man keiner Quelltextzeile an, nur dem Ergebnis.
```
