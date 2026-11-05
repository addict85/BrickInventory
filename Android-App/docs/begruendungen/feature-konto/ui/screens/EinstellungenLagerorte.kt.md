# Begründungen zu `feature-konto/ui/screens/EinstellungenLagerorte.kt`

Die ausführlichen Kommentare aus `feature-konto/src/main/java/ch/brickinventoryapp/ui/screens/EinstellungenLagerorte.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="lagerortecard"></a>
## `LagerorteCard`

```text
Die eigenen Lagerorte verwalten, je Benutzer.

Nur die eigenen: Ein Lagerort ist ein Regal in der eigenen Wohnung. Beim Set des
Enkels wählt der Grossvater aus dessen Liste, aber fremde Regale umzubenennen
wäre ein Versehen — lesen weit, schreiben eng.

Löschen nur bei einem leeren Ort und nach Rückfrage: Der Server sagt Nein, solange
etwas darin liegt (lagerort_in_benutzung).
```
