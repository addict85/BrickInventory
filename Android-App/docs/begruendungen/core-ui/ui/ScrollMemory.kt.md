# Begründungen zu `core-ui/ui/ScrollMemory.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/ScrollMemory.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="constructor"></a>
## `constructor`

```text
Gemerkte Rollpositionen je Reiter. Mitschreiben und beim Betreten ausdrücklich
scrollToItem(index, offset) — der Weg, der im Katalog zuverlässig an dieselbe
Zeile führt; ein über den NavHost geretteter LazyGridState stand danach
verschoben. Eine schlichte Karte statt eines StateFlow, weil sich die Position
bei jeder Bewegung ändert und nur beim Betreten gelesen wird. Ein Singleton,
damit ViewModels und Navigation dieselbe Karte sehen.
```

<a id="scrollpositionkeeper"></a>
## `ScrollPositionKeeper`

```text
Die Reihenfolge ist die ganze Regel: erst zurückspringen, dann melden.

- Der Merker darf den Ausflug nicht überleben (`remember`, nicht
  `rememberSaveable`), sonst ist die Wiederherstellung nach dem ersten Betreten
  für immer aus.
- Der Melder darf nicht vorher loslaufen: Ein frisches Raster steht auf null und
  überschriebe die gemerkte Stelle.

`bereit` sagt, ob die Liste Inhalt hat — vorher gibt es keine Stelle zum
Springen.
```
