# shared/ — was BEIDE Apps gleich beantworten müssen

Hier liegen keine Programme, sondern **gemeinsame Wahrheiten** in zwei Formen:

* **Prüfkorpora** — Eingaben mit dem Ergebnis, das die Web-App *und* die
  Android-App liefern müssen (`setnummer-korpus.json`).
* **Quellen, aus denen beide Seiten ERZEUGT werden** — Werte, die beide führen
  müssen, aber in verschiedenen Sprachen brauchen (`design-tokens.json`).

Beide Formen lösen dasselbe Problem von zwei Seiten: Ein Korpus *meldet*, wenn
die Fassungen auseinanderlaufen; eine Erzeugungsquelle *verhindert* es. Wo eine
Erzeugung möglich ist, ist sie die bessere Antwort — ein gemeldetes
Auseinanderlaufen ist immer schon eines.

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


## `design-tokens.json` — die Farben, die beide gleich führen müssen

Beide Oberflächen sollen gleich aussehen. Über eine gemeinsame *Datei* geht das
nicht: Das Web liest CSS-Custom-Properties, die App braucht Compose-Farben.
Derselbe Wert, zwei Sprachen — und er stand entsprechend zweimal da. Von 46
Farben in `Theme.kt` nannten genau vier Zeilen, woher ihr Wert stammt; der Rest
war eine stille Abschrift.

Jetzt steht er einmal hier, und beide Seiten werden erzeugt:

```
shared/design-tokens.json
   ├─→ Web-App/public/tokens.css
   └─→ Android-App/.../ui/theme/DesignTokens.kt
```

Erzeugt von `Web-App/scripts/generate-design-tokens.js` (läuft bei
`npm run build`, einzeln `npm run design:tokens`). **Die beiden Erzeugnisse
nicht von Hand ändern** — `Web-App/test/design-abschrift.test.js` rechnet nach
und wird sonst rot. Sie liegen trotzdem mit im Baum, weil der Android-Build kein
Node kennt.

Die Begründungen reisen MIT: Warum die Gebraucht-Linie im Stein-Design Sand ist
und nicht blau, steht unter `_notizen` und landet als Kommentar in beiden
Erzeugnissen.

**Was NICHT hierher gehört**: Werte, die nur eine Seite kennt. Compose führt mit
`background`/`surface`/`surfaceVariant` drei Ebenen, wo das Web mit `--bg`/`--sur`
zwei führt; das Stein-Design hat im Web eine Grundplatte, die die App nicht hat.
Dieselbe Regel wie beim Korpus: Ein Fall, der nur auf einer Seite gelten kann,
wäre der Beweis, dass die Apps unterschiedlich antworten.
