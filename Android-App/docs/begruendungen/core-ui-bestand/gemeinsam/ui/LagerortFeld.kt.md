# Begründungen zu `core-ui-bestand/gemeinsam/ui/LagerortFeld.kt`

Die ausführlichen Kommentare aus `core-ui/src/main/java/ch/brickinventoryapp/ui/screens/LagerortFeld.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="lagerortfeld"></a>
## `LagerortFeld`

```text
Das Lagerort-Feld: auswählen oder neu eintippen, in einem Bedienelement — ein
ExposedDropdownMenuBox klappt auf wie ein Auswahlfeld und nimmt trotzdem
Getipptes an, das Gegenstück zur `datalist` der Webapp.

Getipptes speichert entprellt, nicht beim Fokusverlust: Am Telefon tippt man,
schliesst die Tastatur und geht zurück — dieser Fokuswechsel kommt nie. Die
Ruhezeit liegt im ViewModel und überlebt den Bildschirm (siehe
setzeSetLagerort). Eine Wahl aus der Liste speichert sofort: Sie ist fertig,
wenn sie getroffen wird.
```
