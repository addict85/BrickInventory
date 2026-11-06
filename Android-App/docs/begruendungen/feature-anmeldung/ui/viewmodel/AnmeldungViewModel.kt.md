# Begründungen zu `feature-anmeldung/ui/viewmodel/AnmeldungViewModel.kt`

Die ausführlichen Kommentare aus `feature-anmeldung/src/main/java/ch/brickinventoryapp/ui/viewmodel/AnmeldungViewModel.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="loginwithqrtoken"></a>
## `loginWithQrToken`

```text
Erst nach der Bestätigung im Einrichtungsbildschirm: Die Adresse kommt aus dem
Code. Sein Fingerabdruck gilt schon für die erste Anfrage, gemerkt wird er aber
erst nach gelungener Anmeldung. Verlangt [mussAbtippen] es, nur wenn
[pinWechselEingabe] ihn aus einer zweiten Quelle bestätigt: Ein Code kann von
jedem stammen, ein Tipp genügte sonst für einen fremden Schlüssel. Ein Code
mit http-Adresse wird nicht übernommen, auch wenn die Oberfläche ihn durchliesse.
```
