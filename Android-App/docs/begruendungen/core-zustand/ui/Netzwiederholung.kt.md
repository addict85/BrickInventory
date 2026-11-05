# Begründungen zu `core-zustand/ui/Netzwiederholung.kt`

Die ausführlichen Kommentare aus `core-zustand/src/main/java/ch/brickinventoryapp/ui/Netzwiederholung.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="retryonnetwork"></a>
## `retryOnNetwork`

```text
Wiederholen, solange der Fehler vorübergehend ist.

── Warum das hier steht und nicht mehr im MainViewModel ────────────────────
Die Funktion benutzt nichts aus dem ViewModel — weder Zustand noch Repository
noch Context. Sie stand dort nur, weil die Feature-Erweiterungen sie als
Mitglied erreichen konnten.

Als paketweite Funktion erreichen die Erweiterungen sie unverändert (Kotlin
bindet an das Paket), und die neuen Bildschirm-ViewModels ausserhalb von
`ui` können sie mit einem Import ebenso benutzen — statt sie ein zweites Mal
hinzuschreiben.

Sie ist gedacht für Aufrufe beim App-Start, die an noch nicht verfügbarem
Netzwerk oder DNS scheitern. `transient` setzt die Datenschicht in
RepoBasis; hier wird nicht an der Fehlermeldung geraten.
```
