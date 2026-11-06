# Begründungen zu `feature-konto/ui/screens/EinstellungenCsv.kt`

Die ausführlichen Kommentare aus `feature-konto/src/main/java/ch/brickinventoryapp/ui/screens/EinstellungenCsv.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="csvimportcard"></a>
## `CsvImportCard`

```text
Eine CSV-Datei hochladen — Sets, Teile, Minifiguren, Merkliste oder Preisalarme,
über dieselben Adressen wie die Webapp. Der Fortschritt danach kommt über den
bestehenden Kanal: Der Import läuft auf dem Server weiter, auch wenn die App
zugeklappt wird.

Je Art eine Zeile mit Symbol und den erwarteten Spalten: Als fünf Chips sahen
die Knöpfe wie Filter aus, und welche Datei gemeint ist, stand nirgends.
```
