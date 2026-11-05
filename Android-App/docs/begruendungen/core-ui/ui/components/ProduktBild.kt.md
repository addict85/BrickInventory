# Begründungen zu `core-ui/ui/components/ProduktBild.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/components/ProduktBild.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="produktbild"></a>
## `ProduktBild`

```text
Jede Bildfläche eines Sets, Teils oder einer Figur. Solange das Bild lädt, fehlt
oder nicht kommt, steht darunter dasselbe Ersatzbild (Stein-Silhouette auf
surfaceContainer): Eine leere weisse Fläche sah in Galerie und Detail aus wie ein
Fehler der App, und jede Stelle hatte ihren eigenen Platzhalter.

[modifier] gibt die Grösse vor; das Bild füllt sie. [onState] reicht Coils Zustand
weiter (Wiederholversuch, Rückfall auf die volle Auflösung).
```
