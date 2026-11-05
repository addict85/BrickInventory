# Begründungen zu `core-data/alarm/Alarmabholung.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/alarm/Alarmabholung.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z7"></a>
## z7

```text
Was beim Abholen der ausgelösten Preisalarme entschieden wird — ausserhalb des
Workers, weil sich ein ListenableWorker nur mit laufendem Android prüfen lässt.
Der Worker beschafft den Kontext, ruft hier an und zeigt an, was zurückkommt.

Die Marke kommt vom Server, nicht von der Uhr des Telefons: Sonst entschiede die
Gangabweichung, ob eine Meldung doppelt kommt (Telefonuhr geht nach) oder
verloren geht (sie geht vor). Deshalb wird der Zeitpunkt, den der Server in
jeder Antwort mitreicht, zur nächsten Marke.
```
