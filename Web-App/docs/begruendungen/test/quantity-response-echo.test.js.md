# Begründungen zu `test/quantity-response-echo.test.js`

Die ausführlichen Kommentare aus `test/quantity-response-echo.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Beide Oberflächen übernehmen die Menge aus der SERVERANTWORT.

── Warum es das Feld gibt ──────────────────────────────────────────────────
Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz auf das
eigene (Nachtrag 85). Beim VERRINGERN deckelt der Server bei den eigenen
Exemplaren — die eines anderen Kontos lassen sich nicht wegnehmen — und
antwortet mit der tatsächlichen Gesamtmenge.

Beide Regler zählen ihre Zahl vorher hoch und schicken sie dann. Ohne die
Übernahme stünde nach einem gedeckelten Verringern die eigene Annahme im
Feld, bis jemand die Ansicht neu öffnet: Der Server hat recht, der Bildschirm
zeigt etwas anderes, und niemand merkt es.

── Was hier geprüft wird ───────────────────────────────────────────────────
Die REGEL in beiden Clients, nicht die Zahl — die prüft
set-quantity-household-db gegen die echte Datenbank. Hier geht es darum, dass
das gelieferte Feld auch GELESEN wird. Genau diese Lücke ist in diesem
Projekt schon zweimal aufgefallen (die Verschiebe-Zahlen in Nachtrag 65, das
Zustands-Aggregat davor): Der Server liefert seit jeher etwas mit, und die
Oberfläche liest es nie.
```
