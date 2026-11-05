# Begründungen zu `feature-sammlung/ui/Galerie.kt`

Die ausführlichen Kommentare aus `feature-sammlung/src/main/java/ch/brickinventoryapp/ui/Galerie.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="galerie"></a>
## `Galerie`

```text
Der Zustand der Galerie und wie er sich ändert — an EINER Stelle.

Vorher war `_galleryState` ein internes Feld des MainViewModel, in das jede
Datei des Moduls schreiben konnte (Barcode, Sitzung, Set-Detail …). Jetzt ist
der Fluss privat, und wer etwas ändern will, ruft eine benannte Methode.
Abrufe kommen als Funktionen herein: So lässt sich das Verhalten ohne
ViewModel und Netz prüfen (GalerieTest).
```
