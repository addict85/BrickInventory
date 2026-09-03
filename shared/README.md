# shared/ — was BEIDE Apps gleich beantworten müssen

Hier liegen keine Programme, sondern **Prüfkorpora**: Eingaben mit dem Ergebnis,
das die Web-App *und* die Android-App liefern müssen.

## Warum es dieses Verzeichnis gibt

Manche Regeln lassen sich nicht teilen. `setNumberCandidates()` läuft in Kotlin
in der Kameraschleife, ohne Netz; `setnummerKandidaten()` läuft in TypeScript
auf dem Server. Derselbe Gedanke, zwei Sprachen — und genau dort ist in diesem
Projekt schon mehrfach etwas auseinandergelaufen, ohne dass ein Test rot wurde.

Gemessen an der Setnummer-Erkennung:

| Regel | Server (`utils/produkttitel.ts`) | App (`setNumberCandidates`) |
|---|---|---|
| Mengenangabe („3696 Pcs") aussortieren | ja | **nein** |
| Jahreszahl zurückstufen | ja | **nein** |
| nach Stellenzahl ordnen (5, 4, 6, 7) | **nein** | ja |
| dreistellige Setnummern (375, 928) | **nein** | **nein** |

Beide Fassungen beantworteten dieselbe Frage unterschiedlich, und beide
verfehlten alte dreistellige Sets vollständig.

## Wie ein Korpus benutzt wird

`setnummer-korpus.json` enthält eine Liste aus `text`, `erwartet` (der ERSTE
Kandidat, oder `null` für „gar keiner") und `warum`. Zwei Prüfungen lesen
dieselbe Datei:

* `Web-App/test/setnummer-korpus.test.js`
* `Android-App/app/src/test/java/ch/brickinventoryapp/SetnummerKorpusTest.kt`

Ein neuer Fall wird **einmal** eingetragen und prüft ab sofort beide Apps. Läuft
eine Fassung weg, wird genau eine Seite rot — und man sieht am `warum`, worum es
ging. Ein Fall, der nur auf einer Seite gelten kann, gehört nicht hierher: Er
wäre der Beweis, dass die Apps unterschiedlich antworten.
