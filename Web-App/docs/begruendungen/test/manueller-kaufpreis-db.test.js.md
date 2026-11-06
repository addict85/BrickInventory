# Begründungen zu `test/manueller-kaufpreis-db.test.js`

Die ausführlichen Kommentare aus `test/manueller-kaufpreis-db.test.js`, wörtlich. Im Code steht je
Stelle der erste Absatz und ein Verweis hierher. Neue Geschichte gehört in die
Commit-Nachricht (siehe CLAUDE.md).

<a id="kopf"></a>
## `Kopf der Datei`

```text
Teil und Minifigur ohne Marktpreis hinterlassen DASSELBE.

── Der Befund ──────────────────────────────────────────────────────────────

`resolveManualPartPurchase` (routes/parts.ts) und `resolveManualFigPurchase`
(routes/minifigs.ts) waren bis auf die Marktpreis-Abfrage gleich — mit einem
Unterschied, den die Doppelungsmessung sichtbar gemacht hat:

    Teile:       … ?? 0     ← liefert BrickLink nichts, steht 0 in der Zeile
    Minifiguren: (fehlte)   ← dann stand NULL

Bei den Teilen steht der Grund im Quelltext: „sonst zeigt das Kaufpreis-Feld
im Frontend dauerhaft den Marktpreis-Platzhalter". src/finanzen/financeCalc.ts liest
beide Fälle unterschiedlich (`hasCost = … != null; // 0 zählt als erfasst`):
Eine Figur ohne ermittelbaren Marktpreis galt als „kein Kaufpreis erfasst",
ein Teil in derselben Lage als „0 erfasst". Derselbe Fix war bei den Teilen
gemacht und bei den Figuren liegen geblieben.

── Der zweite Teil, und der ist der feinere ────────────────────────────────

In der STAMMZEILE ist die 0 ein Anzeigewert. In der ERFASSUNG hiesse sie
„für null Franken gekauft" — dort gehört NULL hin. Diese Umwandlung stand
in routes/minifigs.ts an EINER von DREI Stellen: bei der Zweiterfassung ja,
bei der Neuanlage nein, im CSV-Import nein.

Beides ist jetzt eine Sache: src/finanzen/preisRegel.ts gibt `kaufpreis` (nie null)
und `erfassungsPreis` (null, wenn unbekannt) getrennt zurück, und keine
Schreibstelle rechnet mehr selbst.

── Was Migration 0035 daran geändert hat ───────────────────────────────────

Die Stammzeile hat keinen Preis mehr — er gehört je Kauf in die Erfassung.
Der ANZEIGEWERT (nie leer, 0 heisst „nichts bekannt") wird jetzt beim Lesen
gebildet: COALESCE(neueste Erfassung, 0) in getManualParts bzw.
getManualMinifigs.

Der Unterschied, den dieser Test gefunden hat, ist damit nicht nur behoben,
sondern unmöglich geworden: Es gibt nur noch EINEN Ausdruck, der die 0
erzeugt, und beide Listen benutzen ihn. Geprüft wird deshalb jetzt die
ANTWORT der beiden Listen statt der Spalteninhalt — die Aussage bleibt
dieselbe, die Frage ist dieselbe.

── Warum gegen die echte Datenbank ────────────────────────────────────────

Am Quelltext wäre es die Frage, ob dieselbe Variable an beiden Stellen
steht. Interessant ist, was am Ende IN DEN TABELLEN liegt — und zwar beim
Teil und bei der Figur verglichen. Dieselbe Begründung wie in
teile-import-preis-db.test.js nebenan.

Ohne BrickLink-Zugang liefert die Marktpreis-Abfrage nichts; genau das ist
der Fall, um den es geht, und im Testlauf ist er der Normalfall.

Voraussetzung: Test-DB via TEST_DATABASE_URL.
```
