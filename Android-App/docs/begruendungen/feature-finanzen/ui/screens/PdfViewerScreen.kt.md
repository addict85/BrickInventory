# Begründungen zu `feature-finanzen/ui/screens/PdfViewerScreen.kt`

Die ausführlichen Kommentare aus `feature-finanzen/src/main/java/ch/brickinventoryapp/ui/screens/PdfViewerScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z321"></a>
## z321

```text
Die Seiten, zoombar. Gezoomt wird über die Breite statt mit einem graphicsLayer:
So rendert PdfPage in der Grösse, in der die Seite steht (scharf statt
gestreckt), das Rollen bleibt im richtigen Mass, und ein echtes horizontalScroll
verschiebt mit Anschlag. transformable(canPan = { false }) beansprucht keinen
Einfinger-Zug, deshalb rollt die Liste weiter; wo die Geste doch verliert,
bleiben Doppeltipp und Knöpfe.
```
