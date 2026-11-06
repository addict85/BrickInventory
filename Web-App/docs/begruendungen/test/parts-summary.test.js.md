# Begründungen zu `test/parts-summary.test.js`

Die ausführlichen Kommentare aus `test/parts-summary.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Vorberechnete Teile-Zusammenfassung (src/teile/partsSummary.ts).

Die Teileansicht gruppiert 171'000 parts-Zeilen nach Teil und Farbe. Diese
Gruppierung lief bei JEDEM Seitenaufruf neu — auch nach der Umstellung auf
Endlos-Scroll, denn LIMIT greift erst nach dem GROUP BY. Gemessen an 380
Sets: 1294 ms bis zur ersten Kachel, rund 600 ms je Scroll-Schritt.
Aus der Zusammenfassung: 110 ms bzw. 5–13 ms.

Der kritische Teil ist nicht die Geschwindigkeit, sondern dass die Zahlen
stimmen und nie veralten. Deshalb hängt die Entwertung an einem
Statement-Trigger auf `parts` und `sets` statt an Aufrufen in den
Schreibpfaden — kein Code-Pfad kann daran vorbei.

Braucht Postgres (TEST_DATABASE_URL), überspringt sich sonst.
Ausführen: npm test
```

<a id="h-stelle"></a>
## `const h = require('./helpers/sources').handlerQuelle();`

```text
Zwei Filter, ein Grund: Die Zusammenfassung ist nach Teil und Farbe
verdichtet und kann nach nichts filtern, was INNERHALB einer Gruppe
verschieden ist.

  set_number  — die Teile EINES Sets sind ein anderer Anwendungsfall
  storage     — der Lagerort steht dort nur verdichtet („Kiste 3, Regal B"
                für ein Teil aus zwei Sets); ein Vergleich darauf träfe die
                Gruppe falsch

In beiden Fällen macht der Filter die Menge klein, die Live-Abfrage ist
also passend UND schnell genug.

Geprüft wird auf beide Namen einzeln statt auf die ganze Zeile: Kommt ein
dritter Filter dazu, soll dieser Test nicht an der Reihenfolge scheitern.
```

<a id="fremd"></a>
## `const FREMD = 990502;`

```text
── Der Schreibvorgang eines FREMDEN Kontos darf nichts entwerten ────────

Vorher zählte ein einziger globaler Zähler: Trug ein Kind ein Teil nach,
galt die Zusammenfassung der Eltern als veraltet, und die Kennzahlen
(strict) wichen bis zum Abschluss des Neuaufbaus auf die Live-Abfrage aus
— an 800 Sets / 60'000 Teilen rund 300 ms, ausgelöst von einer Änderung,
die mit diesen Daten nichts zu tun hat.
```

<a id="src-stelle"></a>
## `const src = fs.readFileSync(path.join(ROOT, 'src/teile/partsSummary.ts`

```text
Kern des zuletzt gemeldeten Fehlers: ensureFresh() hat bei veralteter
Version SYNCHRON neu aufgebaut. Weil der Trigger die Version bei jeder
Änderung an parts hochsetzt (CSV-Import, Set hinzufügen,
Katalog-Anreicherung), zahlte der nächste Aufruf des Teile-Reiters den
vollen Aufbau — an 380 Sets gemessen gut drei Sekunden, in denen die
Kachelwand leer blieb. Manuell erfasste Teile erschienen sofort, weil sie
über eine eigene Abfrage ohne Zusammenfassung laufen.
```

<a id="stelle"></a>
## `try { await db.initSchema(); }`

```text
── Der Befund ───────────────────────────────────────────────────────────

getPartsStats hat zwei Wege: die Zusammenfassung (schnell) und eine
Live-Abfrage (Rückfall). Die Zusammenfassung lässt manuell erfasste Teile
WEG — so ist sie gebaut, und der Kommentar an getPartsStats sagt es auch:
„Die Kennzahlen beziehen sich wie die Liste auf Set-Teile."

Die Live-Abfrage tat es nicht. Damit gab es zwei Antworten auf dieselbe
Frage, und welche man bekam, hing davon ab, ob die Zusammenfassung gerade
frisch war.

── Warum `strict` das nicht abgedeckt hat ───────────────────────────────

Der Test darüber („Kennzahlen benutzen keinen veralteten Stand") kommt aus
genau diesem Problem und hat es zur Hälfte gelöst: `strict` sorgt dafür,
dass beide Aufrufer GEMEINSAM ausweichen, wenn der Stand veraltet ist. Es
sorgt nicht dafür, dass die beiden Abfragen dasselbe LIEFERN. Wechselt die
Zusammenfassung zwischen zwei Aufrufen von „gibt es nicht" auf „frisch",
greift strict nicht — und genau so ist es in der CI aufgefallen
(api-parity, Lauf 213: derselbe Endpunkt, Sitzung gegen Token).

Diese Prüfung hängt deshalb nicht am Zeitpunkt, sondern am INHALT: beide
Wege, dieselben Daten, ein Vergleich.
```
