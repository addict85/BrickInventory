# Begründungen zu `test/menue-icons-beide.test.js`

Die ausführlichen Kommentare aus `test/menue-icons-beide.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Das Menü oben rechts trägt in BEIDEN Oberflächen dieselben Symbole.

── Marcos Vorgabe ──────────────────────────────────────────────────────────

17.10.: „Bitte sicherstellen dass in der Webapp und der Android-App im Menü
oben rechts die gleichen Icons verwendet werden."

── Was dabei NICHT geht, und warum es trotzdem eine Prüfung gibt ───────────

Buchstäblich dieselben Zeichen können es nicht sein: Die Webapp zeichnet
ihre eigene Symbolfamilie (das Sprite in index.html), die App
Material-Symbole. `#i-gutschein` und `Icons.Outlined.Redeem` sind
verschiedene Dateien aus verschiedenen Systemen — gleich ist das GEMEINTE.
(Bis zum 25.10. stand im Web ein Emoji im Sprachtext; die Tabelle hält
seither die Symbol-IDs.)

Genau deshalb braucht es hier eine Tabelle und keine Gleichheitsprüfung:
Die Zuordnung „welcher Eintrag trägt welches Sinnbild" ist eine
Entscheidung, und eine Entscheidung, die nirgends steht, läuft auseinander.
Sie stand bisher nirgends — und war auseinandergelaufen:

    GEMESSEN am 17.10.: Die Webapp benutzte 📦 ZWEIMAL — für „Lagerorte"
    und für „Daten exportieren". In der App sind das `Inventory2` und
    `UploadFile`, also zwei verschiedene Sinnbilder. Im Web war derselbe
    Karton einmal ein Lagerort und einmal ein Datenpaket.

── Warum die Prüfung hier liegt und nicht in der App ───────────────────────

Dieselbe Entscheidung wie bei test/lagerort-beide.test.js und
test/preisalarm-beide.test.js: Eine Zusicherung über BEIDE Oberflächen
gehört an EINE Stelle, sonst gibt es sie zweimal und die beiden Fassungen
driften. Die Web-Suite läuft hier und kann die Kotlin-Quellen mitlesen; die
App-Tests können das umgekehrt nicht.
```

<a id="zuordnung"></a>
## `const ZUORDNUNG = [`

```text
Die ZUORDNUNG — die einzige Stelle, an der sie steht.

`web` ist der i18n-Schlüssel der Webapp, `app` der R.string-Schlüssel der
App, `sinnbild` das, was beide zeigen sollen, und `glyph`/`vektor` die
vereinbarten Zeichen.

Einstellungen und Monitoring stehen in der App auf der Seite „Mehr“, in der
Webapp als REITER. Sie sind trotzdem hier, denn Marcos Frage gilt dem, was man oben
rechts sieht — und ein Zahnrad soll in beiden Oberflächen ein Zahnrad sein.
```
