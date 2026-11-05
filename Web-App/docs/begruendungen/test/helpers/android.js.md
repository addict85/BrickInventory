# Begründungen zu `test/helpers/android.js`

Die ausführlichen Kommentare aus `test/helpers/android.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Android-Quellen über alle Gradle-Module.

Seit der Aufteilung der App liegt eine Kotlin-Datei in app, einem core- oder
einem feature-Modul. Die Web-Tests fragen nach dem Paketpfad (`ui/screens/X.kt`),
nicht nach dem Modul: Wandert eine Datei zwischen Modulen, bleibt der Test
gleich. Was es nicht genau einmal gibt, ist ein Fehler mit Namen — nie eine
leere Zeichenkette, die eine Prüfung still bestehen liesse.
```
