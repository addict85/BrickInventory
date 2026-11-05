# Begründungen zu `test/vertrag-schreiben-db.test.js`

Die ausführlichen Kommentare aus `test/vertrag-schreiben-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Jede SCHREIBENDE Route der App gegen ihren Vertrag (src/infra/vertrag/):
Antwort und, wo der Vertrag eine nennt, die Eingabe.

Gegenstück zu vertrag-lesen-db (dort die GET-Routen). Die App liest
ohne coerceInputValues: Ein null in einem nicht-nullbaren Feld ist dort ein
Fehler — und bei einer Schreibantwort hiesse das „gescheitert", obwohl
gespeichert wurde. Deshalb läuft hier jede Route der App einmal echt durch,
oder sie steht mit Grund in AUSGELASSEN. Eine neue Route ohne beides macht
den Test rot. Ob die Kotlin-Modelle zum Vertrag passen, prüft vertrag-kotlin.

Die Schritte laufen in einer festen Reihenfolge, weil sie aufeinander
aufbauen (anlegen → ändern → löschen) und die Sitzung zwischen drei Konten
wechselt (Haushalt einladen und beitreten).
```
