# Begründungen zu `feature-teile/ui/screens/TeilelisteZeilen.kt`

Die ausführlichen Kommentare aus `feature-teile/src/main/java/ch/brickinventoryapp/ui/screens/TeilelisteZeilen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="vorhanden"></a>
## `vorhanden`

```text
Wie viele davon im eigenen Bestand liegen — `null`, solange nicht
gefragt wurde.

`null` und `0` sind ausdruecklich verschieden: `null` heisst „nicht
gefragt" (die Zeile zeigt gar nichts), `0` heisst „gefragt, nichts
vorhanden" (die Zeile zeigt eine rote Null). Ein Int mit Vorgabe 0
haette beides zu „habe ich nicht" verschmolzen.
```
