# Begründungen zu `feature-sammlung/ui/screens/BarcodeScannerScreen.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/sammlung/ui/screens/BarcodeScannerScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z3"></a>
## z3

```text
═══ NICHT ÄNDERN OHNE ZU LESEN: Autofokus ═══

1. CONTROL_AF_MODE_CONTINUOUS_PICTURE an beiden Use Cases, Preview und
ImageAnalysis: CameraX führt sie zu einem Repeating-Request zusammen, und steht
der Modus nur an einem, bleibt das Bild je nach Gerät unscharf.

2. Kein periodisches startFocusAndMetering: Ein Takt zwingt die Kamera dauernd
in eine neue Messung. Tippen zum Scharfstellen ist in Ordnung.

Beides prüft CameraFocusConfigTest — schlägt er fehl, ist der Code falsch, nicht
der Test.
```

<a id="z176"></a>
## z176

```text
Kandidaten für eine Setnummer aus erkanntem Text, in absteigender Güte. Auf
einer Anleitung stehen viele Zahlen (Alter, Teilezahl, Seite, Jahr, Heft- und
Elementnummern); die längste ist selten die Setnummer.

1. Eine Zahl vor einem Mengenwort fällt weg („1215 Teile“). 2. Mit
Variantensuffix (`60445-1`) zuerst — die einzige eindeutige Form. 3. Direkt
hinter `#` bevorzugt. 4. Vierstellig zwischen 1949 und nächstem Jahr wird
zurückgestuft (wahrscheinlich ein Jahr), nicht verworfen. 5. Dann nach
Stellenzahl 5, 4, 6, 7, 3 — der Häufigkeit echter Setnummern; dreistellige alte
Sets ganz hinten. 6. Bei Gleichstand die Reihenfolge im Text.

BarcodeAnalyzer nimmt firstOrNull() ohne Katalogabgleich, deshalb gilt jeder
Treffer als unsicher. Dieselbe Frage beantwortet Web-App/utils/produkttitel.ts;
beide prüfen shared/setnummer-korpus.json (SetnummerKorpusTest).
```
