# Begründungen zu `core-ui/ui/theme/Formen.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/theme/Formen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kachelhoehe"></a>
## `kachelHoehe`

```text
Höhe der Bestandskachel, nachgerechnet für den schlimmsten Fall bei labelSmall
(16 dp Zeilenhöhe):

    Name             2 Zeilen   32
    Farbe (Teile)    1 Zeile    16
    Preis            1 Zeile    16
    Notiz            1 Zeile    16
    Zustand          3 + 18     21
    Besitzer         2 + 16     18
    Innenabstand     4 + 4       8
                               ---
                               127  + 76 Bild = 203

208 lässt fünf Punkte Luft; höher passten weniger Reihen auf den Bildschirm.
```
