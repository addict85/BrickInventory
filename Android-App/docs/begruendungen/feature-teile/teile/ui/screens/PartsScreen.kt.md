# Begründungen zu `feature-teile/ui/screens/PartsScreen.kt`

Die ausführlichen Kommentare aus `feature-teile/src/main/java/ch/brickinventoryapp/teile/ui/screens/PartsScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="parttablerow"></a>
## `PartTableRow`

```text
Ein Teil als Tabellenzeile.

Zeigt, was die Tabelle der Webapp zeigt (partsTableRow in 03-parts.js):
Bild, Nummer, Name, Farbe, Kategorie, Menge, In Sets. Die beiden breiten
Spalten — Kategorie und Sets — stehen als zweite Zeile darunter statt
daneben; sieben Spalten nebeneinander passen auf kein Telefon.

„In Sets" ist nur gefuellt, wenn der Lader `with_sets=1` mitgegeben hat, und
das tut er nur in dieser Ansicht (TeileQuelle in teile/ui/Teile.kt).
```
