# Begründungen zu `feature-anmeldung/ui/screens/LoginScreen.kt`

Die ausführlichen Kommentare aus `feature-anmeldung/src/main/java/ch/brickinventoryapp/ui/screens/LoginScreen.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="flowrow"></a>
## `FlowRow`

```text
Der Registrier-Link erscheint NUR bei einem ausdruecklichen `true`.
`null` heisst „noch nicht gefragt" oder „der Server hat nicht
geantwortet" — in beiden Faellen fuehrte der Knopf ins Leere.
Beide Verweise in einer umbrechenden Reihe: untereinander lag zwischen ihnen der
doppelte Abstand des Formulars. Mittig gesetzt, auch wenn einer bei grosser Schrift
zweizeilig wird: Sonst stand er linksbündig über dem mittigen anderen.
```
