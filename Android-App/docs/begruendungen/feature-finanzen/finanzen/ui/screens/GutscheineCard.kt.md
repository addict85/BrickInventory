# Begründungen zu `feature-finanzen/ui/screens/GutscheineCard.kt`

Die ausführlichen Kommentare aus `feature-finanzen/src/main/java/ch/brickinventoryapp/finanzen/ui/screens/GutscheineCard.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="nummermaske"></a>
## `nummerMaske`

```text
Filter UND Tastatur gehoeren zusammen — die Tastaturwahl ist eine
Bitte an die Tastatur-App, keine Zusicherung: Eine angestoepselte
Tastatur und die Zwischenablage liefern trotzdem Buchstaben. Die
Regel steht in ZahlentastaturTest, der Filter in NumericInput.kt.
Beim Bearbeiten steht die Maske des Servers im Feld; eingabeUeberMaske()
behandelt sie als Ganzes, gespeichert heisst sie „unverändert“.
```
