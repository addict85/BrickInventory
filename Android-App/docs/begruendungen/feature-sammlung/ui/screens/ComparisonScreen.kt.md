# Begründungen zu `feature-sammlung/ui/screens/ComparisonScreen.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/ui/screens/ComparisonScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z87"></a>
## z87

```text
── Zahlentastatur statt Freitext ──

Hier tippt man Setnummern und Barcodes, keine Namen — deshalb die
Zahlentastatur. Der Filter gehört dazu: Eine angeschlossene Tastatur, die
Zwischenablage und manche Bildschirmtastaturen liefern trotzdem Buchstaben.
setNumber() lässt Ziffern und den Varianten-Bindestrich durch — genau das,
was „75192-1“ braucht.
```
