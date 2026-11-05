# Begründungen zu `core-ui/ui/components/WahlChips.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/components/WahlChips.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="segmentwahl"></a>
## `SegmentWahl`

```text
Genau eine von zwei bis vier gleichrangigen Möglichkeiten (Neu | Gebraucht,
Fällt unter | Steigt über): Material sieht dafür die Segmentschaltfläche vor —
zwei Chips nebeneinander lasen sich wie zwei Filter, die man beide setzen kann.

Ab grosser Schrift ([GROSSE_SCHRIFT_AB]) dieselbe Wahl als [WahlChips]: Segmente
teilen die Breite zu gleichen Teilen, und ein langes Wort brach darin Zeichen für
Zeichen um. Chips brechen zwischen den Möglichkeiten um, nie im Wort.
```
