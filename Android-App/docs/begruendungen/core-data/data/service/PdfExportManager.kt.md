# Begründungen zu `core-data/service/PdfExportManager.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/service/PdfExportManager.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="z146"></a>
## z146

```text
downloadResult ist als Result<ByteArray>? deklariert, damit die
Wiederholschleife oben es überschreiben kann. Dass die Schleife
IMMER mindestens einmal zuweist (repeat(5) läuft, und beim
ersten Durchlauf ist der Wert null, also nicht Success), kann
der Compiler nicht sehen — Zuweisungen in einer Lambda zählen
für ihn nicht als sichere Initialisierung.

Bewusst ein null-Zweig und KEIN else: BrickRepository.kt sagt
ausdrücklich, dass jedes when über Result erschöpfend bleiben
soll, damit ein künftiger dritter Zustand überall auffällt.
Ein else würde genau das verdecken.

Ohne diesen Zweig bliebe die Oberfläche im Zustand "Running"
hängen, falls der Fall doch je einträte.
```
