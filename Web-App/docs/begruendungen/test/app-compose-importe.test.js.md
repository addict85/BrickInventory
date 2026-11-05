# Begründungen zu `test/app-compose-importe.test.js`

Die ausführlichen Kommentare aus `test/app-compose-importe.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Compose-Bausteine, die der naheliegende Stern-Import NICHT mitbringt.

── Woher diese Datei kommt ─────────────────────────────────────────────────

Android-CI Lauf 203, nach anderthalb Minuten und einem roten Lauf:

    MerklisteScreen.kt:120:20 Unresolved reference 'rememberSaveable'.

Die Datei hatte `import androidx.compose.runtime.*`. Das sieht aus, als
decke es die Compose-Laufzeit ab — `rememberSaveable` liegt aber in einem
eigenen Artefakt und damit in einem eigenen Paket
(androidx.compose.runtime.saveable). Der Stern-Import eine Zeile darueber
hilft nicht, und der Fehler sieht danach aus wie ein Tippfehler.

Es ist dieselbe Falle wie bei app-vm-importe.test.js, nur mit einem
FREMDEN Paket statt einem eigenen: Ein Aufruf steht da, sein Import fehlt,
und in diesem Baum ist die GitHub-Action der einzige Kotlin-Compiler. Ein
solcher Fehler kostet dort neun Minuten — hier eine Sekunde.

── Warum nur diese beiden Namen ────────────────────────────────────────────

Weil die Regel BEWEISBAR sein muss. Für beide gilt: Der Name lebt in genau
einem Paket, und dieses Paket ist NICHT `androidx.compose.runtime`. Wer
eine dritte Falle findet, traegt sie hier ein — eine Liste, die raet, waere
schlimmer als keine (siehe die 117 Fehlmeldungen, die der erste Entwurf von
app-vm-importe.test.js produziert hat).
```

<a id="benutzt"></a>
## `const benutzt = new RegExp('(?<![\\w.])${name}\\s*[({<]').test(code);`

```text
Der Import steht in der ROHEN Quelle — ohneBeiwerk() laesst ihn
stehen, aber sicher ist sicher.
`[({<]` und nicht nur `[(<]`: Der haeufigste Aufruf ist
`rememberSaveable { … }` — mit geschweifter Klammer. Die erste
Fassung dieser Zeile verlangte `(` oder `<` und war damit auf JEDER
Datei gruen, auch auf der, fuer die ich sie geschrieben habe. Drei
```
