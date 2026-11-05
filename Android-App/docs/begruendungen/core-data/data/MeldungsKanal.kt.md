# Begründungen zu `core-data/data/MeldungsKanal.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/data/MeldungsKanal.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="constructor"></a>
## `constructor`

```text
Ein Weg für flüchtige Meldungen — die Snackbar hat genau einen Platz auf dem
Bildschirm, also gibt es genau einen Kanal dorthin. Mit einem Kanal je ViewModel
bräuchte jede Stelle, die ein ViewModel benutzt, einen Weiterleitungsblock;
fehlt er, verschwinden die Meldungen lautlos.

Er lebt als @Singleton neben den ViewModels (wie [SessionExpiredSignal]): Wer
melden will, lässt ihn sich einspritzen; angezeigt wird an einer Stelle
(AppNavigation.kt). Ein neues ViewModel braucht nur den Konstruktorparameter.

`fluss` ist absichtlich der MutableStateFlow selbst und nicht hinter
zeige()/quittiere() versteckt: Die ViewModels halten ihn unter dem Namen
`_snackbar`, damit die vielen Schreibstellen in den Feature-Dateien gleich
bleiben.
```
