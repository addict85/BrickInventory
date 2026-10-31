# Begründungen zu `src/gutscheine/gutscheinGuthabenSchranke.ts`

Die ausführlichen Kommentare aus `src/gutscheine/gutscheinGuthabenSchranke.ts`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="abschnitt"></a>
## Abschnitt

```text
Die Schranke vor der Guthaben-Abfrage: ein Aufruf je 30 Sekunden, und Ruhe,
wenn der Bot-Schutz anspricht.

── Marcos Vorgaben ─────────────────────────────────────────────────────────

  „Bitte auch dafür sorgen dass maximal 1 Request pro 30sek abgesetzt
   werden kann. (über alle Benutzer)"

  „Der Botschutz beibehalten, dass nicht mehr Aufrufe generiert werden wenn
   ein Schutz greift. Ich möchte aber den Notweg weglassen."

── Warum das in der DATENBANK steht und nicht im Speicher ──────────────────

„Über alle Benutzer" ist der entscheidende Teil. Ein Zähler im Modulspeicher
gilt je PROZESS, und der Server läuft im Cluster (WORKERS = max(2, Kerne)).
Aus „ein Aufruf je 30 Sekunden" würden dann N Aufrufe je 30 Sekunden — ohne
dass es irgendwo auffiele, denn jede einzelne Instanz hielte ihre Grenze
korrekt ein.

Genau dieser Fehler ist in diesem Baum zweimal gefunden und behoben worden:

  * src/konto/loginLimiter.ts — „bei N Cluster-Workern werden aus 5
    Fehlversuchen sonst N×5".
  * utils/rateLimiter.ts — das Rebrickable-Tageskontingent lag in
    `this.count` eines Prozesses; auf einem Vierkerner waren 100'000
    Aufrufe möglich, wo 25'000 eingestellt waren.

Die Lösung ist dieselbe wie dort und wie bei BrickLink/Brickset
(checkAndIncrementRateLimit): eine Zeile, in einer Transaktion gelesen und
geschrieben, mit `FOR UPDATE`. Damit kann genau ein Arbeiter den Platz
belegen; alle anderen sehen ihn belegt.

── Warum eine eigene Tabelle ───────────────────────────────────────────────

Der erste Entwurf legte die zwei Zeitpunkte in der zentralen
Schlüssel-Wert-Tabelle der globalen Einstellungen ab, wie die `api_calls_*`.
scripts/check-global-settings.js hat das zurückgewiesen, und beim Nachsehen
zu Recht: Dort gilt, dass diese Tabelle über src/konto/settings.ts angefasst
wird, und genau das geht hier nicht — getGlobalSetting() hat seine eigene
Verbindung und gäbe die Sperre auf, um die es geht. Die eigene Tabelle
(Migration 0039) ist dafür der richtige Ort und spart zugleich zwei
Ausnahmen: eine in der Einstellungsseite und eine im
Konfigurations-Export.

── Die Uhr ist die der DATENBANK ───────────────────────────────────────────

Gerechnet wird in SQL mit `NOW()`, nicht in JavaScript mit `Date.now()`.
Nicht aus Vorsicht gegen abweichende Uhren — im Cluster ist es dieselbe
Maschine —, sondern weil der Vergleich und das Schreiben so in DERSELBEN
Anweisung stehen. Zwei Uhren für einen Vergleich sind eine Fehlerquelle,
die man nicht braucht, wenn eine genügt.

── Der Platz wird VOR dem Abruf belegt ─────────────────────────────────────

Belegt wird er auch dann, wenn die Abfrage danach scheitert. Das ist
Absicht: Die Grenze zählt ABGESETZTE Anfragen, und eine Anfrage, die mit
einem Fehler zurückkommt, ist abgesetzt worden. Andernfalls liesse sich die
Grenze durch wiederholtes Scheitern beliebig oft umgehen — und ein
Endpunkt, der gerade zickt, ist genau der, den man nicht im Sekundentakt
fragen soll.

── Die 30 Minuten Pause sind MEINE Zahl ────────────────────────────────────

Die 30 Sekunden stehen in Marcos Vorgabe, die fünf Minuten Token-Puffer im
Prototyp. Für die Pause nach einem Bot-Schutz-Treffer sagt keine der beiden
Quellen etwas — die 30 Minuten habe ich gewählt, und das soll hier stehen
statt als Zahl ohne Herkunft im Code.

Begründung: Ein Bot-Schutz wird nicht dadurch milder, dass man ihn gleich
noch einmal fragt; und seit der Notweg entfällt (Marcos Wunsch), ist Warten
die einzige Antwort, die der Baum darauf hat. Eine halbe Stunde ist lang
genug, dass die Oberfläche nicht dauernd gegen eine Wand läuft, und kurz
genug, dass niemand den Server neu starten will. Die Sperre läuft von
selbst ab, und die Oberfläche nennt die Restzeit.
```

<a id="belegeplatz"></a>
## `belegePlatz`

```text
Den Platz belegen — oder sagen, wie lange es noch dauert.

Eine Transaktion, eine Anweisung mit `FOR UPDATE`, feste Reihenfolge über
`ORDER BY key`: Letzteres verhindert, dass zwei gleichzeitige Transaktionen
dieselben zwei Zeilen in unterschiedlicher Folge sperren und sich
gegenseitig blockieren (dieselbe Begründung steht in
checkAndIncrementRateLimit).
```

<a id="frageguthabenab"></a>
## `frageGuthabenAb`

```text
Das Guthaben abfragen — durch die Schranke.

Der eine Weg, auf dem in diesem Baum eine Guthaben-Abfrage entsteht. Die
Route ruft hier an und nicht bei `holeGuthaben()`: So kann kein zweiter
Aufrufer später die Grenze umgehen, ohne es zu merken.

Ein echter Fehler (kaputter Endpunkt, falsche PIN, kein Token) FLIEGT —
darüber muss der Mensch am Knopf etwas erfahren. Nur der Bot-Schutz wird
hier zu einer Antwort umgeformt, weil daran eine Handlung hängt: die Pause.
```
