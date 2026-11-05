# Begründungen zu `core-data/util/LanguageManager.kt`

Die ausführlichen Kommentare aus `core-data/src/main/java/ch/brickinventoryapp/util/LanguageManager.kt`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="languagemanager"></a>
## `LanguageManager`

```text
Wendet die gespeicherte Sprachpräferenz ("system", "en", "de") über
AppCompatDelegate.setApplicationLocales() an.

Vorteil gegenüber manuellem Context-Wrapping: AppCompatDelegate kümmert
sich intern um die Persistenz (über AppLocalesMetadataHolderService bzw.
ab Android 13 über die System-LocaleManager-API) und um den Recreate()
der laufenden Activity — man muss nichts selbst speichern oder die
Activity manuell neu erzeugen.
```

<a id="nicht"></a>
## `nicht`

```text
Context mit der gewählten App-Sprache — für SERVICES und andere
Nicht-Activity-Kontexte.

AppCompatDelegate.setApplicationLocales() lokalisiert nur
AppCompat-Activities. Ein Service, der auf seinem eigenen Context
getString() aufruft, bekommt unterhalb von Android 13 weiterhin die
SYSTEM-Sprache — genau deshalb waren die Benachrichtigungstexte der
Foreground-Services bisher hartkodiert statt lokalisiert. Ab Android 13
wendet das System die per-App-Sprache selbst auf den ganzen Prozess an,
dort ist der Context unverändert richtig.
```
