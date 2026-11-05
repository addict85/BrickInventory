# Begründungen zu `core-zustand/ui/viewmodel/KaeufeViewModel.kt`

Die ausführlichen Kommentare aus `core-zustand/src/main/java/ch/brickinventoryapp/ui/viewmodel/KaeufeViewModel.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="constructor"></a>
## `constructor`

```text
Die Käufe eines Eintrags — Set, manuelles Teil oder manuelle Figur:
Kaufpreise, Mengen, Daten, Besitzer, dazu Preisverlauf und Lagerort der
manuellen Einträge. Dient der Detailansicht manueller Einträge und der
Verwaltung der Käufe.

Ein Zustand für alle drei Arten ([ManualItemDetailUiState]): Die Verwaltung
zeigte vorher je nach Art einen von zwei Zuständen zweier Bildschirme.
```
