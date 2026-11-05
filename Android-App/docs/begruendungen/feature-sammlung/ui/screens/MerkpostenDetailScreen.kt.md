# Begründungen zu `feature-sammlung/ui/screens/MerkpostenDetailScreen.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/ui/screens/MerkpostenDetailScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="merkpostendetailscreen"></a>
## `MerkpostenDetailScreen`

```text
Das Detail eines Merkpostens — dieselben Zeilen in derselben Reihenfolge wie das
Set-Detail, ohne was ein Merkposten nicht hat (Kaufpreis, Anzahl, Lagerort,
Anleitungen; „hinzugefügt“ heisst hier „auf der Liste seit“). Marktpreis und
Verlauf zeichnet dieselbe PriceChart(). Der Merkposten wird aus dem geladenen
Zustand gesucht statt kopiert, damit der Bildschirm merkt, wenn er gelöscht oder
übernommen wurde.
```
